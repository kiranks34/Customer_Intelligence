"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { ui } from "../../ui";
import { clearSearchesAction, renameStudyAction, startCollectionAction } from "../actions";

/** The study's header actions: Run again (new posts only), and ⋯ with Search settings, Rename, Remove. */
export function StudyActions({ id, title, busy }: { id: number; title: string; busy: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(title);
  const [note, setNote] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) {
        setOpen(false);
        setRenaming(false);
        if (e instanceof KeyboardEvent) button.current?.focus();
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const act = (fn: () => Promise<{ ok: boolean; message: string }>, then: () => void) =>
    startTransition(async () => {
      const r = await fn();
      setOpen(false);
      if (r.ok) then();
      else setNote(r.message);
    });
  const item = "block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-2 disabled:opacity-50";

  return (
    <div className="flex flex-col items-end gap-1">
      <div ref={box} className="relative flex items-center gap-2">
        <button
          type="button"
          disabled={pending || busy}
          onClick={() =>
            act(
              () => startCollectionAction(id),
              () => {
                router.replace(`/searches/${id}?run=1`);
                router.refresh();
              },
            )
          }
          className={ui.plainSm}
          title="Collect posts published since the last run, then read them"
        >
          Run again
        </button>
        <button ref={button} type="button" aria-label="More actions" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={ui.icon}>
          ⋯
        </button>
        {open && (
          <div className="absolute top-10 right-0 z-20 w-60 rounded-xl border border-border bg-surface p-1.5 shadow-[0_16px_48px_rgba(0,0,0,.45)]">
            {renaming ? (
              <form
                className="flex flex-col gap-2 p-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  act(() => renameStudyAction(id, name), () => router.refresh());
                }}
              >
                <input autoFocus value={name} maxLength={120} onChange={(e) => setName(e.target.value)} aria-label="Study name" className={ui.input} />
                <div className="flex gap-2">
                  <button type="submit" disabled={pending} className={ui.primarySm}>
                    Save
                  </button>
                  <button type="button" onClick={() => setRenaming(false)} className={ui.plainSm}>
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <>
                <a
                  href="#settings"
                  className={item}
                  onClick={() => {
                    setOpen(false);
                    const d = document.getElementById("settings") as HTMLDetailsElement | null;
                    if (d) d.open = true;
                  }}
                >
                  Search settings
                </a>
                <button type="button" className={item} onClick={() => setRenaming(true)}>
                  Rename
                </button>
                <button
                  type="button"
                  disabled={pending}
                  className={`${item} text-critical`}
                  onClick={() => {
                    if (window.confirm(`Remove “${title}” from All studies? Its posts and costs are kept.`)) act(() => clearSearchesAction([id]), () => router.push("/"));
                  }}
                >
                  Remove
                </button>
              </>
            )}
          </div>
        )}
      </div>
      {note && (
        <span role="alert" className="text-xs text-critical">
          {note}
        </span>
      )}
    </div>
  );
}
