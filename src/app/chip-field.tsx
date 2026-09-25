"use client";

import { useState, type KeyboardEvent } from "react";

export interface ChipAction {
  label: string;
  /** The action has nothing left to do for this chip (the button is hidden). */
  done: (value: string) => boolean;
  run: (value: string) => void;
}

export function ChipField(props: { label: string; hint: string; note?: string; values: string[]; onChange: (v: string[]) => void; max?: number; chipAction?: ChipAction }) {
  const { label: text, hint, note, values, onChange, max, chipAction } = props;
  const [input, setInput] = useState("");
  const full = max !== undefined && values.length >= max;
  function add() {
    const v = input.trim();
    if (v && !full && !values.some((x) => x.toLowerCase() === v.toLowerCase())) onChange([...values, v]);
    setInput("");
  }
  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      add();
    } else if (e.key === "Backspace" && !input && values.length) {
      onChange(values.slice(0, -1));
    }
  }
  return (
    <div className="flex flex-col gap-1 text-sm">
      <span>{text}</span>
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-background p-1.5">
        {values.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded-full bg-border/60 py-0.5 pr-1 pl-2.5">
            {v}
            {chipAction && !chipAction.done(v) && (
              <button type="button" onClick={() => chipAction.run(v)} aria-label={`Add ${v} as a search`} className="rounded-full px-1.5 text-xs text-accent hover:underline">
                {chipAction.label}
              </button>
            )}
            <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))} className="rounded-full px-1 text-muted hover:text-foreground">
              ×
            </button>
          </span>
        ))}
        {!full && (
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            onBlur={add}
            placeholder={values.length ? "add…" : hint}
            aria-label={`Add to ${text}`}
            className="min-w-32 flex-1 bg-transparent px-1.5 py-1 outline-none"
          />
        )}
      </div>
      {note && <span className="text-xs text-muted">{note}</span>}
      {full && <span className="text-xs text-muted">Up to {max}; remove one to add another.</span>}
    </div>
  );
}
