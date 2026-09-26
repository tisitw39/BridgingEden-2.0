import type { Metadata } from "next";
import { LoginForm } from "@/components/login-form";

export const metadata: Metadata = { title: "Login" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const params = await searchParams;
  const callbackUrl = params.callbackUrl?.startsWith("/") ? params.callbackUrl : undefined;

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center px-6 py-16">
      <img src="/brand/bridging-eden-logo.png" alt="" className="h-16 w-16" />
      <h1 className="mt-4 font-serif text-4xl text-forest">Bridging Eden</h1>
      <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
        Sign in to your account
      </p>
      <div className="mt-8 w-full rounded-2xl border border-line bg-white p-6 shadow-sm">
        <LoginForm callbackUrl={callbackUrl} />
      </div>
      <p className="mt-4 text-center text-xs text-muted">Your data is kept private and never shared.</p>
      <div className="mt-8 w-full rounded-2xl border border-line bg-pale p-4 text-sm text-muted">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-forest">Local demo</p>
        <p className="mt-2">Staff: admin@bridgingeden.ie · EdenAdmin!2026</p>
        <p>Holder: aoife.brennan@example.com · HolderDemo!2026</p>
      </div>
    </div>
  );
}
