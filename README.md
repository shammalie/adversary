# Adversary

<p align="center">
  <img src="docs/images/hero-banner.png" alt="Adversary — multi-target tracking simulation" width="100%" />
</p>

**Adversary** is a browser-based multi-target tracking simulator. Author scenarios, replay timed position and message events, and run an operations console with live roster, map tracks, and priority intelligence — including offline map regions for disconnected use.

<p align="center">
  <a href="#quick-start"><strong>Quick start</strong></a> ·
  <a href="#how-to-use"><strong>How to use</strong></a> ·
  <a href="#scenario-format"><strong>Scenario format</strong></a> ·
  <a href="#deployment"><strong>Deployment</strong></a>
</p>

---

## Why Adversary

Train operators, demo tracking workflows, or prototype geospatial intelligence pipelines without a live data feed. Scenarios are plain JSON: define targets, schedule events, hit **Start simulation**, and watch contacts appear on the map as time advances.

| Operations console | Scenario builder | Offline regions |
| :---: | :---: | :---: |
| <img src="docs/images/feature-operations.png" alt="Operations map with tracked contacts" width="280" /> | <img src="docs/images/feature-builder.png" alt="Scenario builder with routes and timeline" width="280" /> | <img src="docs/images/feature-offline.png" alt="Offline map region packages" width="280" /> |
| Live roster, track camera, event ingest, and priority alerts | Targets, routes, messages, demos, and schema-validated export | Import PMTiles packages and run disconnected |

### Capabilities

- **Operations dashboard** — target roster, 2D / globe map, track / overview / pan camera, event ingest table, and priority message highlighting
- **Scenario builder** — author targets and timed events, generate routes, load random demos, preview, and start a run
- **JSON import** — upload or paste scenarios with inline schema docs and validation
- **Offline maps** — import region packages (PMTiles + style) for field or air-gapped use
- **Client-first** — scenarios and runtime state persist in IndexedDB; installable as a PWA

---

## Quick start

**Requirements:** [Node.js](https://nodejs.org/) 20+, [pnpm](https://pnpm.io/) 10+

```bash
pnpm install
pnpm run dev
```

Open [http://localhost:3001](http://localhost:3001). The app redirects to **Operations**.

To run only the web app:

```bash
pnpm run dev:web
```

---

## How to use

### 1. Start a simulation

From an empty Operations screen:

1. Open **Settings** (gear) → **Builder**, or go to `/builder`
2. Click **Load random demo** (or pick a vehicle type), *or* author targets and events yourself
3. Click **Start simulation**
4. Return to **Operations** (`/operations`) to watch the run

Alternatively: **Settings** → **Import** (`/import`), upload a scenario JSON file, then start it from the builder or import flow.

### 2. Run the operations console

While a simulation is active:

- **Target roster** — contacts derived from received events; check **Track** to follow them on the map
- **Operational map** — toggle **2D / Globe**; camera modes: track, overview, pan
- **Event ingest** — ordered stream of position and message events
- **Intelligence messages** — messages matched against scenario `priorityTerms`

**Keyboard shortcuts**

| Shortcut | Action |
| --- | --- |
| `Ctrl/Cmd + K` | Command palette |
| `Shift + M` | Toggle 2D / globe |
| `Shift + S` | Stop simulation |
| `Shift + R` | Reset and open builder |

### 3. Author or import scenarios

**Builder** (`/builder`)

- Add targets (callsign, color, vehicle category, affiliation, status)
- Schedule position and/or message events
- Generate routes between waypoints
- Save drafts locally, export JSON, or start immediately

**Import** (`/import`)

- Drag-and-drop or paste scenario JSON
- Browse schema documentation and cross-field rules
- Valid scenarios can be saved and started

### 4. Offline map regions

Import a ZIP package containing:

- `manifest.json` (schema version `2`)
- `style.json`
- A `.pmtiles` file referenced by the manifest

Activate a region to use its tiles when operating without online basemaps.

---

## Scenario format

Scenarios use **schema version 2**. Minimal shape:

```json
{
  "schemaVersion": 2,
  "id": "scenario-demo-1",
  "name": "Channel transit",
  "createdAt": "2026-01-01T12:00:00.000Z",
  "updatedAt": "2026-01-01T12:00:00.000Z",
  "priorityTerms": ["critical", "proximity"],
  "targets": [
    {
      "id": "tgt-1",
      "callsign": "VIPER-01",
      "revealOnFirstEvent": true,
      "color": "#4ec9e0",
      "profile": {
        "vehicleCategory": "aircraft",
        "affiliation": "hostile",
        "status": "active"
      }
    }
  ],
  "events": [
    {
      "id": "evt-1",
      "targetId": "tgt-1",
      "at": "2026-01-01T12:00:30.000Z",
      "position": {
        "latitude": 51.5,
        "longitude": -0.12,
        "altitude": 12000,
        "speed": 420
      },
      "message": "Contact entered monitored sector."
    }
  ]
}
```

**Rules of thumb**

- At least one target and one event
- Unique target IDs, callsigns, and event IDs
- Every `event.targetId` must reference a target
- Datetimes must include a timezone offset
- Each event needs a `position`, a `message`, or both
- Vehicle categories: `aircraft` · `boat` · `car` · `truck` · `other`
- Affiliations: `unknown` · `friendly` · `neutral` · `hostile`

Full field docs live on the **Import** page in the app.

---

## Project structure

```
adversary/
├── apps/
│   └── web/              # React app (TanStack Router, MapLibre, PWA)
├── packages/
│   ├── ui/               # Shared shadcn/ui primitives & styles
│   ├── env/              # Shared environment helpers
│   └── config/           # Shared TypeScript / tooling config
├── docs/images/          # README artwork
└── docker-compose.yml    # Production-style web container
```

**Stack:** TypeScript · React 19 · TanStack Router · Tailwind CSS · MapLibre GL · PMTiles · IndexedDB · Vite+ · pnpm workspaces

---

## Available scripts

| Script | Description |
| --- | --- |
| `pnpm run dev` | Start all apps in development |
| `pnpm run dev:web` | Start only the web app |
| `pnpm run build` | Build all apps |
| `pnpm run check` | Format/lint + TypeScript checks |
| `pnpm run check-types` | TypeScript only |
| `pnpm run lint` / `pnpm run format` | Lint or format |
| `pnpm run test:a11y` | Playwright accessibility tests (web) |
| `pnpm run docker:build` | Build Compose images |
| `pnpm run docker:up` | Build and start Compose stack |
| `pnpm run docker:logs` | Tail Compose logs |
| `pnpm run docker:down` | Stop Compose stack |
| `pnpm run hooks:setup` | Install Vite+ native Git hooks |

Unit tests (Vitest) and e2e (Playwright) live under `apps/web`:

```bash
pnpm --filter web test
pnpm --filter web test:e2e
```

---

## Deployment

### Docker Compose

```bash
pnpm run docker:up
```

Serves the web app at [http://localhost:3001](http://localhost:3001) (nginx in-container on port 80).

```bash
pnpm run docker:logs   # follow logs
pnpm run docker:down   # stop
```

Environment variables are read from `apps/web/.env` when present, and can be overridden in `docker-compose.yml`.

### UI customization

Shared design tokens and primitives live in `packages/ui`:

- Styles: `packages/ui/src/styles/globals.css`
- Components: `packages/ui/src/components/*`

Add shared primitives from the repo root:

```bash
npx shadcn@latest add accordion dialog popover sheet table -c packages/ui
```

```tsx
import { Button } from "@adversary/ui/components/button";
```

---

## License

Private project — all rights reserved unless otherwise noted.
