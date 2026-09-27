import type { NextAuthConfig } from "next-auth";
import { assertProductionEnv } from "@/lib/env";

export const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

export function sessionClaims(role: unknown, id: unknown): { id: string; role: "ADMIN" | "HOLDER" } {
  if ((role === "ADMIN" || role === "HOLDER") && typeof id === "string" && id.length > 0) {
    return { id, role };
  }
  return { id: "", role: "HOLDER" };
}

export const authConfig = {
  // Safe only when AUTH_URL is set. Production startup rejects a missing AUTH_URL.
  trustHost: true,
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_SECONDS },
  pages: { signIn: "/login" },
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      assertProductionEnv();
      if (request.nextUrl.pathname.startsWith("/admin")) {
        return auth?.user?.role === "ADMIN";
      }
      return true;
    },
    jwt({ token, user }) {
      if (user) {
        const claims = sessionClaims((user as { role?: unknown }).role, (user as { id?: unknown }).id);
        token.id = claims.id;
        token.role = claims.role;
      } else {
        const claims = sessionClaims(token.role, token.id);
        token.id = claims.id;
        token.role = claims.role;
      }
      return token;
    },
    session({ session, token }) {
      const claims = sessionClaims(token.role, token.id);
      session.user.id = claims.id;
      session.user.role = claims.role;
      return session;
    },
  },
} satisfies NextAuthConfig;
