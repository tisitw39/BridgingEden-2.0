import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatTonnes } from "@/lib/format";
import { chipClass, primaryButtonClass } from "@/components/ui";

const impacts = [
  {
    eyebrow: "Conservation",
    title: "Native Tree Planting",
    body: "Restoring native woodland to their historic species mix, supporting wildlife habitat and biodiversity.",
    image: "/brand/impact-tree-planting-editorial.png",
    alt: "Black and white study of native leaves",
  },
  {
    eyebrow: "Biodiversity",
    title: "Wildlife Conservation",
    body: "Creating safe habitats and hosting breeding programs to promote vulnerable native species, including Red Squirrel.",
    image: "/brand/impact-wildlife-editorial.png",
    alt: "Black and white engraving of a red squirrel",
  },
  {
    eyebrow: "Access",
    title: "Public Recreation",
    body: "Enhancing public access to nature through the creation of trails and outdoor recreation areas.",
    image: "/brand/impact-recreation-editorial.png",
    alt: "A walker on a forest trail",
  },
];

const steps = [
  {
    n: "01",
    title: "Fund",
    body: "Corporate buyers fund a forestry project. Capital flows directly into verified afforestation projects, securing land and covering planting costs.",
  },
  {
    n: "02",
    title: "Planting & Conservation",
    body: "The Bridging Eden team and our specialised contractors immediately mobilise to plant native trees and establish the vital conservation infrastructure for each project.",
  },
  {
    n: "03",
    title: "Public Ownership",
    body: "After 15 years, ownership of the forest is transferred to a public trust, placing the woodland into public hands via a charitable legal framework.",
  },
];

export default async function HomePage() {
  const projects = await prisma.project.findMany({
    orderBy: { name: "asc" },
    include: { batches: { where: { status: "APPROVED" }, select: { quantity: true } } },
  });

  return (
    <>
      <section className="bg-cream">
        <div className="mx-auto grid max-w-page items-center gap-10 px-6 py-12 lg:grid-cols-[1.1fr_0.9fr] lg:px-24 lg:py-24">
          <div className="order-2 lg:order-1">
            <h1 className="font-serif text-5xl leading-[1.02] tracking-tight text-black sm:text-6xl lg:text-[5.4rem]">
              Carbon Credits
              <br />
              With A Legacy
            </h1>
            <p className="mt-8 max-w-md text-lg leading-relaxed text-muted">
              Native woodland in Ireland, recorded one tonne at a time. Credits are issued on an
              append-only ledger and retired when the claim is used.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/projects" className={primaryButtonClass}>
                View projects
              </Link>
              <Link href="/login" className={chipClass}>
                Sign in →
              </Link>
            </div>
          </div>
          <img
            src="/brand/hero-forest.png"
            alt="Engraving of a native woodland canopy"
            className="order-1 w-full justify-self-end lg:order-2"
          />
        </div>
      </section>

      <section className="bg-sand">
        <div className="mx-auto max-w-page px-6 py-16 lg:px-8 lg:py-20">
          <h2 className="font-serif text-4xl text-ink sm:text-5xl">How our forests create impact.</h2>
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {impacts.map((impact) => (
              <article key={impact.title} className="flex flex-col overflow-hidden rounded-2xl border border-line bg-pale">
                <div className="p-6">
                  <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">{impact.eyebrow}</p>
                  <h3 className="mt-3 font-serif text-2xl text-ink">{impact.title}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-muted">{impact.body}</p>
                </div>
                <img src={impact.image} alt={impact.alt} className="mt-auto h-56 w-full object-cover" />
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-mint">
        <div className="mx-auto max-w-page px-6 py-16 lg:px-8 lg:py-20">
          <h2 className="max-w-xl font-serif text-4xl text-ink sm:text-5xl">One credit. One tonne.</h2>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-ink/80">
            A Bridging Eden credit is one tonne of CO₂e. It does not pay yield. The ledger is the
            record of who holds it, and retirement is how a claim is used.
          </p>
          <div className="mt-10 grid gap-5 md:grid-cols-2">
            <article className="rounded-2xl border border-line bg-white p-6">
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">Carbon impact</p>
              <h3 className="mt-3 font-serif text-2xl">Verified carbon credit</h3>
              <p className="mt-4 font-mono text-sm uppercase tracking-[0.12em] text-forest">1 credit = 1 tCO₂e</p>
              <p className="mt-4 text-sm leading-relaxed text-muted">
                Issued against a named project, vintage, and methodology. Each tonne receives a
                serial number. The same serial cannot be issued twice, and balances are derived
                from the ledger rather than stored as an editable figure.
              </p>
            </article>
            <article className="rounded-2xl border border-line bg-white p-6">
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">When it is used</p>
              <h3 className="mt-3 font-serif text-2xl">Retirement certificate</h3>
              <p className="mt-4 text-sm leading-relaxed text-muted">
                A holder retires credits for a beneficiary and a reason. The serial range leaves
                their balance, the retirement is permanent, and Bridging Eden issues a certificate
                with the project, vintage, beneficiary, and date.
              </p>
              <Link href="/portfolio" className={`${chipClass} mt-6`}>
                Portfolio →
              </Link>
            </article>
          </div>
        </div>
      </section>

      <section className="bg-pale">
        <div className="mx-auto max-w-page px-6 py-16 lg:px-8 lg:py-20">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">The mechanism</p>
          <h2 className="mt-3 font-serif text-4xl text-ink sm:text-5xl">How Bridging Eden works.</h2>
          <div className="mt-10 overflow-hidden rounded-2xl border border-line bg-white md:grid md:grid-cols-3">
            {steps.map((step) => (
              <article key={step.n} className="border-b border-line p-8 last:border-b-0 md:border-b-0 md:border-r md:last:border-r-0">
                <p className="font-mono text-sm text-forest">{step.n}</p>
                <h3 className="mt-4 font-serif text-2xl text-forest">{step.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted">{step.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-cream">
        <div className="mx-auto max-w-page px-6 py-16 lg:px-8 lg:pb-24">
          <h2 className="font-serif text-4xl text-ink sm:text-5xl">Projects on the ledger.</h2>
          {projects.length === 0 ? (
            <p className="mt-6 text-muted">Projects appear here once Bridging Eden registers them.</p>
          ) : (
            <div className="mt-8 grid gap-5 md:grid-cols-2">
              {projects.map((project) => {
                const tonnes = project.batches.reduce((sum, batch) => sum + batch.quantity, 0);
                return (
                  <Link
                    key={project.id}
                    href={`/projects/${project.id}`}
                    className="rounded-2xl border border-line bg-white p-6 transition hover:-translate-y-0.5 hover:shadow-md"
                  >
                    <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">{project.code}</p>
                    <h3 className="mt-2 font-serif text-2xl">{project.name}</h3>
                    <p className="mt-2 text-sm text-muted">{project.location}</p>
                    <p className="mt-4 font-mono text-xs uppercase tracking-[0.12em] text-forest">
                      {formatTonnes(tonnes)} tCO₂e issued
                    </p>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
