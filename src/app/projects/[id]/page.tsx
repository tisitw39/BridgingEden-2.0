import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatSerialRange, formatTonnes, formatWhen } from "@/lib/format";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const project = await prisma.project.findUnique({ where: { id }, select: { name: true } });
  return { title: project?.name ?? "Project" };
}

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      documents: { orderBy: { createdAt: "asc" }, select: { id: true, fileName: true, sizeBytes: true, createdAt: true } },
      batches: {
        where: { status: "APPROVED" },
        orderBy: { vintageYear: "asc" },
      },
    },
  });
  if (!project) notFound();

  return (
    <div className="mx-auto max-w-page px-6 py-12 lg:px-8">
      <Link href="/projects" className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
        ← Projects
      </Link>
      <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.16em] text-muted">{project.code}</p>
      <h1 className="mt-2 font-serif text-4xl sm:text-5xl">{project.name}</h1>
      <p className="mt-3 text-muted">{project.location}</p>
      <p className="mt-6 max-w-3xl text-base leading-relaxed">{project.description}</p>

      <dl className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-line bg-white p-5">
          <dt className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">Methodology</dt>
          <dd className="mt-2 text-sm">{project.methodology}</dd>
        </div>
        <div className="rounded-2xl border border-line bg-white p-5">
          <dt className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">Standard / registry</dt>
          <dd className="mt-2 text-sm">{project.standardReference}</dd>
        </div>
      </dl>

      <h2 className="mt-12 font-serif text-3xl">Issued vintages</h2>
      <div className="mt-4 overflow-x-auto rounded-2xl border border-line bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-line bg-pale font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Vintage</th>
              <th className="px-4 py-3 font-medium">Tonnes</th>
              <th className="px-4 py-3 font-medium">Serial range</th>
              <th className="px-4 py-3 font-medium">Methodology</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {project.batches.map((batch) => (
              <tr key={batch.id}>
                <td className="px-4 py-3">{batch.vintageYear}</td>
                <td className="px-4 py-3">{formatTonnes(batch.quantity)}</td>
                <td className="px-4 py-3 font-mono text-xs">
                  {batch.serialStart && batch.serialEnd
                    ? formatSerialRange(project.code, batch.vintageYear, batch.serialStart, batch.serialEnd)
                    : "—"}
                </td>
                <td className="px-4 py-3">{batch.methodology}</td>
              </tr>
            ))}
            {project.batches.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-muted" colSpan={4}>
                  No credits have been issued for this project yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <h2 className="mt-12 font-serif text-3xl">Supporting documents</h2>
      <ul className="mt-4 space-y-2">
        {project.documents.map((document) => (
          <li key={document.id}>
            <a className="text-sm text-forest underline" href={`/api/documents/${document.id}`}>
              {document.fileName}
            </a>
            <span className="ml-2 font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
              {formatWhen(document.createdAt)}
            </span>
          </li>
        ))}
        {project.documents.length === 0 ? <li className="text-sm text-muted">No documents uploaded.</li> : null}
      </ul>
    </div>
  );
}
