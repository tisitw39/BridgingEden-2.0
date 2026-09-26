import type { Metadata } from "next";
import Link from "next/link";
import { approveBatchAction, rejectBatchAction } from "@/lib/actions/issuance";
import { Flash, PageTitle, inputClass, primaryButtonClass, secondaryButtonClass } from "@/components/ui";
import { prisma } from "@/lib/db";
import { formatSerialRange, formatTonnes, formatWhen } from "@/lib/format";

export const metadata: Metadata = { title: "Issuance" };

export default async function IssuancePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const flash = await searchParams;
  const [drafts, history] = await Promise.all([
    prisma.creditBatch.findMany({
      where: { status: "DRAFT" },
      include: { project: true, draftedBy: true },
      orderBy: { draftedAt: "asc" },
    }),
    prisma.creditBatch.findMany({
      where: { status: { in: ["APPROVED", "REJECTED"] } },
      include: { project: true, draftedBy: true, approvedBy: true, rejectedBy: true },
      orderBy: { draftedAt: "desc" },
      take: 30,
    }),
  ]);

  return (
    <div>
      <PageTitle
        eyebrow="Second step"
        title="Issuance"
        lede="Approval assigns the next serial numbers for the project and posts a balanced issuance to the ledger. Rejection leaves the ledger unchanged."
      />
      <Flash error={flash.error} notice={flash.notice} />

      <h2 className="font-serif text-2xl">Awaiting approval</h2>
      <div className="mt-4 space-y-4">
        {drafts.map((batch) => (
          <article key={batch.id} className="rounded-2xl border border-line bg-white p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">{batch.project.code}</p>
                <h3 className="mt-1 font-serif text-2xl">
                  <Link className="hover:underline" href={`/admin/projects/${batch.projectId}`}>
                    {batch.project.name}
                  </Link>
                </h3>
                <p className="mt-2 text-sm text-muted">
                  Vintage {batch.vintageYear} · {formatTonnes(batch.quantity)} tCO₂e · {batch.methodology}
                </p>
                <p className="mt-2 text-sm">
                  Drafted by {batch.draftedBy.name} · {formatWhen(batch.draftedAt)}
                </p>
              </div>
              <p className="font-serif text-4xl text-forest">{formatTonnes(batch.quantity)}</p>
            </div>
            <div className="mt-6 flex flex-col gap-4 lg:flex-row lg:items-end">
              <form action={approveBatchAction}>
                <input type="hidden" name="batchId" value={batch.id} />
                <button className={primaryButtonClass} type="submit">
                  Approve and issue →
                </button>
              </form>
              <form action={rejectBatchAction} className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
                <input type="hidden" name="batchId" value={batch.id} />
                <input className={inputClass} name="note" placeholder="Reason for rejection" required />
                <button className={secondaryButtonClass} type="submit">
                  Reject
                </button>
              </form>
            </div>
          </article>
        ))}
        {drafts.length === 0 ? (
          <p className="rounded-2xl border border-line bg-white px-6 py-8 text-sm text-muted">
            No drafts are waiting. Open a project and save a batch to start an issuance.
          </p>
        ) : null}
      </div>

      <h2 className="mt-12 font-serif text-2xl">Decisions</h2>
      <div className="mt-4 overflow-x-auto rounded-2xl border border-line bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-line bg-pale font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Project</th>
              <th className="px-4 py-3 font-medium">Vintage</th>
              <th className="px-4 py-3 font-medium">Tonnes</th>
              <th className="px-4 py-3 font-medium">Serials</th>
              <th className="px-4 py-3 font-medium">By</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {history.map((batch) => (
              <tr key={batch.id}>
                <td className="px-4 py-3 font-mono text-[11px] uppercase tracking-[0.12em]">{batch.status}</td>
                <td className="px-4 py-3">{batch.project.name}</td>
                <td className="px-4 py-3">{batch.vintageYear}</td>
                <td className="px-4 py-3">{formatTonnes(batch.quantity)}</td>
                <td className="px-4 py-3 font-mono text-xs">
                  {batch.serialStart && batch.serialEnd
                    ? formatSerialRange(batch.project.code, batch.vintageYear, batch.serialStart, batch.serialEnd)
                    : batch.rejectionNote ?? "—"}
                </td>
                <td className="px-4 py-3">
                  {batch.status === "APPROVED"
                    ? `${batch.approvedBy?.name ?? "—"} · ${batch.approvedAt ? formatWhen(batch.approvedAt) : ""}`
                    : `${batch.rejectedBy?.name ?? "—"} · ${batch.rejectedAt ? formatWhen(batch.rejectedAt) : ""}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
