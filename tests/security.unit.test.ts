import { describe, expect, it } from "vitest";
import { SESSION_MAX_AGE_SECONDS, sessionClaims } from "@/auth.config";
import { clientIp } from "@/lib/authenticate";
import { documentDownloadHeaders } from "@/lib/documents";
import { adminEntryRedirect } from "@/lib/admin-gate";
import { auditEmailHmac } from "@/lib/audit-email";
import { cronBearerMatches } from "@/lib/cron-auth";
import { productionEnvError, startupEnvError } from "@/lib/env";
import { errorText, noticeText } from "@/lib/flash";
import { errorCode } from "@/lib/http";
import { ledgerErrorFromDatabase } from "@/lib/ledger/service";
import { weakPasswordMessage } from "@/lib/weak-passwords";
import { pdfText } from "@/lib/pdf-text";
import { contentSecurityPolicy, securityHeaders } from "@/lib/security-headers";

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
    expect(
      productionEnvError({
        NODE_ENV: "production",
        AUTH_SECRET: "x".repeat(32),
        AUTH_URL: "https://registry.example",
      }),
    ).toMatch(/AUDIT_EMAIL_HMAC_KEY/);
    expect(
      productionEnvError({
        NODE_ENV: "production",
        AUTH_SECRET: "x".repeat(32),
        AUTH_URL: "",
        AUDIT_EMAIL_HMAC_KEY: "y".repeat(32),
      }),
    ).toMatch(/AUTH_URL/);
    expect(
      productionEnvError({
        NODE_ENV: "production",
        AUTH_SECRET: "x".repeat(32),
        AUTH_URL: "http://registry.example",
        AUDIT_EMAIL_HMAC_KEY: "y".repeat(32),
      }),
    ).toMatch(/https/);
    expect(
      productionEnvError({
        NODE_ENV: "production",
        AUTH_SECRET: "x".repeat(32),
        AUTH_URL: "https://registry.example",
        AUDIT_EMAIL_HMAC_KEY: "y".repeat(32),
      }),
    ).toBeNull();
    expect(productionEnvError({ NODE_ENV: "development", AUTH_SECRET: "", AUTH_URL: "" })).toBeNull();
  });
});

describe("admin middleware gate", () => {
  it("sends non-admins away from /admin", () => {
    expect(adminEntryRedirect("/admin", undefined)).toBe("/login");
    expect(adminEntryRedirect("/admin/issuance", "HOLDER")).toBe("/portfolio");
    expect(adminEntryRedirect("/admin", "ADMIN")).toBeNull();
    expect(adminEntryRedirect("/portfolio", "HOLDER")).toBeNull();
  });
});

