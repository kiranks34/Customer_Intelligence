"use server";

import { revalidatePath } from "next/cache";

import { authed, errorText, type ActionState } from "@/lib/action-guards";
import { CATALOG_LIMITS, familyKey, nameConflict, normalize, type TreeNode } from "@/lib/catalog";
import { referenceFor } from "@/lib/catalog-references";
import {
  addNode,
  approveProposal,
  catalogByKey,
  catalogNode,
  createCatalog,
  findProposals,
  getCatalog,
  listProposals,
  markVerified,
  matchCatalog,
  proposalNode,
  rejectProposal,
  setAliases,
  setRetired,
  unverifiedNodes,
  type Proposal,
} from "@/lib/catalogs";

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

// ---- Check for new models (proposals) and manual additions ---------------------------------------------------

/** "Check for new models": suggests what's missing, from the verified list and from collected posts. */
export async function updateCatalogAction(catalogId: number): Promise<ActionState> {
  const denied = await authed();
  if (denied) return denied;
  try {
    const { reference, posts } = await findProposals(catalogId);
    revalidatePath(`/catalogs/${catalogId}`);
    const total = reference + posts;
    if (total === 0) return { ok: true, message: "No new models. The catalog has everything in HP's list and every model named in 2+ of your posts." };
    const parts = [reference ? `${reference} from HP's list` : null, posts ? `${posts} from your posts` : null].filter(Boolean).join(" and ");
    return { ok: true, message: `Found ${total} new: ${parts}. Add or skip each one above.` };
  } catch (err) {
    return { ok: false, message: `Couldn't check for new models: ${errorText(err)}` };
  }
}

const cleanInput = (s: string) => String(s ?? "").trim().replace(/\s+/g, " ");

/** Adds a suggested product with the name (and, for a model, the series) you chose. */
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
      if (!series) return { ok: false, message: "Pick the series it belongs to (add a new series first)." };
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
    const kept = held.length ? ` ${held.join(", ")} stay in the review list because another product already has that name.` : "";
    return { ok: true, message: `Added ${clean}${models}. Posts were re-linked.${kept}` };
  } catch (err) {
    return { ok: false, message: `Couldn't add: ${errorText(err)}` };
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
    return { ok: true, message: `Skipped ${node.name}. It won't be suggested again.` };
  } catch (err) {
    return { ok: false, message: `Couldn't skip: ${errorText(err)}` };
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

/** "Keep": you confirm a product that isn't in the verified list (e.g. from an old AI draft). */
export async function keepAction(catalogId: number, nodeId: number): Promise<ActionState> {
  const denied = await authed();
  if (denied) return denied;
  try {
    const node = await catalogNode(catalogId, nodeId);
    if (!node || node.level === "family") return { ok: false, message: "That product isn't in this catalog." };
    await markVerified(catalogId, nodeId);
    revalidatePath(`/catalogs/${catalogId}`);
    return { ok: true, message: `Kept ${node.name}.` };
  } catch (err) {
    return { ok: false, message: `Couldn't update: ${errorText(err)}` };
  }
}

/** "Remove": retires a product that isn't in the verified list. A series holding verified models stays. */
export async function removeUnlistedAction(catalogId: number, nodeId: number): Promise<ActionState> {
  const denied = await authed();
  if (denied) return denied;
  try {
    const target = (await unverifiedNodes(catalogId)).find((n) => n.id === nodeId);
    if (!target) return { ok: false, message: "That product is no longer waiting for review." };
    if (target.holdsListed) return { ok: false, message: `${target.name} holds models from HP's verified list, so it stays. Use Keep.` };
    return await setRetiredAction(catalogId, nodeId, true);
  } catch (err) {
    return { ok: false, message: `Couldn't remove: ${errorText(err)}` };
  }
}
