import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { primaryButtonClass } from "@/components/ui";
import { PageTitle } from "@/components/ui";
import { requireAdmin } from "@/lib/session";

export const metadata: Metadata = { title: "Projects" };

export default async function AdminProjectsPage() {
  await requireAdmin();
  const projects = await prisma.project.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { batches: true, documents: true } } },
  });

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageTitle eyebrow="Registry" title="Projects" />
        <Link href="/admin/projects/new" className={primaryButtonClass}>
          New project
        </Link>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-line bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-line bg-pale font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Code</th>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Location</th>
              <th className="px-4 py-3 font-medium">Batches</th>
              <th className="px-4 py-3 font-medium">Documents</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {projects.map((project) => (
              <tr key={project.id}>
                <td className="px-4 py-3 font-mono text-xs">{project.code}</td>
                <td className="px-4 py-3">
                  <Link className="text-forest underline" href={`/admin/projects/${project.id}`}>
                    {project.name}
                  </Link>
                </td>
                <td className="px-4 py-3">{project.location}</td>
                <td className="px-4 py-3">{project._count.batches}</td>
                <td className="px-4 py-3">{project._count.documents}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
