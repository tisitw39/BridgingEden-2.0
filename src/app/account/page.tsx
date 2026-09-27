import type { Metadata } from "next";
import { changePasswordAction } from "@/lib/actions/auth";
import { Flash, PageTitle, inputClass, primaryButtonClass } from "@/components/ui";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const user = await requireUser();
  const flash = await searchParams;

  return (
    <div className="mx-auto max-w-xl px-6 py-12 lg:px-8">
      <PageTitle
        eyebrow="Account"
        title="Password"
        lede={`${user.name} · ${user.email}. Change the password for this signed-in account.`}
      />
      <Flash error={flash.error} notice={flash.notice} />
      <form action={changePasswordAction} className="space-y-4 rounded-2xl border border-line bg-white p-6">
        <label className="block">
          <span className="mb-1.5 block font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
            Current password
          </span>
          <input className={inputClass} name="currentPassword" type="password" autoComplete="current-password" required />
        </label>
        <label className="block">
          <span className="mb-1.5 block font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
            New password
          </span>
          <input
            className={inputClass}
            name="newPassword"
            type="password"
            autoComplete="new-password"
            minLength={8}
            maxLength={200}
            required
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
            Confirm new password
          </span>
          <input
            className={inputClass}
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            minLength={8}
            maxLength={200}
            required
          />
        </label>
        <button className={primaryButtonClass} type="submit">
          Update password
        </button>
      </form>
    </div>
  );
}
