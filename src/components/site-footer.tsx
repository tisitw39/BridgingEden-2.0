export function SiteFooter() {
  return (
    <footer className="mt-auto bg-footer text-sage">
      <div className="mx-auto flex max-w-page flex-col gap-4 px-5 py-8 sm:flex-row sm:items-center sm:justify-between lg:px-8">
        <div className="flex items-center gap-2.5">
          <img
            src="/brand/bridging-eden-logo.png"
            alt=""
            className="h-9 w-9 brightness-0 invert"
          />
          <span className="font-serif text-xl text-white">Bridging Eden</span>
        </div>
        <p className="font-mono text-xs tracking-wide">© 2026 — High Impact Carbon Credits</p>
      </div>
    </footer>
  );
}
