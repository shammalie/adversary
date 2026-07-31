#!/usr/bin/env node
/**
 * Legacy Node miner — kept as behavioural reference.
 * Prefer: go run ./apps/api/cmd/geoseed  (also: pnpm geo:seeds)
 *
 * Usage (legacy): node scripts/build-geo-seeds.mjs
 *
 * Reads via Node 22 node:sqlite. Tiles use TMS y-ordering (flip: tmsY = 2^z - 1 - y).
 * Vector deps resolve from apps/web (pbf + @mapbox/vector-tile).
 */
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { gunzipSync, gzipSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const MBTILES = join(ROOT, "data/tiles/openmaptiles.mbtiles");
const OUT_PATH = join(ROOT, "apps/web/public/geo-seeds.json");
const FIXTURE_DIR = join(ROOT, "apps/web/src/lib/geo/fixtures/tiles");

const require = createRequire(join(ROOT, "apps/web/package.json"));
const { PbfReader } = require("pbf");
const { VectorTile } = require("@mapbox/vector-tile");

const EXTENT = 4096;
const MIN_RUNWAY_M = 1500;
const DRIVABLE = new Set([
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
  "minor",
  "service",
]);

/** Hand-picked region bboxes; `supports` is derived from tile geometry below. */
const REGION_DEFS = [
  { id: "london", name: "Greater London", bbox: [-0.55, 51.28, 0.35, 51.72] },
  { id: "english-channel", name: "English Channel", bbox: [-2.5, 49.5, 2.0, 51.5] },
  { id: "north-sea", name: "North Sea", bbox: [0.5, 53.0, 8.0, 57.0] },
  { id: "benelux", name: "Benelux", bbox: [2.5, 49.4, 7.6, 53.7] },
  { id: "central-europe", name: "Central Europe", bbox: [5.0, 47.0, 17.0, 54.0] },
  { id: "alps", name: "Alpine Corridor", bbox: [7.0, 45.8, 13.5, 47.8] },
  { id: "us-midwest", name: "US Midwest", bbox: [-93.5, 39.0, -84.5, 43.5] },
  { id: "rhine-corridor", name: "Rhine Corridor", bbox: [5.5, 48.5, 9.2, 52.2] },
  { id: "mediterranean", name: "Mediterranean", bbox: [5.0, 33.0, 28.0, 42.0] },
  { id: "new-york-harbor", name: "New York Harbor", bbox: [-74.35, 40.4, -73.7, 40.95] },
  {
    id: "us-eastern-seaboard",
    name: "US Eastern Seaboard",
    bbox: [-78.0, 35.0, -70.0, 42.5],
  },
  { id: "california-coast", name: "California Coast", bbox: [-123.0, 32.5, -117.0, 38.5] },
  { id: "singapore-strait", name: "Singapore Strait", bbox: [103.5, 1.0, 104.5, 1.55] },
  { id: "tokyo-bay", name: "Tokyo Bay", bbox: [139.5, 35.2, 140.15, 35.75] },
  { id: "persian-gulf", name: "Persian Gulf", bbox: [48.0, 24.0, 56.0, 30.0] },
  { id: "south-china-sea", name: "South China Sea", bbox: [108.0, 10.0, 120.0, 18.0] },
  { id: "gulf-of-aden", name: "Gulf of Aden", bbox: [42.0, 10.0, 52.0, 15.0] },
];

function lngLatToTile(lng, lat, z) {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  );
  return { z, x: clampTile(x, n), y: clampTile(y, n) };
}

function clampTile(v, n) {
  return Math.max(0, Math.min(n - 1, v));
}

function tileLocalToLngLat(z, x, y, px, py, extent = EXTENT) {
  const n = 2 ** z;
  const lng = ((x + px / extent) / n) * 360 - 180;
  const lat =
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + py / extent)) / n))) * 180) / Math.PI;
  return [lng, lat];
}

