import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";
import { adminEntryRedirect } from "@/lib/admin-gate";
import { clientIp } from "@/lib/client-ip";
import { edgeRateDecision } from "@/lib/edge-rate-limit";
import { contentSecurityPolicy, createNonce, securityHeaders } from "@/lib/security-headers";

const { auth } = NextAuth(authConfig);

function applySecurityHeaders(response: NextResponse, csp: string) {
  response.headers.set("Content-Security-Policy", csp);
  for (const header of securityHeaders()) {
    response.headers.set(header.key, header.value);
  }
  return response;
}

// authorized() in auth.config.ts also returns false for non-admins on /admin.
// Auth.js ignores that boolean when a handler is passed, so the redirect here
// is the middleware gate. requireAdmin remains the check inside each action.
export default auth((request) => {
  const nonce = createNonce();
  const csp = contentSecurityPolicy(nonce);
  if (
    edgeRateDecision({
      method: request.method,
      pathname: request.nextUrl.pathname,
      ip: clientIp(request),
    }) === "limited"
  ) {
    const limited = new NextResponse("Too many attempts from this network. Wait a minute and try again.", {
      status: 429,
      headers: new Headers({ "Retry-After": "60" }),
    });
    return applySecurityHeaders(limited, csp);
  }
  const destination = adminEntryRedirect(request.nextUrl.pathname, request.auth?.user?.role);
  if (destination) {
    const url = request.nextUrl.clone();
    url.pathname = destination;
    url.search = "";
    if (destination === "/login") {
      url.searchParams.set("callbackUrl", request.nextUrl.pathname);
    }
    return applySecurityHeaders(NextResponse.redirect(url), csp);
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("content-security-policy", csp);
  requestHeaders.set("x-nonce", nonce);
  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  return applySecurityHeaders(response, csp);
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|brand/).*)"],
};
