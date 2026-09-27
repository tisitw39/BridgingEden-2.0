import fs from "node:fs";
import path from "node:path";
import QRCode from "qrcode";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { formatDate, formatTonnes } from "@/lib/format";
import { pdfText } from "@/lib/pdf-text";
import { loadRetirementVerification, verificationUrl } from "@/lib/verify";

const forest = rgb(28 / 255, 95 / 255, 33 / 255);
const cream = rgb(252 / 255, 250 / 255, 243 / 255);
const ink = rgb(30 / 255, 41 / 255, 35 / 255);
const muted = rgb(87 / 255, 126 / 255, 73 / 255);

function wrap(text: string, widthOf: (line: string) => number, maxWidth: number): string[] {
  const lines: string[] = [];
  const paragraphs = pdfText(text).split("\n");
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let current = "";
    const pushPiece = (piece: string) => {
      const next = current ? `${current} ${piece}` : piece;
      if (current && widthOf(next) > maxWidth) {
        lines.push(current);
        current = piece;
      } else {
        current = next;
      }
    };
    for (const word of words) {
      if (widthOf(word) <= maxWidth) {
        pushPiece(word);
        continue;
      }
      let chunk = "";
      for (const char of word) {
        if (chunk && widthOf(chunk + char) > maxWidth) {
          pushPiece(chunk);
          chunk = char;
        } else {
          chunk += char;
        }
      }
      if (chunk) pushPiece(chunk);
    }
    if (current) lines.push(current);
  }
  return lines.length > 0 ? lines : [""];
}

type Sheet = {
  pdf: PDFDocument;
  page: PDFPage;
  cursor: number;
  width: number;
  height: number;
  sans: PDFFont;
  sansBold: PDFFont;
  serif: PDFFont;
  serifBold: PDFFont;
};

function paintChrome(sheet: Sheet, continued: boolean) {
  const { page, width, height } = sheet;
  page.drawRectangle({ x: 0, y: 0, width, height, color: cream });
  page.drawRectangle({ x: 0, y: height - (continued ? 56 : 108), width, height: continued ? 56 : 108, color: forest });
  page.drawRectangle({ x: 0, y: 0, width, height: 48, color: forest });
  page.drawText("Bridging Eden  ·  High Impact Carbon Credits  ·  Append-only ledger", {
    x: 48,
    y: 20,
    size: 9,
    font: sheet.sans,
    color: cream,
  });
}

function addPage(sheet: Sheet, continued: boolean) {
  sheet.page = sheet.pdf.addPage([595.28, 841.89]);
  const size = sheet.page.getSize();
  sheet.width = size.width;
  sheet.height = size.height;
  paintChrome(sheet, continued);
  sheet.cursor = sheet.height - (continued ? 84 : 150);
}

function ensure(sheet: Sheet, needed: number) {
  if (sheet.cursor - needed < 72) addPage(sheet, true);
}

function drawLines(sheet: Sheet, lines: string[], x: number, size: number, font: PDFFont, color: ReturnType<typeof rgb>, gap: number) {
  for (const line of lines) {
    ensure(sheet, gap + 4);
    sheet.page.drawText(line, { x, y: sheet.cursor, size, font, color });
    sheet.cursor -= gap;
  }
}

