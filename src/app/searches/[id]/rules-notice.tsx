"use client";

import { useState, useSyncExternalStore } from "react";

import type { RelevanceCounts } from "@/lib/analysis";

import { ui } from "../../ui";
import { openOnPage } from "./study-control";

/**
 * Once, after posts were read again with clearer rules (D50): what moved. Closing it hides it for good in this
 * browser (it's news, not a state).
 */
export function RulesNotice({ jobId, before, after }: { jobId: number; before: RelevanceCounts; after: RelevanceCounts }) {
  const key = `pulse:rules-notice:${jobId}`;
  const [closed, setClosed] = useState(false);
  // Read after hydration (the server can't know), so it never flashes for someone who closed it.
  const seen = useSyncExternalStore(
    () => () => undefined,
    () => {
      try {
        return localStorage.getItem(key) !== null;
      } catch {
        return false;
      }
    },
    () => true,
  );
  const shown = !closed && !seen;
  const posts = (n: number) => `${n} ${n === 1 ? "post" : "posts"}`;
  const parts = [
    [after.chat - before.chat, "moved to Chat"],
    [after.competitors - before.competitors, "moved to Competitors"],
    [(after.language ?? 0) - (before.language ?? 0), "set aside as another language"],
  ]
    .filter(([n]) => (n as number) > 0)
    .map(([n, what]) => `${posts(n as number)} ${what}`);
  if (!shown) return null;
  const close = () => {
    setClosed(true);
    try {
      localStorage.setItem(key, "1");
    } catch {
      // Hidden for this visit only.
    }
  };
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];
  return (
    <div className={ui.noticeInfo}>
      <span className="min-w-56 flex-1">
        <b>Re-analyzed with clearer rules.</b> {list ? `${list}. ` : ""}
        Uncertain posts went from {before.needsLook} to {after.needsLook}.
      </span>
      <a
        href="#needs-look"
        className={ui.link}
        onClick={() => {
          openOnPage("needs-look");
          close();
        }}
      >
        Review uncertain posts →
      </a>
      <button type="button" aria-label="Dismiss" className={ui.icon} onClick={close}>
        ×
      </button>
    </div>
  );
}
