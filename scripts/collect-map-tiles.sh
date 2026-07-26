#!/usr/bin/env bash
# Collect OpenMapTiles-compatible planet MBTiles + Liberty/Dark styles for tileserver-gl.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="${TILES_DATA_DIR:-$ROOT_DIR/data/tiles}"
INDEX_URL="${OPENFREEMAP_INDEX_URL:-https://btrfs.openfreemap.com/files.txt}"
ASSETS_BASE="${OPENFREEMAP_ASSETS_URL:-https://assets.openfreemap.com}"
# Planet MBTiles are ~100GB; require headroom for download + extract work.
MIN_FREE_GB="${MIN_FREE_GB:-120}"
USER_AGENT="${USER_AGENT:-AdversaryCollectMapTiles/1.0}"

log() { printf '%s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

# wget is preferred over curl — OpenFreeMap index/large downloads can close curl streams mid-transfer.
wget_get() {
  # Usage: wget_get URL OUTPUT_PATH
  local url="$1"
  local out="$2"
  wget \
    --continue \
    --tries=8 \
    --retry-connrefused \
    --waitretry=5 \
    --timeout=60 \
    --read-timeout=60 \
    --user-agent="$USER_AGENT" \
    --output-document="$out" \
    "$url"
}

wget_stdout() {
  # Usage: wget_stdout URL  → writes body to stdout
  local url="$1"
  wget \
    --quiet \
    --tries=8 \
    --retry-connrefused \
    --waitretry=5 \
    --timeout=60 \
    --read-timeout=60 \
    --user-agent="$USER_AGENT" \
    --output-document=- \
    "$url"
}

need_cmd wget
need_cmd python3
need_cmd tar
need_cmd df

mkdir -p "$DATA_DIR" "$DATA_DIR/styles/liberty" "$DATA_DIR/styles/dark" "$DATA_DIR/fonts" "$DATA_DIR/sprites" "$DATA_DIR/.cache"

free_gb="$(df -BG --output=avail "$DATA_DIR" | tail -n1 | tr -dc '0-9')"
if [[ -z "$free_gb" ]]; then
  die "could not determine free disk space for $DATA_DIR"
fi
if (( free_gb < MIN_FREE_GB )); then
  die "need at least ${MIN_FREE_GB}GB free in $DATA_DIR (have ${free_gb}GB). Set MIN_FREE_GB to override."
fi

log "Fetching OpenFreeMap planet index…"
index="$(wget_stdout "$INDEX_URL")"
planet_path="$(printf '%s\n' "$index" | grep -E 'areas/planet/.+/tiles\.mbtiles$' | tail -n1)"
[[ -n "$planet_path" ]] || die "no planet tiles.mbtiles entry found in $INDEX_URL"

planet_url="https://btrfs.openfreemap.com/${planet_path}"
mbtiles_path="$DATA_DIR/openmaptiles.mbtiles"
log "Latest planet: $planet_url"
log "Downloading to $mbtiles_path (resume supported)…"
wget_get "$planet_url" "$mbtiles_path"

log "Downloading fonts, sprites, and styles…"
wget_get "$ASSETS_BASE/fonts/ofm.tar.gz" "$DATA_DIR/.cache/fonts.tar.gz"
wget_get "$ASSETS_BASE/sprites/ofm_f384.tar.gz" "$DATA_DIR/.cache/sprites.tar.gz"
wget_get "$ASSETS_BASE/styles/ofm.tar.gz" "$DATA_DIR/.cache/styles.tar.gz"

rm -rf "$DATA_DIR/.cache/fonts_extract" "$DATA_DIR/.cache/sprites_extract" "$DATA_DIR/.cache/styles_extract"
mkdir -p "$DATA_DIR/.cache/fonts_extract" "$DATA_DIR/.cache/sprites_extract" "$DATA_DIR/.cache/styles_extract"
tar -xzf "$DATA_DIR/.cache/fonts.tar.gz" -C "$DATA_DIR/.cache/fonts_extract"
tar -xzf "$DATA_DIR/.cache/sprites.tar.gz" -C "$DATA_DIR/.cache/sprites_extract"
tar -xzf "$DATA_DIR/.cache/styles.tar.gz" -C "$DATA_DIR/.cache/styles_extract"

# fonts: ofm/Noto Sans … → fonts/Noto Sans …
if [[ -d "$DATA_DIR/.cache/fonts_extract/ofm" ]]; then
  rm -rf "$DATA_DIR/fonts"
  mkdir -p "$DATA_DIR/fonts"
  cp -a "$DATA_DIR/.cache/fonts_extract/ofm/." "$DATA_DIR/fonts/"
fi

# sprites: ofm_f384/* → sprites/ofm*
rm -rf "$DATA_DIR/sprites"
mkdir -p "$DATA_DIR/sprites"
if [[ -d "$DATA_DIR/.cache/sprites_extract/ofm_f384" ]]; then
  cp -a "$DATA_DIR/.cache/sprites_extract/ofm_f384/." "$DATA_DIR/sprites/"
fi

rewrite_style() {
  local src="$1"
  local dest="$2"
  python3 - "$src" "$dest" <<'PY'
import json, sys
src, dest = sys.argv[1], sys.argv[2]
with open(src, encoding="utf-8") as f:
    style = json.load(f)

style["glyphs"] = "{fontstack}/{range}.pbf"
style["sprite"] = "sprites/ofm"

sources = style.get("sources") or {}
# Drop remote Natural Earth raster for fully local serving.
sources.pop("ne2_shaded", None)
sources["openmaptiles"] = {
    "type": "vector",
    "url": "mbtiles://{openmaptiles}",
}
style["sources"] = sources
style["layers"] = [
    layer for layer in style.get("layers") or []
    if layer.get("source") != "ne2_shaded"
]

with open(dest, "w", encoding="utf-8") as f:
    json.dump(style, f, ensure_ascii=False)
    f.write("\n")
PY
}

liberty_src="$DATA_DIR/.cache/styles_extract/ofm/liberty.json"
dark_src="$DATA_DIR/.cache/styles_extract/ofm/dark.json"
[[ -f "$liberty_src" ]] || die "missing liberty style in styles archive"
[[ -f "$dark_src" ]] || die "missing dark style in styles archive"

rewrite_style "$liberty_src" "$DATA_DIR/styles/liberty/style.json"
rewrite_style "$dark_src" "$DATA_DIR/styles/dark/style.json"

cat > "$DATA_DIR/config.json" <<'EOF'
{
  "options": {
    "paths": {
      "root": "/data",
      "fonts": "fonts",
      "sprites": "sprites",
      "styles": "styles",
      "mbtiles": ""
    }
  },
  "styles": {
    "liberty": {
      "style": "liberty/style.json",
      "tilejson": {
        "bounds": [-180, -85.0511, 180, 85.0511]
      }
    },
    "dark": {
      "style": "dark/style.json",
      "tilejson": {
        "bounds": [-180, -85.0511, 180, 85.0511]
      }
    }
  },
  "data": {
    "openmaptiles": {
      "mbtiles": "openmaptiles.mbtiles"
    }
  }
}
EOF

# Keep a small placeholder marker so empty clones know the layout.
printf '%s\n' "Planet tiles + Liberty/Dark styles prepared for tileserver-gl." > "$DATA_DIR/READY.txt"
printf '%s\n' "$planet_url" > "$DATA_DIR/SOURCE.txt"

log "Done."
log "  MBTiles: $mbtiles_path"
log "  Styles:  liberty, dark"
log "  Config:  $DATA_DIR/config.json"
log "Start the stack with: pnpm run docker:up"
log "Map styles: http://tiles.adversary/styles/liberty/style.json"
log "            http://tiles.adversary/styles/dark/style.json"
