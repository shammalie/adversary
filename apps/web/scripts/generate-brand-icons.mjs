#!/usr/bin/env node
/**
 * Rasterize Adversary brand icons into public/ favicon + PWA assets.
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import toIco from "to-ico";

const __dir = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dir, "../public");

const iconSvg = await readFile(join(publicDir, "icon-512.svg"));

async function png(size, name) {
  const buf = await sharp(iconSvg).resize(size, size).png().toBuffer();
  await writeFile(join(publicDir, name), buf);
  console.log("wrote", name, `${size}x${size}`);
  return buf;
}

const png16 = await png(16, "favicon-16.png");
const png32 = await png(32, "favicon-32.png");
await png(180, "apple-touch-icon.png");
await png(192, "icon-192.png");
await png(512, "icon-512.png");

const ico = await toIco([png16, png32]);
await writeFile(join(publicDir, "favicon.ico"), ico);
console.log("wrote favicon.ico");
