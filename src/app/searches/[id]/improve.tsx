"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import type { Accuracy, CheckItem, LookPost } from "@/lib/analysis";
import type { Codebook } from "@/lib/codebook";

import { ui } from "../../ui";
import { reviewAction } from "../analysis-actions";
import { CodebookEditor } from "./codebook-editor";
import { SpotCheck } from "./spot-check";

const SOURCE_LABELS: Record<string, string> = { youtube: "YouTube", reddit: "Reddit" };

interface Props {
  searchId: number;
  version: number;
  look: LookPost[];
  lookTotal: number;
  check: { items: CheckItem[]; accuracy: Accuracy } | null;
  summaryCodebook: Codebook;
  codebook: { version: number; codebook: Codebook } | null;
  claudeModel: string;
  /** About what one "Improve rules" call costs. */
  improveUsd: number;
  /** The family's product knowledge: where it lives, how many facts, and how many this study doesn't use yet. */
  knowledge: { href: string; facts: number; site: string | null; notUsed: number } | null;
}

type RowKey = "needs-look" | "accuracy" | "categories";

/**
 * "Improve these results" (D47): optional. Check answers (Needs a look, Accuracy), then update what posts are read
 * with (Categories, Product knowledge). Rows only show their state and open in place; Re-analyze lives in the study
 * bar, the one place that starts paid work.
 */
export function Improve(props: Props) {
  const [openRow, setOpenRow] = useState<RowKey | null>(null);
  const toggle = (k: RowKey) => setOpenRow((o) => (o === k ? null : k));
  const acc = props.check?.accuracy;
  const answers = acc ? acc.questions.reduce((n, q) => n + q.open, 0) : 0;
  const sure = acc ? acc.questions.reduce((n, q) => n + q.sure, 0) : 0;
  const right = acc ? acc.questions.reduce((n, q) => n + q.right, 0) : 0;
  const wrong = sure - right;
  const claudeRan = props.check?.items.some((i) => i.claude) ?? false;
  const k = props.knowledge;

  // "Check answers" in the study bar, and links between rows, open a row and bring it into view.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const target = (e as CustomEvent<string>).detail as RowKey;
      if (!["needs-look", "accuracy", "categories"].includes(target)) return;
      setOpenRow(target);
      setTimeout(() => document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    };
    window.addEventListener("pulse:open", onOpen);
    return () => window.removeEventListener("pulse:open", onOpen);
  }, []);

  const opener = (key: RowKey, label: string) => (
    <button type="button" aria-expanded={openRow === key} aria-controls={`${key}-body`} onClick={() => toggle(key)} className={ui.secondarySm}>
      {openRow === key ? "Close ▴" : `${label} ▾`}
    </button>
  );

  return (
    <section id="improve" aria-labelledby="improve-heading" className="flex scroll-mt-32 flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h2 id="improve-heading" className={ui.sectionTitle}>
          Improve these results
        </h2>
        <span className={ui.meta}>Optional.</span>
      </div>

      <h3 className={`${ui.eyebrow} mt-1`}>Check answers</h3>
      <Row
        id="needs-look"
        title="Needs a look"
        status={
          props.lookTotal ? (
            <>
              <b className="font-semibold text-foreground">{props.lookTotal} {props.lookTotal === 1 ? "post" : "posts"}</b> Jev wasn&apos;t sure about · not counted until you keep them
            </>
          ) : (
            "Nothing waiting"
          )
        }
        action={props.lookTotal > 0 ? opener("needs-look", "Review") : null}
        open={openRow === "needs-look"}
      >
        <NeedsLook searchId={props.searchId} version={props.version} posts={props.look} total={props.lookTotal} />
      </Row>

      {props.check && props.check.items.length > 0 && (
        <Row
          id="accuracy"
          title="Accuracy"
          status={
            claudeRan ? (
              <>
                Claude checked {props.check.items.length} posts · <b className="font-semibold text-foreground">Jev agrees on {sure ? Math.round((right / sure) * 100) : 100}%</b> ·{" "}
                {answers} {answers === 1 ? "answer" : "answers"} to check
              </>
            ) : (
              "Not checked yet · Claude can check 20 posts against Jev"
            )
          }
          action={opener("accuracy", answers ? "Check answers" : "Open")}
          open={openRow === "accuracy"}
        >
          <SpotCheck
            searchId={props.searchId}
            version={props.version}
            codebook={props.summaryCodebook}
            items={props.check.items}
            accuracy={props.check.accuracy}
            claudeModel={props.claudeModel}
            onShowCategories={() => window.dispatchEvent(new CustomEvent("pulse:open", { detail: "categories" }))}
          />
        </Row>
      )}

      <h3 className={`${ui.eyebrow} mt-3`}>Update categories and product knowledge</h3>
      {props.codebook && (
        <Row
          id="categories"
          title="Categories"
          status={
            <>
              {listSizes(props.codebook.codebook)} · <b className="font-semibold text-foreground">version {props.codebook.version}</b>
            </>
          }
          action={opener("categories", "Open")}
          open={openRow === "categories"}
        >
          <CodebookEditor key={props.codebook.version} searchId={props.searchId} codebook={props.codebook.codebook} improveUsd={props.improveUsd} wrong={claudeRan ? wrong : 0} />
        </Row>
      )}

      <Row
        id="product-knowledge"
        title="Product knowledge"
        status={
          !k ? (
            "This study has no product family"
          ) : (
            <>
              {k.facts} {k.facts === 1 ? "fact" : "facts"}
              {k.site ? ` from ${k.site}` : ""}
              {k.notUsed > 0 && (
                <>
                  {" · "}
                  <b className="inline-flex items-center gap-1.5 font-semibold text-foreground">
                    <span className="h-2 w-2 rounded-full bg-warning" aria-hidden />
                    {k.notUsed} not used in this study yet
                  </b>
                </>
              )}
            </>
          )
        }
        action={
          k && (
            <Link href={k.href} className={ui.link}>
              Open in Products →
            </Link>
          )
        }
        open={false}
      >
        {null}
      </Row>
    </section>
  );
}

