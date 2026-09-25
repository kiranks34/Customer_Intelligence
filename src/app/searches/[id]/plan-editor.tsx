"use client";

import { startTransition, useActionState, type FormEvent } from "react";

import type { Plan } from "@/lib/plan";

import { savePlanAction, type ActionState } from "../actions";

const field = "rounded-lg border border-border bg-background px-3 py-2 text-sm";
const label = "flex flex-col gap-1 text-sm";

export function PlanEditor({ searchId, plan, version, locked }: { searchId: number; plan: Plan; version: number; locked: boolean }) {
  const [state, action, pending] = useActionState<ActionState | null, FormData>(savePlanAction.bind(null, searchId), null);

  // Submitting through onSubmit (not the form `action` prop) stops React from resetting the fields afterwards,
  // so edits survive a validation error. A successful save re-renders with the new version as the key.
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => action(data));
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" key={version}>
      <fieldset disabled={locked || pending} className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className={label}>
            Type
            <select name="intent" defaultValue={plan.intent} className={field}>
              <option value="topic">Topic</option>
              <option value="question">Question</option>
            </select>
          </label>
          <label className={`${label} sm:col-span-2`}>
            Subject
            <input name="subject" defaultValue={plan.subject} className={field} />
          </label>
          <label className={label}>
            Kind
            <select name="kind" defaultValue={plan.kind} className={field}>
              <option value="product">Product</option>
              <option value="family">Product family</option>
              <option value="category">Category</option>
              <option value="audience">Audience</option>
            </select>
          </label>
          <label className={`${label} sm:col-span-2`}>
            Question (for questions)
            <input name="question" defaultValue={plan.question ?? ""} className={field} />
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className={label}>
            From (YYYY-MM-DD)
            <input name="from" defaultValue={plan.timeWindow.from ?? ""} placeholder="no limit" className={field} />
          </label>
          <label className={label}>
            To (YYYY-MM-DD)
            <input name="to" defaultValue={plan.timeWindow.to ?? ""} placeholder="today" className={field} />
          </label>
          <label className={label}>
            Period label
            <input name="label" defaultValue={plan.timeWindow.label} className={field} />
          </label>
        </div>

        <label className={label}>
          Focus themes (comma-separated)
          <input name="focus" defaultValue={plan.focus.join(", ")} className={field} />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <fieldset className="flex flex-col gap-2 rounded-lg border border-border p-3">
            <legend className="px-1 text-sm font-medium">YouTube</legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="yt_enabled" defaultChecked={plan.youtube.enabled} /> Use YouTube
            </label>
            <label className={label}>
              Search queries (one per line)
              <textarea name="yt_queries" rows={4} defaultValue={plan.youtube.queries.join("\n")} className={field} />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className={label}>
                Videos per query
                <input type="number" name="yt_videos" defaultValue={plan.youtube.videosPerQuery} className={field} />
              </label>
              <label className={label}>
                Comments per video
                <input type="number" name="yt_comments" defaultValue={plan.youtube.commentsPerVideo} className={field} />
              </label>
            </div>
          </fieldset>
          <fieldset className="flex flex-col gap-2 rounded-lg border border-border p-3">
            <legend className="px-1 text-sm font-medium">Reddit</legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="rd_enabled" defaultChecked={plan.reddit.enabled} /> Use Reddit
            </label>
            <label className={label}>
              Search queries (one per line)
              <textarea name="rd_queries" rows={4} defaultValue={plan.reddit.queries.join("\n")} className={field} />
            </label>
            <label className={label}>
              Comment threads read per query
              <input type="number" name="rd_threads" defaultValue={plan.reddit.commentThreadsPerQuery} className={field} />
            </label>
          </fieldset>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className={label}>
            Other names people use (one per line)
            <textarea name="aliases" rows={3} defaultValue={plan.aliases.join("\n")} className={field} />
          </label>
          <label className={label}>
            Exclude results mentioning (one per line)
            <textarea name="exclusions" rows={3} defaultValue={plan.exclusions.join("\n")} className={field} />
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className={label}>
            Stop after posts
            <input type="number" name="postCap" defaultValue={plan.postCap} className={field} />
          </label>
          <label className={`${label} sm:col-span-2`}>
            Notes
            <input name="notes" defaultValue={plan.notes} className={field} />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className="rounded-lg border border-border px-4 py-2 text-sm font-medium disabled:opacity-50">
            {pending ? "Saving…" : "Save plan changes"}
          </button>
          {locked && <span className="text-sm text-muted">Locked while a collection is running.</span>}
          {state && (
            <span role="status" className={`text-sm ${state.ok ? "text-muted" : "text-critical"}`}>
              {state.message}
            </span>
          )}
        </div>
      </fieldset>
    </form>
  );
}
