import { beforeEach, describe, expect, it, vi } from "vitest";
import { LOGIN_EDGE_LIMIT, resetEdgeRateLimits } from "@/lib/edge-rate-limit";

vi.mock("next/server", () => {
  class NextResponse {
    status: number;
    headers: Headers;
    constructor(_body?: unknown, init?: { status?: number; headers?: Headers }) {
      this.status = init?.status ?? 200;
      this.headers = init?.headers ?? new Headers();
    }
    static redirect(url: URL) {
      return new NextResponse(null, { status: 307, headers: new Headers({ location: url.toString() }) });
    }
    static next() {
      return new NextResponse(null, { status: 200, headers: new Headers() });
    }
  }
  return { NextResponse };
});

vi.mock("next-auth", () => ({
  default: () => ({
    auth: (handler: (request: unknown) => Promise<unknown> | unknown) => handler,
  }),
}));

type GateRequest = {
  method: string;
  headers: Headers;
  auth: { user?: { role?: string } } | null;
  nextUrl: URL & { clone: () => URL };
};

function requestFor(pathname: string, role?: string, method = "GET"): GateRequest {
  const nextUrl = new URL(`http://localhost:3000${pathname}`);
  const clone = () => new URL(nextUrl.toString());
  return {
    method,
    headers: new Headers(),
    auth: role ? { user: { role } } : null,
    nextUrl: Object.assign(nextUrl, { clone }),
  };
}

describe("admin middleware", () => {
  beforeEach(() => {
    process.env.AUTH_SECRET ??= "middleware-test-secret-32-bytes-min";
    process.env.AUTH_URL ??= "http://localhost:3000";
  });

  it("redirects anonymous and holder requests away from /admin", async () => {
    const { default: middleware } = await import("@/middleware");
    const gate = middleware as unknown as (request: GateRequest) => Promise<{ status: number; headers: Headers }>;

    const anonymous = await gate(requestFor("/admin/issuance"));
    expect(anonymous.status).toBe(307);
    const location = anonymous.headers.get("location") ?? "";
    expect(location).toContain("/login");
    expect(location).toContain("callbackUrl=%2Fadmin%2Fissuance");

    const holder = await gate(requestFor("/admin", "HOLDER"));
    expect(holder.status).toBe(307);
    expect(holder.headers.get("location")).toContain("/portfolio");

    const admin = await gate(requestFor("/admin/ledger", "ADMIN"));
    expect(admin.status).toBe(200);
    expect(admin.headers.get("location")).toBeNull();
  });

  it("returns 429 when one address posts the login form too many times", async () => {
    resetEdgeRateLimits();
    const { default: middleware } = await import("@/middleware");
    const gate = middleware as unknown as (request: GateRequest) => Promise<{ status: number; headers: Headers }>;
    let status = 200;
    for (let attempt = 0; attempt < LOGIN_EDGE_LIMIT + 1; attempt += 1) {
      const response = await gate(requestFor("/login", undefined, "POST"));
      status = response.status;
    }
    expect(status).toBe(429);
    resetEdgeRateLimits();
  });
});