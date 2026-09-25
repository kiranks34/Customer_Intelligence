"use server";

import { revalidatePath } from "next/cache";

import { authed, budgetBlock, errorText, type ActionState } from "@/lib/action-guards";
import { CATALOG_LIMITS, familyKey, familyTerms, findMentions, nameConflict, normalize, treeFromDraft, type TreeNode } from "@/lib/catalog";
import { applyReference, treeFromReference } from "@/lib/catalog-reference";
import { referenceFor } from "@/lib/catalog-references";
import { CatalogDraftError, draftCatalog } from "@/lib/catalog-drafter";
import { approveCatalog, catalogByKey, catalogNode, createCatalog, getCatalog, linkSearch, matchCatalog, matchSearch, postTexts, saveTree, setAliases, setRetired } from "@/lib/catalogs";
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
    const subjectKey = familyKey(plan.subject);
    if (!subjectKey) return { ok: false, message: "The plan's subject is empty." };
    // A family with a verified reference always uses the reference's key, so "Smart Tank" and "HP SmartTank"
    // searches share one catalog.
    const reference = referenceFor(subjectKey);
    const key = reference?.key ?? subjectKey;

    const existing = await catalogByKey(key);
    if (existing) {
      await linkSearch(searchId, existing.id);
      await matchSearch(searchId, existing.id);
      revalidatePath(`/searches/${searchId}`);
      return { ok: true, catalogId: existing.id, message: `Using the existing ${existing.name} catalog.` };
    }

    // A verified reference (researched from the maker's own pages) replaces the AI draft: no AI call, no guesses.
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


const NAME_MAX = 80;

/**
 * Adds a name people use for a series or model. Refused when another product already has it, so two products are
 * never merged by accident. Posts are re-linked so the new name counts straight away.
 */
export async function addNameAction(catalogId: number, nodeId: number, name: string): Promise<ActionState> {
  const denied = await authed();
  if (denied) return denied;
  const clean = String(name ?? "").trim().replace(/\s+/g, " ");
  if (!clean) return { ok: false, message: "Type a name first." };
  if (clean.length > NAME_MAX) return { ok: false, message: `Keep names under ${NAME_MAX} characters.` };
  try {
    const [found, node] = await Promise.all([getCatalog(catalogId), catalogNode(catalogId, nodeId)]);
    if (!found || !node || node.level === "family") return { ok: false, message: "That product isn't in this catalog." };
    if ([node.name, ...node.aliases].some((a) => normalize(a) === normalize(clean))) return { ok: true, message: `“${clean}” is already recognised.` };
    const clash = nameConflict(found.tree, nodeId, clean);
    if (clash) return { ok: false, message: `“${clean}” already means ${clash}. Use a name that only fits ${node.name}.` };
    await setAliases(nodeId, [...node.aliases, clean].slice(0, CATALOG_LIMITS.aliases));
    await matchCatalog(catalogId);
    revalidatePath(`/catalogs/${catalogId}`);
    return { ok: true, message: `Added “${clean}”. Posts were re-linked.` };
  } catch (err) {
    return { ok: false, message: `Couldn't add the name: ${errorText(err)}` };
  }
}

export async function removeNameAction(catalogId: number, nodeId: number, name: string): Promise<ActionState> {
  const denied = await authed();
  if (denied) return denied;
  try {
    const node = await catalogNode(catalogId, nodeId);
    if (!node) return { ok: false, message: "That product isn't in this catalog." };
    await setAliases(
      nodeId,
      node.aliases.filter((a) => a !== name),
    );
    await matchCatalog(catalogId);
    revalidatePath(`/catalogs/${catalogId}`);
    return { ok: true, message: `Removed “${name}”. Posts were re-linked.` };
  } catch (err) {
    return { ok: false, message: `Couldn't remove the name: ${errorText(err)}` };
  }
}

/** Retires (sunset) or restores a series or model. Retired products leave the pickers; past post links stay. */
export async function setRetiredAction(catalogId: number, nodeId: number, retired: boolean): Promise<ActionState> {
  const denied = await authed();
  if (denied) return denied;
  try {
    const node = await catalogNode(catalogId, nodeId);
    if (!node || node.level === "family") return { ok: false, message: "That product isn't in this catalog." };
    await setRetired(catalogId, nodeId, retired);
    revalidatePath(`/catalogs/${catalogId}`);
    const what = node.level === "series" ? `${node.name} and its models` : node.name;
    return { ok: true, message: retired ? `Retired ${what}. Past posts stay linked.` : `Restored ${what}.` };
  } catch (err) {
    return { ok: false, message: `Couldn't update: ${errorText(err)}` };
  }
}

export async function approveCatalogAction(catalogId: number): Promise<ActionState> {
  const denied = await authed();
  if (denied) return denied;
  try {
    if (!(await getCatalog(catalogId))) return { ok: false, message: "Catalog not found." };
    await approveCatalog(catalogId);
    revalidatePath(`/catalogs/${catalogId}`);
    return { ok: true, message: "Catalog approved." };
  } catch (err) {
    return { ok: false, message: `Couldn't approve: ${errorText(err)}` };
  }
}
