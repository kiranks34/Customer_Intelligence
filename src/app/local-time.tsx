"use client";

import { useSyncExternalStore } from "react";

import { shortDay, when } from "./format";

/**
 * A timestamp in the viewer's time zone. The server (and the first client render, so hydration matches) show it in
 * UTC; right after, it switches to local time.
 */
const noop = () => () => {};

export function LocalTime({ iso, day = false }: { iso: string; day?: boolean }) {
  const local = useSyncExternalStore(noop, () => true, () => false);
  const tz = local ? undefined : "UTC";
  return <time dateTime={iso}>{day ? shortDay(iso, tz) : when(iso, tz)}</time>;
}
