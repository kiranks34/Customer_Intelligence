"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { addFamilyAction } from "../catalogs/actions";
import { ui } from "../ui";

/** Adds a product family by name, then opens it. `compact` is the button in the page header. */
export function AddFamily({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(!compact);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={ui.primary}>
        + Add a product family
      </button>
    );
  }
  return (
    <form
      className="flex w-full max-w-xl flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const r = await addFamilyAction(name);
          if (r.ok) router.push(`/products/${r.catalogId}`);
          else setError(r.message);
        });
      }}
    >
      <div className="flex flex-wrap gap-2">
        <input
          autoFocus={compact}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          placeholder="e.g. HP Smart Tank"
          aria-label="Product family name"
          className={`${ui.input} h-11 min-w-56 flex-1`}
        />
        <button type="submit" disabled={pending || name.trim().length < 2} className={ui.primary}>
          {pending ? "Adding…" : "Add"}
        </button>
        {compact && (
          <button type="button" onClick={() => setOpen(false)} className={ui.plain}>
            Cancel
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-critical">
          {error}
        </p>
      )}
    </form>
  );
}
