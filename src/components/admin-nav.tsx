"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/projects", label: "Projects" },
  { href: "/admin/issuance", label: "Issuance" },
  { href: "/admin/holdings", label: "Holdings" },
  { href: "/admin/ledger", label: "Ledger" },
  { href: "/admin/audit", label: "Audit" },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap gap-2">
      {links.map((link) => {
        const active =
          link.href === "/admin"
            ? pathname === "/admin"
            : pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={
              active
                ? "rounded-md bg-forest px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-cream"
                : "rounded-md px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-forest hover:bg-white"
            }
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