function haversineM(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function bearingDeg(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;
  const φ1 = toRad(a[1]);
  const φ2 = toRad(b[1]);
  const Δλ = toRad(b[0] - a[0]);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function lineLengthM(coords) {
  let len = 0;
  for (let i = 1; i < coords.length; i++) len += haversineM(coords[i - 1], coords[i]);
  return len;
}

function pointInBbox(lng, lat, bbox) {
  return lng >= bbox[0] && lng <= bbox[2] && lat >= bbox[1] && lat <= bbox[3];
}

function expandBbox(bbox, padDeg) {
  return [bbox[0] - padDeg, bbox[1] - padDeg, bbox[2] + padDeg, bbox[3] + padDeg];
}

function tilesCoveringBbox(bbox, z) {
  const tl = lngLatToTile(bbox[0], bbox[3], z);
  const br = lngLatToTile(bbox[2], bbox[1], z);
  const out = [];
  for (let x = tl.x; x <= br.x; x++) {
    for (let y = tl.y; y <= br.y; y++) out.push({ z, x, y });
  }
  return out;
}

function openDb() {
  return new DatabaseSync(MBTILES, { readOnly: true });
}

function readTile(db, z, x, y) {
  const tmsY = 2 ** z - 1 - y;
  const row = db
    .prepare(
      "SELECT tile_data FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?",
    )
    .get(z, x, tmsY);
  if (!row) return null;
  let buf = Buffer.from(row.tile_data);
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf);
  return buf;
}

function decodeLayer(buf, z, x, y, layerName) {
  const tile = new VectorTile(new PbfReader(buf));
  const layer = tile.layers[layerName];
  if (!layer) return [];
  const extent = layer.extent || EXTENT;
  const features = [];
  for (let i = 0; i < layer.length; i++) {
    const f = layer.feature(i);
    const geometry = f.loadGeometry().map((ring) =>
      ring.map((p) => tileLocalToLngLat(z, x, y, p.x, p.y, extent)),
    );
    features.push({
      type: f.type,
      properties: { ...f.properties },
      geometry,
    });
  }
  return features;
}

function quantizeKey(lng, lat, decimals = 3) {
  return `${lng.toFixed(decimals)},${lat.toFixed(decimals)}`;
}

/**
 * Scan z8 for IATA aerodromes (OpenMapTiles only emits IATA airports at z8),
 * then z10 within the union of region bboxes for additional fields / non-IATA
 * candidates that pass the runway-length filter.
 */
function mineAerodromes(db) {
  console.log("Mining aerodromes (z8 global IATA + z10 regional)…");
  const byKey = new Map();

  function ingest(feat, lng, lat) {
    const p = feat.properties;
    const iata = typeof p.iata === "string" && p.iata.length > 0 ? p.iata : "";
    const icao = typeof p.icao === "string" && p.icao.length > 0 ? p.icao : "";
    const name = typeof p.name === "string" ? p.name : "";
    const cls = typeof p.class === "string" ? p.class : "";
    const eleFt =
      typeof p.ele_ft === "number"
        ? p.ele_ft
        : typeof p.ele === "number"
          ? Math.round(p.ele * 3.28084)
          : 0;
    const key = icao || iata || `${name}|${quantizeKey(lng, lat, 2)}`;
    const prev = byKey.get(key);
    if (prev) {
      // Prefer higher zoom / richer codes
      if (!prev.iata && iata) prev.iata = iata;
      if (!prev.icao && icao) prev.icao = icao;
      if (!prev.name && name) prev.name = name;
      if (!prev.class && cls) prev.class = cls;
      return;
    }
    byKey.set(key, {
      icao,
      iata,
      name,
      class: cls,
      eleFt,
      lng: Number(lng.toFixed(5)),
      lat: Number(lat.toFixed(5)),
      runways: [],
      maxRunwayM: 0,
    });
  }

  // z8 global
  const z8coords = db
    .prepare("SELECT tile_column AS x, tile_row AS tmsY FROM tiles WHERE zoom_level = 8")
    .all();
  const get = db.prepare(
    "SELECT tile_data FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?",
  );
  let t0 = Date.now();
  for (let i = 0; i < z8coords.length; i++) {
    const { x, tmsY } = z8coords[i];
    const y = 2 ** 8 - 1 - tmsY;
    const row = get.get(8, x, tmsY);
    if (!row) continue;
    let buf = Buffer.from(row.tile_data);
    if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf);
    for (const feat of decodeLayer(buf, 8, x, y, "aerodrome_label")) {
      if (feat.type !== 1 || !feat.geometry[0]?.[0]) continue;
      const [lng, lat] = feat.geometry[0][0];
      ingest(feat, lng, lat);
    }
    if ((i + 1) % 15000 === 0) {
      console.log(`  z8 ${i + 1}/${z8coords.length} unique=${byKey.size} ${Date.now() - t0}ms`);
    }
  }
  console.log(`  z8 done unique=${byKey.size} ${Date.now() - t0}ms`);

  // z10 across expanded region union (catches non-IATA aerodromes near demo areas)
  const unionPad = 2;
  const regionTiles = new Set();
  for (const r of REGION_DEFS) {
    for (const t of tilesCoveringBbox(expandBbox(r.bbox, unionPad), 10)) {
      regionTiles.add(`${t.x}/${t.y}`);
    }
  }
  t0 = Date.now();
  let scanned = 0;
  for (const key of regionTiles) {
    const [xs, ys] = key.split("/");
    const x = Number(xs);
    const y = Number(ys);
    const buf = readTile(db, 10, x, y);
    scanned++;
    if (!buf) continue;
    for (const feat of decodeLayer(buf, 10, x, y, "aerodrome_label")) {
      if (feat.type !== 1 || !feat.geometry[0]?.[0]) continue;
      const [lng, lat] = feat.geometry[0][0];
      ingest(feat, lng, lat);
    }
    if (scanned % 5000 === 0) {
      console.log(`  z10 ${scanned}/${regionTiles.size} unique=${byKey.size} ${Date.now() - t0}ms`);
    }
  }
  console.log(`  z10 regional done unique=${byKey.size} ${Date.now() - t0}ms`);

  // Attach runway headings / lengths at z13 near each candidate
  console.log("Attaching runway headings (z13)…");
  t0 = Date.now();
  let done = 0;
  for (const aero of byKey.values()) {
    const center = lngLatToTile(aero.lng, aero.lat, 13);
    const runwaysByRef = new Map();
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const x = center.x + dx;
        const y = center.y + dy;
        if (x < 0 || y < 0 || x >= 2 ** 13 || y >= 2 ** 13) continue;
        const buf = readTile(db, 13, x, y);
        if (!buf) continue;
        for (const feat of decodeLayer(buf, 13, x, y, "aeroway")) {
          if (feat.properties.class !== "runway" || feat.type !== 2) continue;
          for (const line of feat.geometry) {
            if (line.length < 2) continue;
            const mid = line[Math.floor(line.length / 2)];
            if (haversineM([aero.lng, aero.lat], mid) > 8000) continue;
            const len = lineLengthM(line);
            const hdg = Math.round(bearingDeg(line[0], line[line.length - 1]));
            const ref =
              typeof feat.properties.ref === "string" && feat.properties.ref.length > 0
                ? feat.properties.ref
                : `h${hdg}`;
            const prev = runwaysByRef.get(ref);
            if (!prev || len > prev.len) {
              runwaysByRef.set(ref, { ref, hdg, len });
            }
            if (len > aero.maxRunwayM) aero.maxRunwayM = len;
          }
        }
      }
    }
    // Expand combined refs like "09L/27R" into two headings 180° apart when possible
    const expanded = [];
    for (const { ref, hdg, len } of runwaysByRef.values()) {
      if (ref.includes("/")) {
        const parts = ref.split("/");
        expanded.push({ ref: parts[0], hdg, len });
        expanded.push({ ref: parts[1] || parts[0], hdg: (hdg + 180) % 360, len });
      } else {
        expanded.push({ ref, hdg, len });
      }
    }
    aero.runways = expanded
      .sort((a, b) => b.len - a.len)
      .slice(0, 8)
      .map((r) => [r.ref, r.hdg]);
    done++;
    if (done % 500 === 0) {
      console.log(`  runways ${done}/${byKey.size} ${Date.now() - t0}ms`);
    }
  }
  console.log(`  runways done ${Date.now() - t0}ms`);

  const kept = [...byKey.values()].filter(
    (a) => a.iata.length > 0 || a.maxRunwayM >= MIN_RUNWAY_M,
  );
  kept.sort((a, b) => a.icao.localeCompare(b.icao) || a.iata.localeCompare(b.iata));
  console.log(
    `Kept ${kept.length} aerodromes (IATA or runway≥${MIN_RUNWAY_M}m) of ${byKey.size} candidates`,
  );
  return kept;
}

