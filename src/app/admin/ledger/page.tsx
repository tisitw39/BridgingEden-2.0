import type { Metadata } from "next";
import type { LedgerEventType } from "@prisma/client";
import { Flash, PageTitle, inputClass, secondaryButtonClass } from "@/components/ui";
import { prisma } from "@/lib/db";
import { formatSerialRange, formatTonnes, formatWhen } from "@/lib/format";
import { listEvents, movementOf } from "@/lib/ledger/queries";
import { requireAdmin } from "@/lib/session";

export const metadata: Metadata = { title: "Ledger" };

const types: LedgerEventType[] = ["ISSUANCE", "TRANSFER", "RETIREMENT", "CANCELLATION"];

export default async function LedgerPage({
  searchParams,
}: {
  searchParams: Promise<{
    type?: string;
    projectId?: string;
    accountId?: string;
    vintageYear?: string;
    error?: string;
    notice?: string;
  }>;
}) {
  const filters = await searchParams;
  await requireAdmin();
  const type = types.find((value) => value === filters.type);
  const vintageYear = filters.vintageYear ? Number(filters.vintageYear) : undefined;
  const [events, projects, accounts] = await Promise.all([
    listEvents({
      type,
      projectId: filters.projectId || undefined,
      accountId: filters.accountId || undefined,
      vintageYear: vintageYear && Number.isInteger(vintageYear) ? vintageYear : undefined,
    }),
    prisma.project.findMany({ orderBy: { name: "asc" } }),
    prisma.account.findMany({ orderBy: { name: "asc" }, include: { user: { select: { email: true } } } }),
  ]);

  return (
    <div>
      <PageTitle
        eyebrow="Journal"
        title="Ledger"
        lede="Issuance, transfer, retirement, and cancellation. Rows are append-only. Filters read the same journal the balances are derived from."
      />
      <Flash error={filters.error} notice={filters.notice} />
      <form className="mb-6 grid gap-3 rounded-2xl border border-line bg-white p-4 md:grid-cols-5" method="get">
        <select className={inputClass} name="type" defaultValue={filters.type ?? ""}>
          <option value="">All types</option>
          {types.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <select className={inputClass} name="projectId" defaultValue={filters.projectId ?? ""}>
          <option value="">All projects</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.code}
            </option>
          ))}
        </select>
        <select className={inputClass} name="accountId" defaultValue={filters.accountId ?? ""}>
          <option value="">All accounts</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.user?.email ?? account.name}
            </option>
          ))}
        </select>
        <input className={inputClass} name="vintageYear" placeholder="Vintage" defaultValue={filters.vintageYear ?? ""} />
        <button className={secondaryButtonClass} type="submit">
          Filter
        </button>
      </form>

      <div className="overflow-x-auto rounded-2xl border border-line bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-line bg-pale font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">When</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Movement</th>
              <th className="px-4 py-3 font-medium">Serials</th>
              <th className="px-4 py-3 font-medium">Tonnes</th>
              <th className="px-4 py-3 font-medium">Actor</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {events.map((event) => {
              const movement = movementOf(event);
              return (
                <tr key={event.id}>
                  <td className="px-4 py-3 whitespace-nowrap">{formatWhen(event.recordedAt)}</td>
                  <td className="px-4 py-3 font-mono text-[11px] uppercase tracking-[0.12em]">{event.type}</td>
                  <td className="px-4 py-3">
                    <p>
                      {event.project.name} · {event.vintageYear}
                    </p>
                    <p className="text-muted">
                      {movement.from} → {movement.to}
                    </p>
                    {event.beneficiary ? <p className="text-muted">For {event.beneficiary}</p> : null}
                    {event.reason ? <p className="text-muted">{event.reason}</p> : null}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {movement.ranges
                      .map((range) => formatSerialRange(event.project.code, event.vintageYear, range.start, range.end))
                      .join(", ")}
                  </td>
                  <td className="px-4 py-3">{formatTonnes(movement.quantity)}</td>
                  <td className="px-4 py-3">{event.actor.name}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
