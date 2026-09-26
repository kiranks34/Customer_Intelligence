"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import type { Accuracy, CheckItem, LookPost } from "@/lib/analysis";
import type { Codebook } from "@/lib/codebook";

import { ui } from "../../ui";
import { reanalyzeWithKnowledgeAction, reviewAction } from "../analysis-actions";
import { CodebookEditor, type EditorHandle } from "./codebook-editor";
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
  knowledge: { catalogId: number; facts: number; updatedAt: string | null; newSince: number } | null;
}

type RowKey = "look" | "check" | "categories";

/**
 * "Improve these results" (D46): optional, numbered, one line each with its status and one action; a row opens in
 * place. 1 Needs a look · 2 Check accuracy · 3 Categories · 4 Product knowledge.
 */
export function Improve(props: Props) {
  const router = useRouter();
  const [openRow, setOpenRow] = useState<RowKey | null>(null);
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const editor = useRef<EditorHandle>(null);
  const toggle = (k: RowKey) => setOpenRow((o) => (o === k ? null : k));
  const open = props.check ? props.check.accuracy.questions.reduce((n, q) => n + q.open, 0) : 0;
  const k = props.knowledge;

  return (
    <section id="improve" aria-labelledby="improve-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h2 id="improve-heading" className="text-lg font-bold">
          Improve these results
        </h2>
        <span className={ui.meta}>Optional. Pulse already did the work; these make it more accurate.</span>
      </div>

      <Row n={1} title="Needs a look" status={props.lookTotal ? `${props.lookTotal} posts Jev wasn't sure about` : "Nothing to look at"} open={openRow === "look"}
        action={props.lookTotal > 0 ? <button type="button" onClick={() => toggle("look")} className={ui.secondarySm}>{openRow === "look" ? "Close" : "Review"}</button> : null}>
        <NeedsLook searchId={props.searchId} version={props.version} posts={props.look} total={props.lookTotal} />
      </Row>

      {props.check && props.check.items.length > 0 && (
        <Row n={2} title="Check accuracy"
          status={props.check.items.some((i) => i.claude) ? `Claude checked ${props.check.items.length} posts · ${open} ${open === 1 ? "answer" : "answers"} to check` : "Measures how often Jev is right"}
          open={openRow === "check"}
          action={<button type="button" onClick={() => toggle("check")} className={ui.secondarySm}>{openRow === "check" ? "Close" : open ? "Check answers" : "Open"}</button>}>
          <SpotCheck searchId={props.searchId} version={props.version} codebook={props.summaryCodebook} items={props.check.items} accuracy={props.check.accuracy} claudeModel={props.claudeModel} onImprove={() => editor.current?.improve()} />
        </Row>
      )}

      {props.codebook && (
        <Row n={3} title="Categories" status={`Themes, stages, touchpoints · version ${props.codebook.version}`} open={openRow === "categories"}
          action={<button type="button" onClick={() => toggle("categories")} className={ui.plainSm}>{openRow === "categories" ? "Close" : "Open"}</button>}>
          <CodebookEditor key={props.codebook.version} searchId={props.searchId} codebook={props.codebook.codebook} version={props.codebook.version} handle={editor} onReveal={() => setOpenRow("categories")} />
        </Row>
      )}

      <Row n={4} title="Product knowledge"
        status={!k ? "This study has no product family" : `${k.facts} facts${k.newSince ? ` · ${k.newSince} new since this study` : ""}`}
        action={k && (
          <>
            {k.newSince > 0 && (
              <button type="button" disabled={pending} className={ui.secondarySm}
                onClick={() => startTransition(async () => {
                  const r = await reanalyzeWithKnowledgeAction(props.searchId);
                  setNote({ ok: r.ok, text: r.message });
                  if (r.ok) router.push(`/searches/${props.searchId}?run=1`);
                })}>
                Re-analyze with it
              </button>
            )}
            <Link href={`/products/${k.catalogId}?tab=knowledge`} className={ui.plainSm}>
              Open →
            </Link>
          </>
        )}
        open={false}>
        {null}
      </Row>
      {note && <p role="status" className={`text-sm ${note.ok ? "text-muted" : "text-critical"}`}>{note.text}</p>}
    </section>
  );
}

function Row(props: { n: number; title: string; status: string; action: React.ReactNode; open: boolean; children: React.ReactNode }) {
  return (
    <div className={ui.card}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-4 sm:px-6">
        <span className="grid size-[26px] place-items-center rounded-lg border border-border bg-surface-2 text-[13px] font-bold text-muted">{props.n}</span>
        <h3 className="text-base font-bold">{props.title}</h3>
        <span className="text-[13px] text-muted sm:ml-auto">{props.status}</span>
        <span className="flex flex-wrap gap-2">{props.action}</span>
      </div>
      {/* Kept mounted while closed: the accuracy check reaches the categories editor through its handle. */}
      {props.children && (
        <div hidden={!props.open} className="border-t border-border px-4 py-5 sm:px-6">
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
