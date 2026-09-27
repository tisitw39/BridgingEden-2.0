import type { Metadata } from "next";
import { PageTitle } from "@/components/ui";
import { prisma } from "@/lib/db";
import { formatWhen } from "@/lib/format";
import { requireAdmin } from "@/lib/session";

export const metadata: Metadata = { title: "Audit" };

export default async function AuditPage() {
  await requireAdmin();
  const entries = await prisma.auditLog.findMany({
    include: { actor: { select: { name: true, email: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return (
    <div>
      <PageTitle
        eyebrow="Who did what"
        title="Audit"
        lede="Drafts, approvals, transfers, retirements, cancellations, and sign-ins. The financial record itself lives in the ledger and cannot be edited."
      />
      <div className="overflow-x-auto rounded-2xl border border-line bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-line bg-pale font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">When</th>
              <th className="px-4 py-3 font-medium">Action</th>
              <th className="px-4 py-3 font-medium">Actor</th>
              <th className="px-4 py-3 font-medium">Detail</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td className="px-4 py-3 whitespace-nowrap">{formatWhen(entry.createdAt)}</td>
                <td className="px-4 py-3 font-mono text-[11px] uppercase tracking-[0.12em]">{entry.action}</td>
                <td className="px-4 py-3">{entry.actor?.name ?? "—"}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted">
                  {JSON.stringify(entry.detail)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