export async function buildRetirementCertificate(eventId: string): Promise<Uint8Array | null> {
  const record = await loadRetirementVerification(eventId);
  if (!record) return null;
  const event = await prismaActor(eventId);
  if (!event) return null;

  const pdf = await PDFDocument.create();
  pdf.setTitle(`Bridging Eden retirement ${record.eventId}`);
  pdf.setAuthor("Bridging Eden");
  const sans = await pdf.embedFont(StandardFonts.Helvetica);
  const sansBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const serif = await pdf.embedFont(StandardFonts.TimesRoman);
  const serifBold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const sheet: Sheet = {
    pdf,
    page: pdf.addPage([595.28, 841.89]),
    cursor: 0,
    width: 0,
    height: 0,
    sans,
    sansBold,
    serif,
    serifBold,
  };
  const size = sheet.page.getSize();
  sheet.width = size.width;
  sheet.height = size.height;
  paintChrome(sheet, false);

  const logoPath = path.join(process.cwd(), "public/brand/bridging-eden-logo.png");
  if (fs.existsSync(logoPath)) {
    const logo = await pdf.embedPng(fs.readFileSync(logoPath));
    sheet.page.drawImage(logo, { x: 48, y: sheet.height - 84, width: 52, height: 52 });
  }
  sheet.page.drawText("Bridging Eden", { x: 112, y: sheet.height - 62, size: 22, font: serif, color: cream });
  sheet.page.drawText("RETIREMENT CERTIFICATE", {
    x: 112,
    y: sheet.height - 82,
    size: 10,
    font: sansBold,
    color: cream,
  });

  sheet.cursor = sheet.height - 150;
  drawLines(
    sheet,
    wrap(
      "This certificate records that the carbon credits below have been retired on the Bridging Eden ledger. Retired credits are removed from the holder's balance and cannot be transferred or retired again. They are not yield-bearing.",
      (line) => sans.widthOfTextAtSize(line, 11),
      sheet.width - 96,
    ),
    48,
    11,
    sans,
    ink,
    16,
  );

  const fields: [string, string][] = [
    ["Certificate", record.eventId],
    ["Date", formatDate(record.date)],
    ["Status", record.status],
    ["Beneficiary", record.beneficiary || "—"],
    ["Reason", event.reason || "—"],
    ["Project", `${record.projectName} (${record.projectCode})`],
    ["Location", event.location],
    ["Vintage", String(record.vintageYear)],
    ["Tonnes CO2e", formatTonnes(record.quantity)],
    ["Standard", event.standard],
    ["Recorded by", event.actorName],
  ];

  sheet.cursor -= 12;
  for (const [label, value] of fields) {
    const lines = wrap(value, (line) => sans.widthOfTextAtSize(line, 12), sheet.width - 220);
    ensure(sheet, Math.max(22, lines.length * 15 + 8));
    sheet.page.drawText(label.toUpperCase(), { x: 48, y: sheet.cursor, size: 8, font: sansBold, color: muted });
    lines.forEach((line, index) => {
      sheet.page.drawText(line, { x: 170, y: sheet.cursor - index * 15, size: 12, font: sans, color: ink });
    });
    sheet.cursor -= Math.max(22, lines.length * 15 + 8);
  }

  sheet.cursor -= 8;
  ensure(sheet, 36);
  sheet.page.drawText("SERIAL RANGE", { x: 48, y: sheet.cursor, size: 8, font: sansBold, color: muted });
  sheet.cursor -= 18;
  for (const serial of record.serials) {
    drawLines(sheet, wrap(serial, (line) => serifBold.widthOfTextAtSize(line, 12), sheet.width - 96), 48, 12, serifBold, forest, 18);
  }

  const url = verificationUrl(record.eventId);
  const qr = await QRCode.toBuffer(url, {
    type: "png",
    width: 180,
    margin: 1,
    color: { dark: "#1C5F21", light: "#FCFAF3" },
  });
  const image = await pdf.embedPng(qr);
  ensure(sheet, 150);
  sheet.cursor -= 8;
  sheet.page.drawText("VERIFY", { x: 48, y: sheet.cursor, size: 8, font: sansBold, color: muted });
  sheet.cursor -= 8;
  sheet.page.drawImage(image, { x: 48, y: sheet.cursor - 96, width: 96, height: 96 });
  const urlLines = wrap(url, (line) => sans.widthOfTextAtSize(line, 10), sheet.width - 180);
  urlLines.forEach((line, index) => {
    sheet.page.drawText(line, { x: 160, y: sheet.cursor - 24 - index * 14, size: 10, font: sans, color: ink });
  });
  sheet.page.drawText("Anyone can confirm this retirement at the address above.", {
    x: 160,
    y: sheet.cursor - 24 - urlLines.length * 14 - 8,
    size: 9,
    font: sans,
    color: muted,
  });

  return pdf.save();
}

async function prismaActor(eventId: string) {
  const { prisma } = await import("@/lib/db");
  const event = await prisma.ledgerEvent.findUnique({
    where: { id: eventId },
    include: { project: true, actor: { select: { name: true } } },
  });
  if (!event || event.type !== "RETIREMENT") return null;
  return {
    reason: event.reason ?? "",
    location: event.project.location,
    standard: event.project.standardReference,
    actorName: event.actor.name,
  };
}
