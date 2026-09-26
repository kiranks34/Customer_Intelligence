"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import type { Accuracy, CheckItem, LookPost, PlacedGroup } from "@/lib/analysis";
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
  /** What the rules placed without asking (D50), and the posts set aside as another language. */
  placed: PlacedGroup[];
  languagePosts: LookPost[];
  /** The study's product, as the "why" bars name it. */
  subject: string;
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
 * "Improve these results" (D47): optional. Check answers (Uncertain posts, Accuracy), then update what posts are read
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
        title="Uncertain posts"
        status={
          props.lookTotal ? (
            <>
              <b className="font-semibold text-foreground">{props.lookTotal} {props.lookTotal === 1 ? "post" : "posts"}</b> Jev wasn&apos;t sure about · not counted until you
              keep {props.lookTotal === 1 ? "it" : "them"}
            </>
          ) : (
            "Nothing waiting"
          )
        }
        action={props.lookTotal > 0 || props.placed.some((g) => g.posts > 0) ? opener("needs-look", props.lookTotal > 0 ? "Review" : "Open") : null}
        open={openRow === "needs-look"}
      >
        <NeedsLook searchId={props.searchId} version={props.version} posts={props.look} total={props.lookTotal} subject={props.subject} />
        <Placed searchId={props.searchId} version={props.version} placed={props.placed} languagePosts={props.languagePosts} subject={props.subject} />
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

/** One uncertain (or set-aside) post: its context and words, why Jev wasn't sure, Keep and Drop. */
function PostRow({ post, subject, onDecide, pending, why = true }: { post: LookPost; subject: string; onDecide: (keep: boolean) => void; pending: boolean; why?: boolean }) {
  return (
    <li className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-x-4">
      <div className="min-w-0 text-sm">
        {post.thread && <p className="mb-1 text-xs text-muted">Under: “{post.thread}”</p>}
        {post.replyingTo && <p className="mb-1 line-clamp-2 border-l-2 border-border pl-2 text-xs text-muted">Replying to: “{post.replyingTo}”</p>}
        {post.title && <p className="font-medium break-words">{post.title}</p>}
        <p className="line-clamp-3 break-words">“{post.text}”</p>
        <p className="mt-1 text-xs text-muted">
          {SOURCE_LABELS[post.source] ?? post.source}
          {post.url && (
            <>
              {" · "}
              <a href={post.url} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2 hover:text-accent">
                open ↗
              </a>
            </>
          )}
        </p>
      </div>
      <div className="flex shrink-0 gap-2 sm:items-start">
        <button type="button" disabled={pending} onClick={() => onDecide(true)} className={ui.secondarySm}>
          Keep
        </button>
        <button type="button" disabled={pending} onClick={() => onDecide(false)} className={ui.plainSm}>
          Drop
        </button>
      </div>
      {why && post.pSubject !== null && <Why post={post} subject={subject} />}
    </li>
  );
}

/**
 * Why Jev wasn't sure (D50): how likely it thought the post is about the product, another brand, only chat, each
 * against the 80% a post needs to count (the line on each bar).
 */
function Why({ post, subject }: { post: LookPost; subject: string }) {
  const s = Math.round((post.pSubject ?? 0) * 100);
  const b = Math.round((post.pBrand ?? 0) * 100);
  const c = Math.round((post.pChat ?? 0) * 100);
  const short = subject.replace(/^HP /, "");
  const verdict =
    s >= 50 && b >= 50
      ? `about ${short} and another brand`
      : s >= 50 && c >= 35
        ? `leans ${short}, but could be only chat`
        : s >= 50 && !post.names
          ? `leans ${short}, but doesn't name it`
          : s >= 50
            ? `leans ${short}, not sure enough to count`
            : b >= 50
              ? "leans another brand"
              : c >= 50
                ? "leans only chat"
                : "unclear what it's about";
  const lead = Math.max(s, b, c);
  const meter = (label: string, v: number, color: string) => (
    <div className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 text-xs ${v === lead ? "font-semibold text-foreground" : "text-muted"}`}>
      <span className="truncate">{label}</span>
      <span className="text-foreground tabular-nums">{v}%</span>
      <span className="relative col-span-2 block h-1.5 overflow-hidden rounded-full bg-border" aria-hidden>
        <span className={`absolute inset-y-0 left-0 block rounded-full ${color}`} style={{ width: `${v}%` }} />
        <span className="absolute inset-y-0 left-[80%] block w-px bg-muted" />
      </span>
    </div>
  );
  return (
    <div className="flex flex-col gap-2 rounded-[10px] bg-surface-2 px-3 py-2.5 sm:col-span-2" role="group" aria-label={`Why Jev wasn't sure: ${verdict}; about ${short} ${s}%, another brand ${b}%, only chat ${c}%`}>
      <span className={ui.meta}>
        Why Jev wasn&apos;t sure: <b className="font-semibold text-foreground">{verdict}</b>
      </span>
      <div className="grid gap-x-4 gap-y-2 sm:grid-cols-3">
        {meter(`About ${short}`, s, "bg-accent")}
        {meter("Another brand", b, "bg-violet")}
        {meter("Only chat", c, "bg-faint")}
      </div>
    </div>
  );
}

