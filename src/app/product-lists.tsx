"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";

export interface ListModel {
  id: number;
  name: string;
  /** Posts collected so far (all searches) that name this model. */
  posts: number;
}

export interface ListSeries {
  id: number;
  name: string;
  /** Posts collected so far that name this series or one of its models. */
  posts: number;
  models: ListModel[];
}

export interface ListFamily {
  id: number;
  name: string;
  /** Posts collected so far that name any series or model of the family. */
  posts: number;
  /** New products waiting for Add or Skip on the catalog page. */
  waiting: number;
  series: ListSeries[];
}

/** What's picked: a family, optionally one series (null = all), optionally one model in it (null = all). */
export interface Pick {
  seriesId: number | null;
  modelId: number | null;
}

const key = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[-_/]+/g, " ").replace(/\s+/g, " ").trim();
const compact = (s: string) => key(s).replace(/\s+/g, "");

/** A name without the brand and family words the tab already shows: "HP Smart Tank 7300 series" → "7300 series". */
export function shortName(name: string, familyName: string): string {
  const family = familyName.replace(/^HP\s+/i, "");
  const out = name
    .replace(/^HP\s+/i, "")
    .replace(new RegExp(`^${family.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*")}\\s+`, "i"), "")
    .trim();
  return out || name;
}

const byPostsThenName = <T extends { posts: number; name: string }>(a: T, b: T) =>
  b.posts - a.posts || a.name.localeCompare(b.name, undefined, { numeric: true });

/** The default pick: the most discussed series, all its models. */
export function defaultPick(family: ListFamily | null): Pick {
  const top = family ? [...family.series].sort(byPostsThenName)[0] : undefined;
  return { seriesId: top?.id ?? null, modelId: null };
}

/** Family tabs, with the actions that belong to the whole catalog on the right. */
export function FamilyTabs(props: {
  families: { id: number; name: string }[];
  selected: number | "other" | null;
  onSelect: (id: number | "other") => void;
  /** "+ Family" form result; the parent adds the family and selects it. */
  onAddFamily?: (name: string) => void;
  /** Shows an "Other topic" tab for searches outside the catalog. */
  other?: boolean;
  pending?: boolean;
  right?: ReactNode;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const tab = (on: boolean) =>
    `rounded-full border px-3.5 py-1.5 text-sm transition-colors ${on ? "border-foreground bg-foreground font-medium text-background" : "border-border hover:border-foreground/40"}`;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-border px-5 py-3">
      <div role="tablist" aria-label="Product family" className="flex flex-wrap items-center gap-2">
        {props.families.map((f) => (
          <button key={f.id} type="button" role="tab" aria-selected={props.selected === f.id} onClick={() => props.onSelect(f.id)} className={tab(props.selected === f.id)}>
            {f.name}
          </button>
        ))}
        {props.other && (
          <button type="button" role="tab" aria-selected={props.selected === "other"} onClick={() => props.onSelect("other")} className={tab(props.selected === "other")}>
            Other topic
          </button>
        )}
        {props.onAddFamily &&
          (adding ? (
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!name.trim()) return;
                props.onAddFamily!(name.trim());
                setAdding(false);
                setName("");
              }}
            >
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. HP DeskJet"
                aria-label="New family name"
                className="w-40 rounded-full border border-border bg-background px-3.5 py-1.5 text-sm"
              />
              <button type="submit" disabled={props.pending || !name.trim()} className="rounded-full bg-accent px-3.5 py-1.5 text-sm font-medium text-white disabled:opacity-50">
                Add
              </button>
              <button type="button" onClick={() => setAdding(false)} className="text-sm text-muted underline">
                Cancel
              </button>
            </form>
          ) : (
            <button type="button" onClick={() => setAdding(true)} className="rounded-full border border-dashed border-border px-3.5 py-1.5 text-sm text-muted hover:border-foreground/40">
              + Family
            </button>
          ))}
      </div>
      {props.right && <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">{props.right}</div>}
    </div>
  );
}

