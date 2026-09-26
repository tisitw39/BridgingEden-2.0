import fs from "node:fs";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { prisma } from "@/lib/db";
import { formatDate, formatSerialRange, formatTonnes } from "@/lib/format";

const forest = rgb(28 / 255, 95 / 255, 33 / 255);
const cream = rgb(252 / 255, 250 / 255, 243 / 255);
const ink = rgb(30 / 255, 41 / 255, 35 / 255);
const muted = rgb(87 / 255, 126 / 255, 73 / 255);

function pdfText(value: string): string {
  return value.normalize("NFC").replace(/[^\n\u0020-\u00FF]/g, "?");
}

function wrap(text: string, widthOf: (line: string) => number, maxWidth: number): string[] {
  const words = pdfText(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (widthOf(next) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export async function buildRetirementCertificate(eventId: string): Promise<Uint8Array | null> {
  const event = await prisma.ledgerEvent.findUnique({
    where: { id: eventId },
    include: {
      project: true,
      actor: { select: { name: true } },
      postings: { orderBy: { seq: "asc" } },
    },
  });
  if (!event || event.type !== "RETIREMENT") return null;

  const ranges = event.postings
    .filter((posting) => posting.side === "CREDIT")
    .map((posting) => ({ start: posting.serialStart, end: posting.serialEnd }));
  const quantity = ranges.reduce((sum, range) => sum + (range.end - range.start + 1), 0);

  const pdf = await PDFDocument.create();
  pdf.setTitle(`Bridging Eden retirement ${event.id}`);
  pdf.setAuthor("Bridging Eden");
  const page = pdf.addPage([595.28, 841.89]);
  const { width, height } = page.getSize();
  const serif = await pdf.embedFont(StandardFonts.TimesRoman);
  const serifBold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const sans = await pdf.embedFont(StandardFonts.Helvetica);
  const sansBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  page.drawRectangle({ x: 0, y: 0, width, height, color: cream });
  page.drawRectangle({ x: 0, y: height - 108, width, height: 108, color: forest });

  const logoPath = path.join(process.cwd(), "public/brand/bridging-eden-logo.png");
  if (fs.existsSync(logoPath)) {
    const logo = await pdf.embedPng(fs.readFileSync(logoPath));
    page.drawImage(logo, { x: 48, y: height - 84, width: 52, height: 52 });
  }

  page.drawText("Bridging Eden", {
    x: 112,
    y: height - 62,
    size: 22,
    font: serif,
    color: cream,
  });
  page.drawText("RETIREMENT CERTIFICATE", {
    x: 112,
    y: height - 82,
    size: 10,
    font: sansBold,
    color: cream,
  });

  page.drawText("One credit. One tonne. Retired.", {
    x: 48,
    y: height - 150,
    size: 22,
    font: serif,
    color: ink,
  });

  const intro =
    "This certificate records that the carbon credits below have been retired on the Bridging Eden ledger. Retired credits are removed from the holder's balance and cannot be transferred or retired again. They are not yield-bearing.";
  let cursor = height - 178;
  for (const line of wrap(intro, (line) => sans.widthOfTextAtSize(line, 11), width - 96)) {
    page.drawText(line, { x: 48, y: cursor, size: 11, font: sans, color: ink });
    cursor -= 16;
  }

  const fields: [string, string][] = [
    ["Certificate", event.id],
    ["Date", formatDate(event.recordedAt)],
    ["Beneficiary", event.beneficiary ?? "—"],
    ["Reason", event.reason ?? "—"],
    ["Project", `${event.project.name} (${event.project.code})`],
    ["Location", event.project.location],
    ["Vintage", String(event.vintageYear)],
    ["Tonnes CO2e", formatTonnes(quantity)],
    ["Standard", event.project.standardReference],
    ["Recorded by", event.actor.name],
  ];

  cursor -= 12;
  for (const [label, value] of fields) {
    page.drawText(label.toUpperCase(), { x: 48, y: cursor, size: 8, font: sansBold, color: muted });
    const lines = wrap(value, (line) => sans.widthOfTextAtSize(line, 12), width - 210);
    lines.forEach((line, index) => {
      page.drawText(line, { x: 170, y: cursor - index * 15, size: 12, font: sans, color: ink });
    });
    cursor -= Math.max(22, lines.length * 15 + 8);
  }

  cursor -= 8;
  page.drawText("SERIAL RANGE", { x: 48, y: cursor, size: 8, font: sansBold, color: muted });
  cursor -= 18;
  for (const range of ranges) {
    page.drawText(
      pdfText(formatSerialRange(event.project.code, event.vintageYear, range.start, range.end)),
      { x: 48, y: cursor, size: 12, font: serifBold, color: forest },
    );
    cursor -= 18;
  }

  page.drawRectangle({ x: 0, y: 0, width, height: 48, color: forest });
  page.drawText("Bridging Eden  ·  High Impact Carbon Credits  ·  Append-only ledger", {
    x: 48,
    y: 20,
    size: 9,
    font: sans,
    color: cream,
  });

  return pdf.save();
}
