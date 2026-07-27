# Graph Report - web  (2026-07-27)

## Corpus Check
- 115 files · ~94,765 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 983 nodes · 2296 edges · 54 communities (36 shown, 18 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 17 edges (avg confidence: 0.59)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `0f254b51`
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
- sea-router.ts
- terrain.ts
- geo-router.worker.ts
- vector-tile-client.ts
- simulation-storage.ts
- simulation-import.tsx
- scenario-migration.ts
- sea-router.test.ts
- LruCache
- @adversary/config

## God Nodes (most connected - your core abstractions)
1. `ScenarioBuilder()` - 29 edges
2. `haversineDistanceNm()` - 29 edges
3. `iterateDemoTargets()` - 23 edges
4. `SimulationEvent` - 23 edges
5. `VehicleCategory` - 22 edges
6. `destinationPoint()` - 21 edges
7. `sortEvents()` - 20 edges
8. `initialBearingDegrees()` - 19 edges
9. `SimulationScenario` - 18 edges
10. `pathToEvents()` - 17 edges

## Surprising Connections (you probably didn't know these)
- `GroupedTimeline()` --indirect_call--> `event()`  [INFERRED]
  src/components/grouped-timeline.tsx → src/lib/build-event-graph.test.ts
- `MapLocationPickerProps` --references--> `PositionPayload`  [EXTRACTED]
  src/components/map-location-picker.tsx → src/types/target.ts
- `EventIngestTable()` --indirect_call--> `event()`  [INFERRED]
  src/components/ops-event-tables.tsx → src/lib/build-event-graph.test.ts
- `ScenarioBuilder()` --indirect_call--> `event()`  [INFERRED]
  src/components/scenario-builder.tsx → src/lib/build-event-graph.test.ts
- `ScenarioBuilder()` --indirect_call--> `profile()`  [INFERRED]
  src/components/scenario-builder.tsx → src/lib/geo/vehicle-profiles.ts

## Import Cycles
- None detected.

## Communities (54 total, 18 thin omitted)

### Community 0 - "target.ts"
Cohesion: 0.06
Nodes (79): defaultEndPoint(), FieldErrors, GenerateRouteForm(), isValidCoordinate(), MapLocationPicker, validateRouteForm(), describeEvent(), FlatItem (+71 more)

### Community 1 - "map-data-provider.tsx"
Cohesion: 0.09
Nodes (23): MapDataContext, MapDataContextValue, MapDataProvider(), resolveColorScheme(), getDevtoolsEnabled(), RouterDevtoolsGate(), subscribeToDevtoolsFlag(), TanStackRouterDevtools (+15 more)

### Community 2 - "scenario-builder.tsx"
Cohesion: 0.43
Nodes (4): BrandMark(), Header(), ModeToggle(), useSimulation()

### Community 3 - "simulation-storage.ts"
Cohesion: 0.25
Nodes (16): clearLegacyScenarios(), deleteScenario(), ensureMigrated(), extractId(), extractName(), extractUpdatedAt(), getDb(), getScenario() (+8 more)

### Community 4 - "demo-scenario.ts"
Cohesion: 0.05
Nodes (85): matchingDemoLocationName(), CATEGORY_SET, DEMO_REGIONS, DemoRegion, demoRegionById(), demoRegionsByIds(), parseRegions(), parseSupports() (+77 more)

### Community 5 - "build-event-graph.ts"
Cohesion: 0.10
Nodes (33): TimedEventEdgeView(), EventGraphNodeView(), KIND_BADGE, KIND_COLOR, KIND_LABEL, GenerateRouteFormProps, edgeTypes, nodeTypes (+25 more)

### Community 6 - "dependencies"
Cohesion: 0.05
Nodes (43): @adversary/env, @adversary/ui, date-fns, dotenv, @hookform/resolvers, idb, lucide-react, @mapbox/vector-tile (+35 more)

### Community 7 - "operations-dashboard.tsx"
Cohesion: 0.18
Nodes (23): AFFILIATION_COLORS, AFFILIATION_SET, isAccessibleAffiliationColor(), resolveAffiliationColor(), resolveAffiliationColorTheme(), channelLuminance(), contrastRatio(), findTargetColorLabel() (+15 more)

### Community 8 - "simulation-engine.ts"
Cohesion: 0.07
Nodes (51): blankScenario(), focusElementById(), formatRegionSupports(), MapLocationPicker, PreviewEventGraph, ScenarioBuilder(), TrackingMap, createDemoScenario() (+43 more)

### Community 9 - "map-location-picker.tsx"
Cohesion: 0.07
Nodes (51): useMapData(), buildNeighborCollection(), buildTrailCollection(), CompanionMapPoint, createCompanionPointElement(), createEventPointElement(), EMPTY_TRAIL, ensureLineLayer() (+43 more)

### Community 10 - "components.json"
Cohesion: 0.09
Nodes (21): aliases, components, hooks, lib, ui, utils, iconLibrary, menuAccent (+13 more)

### Community 11 - "__root.tsx"
Cohesion: 0.08
Nodes (49): ARTERIAL_CLASSES, astarRoad(), BLOCKED_ACCESS, buildRoadGraph(), CLASS_SPEED_MPS, classPreferenceMultiplier(), cumulativeDistances(), DRIVABLE_CLASSES (+41 more)

### Community 12 - "loader.tsx"
Cohesion: 0.13
Nodes (11): Loader(), Register, rootElement, router, @tanstack/react-router, Route, SimulationImport, Route (+3 more)

### Community 13 - "compilerOptions"
Cohesion: 0.12
Nodes (16): ., ../../packages/ui/src/*, vite/client, compilerOptions, esModuleInterop, jsx, module, moduleResolution (+8 more)

### Community 14 - "devDependencies"
Cohesion: 0.15
Nodes (13): @axe-core/playwright, devDependencies, @axe-core/playwright, @tanstack/router-plugin, to-ico, typescript, vite, @vitejs/plugin-react (+5 more)

### Community 15 - "scripts"
Cohesion: 0.15
Nodes (13): scripts, build, check-types, dev, generate-icons, generate-readme-images, serve, start (+5 more)

### Community 16 - "generate-route-dialog.tsx"
Cohesion: 0.22
Nodes (9): idSchema, isoDateSchema, positionPayloadSchema, simulationEventSchema, simulationScenarioSchema, targetDefinitionSchema, targetProfileSchema, validateScenario() (+1 more)

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
Cohesion: 0.09
Nodes (33): DateTimePicker(), DateTimePickerProps, parseValue(), PRESETS, toLocalInputValue(), DEFAULT_POSITION, EditTimelineEvent(), EditTimelineEventProps (+25 more)

### Community 28 - "@tanstack/router-plugin"
Cohesion: 0.09
Nodes (46): Aerodrome, aerodromeInBbox(), AerodromeRunway, AirLoiterPattern, AirPathPoint, AirRouteErr, AirRouteFailureReason, AirRouteOk (+38 more)

### Community 44 - "sea-router.ts"
Cohesion: 0.12
Nodes (36): allFeatures(), astarWaterGrid(), buildNavigableGrid(), cellCenter(), cellKey(), checkAborted(), closestPointOnSegment(), expandBbox() (+28 more)

### Community 45 - "terrain.ts"
Cohesion: 0.12
Nodes (25): waterClassAtPoint(), acceptsCategory(), classifyPoint(), ClassifyPointOptions, closestPointOnSegment(), DRIVABLE_ROAD, NAVIGABLE_WATER_CLASSES, NavigableWaterClass (+17 more)

### Community 46 - "geo-router.worker.ts"
Cohesion: 0.14
Nodes (21): createGeoRouterClient(), GeoRouterClient, GeoRouteRequest, Pending, createGeoRouterWorker(), GeoRouterLngLat, GeoRouterMode, GeoRouterRequest (+13 more)

### Community 47 - "vector-tile-client.ts"
Cohesion: 0.15
Nodes (17): buildTileUrl(), CacheEntry, clearTileSourceCache(), fetchTileBytes(), isGzipFramed(), maybeGunzip(), pickTileTemplate(), resolveTileUrlTemplate() (+9 more)

### Community 48 - "simulation-storage.ts"
Cohesion: 0.21
Nodes (16): SimulationContext, SimulationContextValue, SimulationProvider(), stopRuntime(), coerceEditableScenario(), StoredScenarioRecord, parseScenario(), canUseStorage() (+8 more)

### Community 49 - "simulation-import.tsx"
Cohesion: 0.18
Nodes (14): countPayloadStats(), getTocItemOffset(), SCHEMA_TOC_ITEMS, SchemaBreakdown(), SchemaDialog(), schemaFieldId(), SchemaTocItem, SimulationImport() (+6 more)

### Community 50 - "scenario-migration.ts"
Cohesion: 0.27
Nodes (11): isLegacyScenario(), mergeProfile(), migrateRetiredVehicleCategories(), migrateScenarioV1ToV2(), migrateVehicleCategory(), legacy, VEHICLE_CATEGORY_SET, normalizeScenario() (+3 more)

### Community 51 - "sea-router.test.ts"
Cohesion: 0.23
Nodes (11): SeaSeeds, FIXTURE_DIR, loadFixtureSource(), loadManifest(), ManifestEntry, SEEDS_PATH, waterFeaturesFor(), createFixtureFeatureSource() (+3 more)

## Knowledge Gaps
- **255 isolated node(s):** `$schema`, `style`, `rsc`, `tsx`, `config` (+250 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **18 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `createSeededRandom()` connect `demo-scenario.ts` to `target.ts`, `@tanstack/router-plugin`, `terrain.ts`?**
  _High betweenness centrality (0.059) - this node is a cross-community bridge._
- **Why does `SimulationEvent` connect `build-event-graph.ts` to `target.ts`, `demo-scenario.ts`, `simulation-engine.ts`, `scenario-migration.ts`, `postcss`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **Why does `VehicleCategory` connect `target.ts` to `demo-scenario.ts`, `simulation-engine.ts`, `map-location-picker.tsx`, `scenario-migration.ts`, `@tanstack/router-plugin`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `ScenarioBuilder()` (e.g. with `event()` and `profile()`) actually correct?**
  _`ScenarioBuilder()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `$schema`, `style`, `rsc` to the rest of the system?**
  _255 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `target.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.055658627087198514 - nodes in this community are weakly interconnected._
- **Should `map-data-provider.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.08888888888888889 - nodes in this community are weakly interconnected._