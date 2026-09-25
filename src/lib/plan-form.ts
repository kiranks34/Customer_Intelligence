/** Converts the plan editor's form fields to and from a Plan. Pure, so it can be unit-tested. */
import { isRealDate, normalizePlan, PlanSchema, type Plan } from "./plan";

const lines = (v: FormDataEntryValue | null) =>
  String(v ?? "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
const csv = (v: FormDataEntryValue | null) =>
  String(v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
const str = (v: FormDataEntryValue | null) => String(v ?? "").trim();
/** Empty or non-numeric input becomes NaN, which planFromForm rejects instead of silently clamping. */
const num = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  return s === "" ? Number.NaN : Number(s);
};
const NUMBER_FIELDS: [string, string][] = [
  ["yt_videos", "Videos per query"],
  ["yt_comments", "Comments per video"],
  ["rd_threads", "Comment threads read per query"],
  ["postCap", "Stop after posts"],
];
const orNull = (s: string) => (s ? s : null);

export function planFromForm(form: FormData): { ok: true; plan: Plan } | { ok: false; error: string } {
  for (const [name, label] of NUMBER_FIELDS) {
    if (!Number.isFinite(num(form.get(name)))) return { ok: false, error: `"${label}" needs a number.` };
  }
  for (const [name, label] of [["from", "From"], ["to", "To"]] as const) {
    const v = str(form.get(name));
    if (v && !isRealDate(v)) return { ok: false, error: `"${label}" must be a real date as YYYY-MM-DD.` };
  }
  const candidate = {
    intent: str(form.get("intent")),
    subject: str(form.get("subject")),
    kind: str(form.get("kind")),
    question: orNull(str(form.get("question"))),
    focus: csv(form.get("focus")),
    timeWindow: { from: orNull(str(form.get("from"))), to: orNull(str(form.get("to"))), label: str(form.get("label")) },
    aliases: lines(form.get("aliases")),
    youtube: {
      enabled: form.get("yt_enabled") === "on",
      queries: lines(form.get("yt_queries")),
      videosPerQuery: num(form.get("yt_videos")),
      commentsPerVideo: num(form.get("yt_comments")),
    },
    reddit: {
      enabled: form.get("rd_enabled") === "on",
      queries: lines(form.get("rd_queries")),
      commentThreadsPerQuery: num(form.get("rd_threads")),
    },
    exclusions: lines(form.get("exclusions")),
    postCap: num(form.get("postCap")),
    notes: str(form.get("notes")),
  };
  const parsed = PlanSchema.safeParse(candidate);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: `Check "${first.path.join(".")}": ${first.message}` };
  }
  if (!parsed.data.subject) return { ok: false, error: "Subject can't be empty." };
  return { ok: true, plan: normalizePlan(parsed.data) };
}