describe("unknown-email audit mac", () => {
  it("uses HMAC and refuses a missing key", () => {
    const key = "k".repeat(32);
    const first = auditEmailHmac("person@example.com", key);
    expect(first).toBe(auditEmailHmac("person@example.com", key));
    expect(first).not.toBe(auditEmailHmac("other@example.com", key));
    expect(first).not.toBe(auditEmailHmac("person@example.com", "m".repeat(32)));
    expect(() => auditEmailHmac("person@example.com", "")).toThrow(/AUDIT_EMAIL_HMAC_KEY/);
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
  it("sets nosniff, frame denial, referrer policy, permissions policy, and HSTS in production", () => {
    const dev = securityHeaders("development");
    const prod = securityHeaders("production");
    expect(dev).toContainEqual({ key: "X-Content-Type-Options", value: "nosniff" });
    expect(dev).toContainEqual({ key: "X-Frame-Options", value: "DENY" });
    expect(dev).toContainEqual({ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" });
    expect(dev.find((header) => header.key === "Permissions-Policy")?.value).toContain("camera=()");
    expect(dev.some((header) => header.key === "Strict-Transport-Security")).toBe(false);
    expect(prod.some((header) => header.key === "Strict-Transport-Security")).toBe(true);
  });

  it("uses a script nonce and does not allow unsafe-inline scripts", () => {
    const csp = contentSecurityPolicy("abc+123=", "production");
    const script = csp.split(";").map((part) => part.trim()).find((part) => part.startsWith("script-src")) ?? "";
    expect(script).toContain("'nonce-abc+123='");
    expect(script).not.toContain("unsafe-inline");
    expect(script).not.toContain("unsafe-eval");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(contentSecurityPolicy("abc", "development")).toContain("unsafe-eval");
  });
});

describe("client ip", () => {
  it("uses the Vercel platform header, otherwise the rightmost forwarded hop", () => {
    const spoofed = new Request("http://localhost/login", {
      headers: { "x-forwarded-for": "1.1.1.1, 2.2.2.2" },
    });
    expect(clientIp(spoofed, {})).toBe("2.2.2.2");
    const vercel = new Request("http://localhost/login", {
      headers: {
        "x-forwarded-for": "1.1.1.1",
        "x-vercel-forwarded-for": "9.9.9.9, 8.8.8.8",
      },
    });
    expect(clientIp(vercel, { VERCEL: "1" })).toBe("8.8.8.8");
    expect(clientIp(vercel, {})).toBe("1.1.1.1");
  });
});

describe("vercel startup", () => {
  const production = {
    NODE_ENV: "production" as const,
    AUTH_SECRET: "x".repeat(32),
    AUTH_URL: "https://registry.example",
    AUDIT_EMAIL_HMAC_KEY: "y".repeat(32),
  };

  it("requires a 32-byte CRON_SECRET only when VERCEL is set", () => {
    expect(startupEnvError({ ...production, VERCEL: "1" })).toMatch(/CRON_SECRET/);
    expect(startupEnvError({ ...production, VERCEL: "1", CRON_SECRET: "short" })).toMatch(/CRON_SECRET/);
    expect(startupEnvError({ ...production, VERCEL: "1", CRON_SECRET: "c".repeat(32) })).toBeNull();
    expect(startupEnvError(production)).toBeNull();
  });
});

describe("cron bearer", () => {
  it("compares SHA-256 digests and rejects an empty secret", () => {
    expect(cronBearerMatches("", "Bearer ")).toBe(false);
    expect(cronBearerMatches("cron-secret-value", "Bearer cron-secret-value")).toBe(true);
    expect(cronBearerMatches("cron-secret-value", "Bearer other-secret-value")).toBe(false);
    expect(cronBearerMatches("a", "Bearer aa")).toBe(false);
    expect(cronBearerMatches("cron-secret-value", null)).toBe(false);
  });
});

describe("weak passwords", () => {
  it("flags an offline breach-list password and accepts the demo passwords", () => {
    expect(weakPasswordMessage("password123")).toMatch(/too common/);
    expect(weakPasswordMessage("PASSWORD123")).toMatch(/too common/);
    expect(weakPasswordMessage("EdenAdmin!2026")).toBeNull();
    expect(weakPasswordMessage("HolderDemo!2026")).toBeNull();
  });
});

describe("ledger trigger messages", () => {
  it("maps trigger text onto the flash the page shows", () => {
    const cases = [
      ["new batches must be an unapproved draft", "A new batch has to start as a draft."],
      ["approved batch requires its issuance event", "Approving a batch has to record the issuance at the same time."],
      ["a contra credit is only allowed on an issuance", "Credits can only be issued through an approved batch."],
      ["issuance requires an approved credit batch", "Credits can only be issued through an approved batch."],
      ["the issuance actor must be the batch approver", "The issuance must be recorded by the approving admin."],
      ["the batch approver must be an admin", "The approver must be an admin."],
      ["the batch drafter must be an admin", "The drafter must be an admin."],
      ["contra accounts can only be debited by an issuance", "A contra account can only be debited when credits are issued."],
      ["issuance postings do not match the approved batch", "The issued serials do not match the approved batch."],
      ["credit batch is frozen", "That batch can no longer be changed."],
    ] as const;
    for (const [message, friendly] of cases) {
      const error = ledgerErrorFromDatabase(message);
      expect(error?.message).toBe(friendly);
      expect(errorText(errorCode(error, "invariant"))).toBe(friendly);
    }
    expect(ledgerErrorFromDatabase("something else")).toBeNull();
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
