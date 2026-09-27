import type { Metadata } from "next";
import Link from "next/link";
import { Leaf } from "lucide-react";
import { prisma } from "@/lib/db";
import { retireAction } from "@/lib/actions/retire";
import { Flash, Panel, inputClass, primaryButtonClass } from "@/components/ui";
import { formatRanges, formatSerialRange, formatTonnes, formatWhen } from "@/lib/format";
import { listEvents, listHoldings, movementOf } from "@/lib/ledger/queries";
import { currentUser } from "@/lib/session";

export const metadata: Metadata = { title: "Portfolio" };

const donutColours = ["#1C5F21", "#398E3D", "#7CB342", "#1B5E20", "#A5D6A7"];

function Donut({ slices }: { slices: { label: string; value: number; color: string }[] }) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  if (!total) {
    return (
      <div className="relative mx-auto grid h-48 w-48 place-items-center">
        <div className="absolute inset-0 rounded-full border-[22px] border-[#E4E7EA]" />
        <span className="font-mono text-xs text-muted">No data</span>
      </div>
    );
  }
  let cursor = 0;
  const gradient = slices
    .map((slice) => {
      const start = (cursor / total) * 100;
      cursor += slice.value;
      return `${slice.color} ${start}% ${(cursor / total) * 100}%`;
    })
    .join(", ");
  return (
    <div
      className="relative mx-auto grid h-48 w-48 place-items-center rounded-full"
      style={{ background: `conic-gradient(${gradient})` }}
    >
      <div className="grid h-[7.5rem] w-[7.5rem] place-items-center rounded-full bg-white text-center">
        <span>
          <span className="block font-serif text-2xl text-forest">{formatTonnes(total)}</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">tCO₂e</span>
        </span>
      </div>
    </div>
  );
}

