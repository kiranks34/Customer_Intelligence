"use server";

import { revalidatePath } from "next/cache";

import { authed, budgetBlock, errorText, type ActionState } from "@/lib/action-guards";
import { familyKey, familyTerms, findMentions, treeFromDraft, treeLimitError, TreeNodeSchema, type TreeNode } from "@/lib/catalog";
import { applyReference, treeFromReference } from "@/lib/catalog-reference";
import { referenceFor } from "@/lib/catalog-references";
import { CatalogDraftError, draftCatalog } from "@/lib/catalog-drafter";
import { approveCatalog, catalogByKey, createCatalog, getCatalog, linkSearch, matchCatalog, matchSearch, postTexts, saveTree } from "@/lib/catalogs";
import { loadPlan } from "@/lib/collect";
import { recordCost } from "@/lib/cost";

export type BuildResult = (ActionState & { ok: true; catalogId: number }) | (ActionState & { ok: false });

/**
 * Gives a search its product catalog. Searches of the same family share one: if it exists, the search is linked
 * to it and no AI call is made. Otherwise Claude drafts one from the model mentions in this search's posts.
 */
export async function buildCatalogAction(searchId: number): Promise<BuildResult> {
  const denied = await authed();
  if (denied) return { ok: false, message: denied.message };
  try {
    const latest = await loadPlan(searchId);
    if (!latest) return { ok: false, message: "Search not found." };
    const { plan } = latest;
    const key = familyKey(plan.subject);
    if (!key) return { ok: false, message: "The plan's subject is empty." };

    const existing = await catalogByKey(key);
    if (existing) {
      await linkSearch(searchId, existing.id);
      await matchSearch(searchId, existing.id);
      revalidatePath(`/searches/${searchId}`);
      return { ok: true, catalogId: existing.id, message: `Using the existing ${existing.name} catalog.` };
    }

    // A verified reference (researched from the maker's own pages) replaces the AI draft: no AI call, no guesses.
    const reference = referenceFor(key);
    if (reference) {
      const catalogId = await createOrReuse(key, treeFromReference(reference));
      await linkSearch(searchId, catalogId);
      await matchSearch(searchId, catalogId);
      revalidatePath(`/searches/${searchId}`);
      return { ok: true, catalogId, message: `Built from HP's verified list (checked ${reference.checkedAt}).` };
    }

    const blocked = await budgetBlock();
    if (blocked) return { ok: false, message: blocked.message };
    const texts = await postTexts({ searchId });
    if (texts.length === 0) return { ok: false, message: "Collect some posts first: the catalog is drafted from what people mention." };

    const mentions = findMentions(texts, familyTerms([plan.subject, ...plan.aliases.filter((a) => !/\d/.test(a))]));
    let drafted;
    try {
      drafted = await draftCatalog({ family: plan.subject, knownNames: plan.aliases, mentions, postCount: texts.length });
    } catch (err) {
      if (err instanceof CatalogDraftError && err.cost) await recordCost({ searchId, ...err.cost }).catch(() => undefined);
      return { ok: false, message: `Couldn't draft the catalog: ${errorText(err)}` };
    }
    await recordCost({ searchId, ...drafted.cost }).catch(() => undefined);

    const catalogId = await createOrReuse(key, treeFromDraft(drafted.draft));
    await linkSearch(searchId, catalogId);
    await matchSearch(searchId, catalogId);
    revalidatePath(`/searches/${searchId}`);
    return { ok: true, catalogId, message: "Catalog drafted. Review it, then approve." };
  } catch (err) {
    return { ok: false, message: `Couldn't build the catalog: ${errorText(err)}` };
  }
}

/** Creates the family's catalog, or uses the one another tab created a moment ago (the key is unique). */
async function createOrReuse(key: string, tree: TreeNode): Promise<number> {
  try {
    return await createCatalog(key, tree);
  } catch (err) {
    const raced = await catalogByKey(key);
    if (!raced) throw err;
    return raced.id;
  }
}

/**
 * Replaces the catalog with its family's verified reference, keeping ids of the same products so post links
 * survive. Nodes the reference doesn't contain are removed (they couldn't be verified) and named in the message.
 */
export async function applyReferenceAction(catalogId: number): Promise<ActionState> {
  const denied = await authed();
  if (denied) return denied;
  try {
    const found = await getCatalog(catalogId);
    if (!found) return { ok: false, message: "Catalog not found." };
    const reference = referenceFor(found.catalog.key);
    if (!reference) return { ok: false, message: "There is no verified list for this family yet." };
    const { tree, removed } = applyReference(found.tree, reference);
    await saveTree(catalogId, tree);
    await matchCatalog(catalogId);
    revalidatePath(`/catalogs/${catalogId}`);
    const models = tree.children.reduce((n, s) => n + s.children.length, 0);
    const gone = removed.length ? ` Removed ${removed.length} that couldn't be verified: ${removed.slice(0, 8).join(", ")}${removed.length > 8 ? "…" : ""}.` : "";
    return { ok: true, message: `Updated from HP's verified list: ${tree.children.length} series, ${models} models.${gone}` };
  } catch (err) {
    return { ok: false, message: `Couldn't update the catalog: ${errorText(err)}` };
  }
}

/** Saves an edited catalog (and approves it when asked), then re-links every linked search's posts. */
export async function saveCatalogAction(catalogId: number, tree: unknown, approve: boolean): Promise<ActionState> {
  const denied = await authed();
  if (denied) return denied;
  const parsed = TreeNodeSchema.safeParse(tree);
  if (!parsed.success || parsed.data.level !== "family") return { ok: false, message: "The catalog couldn't be read. Reload and try again." };
  const tooBig = treeLimitError(parsed.data);
  if (tooBig) return { ok: false, message: tooBig };
  try {
    if (!(await getCatalog(catalogId))) return { ok: false, message: "Catalog not found." };
    await saveTree(catalogId, parsed.data);
    if (approve) await approveCatalog(catalogId);
    await matchCatalog(catalogId);
    revalidatePath(`/catalogs/${catalogId}`);
    return { ok: true, message: approve ? "Approved. Posts were re-linked to the models." : "Saved. Posts were re-linked to the models." };
  } catch (err) {
    return { ok: false, message: `Couldn't save the catalog: ${errorText(err)}` };
  }
}
