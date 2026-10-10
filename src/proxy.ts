import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { securityHeaders } from "./lib/security";

export function proxy(request: NextRequest) {
  const nonce = randomBytes(32).toString("base64");
  const headers = securityHeaders(nonce, process.env.NODE_ENV === "development");
  const requestHeaders = new Headers(request.headers);

  // Replace client-provided values. Next reads the request CSP to nonce its
  // framework scripts during dynamic rendering; the browser enforces the copy
  // on the response. Neither value is an authorization credential.
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", headers.get("Content-Security-Policy")!);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  for (const [name, value] of headers) response.headers.set(name, value);
  return response;
}

export const config = {
  // Include error pages, API routes and prefetches. Only Next's generated
  // assets and the favicon bypass document nonce generation.
  matcher: ["/((?!_next/static(?:/|$)|_next/image(?:/|$)|favicon\\.ico$).*)"],
};
