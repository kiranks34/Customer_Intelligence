"use server";

import { revalidatePath } from "next/cache";

import { authed, budgetBlock, errorText, type ActionState } from "@/lib/action-guards";
import { familyKey, familyTerms, findMentions, treeFromDraft, treeLimitError, TreeNodeSchema } from "@/lib/catalog";
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

    let catalogId: number;
    try {
      catalogId = await createCatalog(key, treeFromDraft(drafted.draft));
    } catch (err) {
      // Another tab may have created the same family's catalog a moment ago (unique key): use that one.
      const raced = await catalogByKey(key);
      if (!raced) throw err;
      catalogId = raced.id;
    }
    await linkSearch(searchId, catalogId);
    await matchSearch(searchId, catalogId);
    revalidatePath(`/searches/${searchId}`);
    return { ok: true, catalogId, message: "Catalog drafted. Review it, then approve." };
  } catch (err) {
    return { ok: false, message: `Couldn't build the catalog: ${errorText(err)}` };
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
