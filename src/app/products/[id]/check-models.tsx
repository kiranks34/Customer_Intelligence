"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { updateCatalogAction } from "../../catalogs/actions";
import { ui } from "../../ui";

/** "Check for new models": the verified list and your collected posts; anything found waits for Add or Skip. */
export function CheckModels({ catalogId }: { catalogId: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        className={ui.plainSm}
        onClick={() =>
          startTransition(async () => {
            const r = await updateCatalogAction(catalogId);
            setNote({ ok: r.ok, text: r.message });
            router.refresh();
          })
        }
      >
        {pending ? "Checking…" : "Check for new models"}
      </button>
      {note && (
        <span role="status" className={`max-w-72 text-right text-xs ${note.ok ? "text-muted" : "text-critical"}`}>
          {note.text}
        </span>
      )}
    </div>
  );
}
