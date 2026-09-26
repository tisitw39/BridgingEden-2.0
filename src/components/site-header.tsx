"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { signOutAction } from "@/lib/actions/auth";

type HeaderUser = { name: string; role: "ADMIN" | "HOLDER" } | null;

const linkIdle =
  "rounded-md px-3.5 py-2 font-mono text-sm font-semibold uppercase tracking-wide text-forest transition hover:-translate-y-0.5 hover:bg-pale hover:shadow-md";
const linkActive = "rounded-md bg-forest px-3.5 py-2 font-mono text-sm font-semibold uppercase tracking-wide text-cream";

function active(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SiteHeader({ user }: { user: HeaderUser }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const links = [
    { href: "/mission", label: "Mission" },
    { href: "/projects", label: "Projects" },
    { href: "/portfolio", label: "Portfolio" },
    ...(user?.role === "ADMIN" ? [{ href: "/admin", label: "Admin" }] : []),
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-forest/10 bg-sage shadow-header">
      <div className="mx-auto flex h-16 max-w-page items-center justify-between gap-4 px-5 lg:px-8">
        <Link href="/" className="flex items-center gap-2.5">
          <img src="/brand/bridging-eden-logo.png" alt="" className="h-11 w-11" />
          <span className="font-serif text-2xl leading-none text-forest">Bridging Eden</span>
        </Link>
        <nav className="hidden items-center gap-1 md:flex">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={active(pathname, link.href) ? linkActive : linkIdle}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          {user ? (
            <form action={signOutAction}>
              <button className={linkIdle} type="submit">
                Sign out
              </button>
            </form>
          ) : (
            <Link href="/login" className={pathname === "/login" ? linkActive : linkIdle}>
              Login
            </Link>
          )}
          <button
            type="button"
            className={`${linkIdle} md:hidden`}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            Menu
          </button>
        </div>
      </div>
      {open ? (
        <div className="border-t border-forest/10 bg-sage px-5 py-3 md:hidden">
          <div className="flex flex-col gap-1">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={active(pathname, link.href) ? linkActive : linkIdle}
                onClick={() => setOpen(false)}
              >
                {link.label}
              </Link>
            ))}
            {user ? (
              <form action={signOutAction}>
                <button className={`${linkIdle} w-full text-left`} type="submit">
                  Sign out
                </button>
              </form>
            ) : null}
          </div>
        </div>
      ) : null}
    </header>
  );
}
