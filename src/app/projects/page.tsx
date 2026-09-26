import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatTonnes } from "@/lib/format";
import { PageTitle } from "@/components/ui";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectsPage() {
  const projects = await prisma.project.findMany({
    orderBy: { name: "asc" },
    include: {
      batches: { where: { status: "APPROVED" }, select: { quantity: true, vintageYear: true } },
    },
  });

  return (
    <div className="mx-auto max-w-page px-6 py-12 lg:px-8">
      <PageTitle
        eyebrow="The woodland"
        title="Projects"
        lede="Each project is a place, a methodology, and a standard reference. Approved vintages are the credits on the ledger."
      />
      <div className="grid gap-5">
        {projects.map((project) => {
          const tonnes = project.batches.reduce((sum, batch) => sum + batch.quantity, 0);
          const vintages = [...new Set(project.batches.map((batch) => batch.vintageYear))].sort();
          return (
            <Link
              key={project.id}
              href={`/projects/${project.id}`}
              className="rounded-2xl border border-line bg-white p-6 transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">{project.code}</p>
                  <h2 className="mt-2 font-serif text-3xl">{project.name}</h2>
                  <p className="mt-2 text-sm text-muted">{project.location}</p>
                </div>
                <p className="font-mono text-xs uppercase tracking-[0.12em] text-forest">
                  {formatTonnes(tonnes)} tCO₂e issued
                </p>
              </div>
              <p className="mt-4 max-w-3xl text-sm leading-relaxed text-ink/80">{project.description}</p>
              <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
                {project.methodology}
                {vintages.length ? ` · Vintage ${vintages.join(", ")}` : ""}
              </p>
            </Link>
          );
        })}
        {projects.length === 0 ? <p className="text-muted">No projects have been registered yet.</p> : null}
      </div>
    </div>
  );
}
