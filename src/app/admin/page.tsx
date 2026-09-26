import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatTonnes } from "@/lib/format";
import { reconcile } from "@/lib/ledger/service";
import { PageTitle, Panel } from "@/components/ui";

export const metadata: Metadata = { title: "Admin" };

export default async function AdminHomePage() {
  const [projects, drafts, holders, reconciliation] = await Promise.all([
    prisma.project.count(),
    prisma.creditBatch.count({ where: { status: "DRAFT" } }),
    prisma.user.count({ where: { role: "HOLDER" } }),
    reconcile(),
  ]);

  return (
    <div>
      <PageTitle
        eyebrow="Staff"
        title="Registry"
        lede="Issue credits in two steps, transfer them to holders, and read every posting from the ledger."
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Projects" value={String(projects)} href="/admin/projects" />
        <Metric label="Drafts awaiting approval" value={String(drafts)} href="/admin/issuance" />
        <Metric label="Holders" value={String(holders)} href="/admin/holdings" />
        <Metric label="Tonnes issued" value={formatTonnes(reconciliation.issued)} href="/admin/ledger" />
      </div>
      <Panel className="mt-6 p-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">Ledger check</p>
        <p className="mt-3 font-serif text-2xl text-forest">
          {reconciliation.ok ? "Balances match the issued serials." : "The ledger needs attention."}
        </p>
        <p className="mt-3 text-sm text-muted">
          Issued {formatTonnes(reconciliation.issued)} t · Held {formatTonnes(reconciliation.held)} t · Retired{" "}
          {formatTonnes(reconciliation.retired)} t · Cancelled {formatTonnes(reconciliation.cancelled)} t
        </p>
      </Panel>
    </div>
  );
}

function Metric({ label, value, href }: { label: string; value: string; href: string }) {
  return (
    <Link href={href} className="rounded-2xl border border-line bg-white p-5 transition hover:-translate-y-0.5 hover:shadow-md">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">{label}</p>
      <p className="mt-4 font-serif text-4xl text-forest">{value}</p>
    </Link>
  );
}
