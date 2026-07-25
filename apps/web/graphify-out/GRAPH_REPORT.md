# Graph Report - web  (2026-07-25)

## Corpus Check
- 87 files · ~115,971 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 617 nodes · 1320 edges · 43 communities (27 shown, 16 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 14 edges (avg confidence: 0.56)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `981efa95`
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

## God Nodes (most connected - your core abstractions)
1. `ScenarioBuilder()` - 28 edges
2. `SimulationEvent` - 19 edges
3. `sortEvents()` - 18 edges
4. `createDemoScenario()` - 16 edges
5. `SimulationScenario` - 15 edges
6. `scripts` - 13 edges
7. `VehicleCategory` - 12 edges
8. `TargetDefinition` - 12 edges
9. `MapDataProvider()` - 11 edges
10. `buildEventGraph()` - 11 edges

## Surprising Connections (you probably didn't know these)
- `buildSamplePackage()` --references--> `jszip`  [EXTRACTED]
  src/lib/offline-regions/import.test.ts → package.json
- `importOfflineRegionZip()` --references--> `jszip`  [EXTRACTED]
  src/lib/offline-regions/import.ts → package.json
- `readZipEntry()` --references--> `jszip`  [EXTRACTED]
  src/lib/offline-regions/import.ts → package.json
- `Header()` --calls--> `useSimulation()`  [EXTRACTED]
  src/components/header.tsx → src/components/simulation-provider.tsx
- `ScenarioBuilder()` --indirect_call--> `event()`  [INFERRED]
  src/components/scenario-builder.tsx → src/lib/build-event-graph.test.ts

## Import Cycles
- None detected.

## Communities (43 total, 16 thin omitted)

### Community 0 - "target.ts"
Cohesion: 0.08
Nodes (47): MapLocationPickerProps, MapTargetDisplay, createDraftForTargetChange(), createEventDraft(), createFollowOnDraft(), DEFAULT_EVENT_POSITION, draftFromEvent(), EventDraft (+39 more)

### Community 1 - "map-data-provider.tsx"
Cohesion: 0.08
Nodes (46): jszip, jszip, disposeMapDataResources(), MapDataContext, MapDataContextValue, MapDataProvider(), resolveColorScheme(), getOnlineMapStyle() (+38 more)

### Community 2 - "scenario-builder.tsx"
Cohesion: 0.08
Nodes (47): DEFAULT_POSITION, EditTimelineEvent(), EditTimelineEventProps, issuesForField(), TimelineEventShellProps, ViewTimelineEvent(), ViewTimelineEventProps, blankScenario() (+39 more)

### Community 3 - "simulation-storage.ts"
Cohesion: 0.10
Nodes (39): SimulationProvider(), isLegacyScenario(), mergeProfile(), migrateRetiredVehicleCategories(), migrateScenarioV1ToV2(), migrateVehicleCategory(), legacy, VEHICLE_CATEGORY_SET (+31 more)

### Community 4 - "demo-scenario.ts"
Cohesion: 0.08
Nodes (38): countPayloadStats(), getTocItemOffset(), SCHEMA_TOC_ITEMS, SchemaBreakdown(), SchemaDialog(), schemaFieldId(), SchemaTocItem, slugifySchemaHeading() (+30 more)

### Community 5 - "build-event-graph.ts"
Cohesion: 0.10
Nodes (31): TimedEventEdgeView(), EventGraphNodeView(), KIND_BADGE, KIND_COLOR, KIND_LABEL, GenerateRouteDialogProps, edgeTypes, nodeTypes (+23 more)

### Community 6 - "dependencies"
Cohesion: 0.05
Nodes (39): @adversary/env, @adversary/ui, date-fns, dotenv, @hookform/resolvers, idb, lucide-react, maplibre-gl (+31 more)

### Community 7 - "operations-dashboard.tsx"
Cohesion: 0.11
Nodes (31): eventPayloadBadges(), eventSummary(), matchesTargetSearch(), OperationsDashboard(), TargetRoster(), targetSearchFields(), TrackedTargetCard(), TrackingMap (+23 more)

### Community 8 - "simulation-engine.ts"
Cohesion: 0.18
Nodes (23): SimulationContext, SimulationContextValue, clampPreviewTimeMs(), computePreviewRevision(), getPreviewRangeMs(), getPreviewStartMs(), applyEvent(), buildInterpolatedPreviewTargetStates() (+15 more)

### Community 9 - "map-location-picker.tsx"
Cohesion: 0.15
Nodes (20): buildNeighborCollection(), buildTrailCollection(), createEventPointElement(), EMPTY_TRAIL, ensureLineLayer(), ensureOverlayLayers(), ExistingMapPoint, findTimeNeighbors() (+12 more)

### Community 10 - "components.json"
Cohesion: 0.09
Nodes (21): aliases, components, hooks, lib, ui, utils, iconLibrary, menuAccent (+13 more)

### Community 11 - "__root.tsx"
Cohesion: 0.14
Nodes (13): BrandMark(), Header(), ModeToggle(), getDevtoolsEnabled(), RouterDevtoolsGate(), subscribeToDevtoolsFlag(), TanStackRouterDevtools, FALLBACK_THEME_COLORS (+5 more)

### Community 12 - "loader.tsx"
Cohesion: 0.13
Nodes (11): Loader(), Register, rootElement, router, @tanstack/react-router, Route, SimulationImport, Route (+3 more)

### Community 13 - "compilerOptions"
Cohesion: 0.12
Nodes (15): ., ../../packages/ui/src/*, vite/client, compilerOptions, esModuleInterop, jsx, module, moduleResolution (+7 more)

### Community 14 - "devDependencies"
Cohesion: 0.15
Nodes (13): @adversary/config, @axe-core/playwright, devDependencies, @adversary/config, @axe-core/playwright, to-ico, typescript, vite (+5 more)

### Community 15 - "scripts"
Cohesion: 0.15
Nodes (13): scripts, build, check-types, dev, generate-icons, generate-readme-images, serve, start (+5 more)

### Community 16 - "generate-route-dialog.tsx"
Cohesion: 0.24
Nodes (10): DateTimePicker(), DateTimePickerProps, parseValue(), PRESETS, toLocalInputValue(), FieldErrors, GenerateRouteDialog(), MapLocationPicker (+2 more)

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

## Knowledge Gaps
- **177 isolated node(s):** `$schema`, `style`, `rsc`, `tsx`, `config` (+172 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **16 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `dependencies` connect `dependencies` to `map-data-provider.tsx`, `package.json`?**
  _High betweenness centrality (0.235) - this node is a cross-community bridge._
- **Why does `jszip` connect `map-data-provider.tsx` to `dependencies`?**
  _High betweenness centrality (0.225) - this node is a cross-community bridge._
- **What connects `$schema`, `style`, `rsc` to the rest of the system?**
  _177 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `target.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07759562841530054 - nodes in this community are weakly interconnected._
- **Should `map-data-provider.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.08418079096045197 - nodes in this community are weakly interconnected._
- **Should `scenario-builder.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.08208020050125313 - nodes in this community are weakly interconnected._
- **Should `simulation-storage.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.10465116279069768 - nodes in this community are weakly interconnected._