function minePortsAndFerries(db, regions) {
  console.log("Mining ports / ferry terminals…");
  const ports = [];
  const seaLanePts = [];
  const seenPort = new Set();
  const seenLane = new Set();

  function addPort(lng, lat, name, kind) {
    const key = `${kind}|${quantizeKey(lng, lat, 3)}`;
    if (seenPort.has(key)) return;
    seenPort.add(key);
    ports.push({
      lng: Number(lng.toFixed(5)),
      lat: Number(lat.toFixed(5)),
      name: name || "",
      kind,
    });
  }

  function addLane(lng, lat) {
    const key = quantizeKey(lng, lat, 2);
    if (seenLane.has(key)) return;
    seenLane.add(key);
    seaLanePts.push({ lng: Number(lng.toFixed(4)), lat: Number(lat.toFixed(4)) });
  }

  const t0 = Date.now();
  for (const region of regions) {
    // z12 for POI harbour / ferry_terminal; ferry lines also present
    const tiles = tilesCoveringBbox(region.bbox, 12);
    // Cap very large maritime bboxes by striding
    const stride = tiles.length > 800 ? Math.ceil(Math.sqrt(tiles.length / 400)) : 1;
    for (let i = 0; i < tiles.length; i += stride) {
      const { x, y } = tiles[i];
      const buf = readTile(db, 12, x, y);
      if (!buf) continue;
      for (const feat of decodeLayer(buf, 12, x, y, "poi")) {
        const cls = String(feat.properties.class || "");
        const sub = String(feat.properties.subclass || "");
        const isHarbor = cls === "harbor" || sub === "harbour" || sub === "marina" || sub === "dock";
        const isFerry = cls === "ferry_terminal" || sub === "ferry_terminal";
        if (!isHarbor && !isFerry) continue;
        if (feat.type !== 1 || !feat.geometry[0]?.[0]) continue;
        const [lng, lat] = feat.geometry[0][0];
        if (!pointInBbox(lng, lat, region.bbox)) continue;
        addPort(
          lng,
          lat,
          typeof feat.properties.name === "string" ? feat.properties.name : "",
          isFerry ? "ferry_terminal" : "harbor",
        );
      }
      for (const feat of decodeLayer(buf, 12, x, y, "transportation")) {
        if (feat.properties.class !== "ferry" || feat.type !== 2) continue;
        for (const line of feat.geometry) {
          if (line.length < 2) continue;
          const start = line[0];
          const end = line[line.length - 1];
          addPort(start[0], start[1], "", "ferry_endpoint");
          addPort(end[0], end[1], "", "ferry_endpoint");
          // Coarse sea-lane waypoints along the ferry
          for (let s = 0; s < line.length; s += Math.max(1, Math.floor(line.length / 4))) {
            addLane(line[s][0], line[s][1]);
          }
        }
      }
    }
  }
  console.log(
    `  ports=${ports.length} seaLanePts=${seaLanePts.length} ${Date.now() - t0}ms`,
  );
  return { ports, seaLanePts };
}

