import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const prismaCli = resolve("node_modules/prisma/build/index.js");
const result = spawnSync(process.execPath, [prismaCli, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, ALLOW_DEMO_SEED: "1" },
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