/** Keep or Drop a post; it leaves the list at once and every count follows. */
function useDecide(searchId: number, version: number) {
  const router = useRouter();
  const [done, setDone] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
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
  return { done, error, pending, decide };
}

function NeedsLook({ searchId, version, posts, total, subject }: { searchId: number; version: number; posts: LookPost[]; total: number; subject: string }) {
  const { done, error, pending, decide } = useDecide(searchId, version);
  const shown = posts.filter((p) => !done.includes(p.id));
  if (total === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted">
        A post counts when Jev is at least 80% sure it&apos;s about {subject} (the line on each bar). These fell short. Keep counts it; Drop leaves it out.
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
            <PostRow key={p.id} post={p} subject={subject} pending={pending} onDecide={(keep) => decide(p, keep)} />
          ))}
        </ul>
      )}
    </div>
  );
}

const PLACED: Record<PlacedGroup["group"], { color: string; what: (n: number) => string; where: string }> = {
  chat: { color: "bg-faint/50", what: (n) => `${n} only about the video, its creator or chat`, where: "Chat" },
  competitor: { color: "bg-violet", what: (n) => `${n} about another brand only`, where: "Competitors" },
  language: { color: "bg-slate", what: (n) => `${n} in another language`, where: "Set aside" },
};

/**
 * What the rules placed without asking you (D50), each with an example, so you can see the rules at work. Posts in
 * another language aren't counted (the study covers North America in English): Show lists them, and Keep counts one.
 */
function Placed({ searchId, version, placed, languagePosts, subject }: { searchId: number; version: number; placed: PlacedGroup[]; languagePosts: LookPost[]; subject: string }) {
  const [open, setOpen] = useState(false);
  const { done, error, pending, decide } = useDecide(searchId, version);
  const groups = placed.filter((g) => g.posts > 0);
  if (groups.length === 0) return null;
  const language = languagePosts.filter((p) => !done.includes(p.id));
  return (
    <div className="mt-4 flex flex-col gap-2 border-t border-border pt-4">
      <h4 className="text-[13px] font-semibold">Placed by the rules, not waiting for you</h4>
      {groups.map((g) => (
        <div key={g.group} className="grid grid-cols-[10px_minmax(0,1fr)_auto] items-baseline gap-2.5 text-sm">
          <span className={`size-2.5 rounded-sm ${PLACED[g.group].color}`} aria-hidden />
          <span className="min-w-0">
            {PLACED[g.group].what(g.posts)} {g.example && <span className={ui.meta}>(“{g.example}”)</span>}
          </span>
          {g.group === "language" && language.length > 0 ? (
            <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={`${ui.link} text-[13px]`}>
              {open ? "Hide ▴" : "Show ▾"}
            </button>
          ) : (
            <span className={ui.meta}>{PLACED[g.group].where}</span>
          )}
        </div>
      ))}
      {groups.some((g) => g.group === "language") && (
        <p className={ui.meta}>Posts in another language aren&apos;t counted: this study covers North America in English. Show lists them so you can check; Keep still counts one.</p>
      )}
      {error && (
        <p role="alert" className="text-sm text-critical">
          {error}
        </p>
      )}
      {open && (
        <ul className="flex flex-col divide-y divide-border">
          {language.map((p) => (
            <PostRow key={p.id} post={p} subject={subject} pending={pending} why={false} onDecide={(keep) => decide(p, keep)} />
          ))}
        </ul>
      )}
    </div>
  );
}