function probeRegionSupports(db, region, aerodromes) {
  const supports = new Set();
  const roadAnchors = [];

  // Roads at z10 — sample up to ~36 tiles
  let roadHits = 0;
  const roadTiles = tilesCoveringBbox(region.bbox, 10);
  const roadStride = Math.max(1, Math.ceil(roadTiles.length / 36));
  for (let i = 0; i < roadTiles.length; i += roadStride) {
    const { x, y } = roadTiles[i];
    const buf = readTile(db, 10, x, y);
    if (!buf) continue;
    for (const feat of decodeLayer(buf, 10, x, y, "transportation")) {
      if (feat.type !== 2) continue;
      const cls = String(feat.properties.class || "");
      if (!DRIVABLE.has(cls)) continue;
      roadHits++;
      if (roadAnchors.length < 8) {
        const line = feat.geometry[0];
        if (line?.length) {
          const mid = line[Math.floor(line.length / 2)];
          if (pointInBbox(mid[0], mid[1], region.bbox)) {
            roadAnchors.push({
              lng: Number(mid[0].toFixed(5)),
              lat: Number(mid[1].toFixed(5)),
            });
          }
        }
      }
    }
  }
  if (roadHits >= 3) {
    supports.add("car");
    supports.add("truck");
  }

  // Navigable water at z8 — track class so lake-only inland regions don't
  // claim boat support (sea router is ocean/ferry oriented).
  let oceanHits = 0;
  let dockHits = 0;
  let lakeHits = 0;
  const waterTiles = tilesCoveringBbox(region.bbox, 8);
  const waterStride = Math.max(1, Math.ceil(waterTiles.length / 25));
  for (let i = 0; i < waterTiles.length; i += waterStride) {
    const { x, y } = waterTiles[i];
    const buf = readTile(db, 8, x, y);
    if (!buf) continue;
    for (const feat of decodeLayer(buf, 8, x, y, "water")) {
      const cls = String(feat.properties.class || "");
      if (feat.type !== 3 || !feat.geometry[0] || feat.geometry[0].length < 3) continue;
      if (cls === "ocean") oceanHits++;
      else if (cls === "dock") dockHits++;
      else if (cls === "lake") lakeHits++;
    }
  }
  // Ferry presence also counts as boat support
  let ferryHits = 0;
  const ferryTiles = tilesCoveringBbox(region.bbox, 10);
  const ferryStride = Math.max(1, Math.ceil(ferryTiles.length / 20));
  for (let i = 0; i < ferryTiles.length; i += ferryStride) {
    const { x, y } = ferryTiles[i];
    const buf = readTile(db, 10, x, y);
    if (!buf) continue;
    for (const feat of decodeLayer(buf, 10, x, y, "transportation")) {
      if (feat.properties.class === "ferry") ferryHits++;
    }
  }
  if (oceanHits >= 1 || ferryHits >= 1 || dockHits >= 1) supports.add("boat");

  // Aircraft: aerodromes inside padded bbox
  const pad = expandBbox(region.bbox, 0.75);
  const aeroCount = aerodromes.filter((a) => pointInBbox(a.lng, a.lat, pad)).length;
  if (aeroCount >= 1) supports.add("aircraft");

  // `other` follows road or sea (terrain-routed later)
  if (supports.has("car") || supports.has("boat")) supports.add("other");

  const order = ["aircraft", "boat", "car", "truck", "other"];
  return {
    supports: order.filter((c) => supports.has(c)),
    roadAnchors,
    stats: { roadHits, oceanHits, lakeHits, dockHits, ferryHits, aeroCount },
  };
}

