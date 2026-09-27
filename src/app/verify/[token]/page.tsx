import type { Metadata } from "next";
import { headers } from "next/headers";
import { formatDate, formatTonnes } from "@/lib/format";
import { clientIp } from "@/lib/authenticate";
import { allowVerificationLookup, loadRetirementByToken } from "@/lib/verify";

export const metadata: Metadata = { title: "Verify a retirement" };

export default async function VerifyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const headerList = await headers();
  const gate = await allowVerificationLookup(clientIp({ headers: headerList }));
  const record = gate === "ok" ? await loadRetirementByToken(token) : null;

  return (
    <div className="mx-auto max-w-3xl px-6 py-14 lg:px-8">
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">Public record</p>
      <h1 className="mt-2 font-serif text-4xl text-ink sm:text-5xl">Verify a retirement</h1>
      {gate === "busy" ? (
        <p className="mt-8 rounded-2xl border border-line bg-white px-6 py-8 text-sm text-muted">
          Someone else is checking a certificate from this network right now. Wait a moment and open the link again.
        </p>
      ) : gate === "limited" ? (
        <p className="mt-8 rounded-2xl border border-line bg-white px-6 py-8 text-sm text-muted">
          Too many verification attempts from this network. Wait a few minutes and try the link again.
        </p>
      ) : record ? (
        <dl className="mt-8 divide-y divide-line rounded-2xl border border-line bg-white">
          <Row label="Status" value={record.status} />
          <Row label="Project" value={`${record.projectName} (${record.projectCode})`} />
          <Row label="Vintage" value={String(record.vintageYear)} />
          <Row label="Tonnes CO₂e" value={formatTonnes(record.quantity)} />
          <Row label="Beneficiary" value={record.beneficiary || "—"} />
          <Row label="Date" value={formatDate(record.date)} />
          <Row label="Serials" value={record.serials.join(", ") || "—"} />
        </dl>
      ) : (
        <p className="mt-8 rounded-2xl border border-line bg-white px-6 py-8 text-sm text-muted">
          This certificate could not be verified. Check the link on the retirement certificate.
        </p>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 px-6 py-4 sm:grid-cols-[180px_1fr] sm:gap-4">
      <dt className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">{label}</dt>
      <dd className="text-sm text-ink">{value}</dd>
    </div>
  );
}
