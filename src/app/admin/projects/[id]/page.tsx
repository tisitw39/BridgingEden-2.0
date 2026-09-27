import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { draftBatchAction } from "@/lib/actions/issuance";
import { uploadDocumentsAction } from "@/lib/actions/projects";
import { Field, Flash, inputClass, primaryButtonClass, secondaryButtonClass } from "@/components/ui";
import { prisma } from "@/lib/db";
import { formatSerialRange, formatTonnes, formatWhen } from "@/lib/format";
import { requireAdmin } from "@/lib/session";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  await requireAdmin();
  const { id } = await params;
  const project = await prisma.project.findUnique({ where: { id }, select: { name: true } });
  return { title: project?.name ?? "Project" };
}

export default async function AdminProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { id } = await params;
  const flash = await searchParams;
  await requireAdmin();
  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      documents: { orderBy: { createdAt: "desc" } },
      batches: { orderBy: { draftedAt: "desc" }, include: { draftedBy: true, approvedBy: true } },
    },
  });
  if (!project) notFound();

  return (
    <div>
      <Flash error={flash.error} notice={flash.notice} />
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">{project.code}</p>
      <h1 className="mt-2 font-serif text-4xl">{project.name}</h1>
      <p className="mt-2 text-muted">{project.location}</p>
      <p className="mt-4 max-w-3xl text-sm leading-relaxed">{project.description}</p>
      <dl className="mt-6 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">Methodology</dt>
          <dd className="mt-1">{project.methodology}</dd>
        </div>
        <div>
          <dt className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">Standard / registry</dt>
          <dd className="mt-1">{project.standardReference}</dd>
        </div>
      </dl>
      <p className="mt-4">
        <Link className="text-sm text-forest underline" href={`/projects/${project.id}`}>
          Public project page
        </Link>
      </p>

      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-line bg-white p-6">
          <h2 className="font-serif text-2xl">Draft a credit batch</h2>
          <p className="mt-2 text-sm text-muted">
            A draft does not touch the ledger. A different admin approves it and assigns the serial range.
          </p>
          <form action={draftBatchAction} className="mt-5 space-y-4">
            <input type="hidden" name="projectId" value={project.id} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Vintage year">
                <input className={inputClass} name="vintageYear" type="number" min={1990} max={2100} required />
              </Field>
              <Field label="Quantity (tCO₂e)">
                <input className={inputClass} name="quantity" type="number" min={1} required />
              </Field>
            </div>
            <Field label="Methodology">
              <input className={inputClass} name="methodology" defaultValue={project.methodology} maxLength={200} required />
            </Field>
            <button className={primaryButtonClass} type="submit">
              Save draft
            </button>
          </form>
        </section>

        <section className="rounded-2xl border border-line bg-white p-6">
          <h2 className="font-serif text-2xl">Documents</h2>
          <ul className="mt-4 space-y-2 text-sm">
            {project.documents.map((document) => (
              <li key={document.id} className="flex items-baseline justify-between gap-3">
                <a className="text-forest underline" href={`/api/documents/${document.id}`}>
                  {document.fileName}
                </a>
                <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
                  {formatWhen(document.createdAt)}
                </span>
              </li>
            ))}
            {project.documents.length === 0 ? <li className="text-muted">None yet.</li> : null}
          </ul>
          <form action={uploadDocumentsAction} className="mt-5 space-y-3">
            <input type="hidden" name="projectId" value={project.id} />
            <input className={inputClass} name="documents" type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv" required />
            <p className="text-xs text-muted">Up to 2 files, 1.5 MB each.</p>
            <button className={secondaryButtonClass} type="submit">
              Upload
            </button>
          </form>
        </section>
      </div>

      <h2 className="mt-10 font-serif text-2xl">Batches</h2>
      <div className="mt-4 overflow-x-auto rounded-2xl border border-line bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-line bg-pale font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Vintage</th>
              <th className="px-4 py-3 font-medium">Tonnes</th>
              <th className="px-4 py-3 font-medium">Serials</th>
              <th className="px-4 py-3 font-medium">Drafted</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {project.batches.map((batch) => (
              <tr key={batch.id}>
                <td className="px-4 py-3 font-mono text-[11px] uppercase tracking-[0.12em]">{batch.status}</td>
                <td className="px-4 py-3">{batch.vintageYear}</td>
                <td className="px-4 py-3">{formatTonnes(batch.quantity)}</td>
                <td className="px-4 py-3 font-mono text-xs">
                  {batch.serialStart && batch.serialEnd
                    ? formatSerialRange(project.code, batch.vintageYear, batch.serialStart, batch.serialEnd)
                    : "—"}
                </td>
                <td className="px-4 py-3">
                  {batch.draftedBy.name}
                  <span className="block text-xs text-muted">{formatWhen(batch.draftedAt)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