/** The review badge and "Manage catalog" link for a family, shown on the right of the tabs. */
export function CatalogLinks({ family }: { family: ListFamily }) {
  return (
    <>
      {family.waiting > 0 && (
        <Link href={`/catalogs/${family.id}`} className="rounded-full border border-warning/60 bg-warning/15 px-3 py-1 font-medium hover:bg-warning/25">
          {family.waiting} new {family.waiting === 1 ? "product" : "products"} to review
        </Link>
      )}
      <Link href={`/catalogs/${family.id}`} className="font-medium text-accent hover:underline">
        Manage catalog →
      </Link>
    </>
  );
}

/**
 * The series and model lists of one family with a shared finder, most discussed first. Bars show posts already
 * collected, so you can see where there is evidence before picking. Both lists scroll inside a fixed height.
 */
export function ProductLists(props: {
  family: ListFamily;
  pick: Pick;
  onPick: (p: Pick) => void;
  seriesAction?: ReactNode;
  modelAction?: ReactNode;
  /** Hint beside the Models heading ("optional" when picking what to search). */
  modelHint?: string;
}) {
  const { family, pick, onPick } = props;
  const [query, setQuery] = useState("");
  const q = compact(query);
  const matches = (name: string) => !q || compact(shortName(name, family.name)).includes(q) || compact(name).includes(q);

  const series = [...family.series].sort(byPostsThenName);
  const shownSeries = q ? series.filter((s) => matches(s.name) || s.models.some((m) => matches(m.name))) : series;
  const current = family.series.find((s) => s.id === pick.seriesId) ?? null;
  const models = current ? [...current.models].sort(byPostsThenName) : [];
  const shownModels = q && current && !matches(current.name) ? models.filter((m) => matches(m.name)) : models;

  function find(value: string) {
    setQuery(value);
    const v = compact(value);
    if (!v) return;
    // One matching series (or model) is picked straight away, so typing "7301" is enough.
    const hits = series.filter((s) => compact(s.name).includes(v) || compact(shortName(s.name, family.name)).includes(v) || s.models.some((m) => compact(m.name).includes(v)));
    if (hits.length !== 1) return;
    const modelHits = hits[0].models.filter((m) => compact(m.name).includes(v));
    onPick({ seriesId: hits[0].id, modelId: modelHits.length === 1 && !compact(hits[0].name).includes(v) ? modelHits[0].id : null });
  }

  const maxSeries = Math.max(1, ...series.map((s) => s.posts));
  const maxModel = Math.max(1, ...models.map((m) => m.posts));

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-1 px-5 pt-4 sm:flex-row sm:items-center sm:gap-3">
        <label htmlFor={`find-${family.id}`} className="sr-only">
          Find a series or model
        </label>
        <input
          id={`find-${family.id}`}
          type="search"
          value={query}
          onChange={(e) => find(e.target.value)}
          placeholder="Find a series or model, e.g. 7301 or 580"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm sm:max-w-sm"
        />
        {q && (
          <span className="text-xs text-muted">
            {shownSeries.length} series match
          </span>
        )}
      </div>
      <div className="grid sm:grid-cols-2">
        <Column title="Series" count={family.series.length} hint="most discussed first" action={props.seriesAction}>
          <Row
            label={`All ${family.series.length} series`}
            posts={family.posts}
            width={family.posts ? 100 : 0}
            on={pick.seriesId === null}
            strong
            onClick={() => onPick({ seriesId: null, modelId: null })}
          />
          {shownSeries.map((s) => (
            <Row
              key={s.id}
              label={shortName(s.name, family.name)}
              title={s.name}
              posts={s.posts}
              width={(s.posts / maxSeries) * 100}
              on={pick.seriesId === s.id}
              onClick={() => onPick({ seriesId: s.id, modelId: null })}
            />
          ))}
          {shownSeries.length === 0 && <Empty>No series match “{query}”.</Empty>}
        </Column>
        <Column
          title={current ? `Models in ${shortName(current.name, family.name)}` : "Models"}
          count={current ? current.models.length : null}
          hint={props.modelHint ?? "optional"}
          action={props.modelAction}
          divider
        >
          {current ? (
            <>
              <Row
                label={`All ${current.models.length} models`}
                posts={current.posts}
                width={current.posts ? 100 : 0}
                on={pick.modelId === null}
                strong
                onClick={() => onPick({ seriesId: current.id, modelId: null })}
              />
              {shownModels.map((m) => (
                <Row
                  key={m.id}
                  label={shortName(m.name, family.name)}
                  title={m.name}
                  posts={m.posts}
                  width={(m.posts / maxModel) * 100}
                  on={pick.modelId === m.id}
                  onClick={() => onPick({ seriesId: current.id, modelId: m.id })}
                />
              ))}
            </>
          ) : (
            <Empty>Pick a series to see its models.</Empty>
          )}
        </Column>
      </div>
      <p className="border-t border-border px-5 py-3 text-xs text-muted">
        Posts collected: posts and comments your searches have gathered so far. They show where you already have evidence, not how popular a product
        is. “Not collected yet” means no search has covered it.
      </p>
    </div>
  );
}

