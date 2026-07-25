#!/usr/bin/env node
/**
 * Generate README brand images (hero + feature cards) with Apex Cut identity.
 * Renders HTML artboards via Playwright, then writes PNGs to docs/images/.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const __dir = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dir, "../../../docs/images");
await mkdir(outDir, { recursive: true });

const MARK = `<path fill="currentColor" d="M16 4 L28 24 H21.2 L16 14.8 L10.8 24 H4 Z"/>`;

function mark(size, color = "#22d3ee") {
  return `<svg width="${size}" height="${size}" viewBox="0 0 32 32" fill="none" style="color:${color}">${MARK}</svg>`;
}

function markBadge(size = 56) {
  const inner = Math.round(size * 0.55);
  return `<div style="width:${size}px;height:${size}px;border-radius:${Math.round(size * 0.22)}px;background:#14808f;display:grid;place-items:center;color:#ecfeff;box-shadow:0 0 0 1px rgba(34,211,238,.25),0 12px 40px rgba(20,128,143,.35)">${mark(inner, "#ecfeff")}</div>`;
}

const shared = `
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;650;700&family=IBM+Plex+Mono:wght@400;500&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: "IBM Plex Sans", system-ui, sans-serif;
    background: #070a0d;
    color: #e8eef2;
    -webkit-font-smoothing: antialiased;
  }
  .mono { font-family: "IBM Plex Mono", ui-monospace, monospace; }
  .grid-bg {
    background-image:
      linear-gradient(rgba(34,211,238,0.045) 1px, transparent 1px),
      linear-gradient(90deg, rgba(34,211,238,0.045) 1px, transparent 1px);
    background-size: 40px 40px;
  }
`;

const heroHtml = `<!DOCTYPE html><html><head><style>
${shared}
.frame {
  width: 1536px; height: 1024px; position: relative; overflow: hidden;
  background:
    radial-gradient(ellipse 70% 60% at 78% 45%, rgba(34,211,238,0.12), transparent 55%),
    radial-gradient(ellipse 50% 40% at 18% 70%, rgba(20,128,143,0.1), transparent 50%),
    linear-gradient(145deg, #0a0e13 0%, #0c1014 40%, #0f1620 100%);
}
.frame::before {
  content: ""; position: absolute; inset: 0; opacity: 1;
  background-image:
    linear-gradient(rgba(34,211,238,0.04) 1px, transparent 1px),
    linear-gradient(90deg, rgba(34,211,238,0.04) 1px, transparent 1px);
  background-size: 48px 48px;
  mask-image: radial-gradient(ellipse 80% 70% at 50% 50%, #000 20%, transparent 75%);
}
.content {
  position: relative; z-index: 2; height: 100%;
  display: grid; grid-template-columns: 1.05fr 0.95fr; padding: 72px 80px;
  align-items: center; gap: 40px;
}
.eyebrow {
  display: inline-flex; align-items: center; gap: 10px;
  font-size: 13px; letter-spacing: 0.22em; text-transform: uppercase;
  color: #22d3ee; font-weight: 600; margin-bottom: 28px;
}
h1 {
  font-size: 92px; font-weight: 700; letter-spacing: 0.14em;
  line-height: 1; margin-bottom: 22px;
}
.sub {
  font-size: 22px; color: #8b9aab; max-width: 22ch; line-height: 1.45;
  font-weight: 400;
}
.sub .accent { color: #67e8f9; }
.viz {
  position: relative; height: 720px; border-radius: 20px;
  border: 1px solid rgba(34,211,238,0.14);
  background:
    radial-gradient(circle at 50% 48%, rgba(34,211,238,0.08), transparent 42%),
    linear-gradient(180deg, rgba(18,24,32,0.9), rgba(8,11,14,0.95));
  overflow: hidden;
  box-shadow: 0 24px 80px rgba(0,0,0,0.45);
}
.viz .ring {
  position: absolute; left: 50%; top: 48%; transform: translate(-50%,-50%);
  border: 1px solid rgba(34,211,238,0.18); border-radius: 50%;
}
.viz .cross {
  position: absolute; left: 50%; top: 48%; width: 1px; height: 100%;
  background: linear-gradient(transparent, rgba(34,211,238,0.2), transparent);
  transform: translateX(-50%);
}
.viz .cross.h {
  width: 100%; height: 1px; left: 0; top: 48%; transform: none;
  background: linear-gradient(90deg, transparent, rgba(34,211,238,0.2), transparent);
}
.track {
  position: absolute; fill: none; stroke-width: 2; stroke-dasharray: 6 8;
  stroke-linecap: round; opacity: 0.9;
}
.blip {
  position: absolute; width: 44px; height: 44px; border-radius: 50%;
  display: grid; place-items: center;
  border: 1.5px solid currentColor; background: rgba(12,16,20,0.85);
  box-shadow: 0 0 24px currentColor;
}
.hud {
  position: absolute; font-size: 11px; letter-spacing: 0.16em;
  text-transform: uppercase; color: rgba(139,154,171,0.9);
}
.apex-float {
  position: absolute; right: 48px; top: 44px; color: #22d3ee;
  filter: drop-shadow(0 0 18px rgba(34,211,238,0.45));
}
</style></head><body>
<div class="frame">
  <div class="content">
    <div>
      <div class="eyebrow">${markBadge(36)} Adversary</div>
      <h1>ADVERSARY</h1>
      <p class="sub mono">Multi-target tracking simulation for <span class="accent">operations training</span></p>
    </div>
    <div class="viz">
      <div class="ring" style="width:160px;height:160px"></div>
      <div class="ring" style="width:300px;height:300px"></div>
      <div class="ring" style="width:460px;height:460px;border-style:dashed;opacity:.7"></div>
      <div class="cross"></div><div class="cross h"></div>
      <svg class="apex-float" width="48" height="48" viewBox="0 0 32 32">${MARK}</svg>
      <svg width="100%" height="100%" style="position:absolute;inset:0">
        <path class="track" stroke="#22d3ee" d="M120 520 C 200 400, 280 340, 380 300"/>
        <path class="track" stroke="#f59e0b" d="M160 200 C 260 240, 340 320, 420 380"/>
        <path class="track" stroke="#f87171" d="M500 180 C 480 280, 430 360, 360 430"/>
      </svg>
      <div class="blip" style="left:108px;top:498px;color:#22d3ee">${mark(20)}</div>
      <div class="blip" style="left:148px;top:178px;color:#f59e0b;border-radius:10px">${mark(18, "#f59e0b")}</div>
      <div class="blip" style="left:478px;top:158px;color:#f87171;border-radius:4px">${mark(18, "#f87171")}</div>
      <div class="hud" style="left:28px;bottom:28px">3 contacts · live</div>
      <div class="hud" style="right:28px;bottom:28px">OPS · track</div>
    </div>
  </div>
</div>
</body></html>`;

const opsHtml = `<!DOCTYPE html><html><head><style>
${shared}
.frame {
  width: 1024px; height: 1024px; position: relative; overflow: hidden;
  background:
    radial-gradient(circle at 62% 38%, rgba(34,211,238,0.14), transparent 40%),
    linear-gradient(160deg, #0a0e13, #0c1014 50%, #101820);
}
.frame::before {
  content:""; position:absolute; inset:0;
  background-image:
    linear-gradient(rgba(34,211,238,0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(34,211,238,0.05) 1px, transparent 1px);
  background-size: 36px 36px;
  opacity: 0.7;
}
.pad { position:relative; z-index:2; padding:56px; height:100%; display:flex; flex-direction:column; }
.top { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:36px; }
.label { font-size:12px; letter-spacing:0.2em; text-transform:uppercase; color:#22d3ee; font-weight:600; }
.title { font-size:36px; font-weight:650; letter-spacing:-0.02em; margin-top:10px; }
.panel {
  flex:1; border-radius:18px; border:1px solid rgba(34,211,238,0.16);
  background: rgba(8,11,14,0.72); position:relative; overflow:hidden;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.03);
}
.map-land {
  position:absolute; inset:12% 8% 18% 12%;
  background: rgba(30,48,64,0.55);
  border-radius: 40% 60% 45% 55% / 50% 40% 60% 50%;
  box-shadow: inset 0 0 60px rgba(0,0,0,0.35);
}
.ring {
  position:absolute; left:52%; top:42%; transform:translate(-50%,-50%);
  border:1px dashed rgba(34,211,238,0.28); border-radius:50%;
}
.trail { position:absolute; stroke-dasharray:5 7; fill:none; stroke-width:2; }
.chip {
  position:absolute; display:flex; align-items:center; gap:8px;
  padding:8px 12px; border-radius:10px; border:1px solid currentColor;
  background:rgba(12,16,20,0.9); font-size:12px; font-weight:500;
  box-shadow: 0 8px 28px rgba(0,0,0,0.35);
}
.footer {
  display:flex; justify-content:space-between; align-items:center;
  margin-top:28px; color:#8b9aab; font-size:13px;
}
</style></head><body>
<div class="frame">
  <div class="pad">
    <div class="top">
      <div>
        <div class="label mono">Operations console</div>
        <div class="title">Live tracks. Clear picture.</div>
      </div>
      ${markBadge(52)}
    </div>
    <div class="panel">
      <div class="map-land"></div>
      <div class="ring" style="width:140px;height:140px"></div>
      <div class="ring" style="width:260px;height:260px"></div>
      <div class="ring" style="width:400px;height:400px"></div>
      <svg width="100%" height="100%" style="position:absolute;inset:0">
        <path class="trail" stroke="#22d3ee" d="M180 620 C 260 500, 340 400, 520 320"/>
        <path class="trail" stroke="#f59e0b" d="M220 240 C 320 280, 420 360, 560 480"/>
        <path class="trail" stroke="#f87171" d="M700 220 C 640 320, 560 420, 480 520"/>
      </svg>
      <div class="chip" style="left:150px;top:590px;color:#22d3ee">${mark(16)} VIPER-01</div>
      <div class="chip" style="left:190px;top:210px;color:#f59e0b">${mark(16, "#f59e0b")} HAWK-07</div>
      <div class="chip" style="left:660px;top:190px;color:#f87171">${mark(16, "#f87171")} WOLF-3</div>
      <div class="mono" style="position:absolute;left:24px;bottom:20px;font-size:11px;letter-spacing:.14em;color:#6b7c8f;text-transform:uppercase">Roster · map · ingest</div>
    </div>
    <div class="footer mono">
      <span>2D / globe · track camera</span>
      <span style="color:#22d3ee">priority intel</span>
    </div>
  </div>
</div>
</body></html>`;

const builderHtml = `<!DOCTYPE html><html><head><style>
${shared}
.frame {
  width: 1024px; height: 1024px; position: relative; overflow: hidden;
  background:
    radial-gradient(circle at 30% 30%, rgba(34,211,238,0.1), transparent 45%),
    linear-gradient(200deg, #0a0e13, #0c1014 55%, #0e1520);
}
.pad { position:relative; z-index:2; padding:56px; height:100%; display:flex; flex-direction:column; }
.top { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:32px; }
.label { font-size:12px; letter-spacing:0.2em; text-transform:uppercase; color:#22d3ee; font-weight:600; }
.title { font-size:36px; font-weight:650; letter-spacing:-0.02em; margin-top:10px; }
.cols { flex:1; display:grid; grid-template-columns: 0.9fr 1.1fr; gap:18px; min-height:0; }
.card {
  border-radius:16px; border:1px solid rgba(34,211,238,0.14);
  background: rgba(10,14,18,0.85); padding:22px; display:flex; flex-direction:column; gap:14px;
}
.card h3 { font-size:13px; letter-spacing:0.16em; text-transform:uppercase; color:#8b9aab; font-weight:600; }
.row {
  display:flex; align-items:center; gap:12px; padding:12px 14px; border-radius:10px;
  background: rgba(34,211,238,0.05); border:1px solid rgba(34,211,238,0.1);
}
.dot { width:10px; height:10px; border-radius:50%; }
.timeline { position:relative; flex:1; padding-left:18px; }
.timeline::before {
  content:""; position:absolute; left:4px; top:8px; bottom:8px; width:2px;
  background: linear-gradient(#22d3ee, rgba(34,211,238,0.15));
}
.event {
  position:relative; margin-bottom:16px; padding:14px 16px; border-radius:10px;
  background: rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.06);
}
.event::before {
  content:""; position:absolute; left:-17px; top:18px; width:10px; height:10px;
  border-radius:50%; background:#22d3ee; box-shadow:0 0 12px #22d3ee;
}
.route {
  flex:1; border-radius:12px; border:1px dashed rgba(34,211,238,0.25);
  background:
    radial-gradient(circle at 70% 40%, rgba(34,211,238,0.08), transparent 50%),
    rgba(0,0,0,0.2);
  position:relative; min-height:220px;
}
.footer { margin-top:24px; color:#8b9aab; font-size:13px; display:flex; justify-content:space-between; }
</style></head><body>
<div class="frame grid-bg">
  <div class="pad">
    <div class="top">
      <div>
        <div class="label mono">Scenario builder</div>
        <div class="title">Author. Schedule. Export.</div>
      </div>
      ${markBadge(52)}
    </div>
    <div class="cols">
      <div class="card">
        <h3 class="mono">Targets</h3>
        <div class="row"><span class="dot" style="background:#22d3ee"></span><span style="flex:1">VIPER-01</span><span class="mono" style="font-size:11px;color:#6b7c8f">aircraft</span></div>
        <div class="row"><span class="dot" style="background:#f59e0b"></span><span style="flex:1">HAWK-07</span><span class="mono" style="font-size:11px;color:#6b7c8f">boat</span></div>
        <div class="row"><span class="dot" style="background:#f87171"></span><span style="flex:1">WOLF-3</span><span class="mono" style="font-size:11px;color:#6b7c8f">truck</span></div>
        <div class="route">
          <svg width="100%" height="100%" viewBox="0 0 280 200" preserveAspectRatio="xMidYMid meet">
            <path d="M40 150 C 90 120, 130 80, 200 50" fill="none" stroke="#22d3ee" stroke-width="2" stroke-dasharray="5 6"/>
            <circle cx="40" cy="150" r="5" fill="#22d3ee"/>
            <g transform="translate(188 38)" fill="#22d3ee">
              <path d="M16 4 L28 24 H21.2 L16 14.8 L10.8 24 H4 Z" transform="scale(0.75)"/>
            </g>
          </svg>
        </div>
      </div>
      <div class="card">
        <h3 class="mono">Timeline</h3>
        <div class="timeline">
          <div class="event"><div class="mono" style="font-size:11px;color:#22d3ee;margin-bottom:4px">T+00:30</div>Position update · sector entry</div>
          <div class="event"><div class="mono" style="font-size:11px;color:#f59e0b;margin-bottom:4px">T+02:10</div>Message · proximity watch</div>
          <div class="event"><div class="mono" style="font-size:11px;color:#f87171;margin-bottom:4px">T+04:45</div>Critical · priority term match</div>
        </div>
      </div>
    </div>
    <div class="footer mono">
      <span>JSON schema v2</span>
      <span style="color:#22d3ee">start simulation →</span>
    </div>
  </div>
</div>
</body></html>`;

const offlineHtml = `<!DOCTYPE html><html><head><style>
${shared}
.frame {
  width: 1024px; height: 1024px; position: relative; overflow: hidden;
  background:
    radial-gradient(circle at 70% 60%, rgba(34,211,238,0.12), transparent 42%),
    linear-gradient(180deg, #0a0e13, #0c1014 60%, #0d141c);
}
.pad { position:relative; z-index:2; padding:56px; height:100%; display:flex; flex-direction:column; }
.top { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:32px; }
.label { font-size:12px; letter-spacing:0.2em; text-transform:uppercase; color:#22d3ee; font-weight:600; }
.title { font-size:36px; font-weight:650; letter-spacing:-0.02em; margin-top:10px; }
.stack { flex:1; display:grid; place-items:center; position:relative; }
.pkg {
  width: 520px; height: 340px; border-radius: 20px;
  border: 1px solid rgba(34,211,238,0.2);
  background: linear-gradient(145deg, rgba(20,128,143,0.18), rgba(8,11,14,0.95));
  box-shadow: 0 30px 80px rgba(0,0,0,0.45), 0 0 0 1px rgba(34,211,238,0.08);
  position: relative; padding: 36px; display:flex; flex-direction:column; gap:18px;
  transform: perspective(900px) rotateX(8deg) rotateY(-12deg);
}
.pkg::after {
  content:""; position:absolute; inset:auto -40px -50px 40px; height:40px;
  background: rgba(0,0,0,0.35); filter: blur(18px); border-radius:50%;
}
.pkg-title { display:flex; align-items:center; gap:14px; }
.pkg-title strong { font-size:22px; letter-spacing:0.04em; }
.files { display:flex; flex-direction:column; gap:10px; margin-top:8px; }
.file {
  display:flex; justify-content:space-between; align-items:center;
  padding:12px 14px; border-radius:10px; background:rgba(0,0,0,0.28);
  border:1px solid rgba(255,255,255,0.06); font-size:14px;
}
.tile {
  position:absolute; width:180px; height:180px; border-radius:16px;
  border:1px solid rgba(34,211,238,0.18); background:rgba(12,16,20,0.9);
  display:grid; grid-template-columns: repeat(4,1fr); gap:4px; padding:10px;
  box-shadow: 0 16px 40px rgba(0,0,0,0.4);
}
.tile span { background: rgba(34,211,238,0.12); border-radius:3px; }
.tile span:nth-child(3n) { background: rgba(34,211,238,0.28); }
.footer { margin-top:28px; color:#8b9aab; font-size:13px; display:flex; justify-content:space-between; }
</style></head><body>
<div class="frame grid-bg">
  <div class="pad">
    <div class="top">
      <div>
        <div class="label mono">Offline regions</div>
        <div class="title">Maps when the net drops.</div>
      </div>
      ${markBadge(52)}
    </div>
    <div class="stack">
      <div class="tile" style="left:70px;top:80px">
        ${Array.from({ length: 16 }, () => "<span></span>").join("")}
      </div>
      <div class="pkg">
        <div class="pkg-title">${mark(28)} <strong>NORTH-SEA-OPS</strong></div>
        <div class="mono" style="font-size:12px;color:#8b9aab;letter-spacing:.12em">PMTiles · style · manifest v2</div>
        <div class="files">
          <div class="file mono"><span>manifest.json</span><span style="color:#22d3ee">ok</span></div>
          <div class="file mono"><span>style.json</span><span style="color:#22d3ee">ok</span></div>
          <div class="file mono"><span>region.pmtiles</span><span style="color:#22d3ee">12.4 GB</span></div>
        </div>
      </div>
      <div class="tile" style="right:60px;bottom:40px;width:140px;height:140px;opacity:.85">
        ${Array.from({ length: 16 }, () => "<span></span>").join("")}
      </div>
    </div>
    <div class="footer mono">
      <span>import package · activate region</span>
      <span style="color:#22d3ee">air-gap ready</span>
    </div>
  </div>
</div>
</body></html>`;

const browser = await chromium.launch();
const jobs = [
  { name: "hero-banner.png", html: heroHtml, w: 1536, h: 1024 },
  { name: "feature-operations.png", html: opsHtml, w: 1024, h: 1024 },
  { name: "feature-builder.png", html: builderHtml, w: 1024, h: 1024 },
  { name: "feature-offline.png", html: offlineHtml, w: 1024, h: 1024 },
];

for (const job of jobs) {
  const page = await browser.newPage({
    viewport: { width: job.w, height: job.h },
    deviceScaleFactor: 1,
  });
  await page.setContent(job.html, { waitUntil: "networkidle" });
  // Allow webfonts to settle
  await page.waitForTimeout(600);
  const buf = await page.locator(".frame").screenshot({ type: "png" });
  await writeFile(join(outDir, job.name), buf);
  console.log("wrote", job.name, `${(buf.length / 1024).toFixed(0)}KB`);
  await page.close();
}

await browser.close();
console.log("done →", outDir);