export default async function PortfolioPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const flash = await searchParams;
  const user = await currentUser();
  const account = user ? await prisma.account.findUnique({ where: { userId: user.id } }) : null;
  const holdings = account ? await listHoldings(account.id) : [];
  const events = account ? await listEvents({ accountId: account.id }) : [];
  const retiredEvents = events.filter((event) => event.type === "RETIREMENT");
  const tonnesHeld = holdings.reduce((sum, row) => sum + row.quantity, 0);
  const tonnesRetired = retiredEvents.reduce((sum, event) => sum + movementOf(event).quantity, 0);
  const projectCount = new Set(holdings.map((row) => row.projectId)).size;

  const byProject = new Map<string, { label: string; value: number }>();
  for (const row of holdings) {
    const current = byProject.get(row.projectId) ?? { label: row.projectName, value: 0 };
    current.value += row.quantity;
    byProject.set(row.projectId, current);
  }
  const slices = [...byProject.values()].map((slice, index) => ({
    ...slice,
    color: donutColours[index % donutColours.length],
  }));

  const byVintage = new Map<number, number>();
  for (const row of holdings) {
    byVintage.set(row.vintageYear, (byVintage.get(row.vintageYear) ?? 0) + row.quantity);
  }
  const vintageMax = Math.max(1, ...byVintage.values());

  const signedIn = Boolean(user && account);

  return (
    <div className="mx-auto max-w-page px-6 py-12 lg:px-8">
      <h1 className="font-serif text-4xl text-ink">Portfolio Overview</h1>
      <div className="mt-6">
        <Flash error={flash.error} notice={flash.notice} />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Stat label="Tonnes held" value={signedIn ? formatTonnes(tonnesHeld) : "—"} />
        <Stat label="Tonnes retired" value={signedIn ? formatTonnes(tonnesRetired) : "—"} />
        <Stat label="Projects" value={signedIn ? String(projectCount) : "—"} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel className="p-6">
          <h2 className="font-serif text-xl">Total holdings</h2>
          <div className="mt-6">
            <Donut slices={slices} />
          </div>
          <div className="mt-8 grid grid-cols-2 gap-3 border-t border-line pt-6">
            <Mini label="Held" value={signedIn ? `${formatTonnes(tonnesHeld)} t` : "—"} caption="Carbon credits" />
            <Mini label="Retired" value={signedIn ? `${formatTonnes(tonnesRetired)} t` : "—"} caption="Certificates issued" />
          </div>
        </Panel>

        <Panel className="grid place-items-center p-8 text-center">
          {signedIn && byVintage.size > 0 ? (
            <div className="w-full text-left">
              <h2 className="text-center font-serif text-2xl text-forest">Holdings by vintage</h2>
              <ul className="mt-8 space-y-4">
                {[...byVintage.entries()]
                  .sort((a, b) => a[0] - b[0])
                  .map(([vintage, quantity]) => (
                    <li key={vintage}>
                      <div className="mb-1 flex justify-between font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
                        <span>{vintage}</span>
                        <span>{formatTonnes(quantity)} t</span>
                      </div>
                      <div className="h-2 rounded-full bg-pale">
                        <div
                          className="h-2 rounded-full bg-forest"
                          style={{ width: `${(quantity / vintageMax) * 100}%` }}
                        />
                      </div>
                    </li>
                  ))}
              </ul>
            </div>
          ) : (
            <div>
              <div className="mx-auto mb-4 flex h-10 items-end justify-center gap-1 text-forest/40">
                <span className="h-4 w-1.5 rounded-sm bg-current" />
                <span className="h-7 w-1.5 rounded-sm bg-current" />
                <span className="h-5 w-1.5 rounded-sm bg-current" />
              </div>
              <h2 className="font-serif text-2xl text-forest">
                {user?.role === "ADMIN" ? "Staff accounts hold no credits" : "Holdings appear after sign in"}
              </h2>
              {user?.role === "ADMIN" ? (
                <Link href="/admin/holdings" className={`${primaryButtonClass} mt-6`}>
                  View all holdings
                </Link>
              ) : user ? null : (
                <Link href="/login?callbackUrl=/portfolio" className={`${primaryButtonClass} mt-6`}>
                  Log in to view your portfolio
                </Link>
              )}
            </div>
          )}
        </Panel>
      </div>

      <Panel className="mt-4 p-6">
        <h2 className="font-serif text-xl">Project holdings</h2>
        {holdings.length === 0 ? (
          <div className="grid place-items-center py-16 text-center">
            <Leaf className="h-8 w-8 text-sage" aria-hidden />
            <p className="mt-3 font-serif text-xl text-forest">No holdings yet</p>
            <p className="mt-2 text-sm text-muted">Credits transferred to this account will appear here.</p>
            <Link href="/projects" className="mt-3 text-sm text-forest underline">
              Browse projects
            </Link>
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-line font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
                <tr>
                  <th className="py-3 pr-4 font-medium">Project</th>
                  <th className="py-3 pr-4 font-medium">Vintage</th>
                  <th className="py-3 pr-4 font-medium">Serials</th>
                  <th className="py-3 font-medium">Tonnes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {holdings.map((row) => (
                  <tr key={`${row.projectId}-${row.vintageYear}`}>
                    <td className="py-3 pr-4">
                      <Link className="text-forest underline" href={`/projects/${row.projectId}`}>
                        {row.projectName}
                      </Link>
                    </td>
                    <td className="py-3 pr-4">{row.vintageYear}</td>
                    <td className="py-3 pr-4 font-mono text-xs">
                      {formatRanges(row.projectCode, row.vintageYear, row.ranges)}
                    </td>
                    <td className="py-3">{formatTonnes(row.quantity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {holdings.length > 0 ? (
        <Panel className="mt-4 p-6">
          <h2 className="font-serif text-xl">Retire credits</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
            Retirement removes the tonnes from your balance and writes a certificate. Credits are not
            yield-bearing. A retirement cannot be reversed.
          </p>
          <form action={retireAction} className="mt-6 grid gap-4 md:grid-cols-2">
            <label className="block md:col-span-2">
              <span className="mb-1.5 block font-mono text-[11px] uppercase tracking-[0.14em] text-muted">Holding</span>
              <select className={inputClass} name="holding" required>
                {holdings.map((row) => (
                  <option key={`${row.projectId}-${row.vintageYear}`} value={`${row.projectId}:${row.vintageYear}`}>
                    {row.projectName} · {row.vintageYear} · {formatTonnes(row.quantity)} t
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block font-mono text-[11px] uppercase tracking-[0.14em] text-muted">Tonnes</span>
              <input className={inputClass} name="quantity" type="number" min={1} required />
            </label>
            <label className="block">
              <span className="mb-1.5 block font-mono text-[11px] uppercase tracking-[0.14em] text-muted">Beneficiary</span>
              <input className={inputClass} name="beneficiary" maxLength={200} required />
            </label>
            <label className="block md:col-span-2">
              <span className="mb-1.5 block font-mono text-[11px] uppercase tracking-[0.14em] text-muted">Reason</span>
              <textarea className={inputClass} name="reason" rows={3} maxLength={2000} required />
            </label>
            <div className="md:col-span-2">
              <button className={primaryButtonClass} type="submit">
                Retire credits
              </button>
            </div>
          </form>
        </Panel>
      ) : null}

      {signedIn ? (
        <Panel className="mt-4 p-6">
          <h2 className="font-serif text-xl">Transaction history</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-line font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
                <tr>
                  <th className="py-3 pr-4 font-medium">When</th>
                  <th className="py-3 pr-4 font-medium">Type</th>
                  <th className="py-3 pr-4 font-medium">Detail</th>
                  <th className="py-3 font-medium">Tonnes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {events.map((event) => {
                  const movement = movementOf(event);
                  return (
                    <tr key={event.id}>
                      <td className="py-3 pr-4 whitespace-nowrap">{formatWhen(event.recordedAt)}</td>
                      <td className="py-3 pr-4 font-mono text-[11px] uppercase tracking-[0.12em]">{event.type}</td>
                      <td className="py-3 pr-4">
                        <p>
                          {event.project.name} · {event.vintageYear}
                        </p>
                        <p className="mt-1 font-mono text-xs text-muted">
                          {movement.ranges
                            .map((range) =>
                              formatSerialRange(event.project.code, event.vintageYear, range.start, range.end),
                            )
                            .join(", ")}
                        </p>
                        {event.beneficiary ? (
                          <p className="mt-1 text-muted">Beneficiary: {event.beneficiary}</p>
                        ) : null}
                        {event.type === "RETIREMENT" ? (
                          <span className="mt-1 flex flex-wrap gap-3">
                            <a className="text-forest underline" href={`/api/certificates/${event.id}`}>
                              Download certificate
                            </a>
                            {event.verification?.token ? (
                              <a className="text-forest underline" href={`/verify/${event.verification.token}`}>
                                Verification page
                              </a>
                            ) : null}
                          </span>
                        ) : null}
                      </td>
                      <td className="py-3">{formatTonnes(movement.quantity)}</td>
                    </tr>
                  );
                })}
                {events.length === 0 ? (
                  <tr>
                    <td className="py-6 text-muted" colSpan={4}>
                      No transactions yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-line bg-white px-6 py-5">
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">{label}</p>
      <p className="mt-6 font-serif text-3xl text-forest">{value}</p>
    </div>
  );
}

function Mini({ label, value, caption }: { label: string; value: string; caption: string }) {
  return (
    <div className="rounded-xl bg-pale px-4 py-4 text-center">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-forest">{label}</p>
      <p className="mt-2 font-serif text-2xl text-forest">{value}</p>
      <p className="mt-1 text-xs text-muted">{caption}</p>
    </div>
  );
}