function buildRegions(db, aerodromes) {
  console.log("Deriving region supports from geometry…");
  const regions = [];
  const roadAnchors = [];
  for (const def of REGION_DEFS) {
    const { supports, roadAnchors: anchors, stats } = probeRegionSupports(
      db,
      def,
      aerodromes,
    );
    console.log(
      `  ${def.id}: supports=[${supports.join(",")}] roads=${stats.roadHits} ocean=${stats.oceanHits} lake=${stats.lakeHits} dock=${stats.dockHits} ferry=${stats.ferryHits} aero=${stats.aeroCount}`,
    );
    regions.push({
      id: def.id,
      name: def.name,
      bbox: def.bbox,
      supports,
    });
    for (const a of anchors) {
      roadAnchors.push({ regionId: def.id, lng: a.lng, lat: a.lat });
    }
  }
  return { regions, roadAnchors };
}

function packBundle({ aerodromes, ports, seaLanePts, regions, roadAnchors }) {
  return {
    v: 1,
    generatedAt: new Date().toISOString(),
    aerodromes: {
      icao: aerodromes.map((a) => a.icao),
      iata: aerodromes.map((a) => a.iata),
      name: aerodromes.map((a) => a.name),
      class: aerodromes.map((a) => a.class),
      eleFt: aerodromes.map((a) => a.eleFt),
      lng: aerodromes.map((a) => a.lng),
      lat: aerodromes.map((a) => a.lat),
      runways: aerodromes.map((a) => a.runways),
    },
    ports: {
      lng: ports.map((p) => p.lng),
      lat: ports.map((p) => p.lat),
      name: ports.map((p) => p.name),
      kind: ports.map((p) => p.kind),
    },
    seaLanes: {
      lng: seaLanePts.map((p) => p.lng),
      lat: seaLanePts.map((p) => p.lat),
    },
    roadAnchors: {
      regionId: roadAnchors.map((a) => a.regionId),
      lng: roadAnchors.map((a) => a.lng),
      lat: roadAnchors.map((a) => a.lat),
    },
    regions,
  };
}

