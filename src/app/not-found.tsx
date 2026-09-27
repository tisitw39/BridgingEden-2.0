import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl px-6 py-24 text-center">
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">404</p>
      <h1 className="mt-3 font-serif text-4xl">This page is not on the map.</h1>
      <Link href="/" className="mt-6 inline-block text-forest underline">
        Back to the woodland
      </Link>
    </div>
  );
}
