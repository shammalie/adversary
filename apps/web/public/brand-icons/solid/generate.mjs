#!/usr/bin/env node
/**
 * Generates solid (dark plate + cyan mark) favicon-ready SVGs from the
 * currentColor source marks in ../
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dir, "..");
const outDir = join(__dir);

const BG = "#0c1014";
const FG = "#22d3ee";
const RADIUS = 6;

const files = (await readdir(srcDir)).filter((f) => f.endsWith(".svg"));

for (const file of files) {
  const raw = await readFile(join(srcDir, file), "utf8");
  const inner = raw
    .replace(/<\/?svg[^>]*>/g, "")
    .replace(/<title>[\s\S]*?<\/title>/g, "")
    .replaceAll("currentColor", FG)
    .trim();

  const solid = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none" aria-hidden="true">
  <rect width="32" height="32" rx="${RADIUS}" fill="${BG}"/>
  ${inner}
</svg>
`;
  await writeFile(join(outDir, file), solid);
  console.log("wrote", file);
}
