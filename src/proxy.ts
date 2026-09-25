import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE, authConfig, isValidSession } from "@/lib/session";

/** Only the login page (and its form action) is reachable without a session. */
const PUBLIC_PATHS = new Set(["/login"]);

/** Single-user passcode gate (docs/DECISIONS.md D9). */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();
  if (isValidSession(request.cookies.get(SESSION_COOKIE)?.value, authConfig())) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const login = new URL("/login", request.url);
  login.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(login);
}

export const config = {
  // Everything except build assets. Server Functions posted to protected pages pass through here too.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
