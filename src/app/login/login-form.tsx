"use client";

import { useActionState } from "react";

import { login } from "./actions";
import { ui } from "../ui";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="next" value={next} />
      <label htmlFor="passcode" className="text-sm text-muted">
        Passcode
      </label>
      <input
        id="passcode"
        name="passcode"
        type="password"
        autoComplete="current-password"
        required
        autoFocus
        className="rounded-lg border border-border bg-surface px-3 py-2 outline-none focus:border-accent"
      />
      {state?.error && (
        <p role="alert" className="text-sm text-critical">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className={ui.primary}
      >
        {pending ? "Checking…" : "Enter"}
      </button>
    </form>
  );
}