const GRID = "grid grid-cols-[1rem_minmax(0,1fr)_2.5rem_2.5rem] items-center gap-x-3 sm:grid-cols-[1rem_minmax(0,1fr)_5.5rem_3rem]";

function Column(props: { title: string; count: number | null; hint: string; action?: ReactNode; divider?: boolean; children: ReactNode }) {
  return (
    <section className={`flex min-w-0 flex-col px-5 pt-4 pb-4 ${props.divider ? "border-t border-border sm:border-t-0 sm:border-l" : ""}`}>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="flex items-center gap-2 font-medium">
          {props.title}
          {props.count !== null && <span className="rounded-full bg-border/60 px-2 text-xs font-medium text-muted tabular-nums">{props.count}</span>}
        </h3>
        <span className="flex items-baseline gap-3 text-xs text-muted">
          {props.action}
          {props.hint}
        </span>
      </div>
      <div className={`${GRID} border-b border-border px-2 pb-1.5 text-[11px] tracking-wide text-muted uppercase`}>
        <span />
        <span>Name</span>
        <span className="col-span-2 text-right">
          <span className="sm:hidden">Posts</span>
          <span className="hidden sm:inline">Posts collected</span>
        </span>
      </div>
      {/* 6½ rows tall, so a half-visible row shows there is more to scroll. */}
      <div role="radiogroup" aria-label={props.title} className="-mx-1 mt-1 h-[234px] overflow-y-auto px-1 [scrollbar-width:thin]">
        {props.children}
      </div>
    </section>
  );
}

function Row(props: { label: string; title?: string; posts: number; width: number; on: boolean; strong?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={props.on}
      title={props.title}
      onClick={props.onClick}
      className={`${GRID} h-9 w-full rounded-lg px-2 text-left text-sm ${props.on ? "bg-accent/10 ring-1 ring-accent ring-inset" : "hover:bg-border/40"}`}
    >
      <span className={`size-4 rounded-full border ${props.on ? "border-[5px] border-accent" : "border-muted/50"}`} aria-hidden />
      <span className={`truncate ${props.on || props.strong ? "font-medium" : ""}`}>{props.label}</span>
      {props.posts > 0 ? (
        <>
          <span className="h-1.5 rounded-full bg-border" aria-hidden>
            <span className="block h-1.5 rounded-full bg-accent" style={{ width: `${Math.max(3, props.width)}%` }} />
          </span>
          <span className="text-right text-muted tabular-nums">{props.posts.toLocaleString()}</span>
        </>
      ) : (
        <span className="col-span-2 text-right text-xs text-muted italic">not collected yet</span>
      )}
    </button>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-2 py-3 text-sm text-muted">{children}</p>;
}

/** Step heading: a numbered dot, a title and an optional hint, with an optional action on the right. */
export function Step(props: { n: number; title: string; hint?: string; id?: string; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-4">
      <h2 id={props.id} className="flex items-center gap-2.5 text-sm font-semibold tracking-wide text-muted uppercase">
        <span className="grid size-6 place-items-center rounded-full bg-foreground text-xs text-background">{props.n}</span>
        {props.title}
        {props.hint && <span className="font-normal tracking-normal normal-case">· {props.hint}</span>}
      </h2>
      {props.right}
    </div>
  );
}
