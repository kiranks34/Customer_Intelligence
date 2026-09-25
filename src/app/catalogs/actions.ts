"use server";

import { revalidatePath } from "next/cache";

import { authed, budgetBlock, errorText, type ActionState } from "@/lib/action-guards";
import { CATALOG_LIMITS, familyKey, familyTerms, findMentions, nameConflict, normalize, treeFromDraft, type TreeNode } from "@/lib/catalog";
import { applyReference, treeFromReference } from "@/lib/catalog-reference";
import { referenceFor } from "@/lib/catalog-references";
import { CatalogDraftError, draftCatalog } from "@/lib/catalog-drafter";
import {
  addNode,
  approveCatalog,
  approveProposal,
  catalogByKey,
  catalogNode,
  createCatalog,
  findProposals,
  getCatalog,
  listProposals,
  linkSearch,
  matchCatalog,
  matchSearch,
  postTexts,
  proposalNode,
  rejectProposal,
  saveTree,
  setAliases,
  setRetired,
  type Proposal,
} from "@/lib/catalogs";
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
    if (node.aliases.length >= CATALOG_LIMITS.aliases) {
      return { ok: false, message: `${node.name} already has ${CATALOG_LIMITS.aliases} names. Remove one before adding another.` };
    }
    await setAliases(nodeId, [...node.aliases, clean]);
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

// ---- Update product catalog (proposals) and manual additions ---------------------------------------------------

/** "Update product catalog": proposes what's missing, from the verified list and from collected posts. */
export async function updateCatalogAction(catalogId: number): Promise<ActionState> {
  const denied = await authed();
  if (denied) return denied;
  try {
    const { reference, posts } = await findProposals(catalogId);
    revalidatePath(`/catalogs/${catalogId}`);
    const total = reference + posts;
    if (total === 0) return { ok: true, message: "Nothing new found. The catalog covers the verified list and every model named in 2+ posts." };
    const parts = [reference ? `${reference} from HP's verified list` : null, posts ? `${posts} named in your posts` : null].filter(Boolean).join(" and ");
    return { ok: true, message: `Found ${total} to review: ${parts}.` };
  } catch (err) {
    return { ok: false, message: `Couldn't update the catalog: ${errorText(err)}` };
  }
}

const cleanInput = (s: string) => String(s ?? "").trim().replace(/\s+/g, " ");

/** Approves a proposal with the name (and, for a model, the series) you chose. */
export async function approveProposalAction(catalogId: number, nodeId: number, name: string, seriesId: number | null): Promise<ActionState> {
  const denied = await authed();
  if (denied) return denied;
  const clean = cleanInput(name);
  if (!clean || clean.length > NAME_MAX) return { ok: false, message: "Give it a name (up to 80 characters)." };
  try {
    const [found, node] = await Promise.all([getCatalog(catalogId), proposalNode(catalogId, nodeId)]);
    if (!found || !node || found.tree.id === null) return { ok: false, message: "That proposal is no longer waiting." };
    let parentId = found.tree.id;
    if (node.level === "model") {
      const series = found.tree.children.find((s) => s.id === seriesId && !s.retired);
      if (!series) return { ok: false, message: "Pick the series it belongs to (approve a proposed series first)." };
      parentId = series.id!;
    }
    const clash = nameConflict(found.tree, nodeId, clean);
    if (clash) return { ok: false, message: `“${clean}” already means ${clash}.` };
    // A series brings its waiting models along, except any whose name or number another product already has.
    let childIds: number[] = [];
    let held: string[] = [];
    if (node.level === "series") {
      const children = (await listProposals(catalogId)).filter((p) => p.parentId === nodeId);
      const clashes = (p: Proposal) => [p.name, ...p.aliases].some((n) => nameConflict(found.tree, p.id, n));
      childIds = children.filter((p) => !clashes(p)).map((p) => p.id);
      held = children.filter(clashes).map((p) => p.name);
    }
    await approveProposal(catalogId, nodeId, clean, parentId, childIds);
    await matchCatalog(catalogId);
    revalidatePath(`/catalogs/${catalogId}`);
    const models = childIds.length ? ` with ${childIds.length} models` : "";
    const kept = held.length ? ` ${held.join(", ")} stayed in To review because another product already has that name.` : "";
    return { ok: true, message: `Added ${clean}${models}. Posts were re-linked.${kept}` };
  } catch (err) {
    return { ok: false, message: `Couldn't approve: ${errorText(err)}` };
  }
}

