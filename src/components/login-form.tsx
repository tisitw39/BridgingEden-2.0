"use client";

import { useActionState, useState } from "react";
import { loginAction } from "@/lib/actions/auth";
import { inputClass, primaryButtonClass } from "@/components/ui";

export function LoginForm({ callbackUrl }: { callbackUrl?: string }) {
  const [state, action, pending] = useActionState(loginAction, null);
  const [showPassword, setShowPassword] = useState(false);

  return (
    <form action={action} className="space-y-4">
      {callbackUrl ? <input type="hidden" name="callbackUrl" value={callbackUrl} /> : null}
      <label className="block">
        <span className="mb-1.5 block font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
          Email
        </span>
        <input className={inputClass} name="email" type="email" autoComplete="username" required />
      </label>
      <label className="block">
        <span className="mb-1.5 block font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
          Password
        </span>
        <span className="relative block">
          <input
            className={inputClass}
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
          />
          <button
            type="button"
            className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted"
            onClick={() => setShowPassword((value) => !value)}
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        </span>
      </label>
      {state?.error ? <p className="text-sm text-[#8d1c1c]">{state.error}</p> : null}
      <button className={`${primaryButtonClass} w-full`} type="submit" disabled={pending}>
        {pending ? "Signing in" : "Sign in →"}
      </button>
    </form>
  );
}