const listSizes = (c: Codebook) => {
  const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
  return [n(c.themes.length, "theme"), n(c.stages.length, "stage"), c.touchpoints?.length ? n(c.touchpoints.length, "touchpoint") : null].filter(Boolean).join(" · ");
};

export function Row(props: { id: string; title: React.ReactNode; status: React.ReactNode; action: React.ReactNode; open: boolean; children: React.ReactNode }) {
  return (
    <div id={props.id} className={`${ui.card} scroll-mt-32`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-4 sm:px-6">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h4 className="text-base font-bold">{props.title}</h4>
          <span className="text-[13px] text-muted">{props.status}</span>
        </div>
        {props.action}
      </div>
      {/* Kept mounted while closed, so an answer you started isn't lost. */}
      {props.children && (
        <div id={`${props.id}-body`} hidden={!props.open} className="border-t border-border px-4 py-5 sm:px-6">
          {props.children}
        </div>
      )}
    </div>
  );
}

function NeedsLook({ searchId, version, posts, total }: { searchId: number; version: number; posts: LookPost[]; total: number }) {
  const router = useRouter();
  const [done, setDone] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const shown = posts.filter((p) => !done.includes(p.id));

  function decide(post: LookPost, keep: boolean) {
    setError(null);
    setDone((d) => [...d, post.id]);
    startTransition(async () => {
      const r = await reviewAction(searchId, post.id, version, keep);
      if (!r.ok) {
        setError(r.message);
        setDone((d) => d.filter((id) => id !== post.id));
      } else router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted">
        Jev couldn&apos;t tell if these are feedback on the product, so they aren&apos;t counted unless you keep them.
        {total > posts.length && ` Showing the first ${posts.length}.`}
      </p>
      {error && (
        <p role="alert" className="text-sm text-critical">
          {error}
        </p>
      )}
      {shown.length === 0 ? (
        <p className="text-sm text-muted">All done.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {shown.map((p) => (
            <li key={p.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
              <div className="min-w-0 text-sm">
                {p.thread && <p className="mb-1 text-xs text-muted">Under: “{p.thread}”</p>}
                {p.replyingTo && <p className="mb-1 line-clamp-2 border-l-2 border-border pl-2 text-xs text-muted">Replying to: “{p.replyingTo}”</p>}
                {p.title && <p className="font-medium break-words">{p.title}</p>}
                <p className="line-clamp-3 break-words">{p.text}</p>
                <p className="mt-1 text-xs text-muted">
                  {SOURCE_LABELS[p.source] ?? p.source}
                  {p.url && (
                    <>
                      {" · "}
                      <a href={p.url} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2 hover:text-accent">
                        open ↗
                      </a>
                    </>
                  )}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button type="button" disabled={pending} onClick={() => decide(p, true)} className={ui.secondarySm}>
                  Keep
                </button>
                <button type="button" disabled={pending} onClick={() => decide(p, false)} className={ui.plainSm}>
                  Drop
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
