import type { DefaultSession } from "next-auth";

type AppRole = "ADMIN" | "HOLDER";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: AppRole;
      tokenVersion: number;
    } & DefaultSession["user"];
  }

  interface User {
    role: AppRole;
    tokenVersion?: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: AppRole;
    tokenVersion: number;
  }
}
