import type { SerialRange } from "@/lib/ledger/ranges";

export function formatTonnes(quantity: number): string {
  return new Intl.NumberFormat("en-IE").format(quantity);
}

export function formatWhen(date: Date): string {
  return new Intl.DateTimeFormat("en-IE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Dublin",
  }).format(date);
}

export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-IE", {
    dateStyle: "long",
    timeZone: "Europe/Dublin",
  }).format(date);
}

export function formatSerial(code: string, vintage: number, serial: number): string {
  return `BE-${code}-${vintage}-${String(serial).padStart(6, "0")}`;
}

export function formatSerialRange(
  code: string,
  vintage: number,
  start: number,
  end: number,
): string {
  if (start === end) return formatSerial(code, vintage, start);
  return `${formatSerial(code, vintage, start)} – ${formatSerial(code, vintage, end)}`;
}

export function formatRanges(code: string, vintage: number, ranges: SerialRange[]): string {
  return ranges.map((range) => formatSerialRange(code, vintage, range.start, range.end)).join(", ");
}
