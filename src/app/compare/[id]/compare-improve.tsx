"use client";

import Link from "next/link";
import { useState } from "react";

import type { Codebook } from "@/lib/codebook";

import { ui } from "../../ui";
import { CodebookEditor } from "../../searches/[id]/codebook-editor";
import { Row } from "../../searches/[id]/improve";
import { SideName } from "./compare-results";

export interface ImproveSide {
  searchId: number;
  label: string;
  needsLook: number;
  answers: number;
  /** Jev's agreement with Claude, 0–100, or null before the auto-check. */
  agrees: number | null;
  knowledge: { href: string; facts: number; notUsed: number } | null;
}

/**
 * "Improve these results" for a comparison (D48). Categories are shared by both sides, so they are improved here and
 * saved to both. Answers (Needs a look, Accuracy) and product knowledge belong to each side, so each row opens that
 * side's own page. Re-analyze stays in the bar at the top.
 */
export function CompareImprove(props: { compareId: number; sides: ImproveSide[]; codebook: { searchId: number; codebook: Codebook; version: number } | null; improveUsd: number }) {
  const [open, setOpen] = useState(false);
  const back = (id: number) => `/searches/${id}?from=compare-${props.compareId}#improve`;
  return (
    <section id="improve" aria-labelledby="improve-heading" className="flex scroll-mt-32 flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h2 id="improve-heading" className={ui.sectionTitle}>
          Improve these results
        </h2>
        <span className={ui.meta}>Optional.</span>
      </div>

      <h3 className={`${ui.eyebrow} mt-1`}>Check answers</h3>
      {props.sides.map((s, i) => (
        <Row
          key={s.searchId}
          id={`answers-${i}`}
          title={<SideName i={i} label={s.label} />}
          status={
            <>
              {s.needsLook} {s.needsLook === 1 ? "post needs" : "posts need"} a look · {s.agrees === null ? "accuracy not checked yet" : `Jev agrees on ${s.agrees}%`}
              {s.answers > 0 && ` · ${s.answers} ${s.answers === 1 ? "answer" : "answers"} to check`}
            </>
          }
          action={
            <Link href={back(s.searchId)} className={ui.link}>
              Open its study →
            </Link>
          }
          open={false}
        >
          {null}
        </Row>
      ))}

      <h3 className={`${ui.eyebrow} mt-3`}>Update categories and product knowledge</h3>
      {props.codebook && (
        <Row
          id="categories"
          title="Categories"
          status={
            <>
              Shared by both sides · <b className="font-semibold text-foreground">version {props.codebook.version}</b>
            </>
          }
          action={
            <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={ui.secondarySm}>
              {open ? "Close ▴" : "Open ▾"}
            </button>
          }
          open={open}
        >
          <CodebookEditor key={props.codebook.version} searchId={props.codebook.searchId} codebook={props.codebook.codebook} improveUsd={props.improveUsd} wrong={0} />
        </Row>
      )}
      {props.sides.map((s, i) =>
        s.knowledge ? (
          <Row
            key={`k-${s.searchId}`}
            id={`knowledge-${i}`}
            title={
              <span className="inline-flex items-center gap-2">
                Product knowledge · <SideName i={i} label={s.label} />
              </span>
            }
            status={
              <>
                {s.knowledge.facts} {s.knowledge.facts === 1 ? "fact" : "facts"}
                {s.knowledge.notUsed > 0 && (
                  <>
                    {" · "}
                    <b className="inline-flex items-center gap-1.5 font-semibold text-foreground">
                      <span className="h-2 w-2 rounded-full bg-warning" aria-hidden />
                      {s.knowledge.notUsed} not used yet
                    </b>
                  </>
                )}
              </>
            }
            action={
              <Link href={s.knowledge.href} className={ui.link}>
                Open in Products →
              </Link>
            }
            open={false}
          >
            {null}
          </Row>
        ) : null,
      )}
    </section>
  );
}