/** Extract a few small tiles for terrain unit tests. */
function writeFixtures(db) {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const specs = [
    // Mid-Atlantic ocean
    { id: "ocean-z9", ...lngLatToTile(-40, 30, 9), layers: ["water"] },
    // Central London inland
    { id: "london-z10", ...lngLatToTile(-0.1278, 51.5074, 10), layers: ["water", "transportation"] },
    // Dover coastline
    { id: "dover-z10", ...lngLatToTile(1.3, 51.12, 10), layers: ["water", "transportation"] },
  ];
  const manifest = [];
  for (const s of specs) {
    const buf = readTile(db, s.z, s.x, s.y);
    if (!buf) {
      console.warn(`  fixture missing tile ${s.id} ${s.z}/${s.x}/${s.y}`);
      continue;
    }
    const file = `${s.id}-${s.z}-${s.x}-${s.y}.pbf`;
    writeFileSync(join(FIXTURE_DIR, file), buf);
    manifest.push({
      id: s.id,
      file,
      z: s.z,
      x: s.x,
      y: s.y,
      layers: s.layers,
    });
    console.log(`  wrote fixture ${file} (${buf.length} bytes)`);
  }
  writeFileSync(join(FIXTURE_DIR, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
}

function main() {
  console.log(`Opening ${MBTILES}`);
  const db = openDb();
  const aerodromes = mineAerodromes(db);
  const { regions, roadAnchors } = buildRegions(db, aerodromes);
  const { ports, seaLanePts } = minePortsAndFerries(db, REGION_DEFS);

  // Supplement sea lanes with a few mid-bbox samples for maritime-heavy regions lacking ferries
  for (const r of regions) {
    if (!r.supports.includes("boat")) continue;
    const [w, s, e, n] = r.bbox;
    const cx = (w + e) / 2;
    const cy = (s + n) / 2;
    seaLanePts.push({
      lng: Number(cx.toFixed(4)),
      lat: Number(cy.toFixed(4)),
    });
  }

  const bundle = packBundle({ aerodromes, ports, seaLanePts, regions, roadAnchors });
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  const json = JSON.stringify(bundle);
  writeFileSync(OUT_PATH, json);
  const gz = gzipSync(Buffer.from(json));
  console.log(
    `Wrote ${OUT_PATH} raw=${(json.length / 1024).toFixed(1)} KiB gzip=${(gz.length / 1024).toFixed(1)} KiB`,
  );
  console.log(`Regions (${regions.length}):`);
  for (const r of regions) {
    console.log(`  ${r.id}: [${r.supports.join(", ")}]`);
  }

  console.log("Writing terrain test fixtures…");
  writeFixtures(db);
  db.close();
}

main();
