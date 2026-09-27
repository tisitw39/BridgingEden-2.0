import { readFileSync } from "node:fs";
import path from "node:path";

// Offline copy of the xato top-100000 list from SecLists (MIT). No network call.
const LIST_PATH = path.join(process.cwd(), "src/lib/common-passwords.txt");

let common: Set<string> | undefined;

export function commonPasswords(): Set<string> {
  if (!common) {
    const words = readFileSync(LIST_PATH, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim().toLowerCase())
      .filter(Boolean);
    common = new Set(words);
  }
  return common;
}

export function weakPasswordMessage(password: string): string | null {
  if (commonPasswords().has(password.toLowerCase())) {
    return "That password is too common. Choose one that is not on a known breach list.";
  }
  return null;
}
