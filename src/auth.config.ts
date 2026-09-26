import type { NextAuthConfig } from "next-auth";

export const authConfig = {
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      if (request.nextUrl.pathname.startsWith("/admin")) {
        return auth?.user?.role === "ADMIN";
      }
      return true;
    },
    jwt({ token, user }) {
      if (user) {
        const record = user as { id?: string; role?: string };
        token.id = record.id ?? "";
        token.role = record.role === "HOLDER" ? "HOLDER" : "ADMIN";
      }
      return token;
    },
    session({ session, token }) {
      const claims = token as { id?: string; role?: string };
      session.user.id = claims.id ?? "";
      session.user.role = claims.role === "HOLDER" ? "HOLDER" : "ADMIN";
      return session;
    },
  },
} satisfies NextAuthConfig;
