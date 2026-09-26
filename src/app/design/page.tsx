import Link from "next/link";

import { AppShell } from "../app-shell";
import { Crumbs } from "../nav";
import { dot, ui, type Tone } from "../ui";

export const metadata = { title: "Design system · Pulse" };

/**
 * The design system on one page (docs/DESIGN-SYSTEM.md): every shared piece from `ui`, in the page's own theme, so a
 * styling question is settled by looking here, not by comparing screens. Not in the top bar; open /design.
 */
export default function DesignPage() {
  return (
    <AppShell active="studies">
      <div className="flex flex-col gap-2">
        <Crumbs path={[{ label: "Studies", href: "/" }, { label: "Design system" }]} />
        <h1 className={ui.pageTitle}>Design system</h1>
        <p className={ui.detail}>Every shared piece, as pages use it. Rules and when to use each: docs/DESIGN-SYSTEM.md.</p>
      </div>

      <Block title="Colours" note="Tokens in globals.css; light and dark follow the device">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["background", "bg-background"],
            ["surface", "bg-surface"],
            ["surface-2", "bg-surface-2"],
            ["border", "bg-border"],
            ["foreground", "bg-foreground"],
            ["muted", "bg-muted"],
            ["faint", "bg-faint"],
            ["accent · actions, links", "bg-accent"],
            ["good · positive, done", "bg-good"],
            ["warning · needs you", "bg-warning"],
            ["critical · negative, errors", "bg-critical"],
            ["violet · competitors, side B", "bg-violet"],
            ["slate · neutral", "bg-slate"],
          ].map(([name, cls]) => (
            <div key={name} className="flex items-center gap-3">
              <span className={`h-9 w-9 shrink-0 rounded-lg border border-border ${cls}`} />
              <span className="text-[13px]">{name}</span>
            </div>
          ))}
        </div>
      </Block>

      <Block title="Type" note="One page title per page; sizes off this scale fail the check">
        <div className="flex flex-col gap-3">
          <span className={ui.pageTitle}>Page title · 26px bold</span>
          <span className={ui.sectionTitle}>Section or card title · 18px bold</span>
          <span className="text-[15px] font-semibold">Picker and emphasis · 15px</span>
          <span className="text-sm">Body · 14px</span>
          <span className={ui.detail}>Detail line under a title · 13px grey</span>
          <span className={ui.meta}>Meta and hints · 12px grey</span>
          <span className={ui.eyebrow}>Group label · 11px caps</span>
        </div>
      </Block>

      <Block title="Buttons" note="One filled button per area; short verbs; a cost goes under the button">
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={ui.primary}>
            Start study
          </button>
          <button type="button" className={ui.secondary}>
            Secondary
          </button>
          <button type="button" className={ui.plain}>
            Plain
          </button>
          <button type="button" disabled className={ui.primary}>
            Disabled
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex flex-col items-end gap-0.5">
            <button type="button" className={ui.primarySm}>
              Re-analyze
            </button>
            <span className={ui.meta}>about $0.17</span>
          </span>
          <button type="button" className={ui.secondarySm}>
            Review ▾
          </button>
          <button type="button" className={ui.plainSm}>
            Edit myself
          </button>
          <button type="button" aria-label="More actions" className={ui.icon}>
            ⋯
          </button>
        </div>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-[13px] text-muted">
          <li>Filled blue: the one main action. A paid action shows its cost under the button, never in the label.</li>
          <li>Outlined with ▾ / ▴: opens or closes something in place.</li>
          <li>Plain grey: a neutral choice next to a main one (Edit myself, Cancel).</li>
          <li>Underlined blue link with →: goes to another page; ↗ opens another site; ↓ jumps down this page.</li>
        </ul>
      </Block>

      <Block title="Page header" note="Title on the left; status and main action on the right, level with the title">
        <div className="flex flex-col gap-2 rounded-xl border border-dashed border-border p-4">
          <Crumbs path={[{ label: "Studies", href: "/" }, { label: "Smart Tank 7301" }]} />
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
            <div className="flex min-w-0 flex-col gap-2">
              <span className={ui.pageTitle}>Smart Tank 7301</span>
              <span className={ui.detail}>YouTube · Reddit · 1 year · Started Sep 18</span>
            </div>
            <div className="flex items-start gap-3">
              <span className="inline-flex items-center gap-2 pt-1.5 text-[13px] font-semibold">
                <span className={`h-2 w-2 rounded-full ${dot.good}`} aria-hidden />
                Ready
              </span>
              <span className="flex flex-col items-end gap-0.5">
                <button type="button" className={ui.secondarySm}>
                  Collect new posts
                </button>
                <span className={ui.meta}>about $0.04</span>
              </span>
              <button type="button" aria-label="More actions" className={ui.icon}>
                ⋯
              </button>
            </div>
          </div>
        </div>
      </Block>

      <Block title="Links and navigation" note="Every page below Studies or Products shows its path; a page reached from the other section shows the way back">
        <div className="flex flex-wrap items-center gap-6">
          <Link href="/design" className={ui.link}>
            Open in Products →
          </Link>
          <a href="https://support.hp.com" className={ui.link}>
            support.hp.com ↗
          </a>
        </div>
        <Crumbs path={[{ label: "Products", href: "/products" }, { label: "HP Smart Tank" }]} />
        <span className={ui.back}>← Back to study</span>
        <nav className="flex gap-1 border-b border-border">
          <span className={ui.tabOn}>Models · 130</span>
          <span className={ui.tab}>Product knowledge · 20</span>
        </nav>
      </Block>

      <Block title="Status" note="One word, the same in All studies and a study's header. The reason line shows in All studies only">
        <div className="grid gap-4 sm:grid-cols-2">
          {(
            [
              ["info", "Collecting", "Runs while Pulse is open"],
              ["info", "Reading posts", "Runs while Pulse is open"],
              ["info", "Stopping…", "Finishing the current step"],
              ["muted", "Paused", "You stopped it"],
              ["muted", "Not started", "Nothing collected yet"],
              ["warn", "Waiting", "Monthly budget reached"],
              ["muted", "Not analyzed", "200 posts collected, not read yet"],
              ["warn", "Update ready", "20 new product facts not used yet"],
              ["warn", "To review", "3 answers to check"],
              ["good", "Ready", "Results use every post"],
              ["bad", "Stopped", "No posts found"],
            ] as [Tone, string, string][]
          ).map(([tone, word, why]) => (
            <div key={word} className="flex flex-col gap-1">
              <span className="inline-flex items-center gap-2 text-[13px] font-semibold">
                <span className={`h-2 w-2 rounded-full ${dot[tone]}`} aria-hidden />
                {word}
              </span>
              <span className={ui.meta}>{why}</span>
            </div>
          ))}
        </div>
      </Block>

      <Block title="Running and toasts" note="Work runs in any open Pulse tab. A toast is news from elsewhere, never the result of a click on this page">
        <span className={ui.running}>
          <span className="h-2 w-2 animate-pulse rounded-full bg-accent" aria-hidden />2 running
        </span>
        <div className="flex max-w-[380px] flex-col gap-2">
          <div role="status" className={ui.toast}>
            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-good" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold">Smart Tank 7301 is ready</p>
              <p className={ui.meta}>52 posts about the product · 63% negative</p>
              <span className={`${ui.link} text-[13px]`}>Open results →</span>
            </div>
            <button type="button" aria-label="Dismiss" className={ui.icon}>
              ×
            </button>
          </div>
        </div>
      </Block>

      <Block title="Badges and choices">
        <div className="flex flex-wrap items-center gap-3">
          <span className={ui.badgeGood}>✓ Verified on hp.com</span>
          <span className={ui.badgeWarn}>Not verified yet</span>
          <span className={ui.sourceBadge}>YouTube</span>
          <span className={ui.sourceBadge}>Reddit</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={ui.chipOn}>✓ 1 year</span>
          <span className={ui.chip}>2 years</span>
          <span className={`${ui.chip} border-dashed text-muted`}>+ Add source</span>
        </div>
        <input className={ui.input} placeholder="Optional, e.g. Why do people return it in the first month?" aria-label="Example input" />
      </Block>

      <Block title="Notices" note="Inside a card, next to what they are about">
        <div className={ui.noticeInfo}>
          <span className="min-w-56 flex-1">
            <b>Used by 2 studies.</b> 1 doesn&apos;t use the latest facts yet.
          </span>
        </div>
        <div className={ui.noticeWarn}>
          <span className="min-w-56 flex-1">
            <b>Not enough budget left this month.</b> This study needs about $0.28; $0.10 is left.
          </span>
          <button type="button" className={ui.plainSm}>
            Use Reddit only
          </button>
        </div>
        <div className={ui.noticeBad}>
          <span className="min-w-56 flex-1">
            <b>Couldn&apos;t plan the study.</b> Claude didn&apos;t answer. Nothing was collected.
          </span>
          <button type="button" className={ui.secondarySm}>
            Try again
          </button>
        </div>
      </Block>

      <section className={ui.card}>
        <div className={ui.cardHead}>
          <h2 className={ui.cardTitle}>Card</h2>
          <span className={`${ui.meta} sm:ml-auto`}>Header row: title, then its note or controls on the right</span>
        </div>
        <div className={ui.cardBody}>
          <p className="text-sm">Body: 16px side padding on a phone, 24px from tablet up; 20px top and bottom; 16px between items.</p>
        </div>
      </section>
    </AppShell>
  );
}

function Block({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className={ui.card}>
      <div className={ui.cardHead}>
        <h2 className={ui.cardTitle}>{title}</h2>
        {note && <span className={`${ui.meta} sm:ml-auto`}>{note}</span>}
      </div>
      <div className={ui.cardBody}>{children}</div>
    </section>
  );
}
