import type { ReactNode } from "react";

export const inputClass =
  "w-full rounded-xl border border-line bg-cream px-3 py-2.5 text-sm text-ink outline-none ring-forest/30 placeholder:text-muted/70 focus:ring-2";

export const primaryButtonClass =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-forest px-5 py-3 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-cream transition hover:bg-[#164c1b] disabled:opacity-60";

export const secondaryButtonClass =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-line bg-white px-5 py-3 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-forest transition hover:bg-pale";

export const chipClass =
  "inline-flex items-center gap-1 rounded-lg border border-cream bg-forest px-3 py-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-cream";

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">{children}</p>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
        {label}
      </span>
      {children}
    </label>
  );
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-line bg-white ${className}`}>{children}</section>;
}

export function Flash({ error, notice }: { error?: string; notice?: string }) {
  if (error) {
    return (
      <p className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-[#8d1c1c]">
        {error}
      </p>
    );
  }
  if (notice) {
    return (
      <p className="mb-6 rounded-xl border border-line bg-pale px-4 py-3 text-sm text-forest">{notice}</p>
    );
  }
  return null;
}

export function PageTitle({
  eyebrow,
  title,
  lede,
}: {
  eyebrow?: string;
  title: string;
  lede?: string;
}) {
  return (
    <header className="mb-8">
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <h1 className="mt-2 font-serif text-4xl tracking-tight text-ink sm:text-5xl">{title}</h1>
      {lede ? <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted">{lede}</p> : null}
    </header>
  );
}
