# Graph Report - web  (2026-07-26)

## Corpus Check
- 83 files · ~46,689 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 595 nodes · 1271 edges · 44 communities (27 shown, 17 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 14 edges (avg confidence: 0.56)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `79bd3298`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- target.ts
- map-data-provider.tsx
- scenario-builder.tsx
- simulation-storage.ts
- demo-scenario.ts
- build-event-graph.ts
- dependencies
- operations-dashboard.tsx
- simulation-engine.ts
- map-location-picker.tsx
- components.json
- __root.tsx
- loader.tsx
- compilerOptions
- devDependencies
- scripts
- generate-route-dialog.tsx
- a11y.helpers.ts
- generate-readme-images.mjs
- package.json
- generate.mjs
- generate-brand-icons.mjs
- fake-indexeddb
- @playwright/test
- postcss
- sharp
- tailwindcss
- @tanstack/react-router-devtools
- @tanstack/router-plugin
- @types/node
- @types/react
- @types/react-dom
- vite-plugin-pwa
- vitest
- index.tsx
- EVENT_GRAPH_NODE_GAP
- MAP_STYLE
- pwa.test.ts
- vite.config.ts

## God Nodes (most connected - your core abstractions)
1. `ScenarioBuilder()` - 28 edges
2. `SimulationEvent` - 19 edges
3. `sortEvents()` - 18 edges
4. `createDemoScenario()` - 16 edges
5. `SimulationScenario` - 15 edges
6. `scripts` - 13 edges
7. `haversineDistanceNm()` - 13 edges
8. `generatePointToPointEvents()` - 12 edges
9. `VehicleCategory` - 12 edges
10. `TargetDefinition` - 12 edges

## Surprising Connections (you probably didn't know these)
- `MapLocationPickerProps` --references--> `PositionPayload`  [EXTRACTED]
  src/components/map-location-picker.tsx → src/types/target.ts
- `OperationsDashboard()` --indirect_call--> `event()`  [INFERRED]
  src/components/operations-dashboard.tsx → src/lib/build-event-graph.test.ts
- `ScenarioBuilder()` --indirect_call--> `event()`  [INFERRED]
  src/components/scenario-builder.tsx → src/lib/build-event-graph.test.ts
- `EventDraft` --references--> `PositionPayload`  [EXTRACTED]
  src/lib/event-draft.ts → src/types/target.ts
- `EditTimelineEvent()` --calls--> `matchPriorityTerms()`  [EXTRACTED]
  src/components/grouped-timeline-event.tsx → src/lib/priority-terms.ts

## Import Cycles
- None detected.

## Communities (44 total, 17 thin omitted)

### Community 0 - "target.ts"
Cohesion: 0.12
Nodes (35): defaultEndPoint(), FieldErrors, GenerateRouteForm(), isValidCoordinate(), MapLocationPicker, validateRouteForm(), assertFeasibleEndWindow(), CATEGORY_MOVEMENT_SMOOTHING (+27 more)

### Community 1 - "map-data-provider.tsx"
Cohesion: 0.19
Nodes (12): MapDataContext, MapDataContextValue, MapDataProvider(), resolveColorScheme(), getOnlineMapStyle(), isConfiguredStyleUrl(), isOnlineStyleUrl(), MapColorScheme (+4 more)

### Community 2 - "scenario-builder.tsx"
Cohesion: 0.08
Nodes (48): DateTimePicker(), DateTimePickerProps, parseValue(), PRESETS, toLocalInputValue(), DEFAULT_POSITION, EditTimelineEvent(), EditTimelineEventProps (+40 more)

### Community 3 - "simulation-storage.ts"
Cohesion: 0.10
Nodes (39): SimulationProvider(), isLegacyScenario(), mergeProfile(), migrateRetiredVehicleCategories(), migrateScenarioV1ToV2(), migrateVehicleCategory(), legacy, VEHICLE_CATEGORY_SET (+31 more)

### Community 4 - "demo-scenario.ts"
Cohesion: 0.08
Nodes (36): countPayloadStats(), getTocItemOffset(), SCHEMA_TOC_ITEMS, SchemaBreakdown(), SchemaDialog(), schemaFieldId(), SchemaTocItem, SimulationImport() (+28 more)

### Community 5 - "build-event-graph.ts"
Cohesion: 0.10
Nodes (32): TimedEventEdgeView(), EventGraphNodeView(), KIND_BADGE, KIND_COLOR, KIND_LABEL, GenerateRouteFormProps, edgeTypes, nodeTypes (+24 more)

### Community 6 - "dependencies"
Cohesion: 0.05
Nodes (37): @adversary/env, @adversary/ui, date-fns, dotenv, @hookform/resolvers, idb, lucide-react, maplibre-gl (+29 more)

### Community 7 - "operations-dashboard.tsx"
Cohesion: 0.22
Nodes (16): eventPayloadBadges(), eventSummary(), matchesTargetSearch(), OperationsDashboard(), TargetRoster(), targetSearchFields(), TrackedTargetCard(), TrackingMap (+8 more)

### Community 8 - "simulation-engine.ts"
Cohesion: 0.18
Nodes (23): SimulationContext, SimulationContextValue, clampPreviewTimeMs(), computePreviewRevision(), getPreviewRangeMs(), getPreviewStartMs(), applyEvent(), buildInterpolatedPreviewTargetStates() (+15 more)

### Community 9 - "map-location-picker.tsx"
Cohesion: 0.13
Nodes (24): useMapData(), buildNeighborCollection(), buildTrailCollection(), CompanionMapPoint, createCompanionPointElement(), createEventPointElement(), EMPTY_TRAIL, ensureLineLayer() (+16 more)

### Community 10 - "components.json"
Cohesion: 0.09
Nodes (21): aliases, components, hooks, lib, ui, utils, iconLibrary, menuAccent (+13 more)

### Community 11 - "__root.tsx"
Cohesion: 0.14
Nodes (14): BrandMark(), Header(), ModeToggle(), getDevtoolsEnabled(), RouterDevtoolsGate(), subscribeToDevtoolsFlag(), TanStackRouterDevtools, useSimulation() (+6 more)

### Community 12 - "loader.tsx"
Cohesion: 0.13
Nodes (11): Loader(), Register, rootElement, router, @tanstack/react-router, Route, SimulationImport, Route (+3 more)

### Community 13 - "compilerOptions"
Cohesion: 0.12
Nodes (15): ., ../../packages/ui/src/*, vite/client, compilerOptions, esModuleInterop, jsx, module, moduleResolution (+7 more)

### Community 14 - "devDependencies"
Cohesion: 0.15
Nodes (13): @axe-core/playwright, devDependencies, @axe-core/playwright, postcss, to-ico, typescript, vite, @vitejs/plugin-react (+5 more)

### Community 15 - "scripts"
Cohesion: 0.15
Nodes (13): scripts, build, check-types, dev, generate-icons, generate-readme-images, serve, start (+5 more)

### Community 16 - "generate-route-dialog.tsx"
Cohesion: 0.14
Nodes (18): createDraftForTargetChange(), createEventDraft(), createFollowOnDraft(), DEFAULT_EVENT_POSITION, draftFromEvent(), EventDraft, eventFromDraft(), lastPositionForTarget() (+10 more)

### Community 17 - "a11y.helpers.ts"
Cohesion: 0.25
Nodes (9): assertNoWcag21AaViolations(), ColorScheme, FormattedViolation, formatViolations(), setColorScheme(), WCAG_21_AA_TAGS, MAP_EXCLUDE, routes (+1 more)

### Community 18 - "generate-readme-images.mjs"
Cohesion: 0.40
Nodes (5): __dir, jobs, mark(), markBadge(), outDir

### Community 19 - "package.json"
Cohesion: 0.40
Nodes (4): name, private, type, version

### Community 20 - "generate.mjs"
Cohesion: 0.40
Nodes (4): __dir, files, outDir, srcDir

### Community 24 - "postcss"
Cohesion: 0.11
Nodes (30): buildBounds(), buildTrailCoordinates(), createMarkerElement(), EMPTY_TRAIL_COLLECTION, isOutsideViewport(), MapTargetDisplay, needsTrackRefit(), toDisplayTarget() (+22 more)

## Knowledge Gaps
- **174 isolated node(s):** `$schema`, `style`, `rsc`, `tsx`, `config` (+169 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **17 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `SimulationEvent` connect `build-event-graph.ts` to `target.ts`, `scenario-builder.tsx`, `simulation-storage.ts`, `demo-scenario.ts`, `operations-dashboard.tsx`, `simulation-engine.ts`, `generate-route-dialog.tsx`, `postcss`?**
  _High betweenness centrality (0.022) - this node is a cross-community bridge._
- **Why does `Loader()` connect `loader.tsx` to `scenario-builder.tsx`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **Why does `PositionPayload` connect `target.ts` to `generate-route-dialog.tsx`, `map-location-picker.tsx`, `scenario-builder.tsx`, `postcss`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **What connects `$schema`, `style`, `rsc` to the rest of the system?**
  _174 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `target.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.12270531400966184 - nodes in this community are weakly interconnected._
- **Should `scenario-builder.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.07831677381648158 - nodes in this community are weakly interconnected._
- **Should `simulation-storage.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.10465116279069768 - nodes in this community are weakly interconnected._