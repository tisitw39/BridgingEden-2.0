// Windows-1252 characters that sit outside Latin-1. Standard PDF fonts can encode these.
const WIN1252 = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017d,
  0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e,
  0x0178,
]);

const REPLACEMENTS: Record<string, string> = {
  "\u2212": "-",
  "\u2011": "-",
  "\u202f": " ",
  "\u2009": " ",
  "\u200a": " ",
  "\u200b": "",
  "\ufeff": "",
};

function encodable(codePoint: number): boolean {
  if (codePoint === 0x0a) return true;
  if (codePoint >= 0x20 && codePoint <= 0x7e) return true;
  if (codePoint >= 0xa0 && codePoint <= 0xff) return true;
  return WIN1252.has(codePoint);
}

export function pdfText(value: string): string {
  let out = "";
  for (const char of value.normalize("NFC")) {
    const mapped = REPLACEMENTS[char] ?? char;
    for (const piece of mapped) {
      const codePoint = piece.codePointAt(0) ?? 0;
      out += encodable(codePoint) ? piece : "?";
    }
  }
  return out;
}
