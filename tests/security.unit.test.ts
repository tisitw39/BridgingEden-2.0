import { describe, expect, it } from "vitest";
import { SESSION_MAX_AGE_SECONDS, sessionClaims } from "@/auth.config";
import { documentDownloadHeaders } from "@/lib/documents";
import { productionEnvError } from "@/lib/env";
import { errorText, noticeText } from "@/lib/flash";
import { pdfText } from "@/lib/pdf-text";
import { securityHeaders } from "@/lib/security-headers";

describe("session claims", () => {
  it("keeps an explicit admin or holder and rejects anything else", () => {
    expect(sessionClaims("ADMIN", "user_1")).toEqual({ id: "user_1", role: "ADMIN" });
    expect(sessionClaims("HOLDER", "user_2")).toEqual({ id: "user_2", role: "HOLDER" });
    expect(sessionClaims("SUPERUSER", "user_3")).toEqual({ id: "", role: "HOLDER" });
    expect(sessionClaims(undefined, "user_3")).toEqual({ id: "", role: "HOLDER" });
    expect(SESSION_MAX_AGE_SECONDS).toBe(8 * 60 * 60);
  });
});

describe("production environment", () => {
  it("rejects a missing, placeholder, or short AUTH_SECRET and a missing AUTH_URL", () => {
    expect(
      productionEnvError({
        NODE_ENV: "production",
        AUTH_SECRET: "replace-with-a-long-random-string",
        AUTH_URL: "https://registry.example",
      }),
    ).toMatch(/AUTH_SECRET/);
    expect(
      productionEnvError({ NODE_ENV: "production", AUTH_SECRET: "x".repeat(31), AUTH_URL: "https://registry.example" }),
    ).toMatch(/AUTH_SECRET/);
    expect(productionEnvError({ NODE_ENV: "production", AUTH_SECRET: "x".repeat(32), AUTH_URL: "" })).toMatch(
      /AUTH_URL/,
    );
    expect(
      productionEnvError({
        NODE_ENV: "production",
        AUTH_SECRET: "x".repeat(32),
        AUTH_URL: "https://registry.example",
      }),
    ).toBeNull();
    expect(productionEnvError({ NODE_ENV: "development", AUTH_SECRET: "", AUTH_URL: "" })).toBeNull();
  });
});

describe("flash codes", () => {
  it("renders only known codes", () => {
    expect(noticeText("retired")).toMatch(/certificate/i);
    expect(noticeText("<script>alert(1)</script>")).toBeUndefined();
    expect(errorText("insufficient")).toMatch(/not fully held/);
    expect(errorText("Issued 999 tonnes")).toBeUndefined();
  });
});

describe("pdf text", () => {
  it("keeps the en dash and Irish letters and drops C1 controls", () => {
    expect(pdfText("BE-GLEN-2024-000001 – BE-GLEN-2024-000025")).toContain("–");
    expect(pdfText("Córas")).toBe("Córas");
    expect(pdfText("\u0080\u0096")).toBe("??");
    expect(pdfText("\u2212")).toBe("-");
    expect(pdfText("A – B")).not.toContain("?");
  });
});

describe("security headers", () => {
  it("sets CSP, nosniff, frame denial and referrer policy, and HSTS in production", () => {
    const dev = securityHeaders("development");
    const prod = securityHeaders("production");
    const csp = dev.find((header) => header.key === "Content-Security-Policy")?.value ?? "";
    expect(csp).toContain("frame-ancestors 'none'");
    expect(dev).toContainEqual({ key: "X-Content-Type-Options", value: "nosniff" });
    expect(dev).toContainEqual({ key: "X-Frame-Options", value: "DENY" });
    expect(dev).toContainEqual({ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" });
    expect(dev.some((header) => header.key === "Strict-Transport-Security")).toBe(false);
    expect(prod.some((header) => header.key === "Strict-Transport-Security")).toBe(true);
  });
});

describe("document download headers", () => {
  it("allowlists the media type and forces a download", () => {
    const pdf = documentDownloadHeaders("note.pdf", "application/pdf", 12);
    expect(pdf["Content-Type"]).toBe("application/pdf");
    expect(pdf["Content-Disposition"]).toContain("attachment");
    expect(pdf["X-Content-Type-Options"]).toBe("nosniff");
    const html = documentDownloadHeaders("evil.html", "text/html", 4);
    expect(html["Content-Type"]).toBe("application/octet-stream");
    expect(html["Content-Disposition"]).toContain('filename="evil.html"');
  });
});