export async function rejectProposalAction(catalogId: number, nodeId: number): Promise<ActionState> {
  const denied = await authed();
  if (denied) return denied;
  try {
    const node = await proposalNode(catalogId, nodeId);
    if (!node) return { ok: false, message: "That proposal is no longer waiting." };
    await rejectProposal(catalogId, nodeId);
    revalidatePath(`/catalogs/${catalogId}`);
    return { ok: true, message: `Rejected ${node.name}. It won't be proposed again.` };
  } catch (err) {
    return { ok: false, message: `Couldn't reject: ${errorText(err)}` };
  }
}

/** Adds a series (under the family) or a model (under a series) that you typed. A model's number becomes a name too. */
export async function addProductAction(catalogId: number, level: "series" | "model", name: string, seriesId: number | null, number: string): Promise<ActionState> {
  const denied = await authed();
  if (denied) return denied;
  const clean = cleanInput(name);
  const num = cleanInput(number).toLowerCase();
  if (!clean || clean.length > NAME_MAX) return { ok: false, message: "Give it a name (up to 80 characters)." };
  if (num && !/^\d{3,4}[a-z]{0,2}$/.test(num)) return { ok: false, message: "A model number is 3–4 digits, optionally with letters, e.g. 7301 or 9125r." };
  try {
    const found = await getCatalog(catalogId);
    if (!found || found.tree.id === null) return { ok: false, message: "Catalog not found." };
    let parentId = found.tree.id;
    if (level === "model") {
      const series = found.tree.children.find((s) => s.id === seriesId && !s.retired);
      if (!series) return { ok: false, message: "Pick a series first." };
      parentId = series.id!;
    }
    for (const n of [clean, num].filter(Boolean)) {
      const clash = nameConflict(found.tree, -1, n);
      if (clash) return { ok: false, message: `“${n}” already means ${clash}.` };
    }
    await addNode(catalogId, parentId, level, clean, num ? [num] : []);
    await matchCatalog(catalogId);
    revalidatePath(`/catalogs/${catalogId}`);
    return { ok: true, message: `Added ${clean}.` };
  } catch (err) {
    return { ok: false, message: `Couldn't add: ${errorText(err)}` };
  }
}

export type AddFamilyResult = (ActionState & { ok: true; catalogId: number }) | (ActionState & { ok: false });

/** Adds a new product family (its own catalog), e.g. "HP DeskJet" for cartridge printers. */
export async function addFamilyAction(name: string): Promise<AddFamilyResult> {
  const denied = await authed();
  if (denied) return { ok: false, message: denied.message };
  const clean = cleanInput(name);
  const key = familyKey(clean);
  if (!clean || !key || clean.length > NAME_MAX) return { ok: false, message: "Give the family a name (up to 80 characters)." };
  try {
    const existing = (await catalogByKey(referenceFor(key)?.key ?? key)) ?? null;
    if (existing) return { ok: false, message: `${existing.name} already exists.` };
    const catalogId = await createOrReuse(referenceFor(key)?.key ?? key, { id: null, level: "family", name: clean, aliases: [], verified: false, children: [] });
    return { ok: true, catalogId, message: `Added the ${clean} family.` };
  } catch (err) {
    return { ok: false, message: `Couldn't add the family: ${errorText(err)}` };
  }
}
