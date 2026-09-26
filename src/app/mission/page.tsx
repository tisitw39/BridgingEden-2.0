import type { Metadata } from "next";

export const metadata: Metadata = { title: "Mission" };

const lines = [
  "Ireland was once a forest.",
  "Today, Ireland has around 11.5% forest cover — the lowest in Europe.",
  "Our mission is to get Ireland to 20% forest cover.",
  "We plant native woodland: oak, birch, hazel, holly, rowan, willow. The mix belongs to the place.",
  "Biodiversity is not a co-benefit. It is the point.",
  "Red squirrel, Atlantic oakwood, public trails. A forest people can walk into.",
  "After fifteen years the woodland passes to a public trust. The trees stay. The land stays in public hands.",
  "The credits that come from that work are tonnes of CO₂e. They are held, transferred, and retired. They do not pay yield.",
  "We are bridging Ireland back to Eden.",
];

export default function MissionPage() {
  return (
    <article className="mx-auto max-w-3xl px-6 py-20 text-center">
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">Mission</p>
      <div className="mt-8 space-y-8">
        {lines.map((line) => (
          <p key={line} className="font-serif text-2xl leading-relaxed text-ink sm:text-[1.7rem] sm:leading-[1.6]">
            {line}
          </p>
        ))}
      </div>
    </article>
  );
}
