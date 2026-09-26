import type { Metadata } from "next";
import Link from "next/link";
import { cancelAction, createHolderAction, transferAction } from "@/lib/actions/holdings";
import { Field, Flash, PageTitle, inputClass, primaryButtonClass, secondaryButtonClass } from "@/components/ui";
import { prisma } from "@/lib/db";
import { formatRanges, formatTonnes } from "@/lib/format";
import { listHoldings } from "@/lib/ledger/queries";

export const metadata: Metadata = { title: "Holdings" };

export default async function HoldingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const flash = await searchParams;
  const [holdings, accounts, projects] = await Promise.all([
    listHoldings(),
    prisma.account.findMany({
      where: { kind: "ASSET" },
      include: { user: { select: { email: true, role: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.project.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <div>
      <PageTitle
        eyebrow="Positions"
        title="Holdings"
        lede="Every figure here is derived from ledger postings. Transfer moves a serial range between holding accounts. Cancellation removes tonnes from circulation."
      />
      <Flash error={flash.error} notice={flash.notice} />

      <div className="overflow-x-auto rounded-2xl border border-line bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-line bg-pale font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Account</th>
              <th className="px-4 py-3 font-medium">Project</th>
              <th className="px-4 py-3 font-medium">Vintage</th>
              <th className="px-4 py-3 font-medium">Serials</th>
              <th className="px-4 py-3 font-medium">Tonnes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {holdings.map((row) => (
              <tr key={`${row.accountId}-${row.projectId}-${row.vintageYear}`}>
                <td className="px-4 py-3">
                  <span className="block">{row.holderName ?? row.accountName}</span>
                  {row.holderEmail ? <span className="text-xs text-muted">{row.holderEmail}</span> : null}
                </td>
                <td className="px-4 py-3">
                  <Link className="text-forest underline" href={`/projects/${row.projectId}`}>
                    {row.projectName}
                  </Link>
                </td>
                <td className="px-4 py-3">{row.vintageYear}</td>
                <td className="px-4 py-3 font-mono text-xs">
                  {formatRanges(row.projectCode, row.vintageYear, row.ranges)}
                </td>
                <td className="px-4 py-3">{formatTonnes(row.quantity)}</td>
              </tr>
            ))}
            {holdings.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-muted" colSpan={5}>
                  No credits are currently held.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-line bg-white p-6">
          <h2 className="font-serif text-2xl">Transfer</h2>
          <p className="mt-2 text-sm text-muted">
            A partial quantity is taken from the lowest serials and splits that range.
          </p>
          <form action={transferAction} className="mt-5 space-y-4">
            <Field label="From">
              <AccountSelect accounts={accounts} name="fromAccountId" />
            </Field>
            <Field label="To">
              <AccountSelect accounts={accounts} name="toAccountId" />
            </Field>
            <Field label="Project">
              <ProjectSelect projects={projects} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Vintage">
                <input className={inputClass} name="vintageYear" type="number" required />
              </Field>
              <Field label="Tonnes">
                <input className={inputClass} name="quantity" type="number" min={1} />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Or serial start">
                <input className={inputClass} name="serialStart" type="number" min={1} />
              </Field>
              <Field label="Serial end">
                <input className={inputClass} name="serialEnd" type="number" min={1} />
              </Field>
            </div>
            <Field label="Note">
              <input className={inputClass} name="memo" />
            </Field>
            <button className={primaryButtonClass} type="submit">
              Post transfer
            </button>
          </form>
        </section>

        <div className="space-y-6">
          <section className="rounded-2xl border border-line bg-white p-6">
            <h2 className="font-serif text-2xl">Cancel</h2>
            <p className="mt-2 text-sm text-muted">Cancellation retires a range from use without a beneficiary certificate.</p>
            <form action={cancelAction} className="mt-5 space-y-4">
              <Field label="From">
                <AccountSelect accounts={accounts} name="fromAccountId" />
              </Field>
              <Field label="Project">
                <ProjectSelect projects={projects} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Vintage">
                  <input className={inputClass} name="vintageYear" type="number" required />
                </Field>
                <Field label="Tonnes">
                  <input className={inputClass} name="quantity" type="number" min={1} required />
                </Field>
              </div>
              <Field label="Reason">
                <textarea className={inputClass} name="reason" rows={3} required />
              </Field>
              <button className={secondaryButtonClass} type="submit">
                Cancel credits
              </button>
            </form>
          </section>

          <section className="rounded-2xl border border-line bg-white p-6">
            <h2 className="font-serif text-2xl">New holder</h2>
            <form action={createHolderAction} className="mt-5 space-y-4">
              <Field label="Name">
                <input className={inputClass} name="name" required />
              </Field>
              <Field label="Email">
                <input className={inputClass} name="email" type="email" required />
              </Field>
              <Field label="Password">
                <input className={inputClass} name="password" type="text" minLength={8} required />
              </Field>
              <button className={primaryButtonClass} type="submit">
                Create holder
              </button>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}

function AccountSelect({
  accounts,
  name,
}: {
  accounts: { id: string; name: string; code: string; user: { email: string } | null }[];
  name: string;
}) {
  return (
    <select className={inputClass} name={name} required>
      {accounts.map((account) => (
        <option key={account.id} value={account.id}>
          {account.user?.email ? `${account.name} (${account.user.email})` : account.name}
        </option>
      ))}
    </select>
  );
}

function ProjectSelect({ projects }: { projects: { id: string; name: string; code: string }[] }) {
  return (
    <select className={inputClass} name="projectId" required>
      {projects.map((project) => (
        <option key={project.id} value={project.id}>
          {project.code} — {project.name}
        </option>
      ))}
    </select>
  );
}
