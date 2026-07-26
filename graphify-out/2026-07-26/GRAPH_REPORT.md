# Graph Report - adversary  (2026-07-26)

## Corpus Check
- 248 files · ~156,817 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1563 nodes · 2626 edges · 186 communities (84 shown, 102 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 15 edges (avg confidence: 0.56)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `79bd3298`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- event-generator.ts
- scenario-builder.tsx
- operations-dashboard.tsx
- map-data-provider.tsx
- devDependencies
- simulation-storage.ts
- scripts
- cn
- simulation-import.tsx
- dependencies
- simulation-engine.ts
- web/components.json
- compilerOptions
- ui/components.json
- env/package.json
- button.tsx
- loader.tsx
- ui/tsconfig.json
- dependencies
- compilerOptions
- event-generator.ts
- devDependencies
- attachment.tsx
- input-group.tsx
- a11y.helpers.ts
- build-event-graph.ts
- ui/package.json
- bubble.tsx
- exports
- generate.mjs
- marker.tsx
- config/package.json
- env/tsconfig.json
- tsconfig.json
- index.tsx
- tracking-map.tsx
- clsx
- lucide-react
- next-themes
- react-dom
- sonner
- tailwind-merge
- tw-animate-css
- MAP_STYLE
- web/vite.config.ts
- demo-scenario.ts
- @base-ui/react
- shadcn/ui
- ui/src/lib/utils.ts
- maplibre-gl
- next-themes
- Commands
- React Composition Patterns
- Adversary
- 5. Re-render Optimization
- @axe-core/playwright
- 7. JavaScript Performance
- Quick Reference
- Customization & Theming
- sonner
- Component Composition
- Styling & Customization
- scripts
- Tools
- 6. Rendering Performance
- React Composition Patterns
- 3. Server-Side Performance
- React Best Practices
- Locked decisions (map / route / ops plan)
- React Composition Patterns
- React Best Practices
- Sections
- builder-mirrored-panels.md
- Registry Authoring and Addresses
- Base vs Radix
- Chat & Messaging
- Implementation checklist
- Forms & Inputs
- 1. Eliminating Waterfalls
- 2. Bundle Size Optimization
- Sections
- generate-readme-images.mjs
- Icons
- 8. Advanced Patterns
- Web Interface Guidelines
- web/package.json
- fix-a11y-violation.md
- @tanstack/react-router
- async-cheap-condition-before-await.md
- Prefer Statically Analyzable Paths
- server-hoist-static-io.md
- generate-brand-icons.mjs
- architecture-avoid-boolean-props.md
- architecture-compound-components.md
- patterns-children-over-render-props.md
- patterns-explicit-variants.md
- react19-no-forwardref.md
- state-context-interface.md
- state-decouple-implementation.md
- state-lift-state.md
- vercel-composition-patterns/rules/_template.md
- advanced-effect-event-deps.md
- advanced-event-handler-refs.md
- advanced-init-once.md
- advanced-use-latest.md
- async-api-routes.md
- async-dependencies.md
- async-parallel.md
- async-suspense-boundaries.md
- bundle-barrel-imports.md
- bundle-conditional.md
- bundle-defer-third-party.md
- bundle-dynamic-imports.md
- bundle-preload.md
- client-event-listeners.md
- client-localstorage-schema.md
- client-passive-event-listeners.md
- client-swr-dedup.md
- js-batch-dom-css.md
- js-cache-function-results.md
- js-cache-property-access.md
- js-cache-storage.md
- js-combine-iterations.md
- js-early-exit.md
- js-flatmap-filter.md
- js-hoist-regexp.md
- js-index-maps.md
- js-length-check-first.md
- js-min-max-loop.md
- js-request-idle-callback.md
- js-set-map-lookups.md
- js-tosorted-immutable.md
- rendering-activity.md
- rendering-animate-svg-wrapper.md
- rendering-conditional-render.md
- rendering-content-visibility.md
- rendering-hoist-jsx.md
- rendering-hydration-no-flicker.md
- rendering-hydration-suppress-warning.md
- rendering-resource-hints.md
- rendering-script-defer-async.md
- rendering-svg-precision.md
- rendering-usetransition-loading.md
- rerender-defer-reads.md
- rerender-dependencies.md
- rerender-derived-state.md
- rerender-derived-state-no-effect.md
- rerender-functional-setstate.md
- rerender-lazy-state-init.md
- rerender-memo.md
- rerender-memo-with-default-value.md
- rerender-move-effect-to-event.md
- rerender-no-inline-components.md
- rerender-simple-expression-in-memo.md
- rerender-split-combined-hooks.md
- rerender-transitions.md
- rerender-use-deferred-value.md
- rerender-use-ref-transient-values.md
- server-after-nonblocking.md
- server-auth-actions.md
- server-cache-lru.md
- server-dedup-props.md
- server-parallel-fetching.md
- server-parallel-nested-fetching.md
- server-serialization.md
- vercel-react-best-practices/rules/_template.md
- workbox-window
- @xyflow/react
- workbox-window
- @xyflow/react
- zod
- cmdk

## God Nodes (most connected - your core abstractions)
1. `cn()` - 201 edges
2. `ScenarioBuilder()` - 29 edges
3. `Button()` - 22 edges
4. `SimulationEvent` - 19 edges
5. `sortEvents()` - 18 edges
6. `compilerOptions` - 18 edges
7. `createDemoScenario()` - 16 edges
8. `scripts` - 16 edges
9. `5. Re-render Optimization` - 16 edges
10. `SimulationScenario` - 15 edges

## Surprising Connections (you probably didn't know these)
- `MapPickerFallback()` --calls--> `cn()`  [EXTRACTED]
  apps/web/src/components/generate-route-form.tsx → packages/ui/src/lib/utils.ts
- `TimelineEventShell()` --calls--> `cn()`  [EXTRACTED]
  apps/web/src/components/grouped-timeline-event.tsx → packages/ui/src/lib/utils.ts
- `BrandMark()` --calls--> `cn()`  [EXTRACTED]
  apps/web/src/components/brand-mark.tsx → packages/ui/src/lib/utils.ts
- `EventGraphNodeView()` --calls--> `cn()`  [EXTRACTED]
  apps/web/src/components/event-graph-node.tsx → packages/ui/src/lib/utils.ts
- `GenerateRouteForm()` --calls--> `cn()`  [EXTRACTED]
  apps/web/src/components/generate-route-form.tsx → packages/ui/src/lib/utils.ts

## Import Cycles
- None detected.

## Communities (186 total, 102 thin omitted)

### Community 0 - "event-generator.ts"
Cohesion: 0.11
Nodes (19): DEFAULT_POSITION, EditTimelineEvent(), EditTimelineEventProps, issuesForField(), TimelineEventShell(), TimelineEventShellProps, ViewTimelineEvent(), ViewTimelineEventProps (+11 more)

### Community 1 - "scenario-builder.tsx"
Cohesion: 0.06
Nodes (42): MapDataContext, MapDataContextValue, MapDataProvider(), resolveColorScheme(), useMapData(), getDevtoolsEnabled(), RouterDevtoolsGate(), subscribeToDevtoolsFlag() (+34 more)

### Community 2 - "operations-dashboard.tsx"
Cohesion: 0.12
Nodes (20): getTocItemOffset(), SCHEMA_TOC_ITEMS, SchemaBreakdown(), schemaFieldId(), SchemaTocItem, slugifySchemaHeading(), UploadState, Dialog() (+12 more)

### Community 3 - "map-data-provider.tsx"
Cohesion: 0.09
Nodes (43): blankScenario(), describeEvent(), focusElementById(), ScenarioBuilder(), countPayloadStats(), SimulationImport(), AFFILIATION_COLORS, AFFILIATION_SET (+35 more)

### Community 4 - "devDependencies"
Cohesion: 0.05
Nodes (37): devDependencies, @adversary/config, @axe-core/playwright, fake-indexeddb, @playwright/test, postcss, sharp, tailwindcss (+29 more)

### Community 5 - "simulation-storage.ts"
Cohesion: 0.07
Nodes (63): SimulationContext, SimulationContextValue, SimulationProvider(), clampPreviewTimeMs(), computePreviewRevision(), getPreviewRangeMs(), getPreviewStartMs(), isLegacyScenario() (+55 more)

### Community 6 - "scripts"
Cohesion: 0.05
Nodes (43): dependencies, @adversary/env, dotenv, zod, devDependencies, @adversary/config, rolldown, @types/node (+35 more)

### Community 7 - "cn"
Cohesion: 0.05
Nodes (50): AlertDialogAction(), AlertDialogCancel(), AlertDialogContent(), AlertDialogDescription(), AlertDialogFooter(), AlertDialogHeader(), AlertDialogMedia(), AlertDialogOverlay() (+42 more)

### Community 8 - "simulation-import.tsx"
Cohesion: 0.13
Nodes (20): defaultEndPoint(), FieldErrors, GenerateRouteForm(), isValidCoordinate(), MapLocationPicker, MapPickerFallback(), validateRouteForm(), Field() (+12 more)

### Community 9 - "dependencies"
Cohesion: 0.15
Nodes (13): @adversary/ui, dependencies, @adversary/ui, @hookform/resolvers, idb, react, react-hook-form, @tailwindcss/vite (+5 more)

### Community 11 - "simulation-engine.ts"
Cohesion: 0.18
Nodes (10): ButtonGroup(), ButtonGroupSeparator(), ButtonGroupText(), buttonGroupVariants, Separator(), ToggleGroup(), ToggleGroupContext, ToggleGroupItem() (+2 more)

### Community 12 - "web/components.json"
Cohesion: 0.09
Nodes (21): aliases, components, hooks, lib, ui, utils, iconLibrary, menuAccent (+13 more)

### Community 14 - "compilerOptions"
Cohesion: 0.09
Nodes (21): compilerOptions, allowSyntheticDefaultImports, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, lib, module, moduleResolution (+13 more)

### Community 15 - "ui/components.json"
Cohesion: 0.09
Nodes (21): aliases, components, hooks, lib, ui, utils, iconLibrary, menuAccent (+13 more)

### Community 16 - "env/package.json"
Cohesion: 0.09
Nodes (22): dependencies, dotenv, @t3-oss/env-core, zod, devDependencies, @adversary/config, @types/node, typescript (+14 more)

### Community 17 - "button.tsx"
Cohesion: 0.18
Nodes (15): DateTimePicker(), DateTimePickerProps, parseValue(), PRESETS, toLocalInputValue(), Button(), buttonVariants, Calendar() (+7 more)

### Community 18 - "loader.tsx"
Cohesion: 0.13
Nodes (11): Loader(), Register, rootElement, router, @tanstack/react-router, Route, SimulationImport, Route (+3 more)

### Community 19 - "ui/tsconfig.json"
Cohesion: 0.11
Nodes (17): compilerOptions, jsx, lib, paths, types, exclude, extends, include (+9 more)

### Community 21 - "dependencies"
Cohesion: 0.12
Nodes (17): @base-ui/react, class-variance-authority, @fontsource-variable/inter, dependencies, @base-ui/react, class-variance-authority, date-fns, @fontsource-variable/inter (+9 more)

### Community 22 - "compilerOptions"
Cohesion: 0.12
Nodes (15): compilerOptions, esModuleInterop, jsx, module, moduleResolution, paths, rootDirs, skipLibCheck (+7 more)

### Community 23 - "event-generator.ts"
Cohesion: 0.67
Nodes (5): die(), log(), need_cmd(), rewrite_style(), collect-map-tiles.sh script

### Community 25 - "devDependencies"
Cohesion: 0.15
Nodes (13): devDependencies, @adversary/config, tailwindcss, @tailwindcss/postcss, @types/react, @types/react-dom, typescript, @adversary/config (+5 more)

### Community 26 - "attachment.tsx"
Cohesion: 0.09
Nodes (28): BrandMark(), Header(), ModeToggle(), MapLocationPicker, PreviewEventGraph, TrackingMap, useSimulation(), Accordion() (+20 more)

### Community 27 - "input-group.tsx"
Cohesion: 0.09
Nodes (32): matchesTargetSearch(), TargetRoster(), targetSearchFields(), TrackedTargetCard(), TrackingMap, getVehicleCategoryIcon(), Card(), CardAction() (+24 more)

### Community 28 - "a11y.helpers.ts"
Cohesion: 0.25
Nodes (9): assertNoWcag21AaViolations(), ColorScheme, FormattedViolation, formatViolations(), setColorScheme(), WCAG_21_AA_TAGS, MAP_EXCLUDE, routes (+1 more)

### Community 29 - "build-event-graph.ts"
Cohesion: 0.07
Nodes (45): TimedEventEdgeView(), EventGraphNodeView(), KIND_BADGE, KIND_COLOR, KIND_LABEL, GenerateRouteFormProps, eventPayloadBadges(), eventSummary() (+37 more)

### Community 30 - "ui/package.json"
Cohesion: 0.29
Nodes (6): name, private, scripts, check-types, type, version

### Community 31 - "bubble.tsx"
Cohesion: 0.38
Nodes (6): Bubble(), BubbleContent(), BubbleGroup(), BubbleReactions(), bubbleReactionsVariants, bubbleVariants

### Community 32 - "exports"
Cohesion: 0.33
Nodes (6): exports, ./components/*, ./globals.css, ./hooks/*, ./lib/*, ./postcss.config

### Community 33 - "generate.mjs"
Cohesion: 0.40
Nodes (4): __dir, files, outDir, srcDir

### Community 35 - "config/package.json"
Cohesion: 0.50
Nodes (3): name, private, version

### Community 36 - "env/tsconfig.json"
Cohesion: 0.29
Nodes (6): compilerOptions, types, extends, @adversary/config/tsconfig.base.json, node, vite/client

### Community 39 - "tracking-map.tsx"
Cohesion: 0.08
Nodes (35): buildNeighborCollection(), buildTrailCollection(), CompanionMapPoint, createCompanionPointElement(), createEventPointElement(), EMPTY_TRAIL, ensureLineLayer(), ensureOverlayLayers() (+27 more)

### Community 56 - "demo-scenario.ts"
Cohesion: 0.05
Nodes (80): SchemaDialog(), atOffset(), CALLSIGN_PREFIXES, clamp(), createDemoScenario(), CreateDemoScenarioOptions, defaultTargetProfile(), DEMO_COLORS (+72 more)

### Community 59 - "shadcn/ui"
Cohesion: 0.11
Nodes (19): Chat & Messaging → [chat.md](./rules/chat.md), CLI, Component Docs, Examples, and Usage, Component Selection, Component Structure → [composition.md](./rules/composition.md), Critical Rules, Current Project Context, Detailed References (+11 more)

### Community 63 - "Commands"
Cohesion: 0.12
Nodes (17): `add` — Add components, `apply` — Apply a preset to an existing project, `build` — Build a custom registry, Commands, Contents, `diff` — Check for updates, `docs` — Get component documentation URLs, Dry-Run Mode (+9 more)

### Community 64 - "React Composition Patterns"
Cohesion: 0.12
Nodes (16): 1.1 Avoid Boolean Prop Proliferation, 1.2 Use Compound Components, 1. Component Architecture, 2.1 Decouple State Management from UI, 2.2 Define Generic Context Interfaces for Dependency Injection, 2.3 Lift State into Provider Components, 2. State Management, 3.1 Create Explicit Component Variants (+8 more)

### Community 65 - "Adversary"
Cohesion: 0.11
Nodes (18): 1. Start a simulation, 2. Run the operations console, 3. Author or import scenarios, 4. Map styles & environment, Adversary, Available scripts, Capabilities, Collect map tiles (+10 more)

### Community 66 - "5. Re-render Optimization"
Cohesion: 0.12
Nodes (16): 5.10 Subscribe to Derived State, 5.11 Use Functional setState Updates, 5.12 Use Lazy State Initialization, 5.13 Use Transitions for Non-Urgent Updates, 5.14 Use useDeferredValue for Expensive Derived Renders, 5.15 Use useRef for Transient Values, 5.1 Calculate Derived State During Rendering, 5.2 Defer State Reads to Usage Point (+8 more)

### Community 68 - "7. JavaScript Performance"
Cohesion: 0.13
Nodes (15): 7.10 Hoist RegExp Creation, 7.11 Use flatMap to Map and Filter in One Pass, 7.12 Use Loop for Min/Max Instead of Sort, 7.13 Use Set/Map for O(1) Lookups, 7.14 Use toSorted() Instead of sort() for Immutability, 7.1 Avoid Layout Thrashing, 7.2 Build Index Maps for Repeated Lookups, 7.3 Cache Property Access in Loops (+7 more)

### Community 69 - "Quick Reference"
Cohesion: 0.13
Nodes (14): 1. Eliminating Waterfalls (CRITICAL), 2. Bundle Size Optimization (CRITICAL), 3. Server-Side Performance (HIGH), 4. Client-Side Data Fetching (MEDIUM-HIGH), 5. Re-render Optimization (MEDIUM), 6. Rendering Performance (MEDIUM), 7. JavaScript Performance (LOW-MEDIUM), 8. Advanced Patterns (LOW) (+6 more)

### Community 70 - "Customization & Theming"
Cohesion: 0.14
Nodes (14): 1. Built-in variants, 2. Tailwind classes via `className`, 3. Add a new variant, 4. Wrapper components, Adding Custom Colors, Border Radius, Changing the Theme, Checking for Updates (+6 more)

### Community 72 - "Component Composition"
Cohesion: 0.15
Nodes (13): Avatar always needs AvatarFallback, Button has no isPending or isLoading prop, Callouts use Alert, Card structure, Choosing between overlay components, Component Composition, Contents, Dialog, Sheet, and Drawer always need a Title (+5 more)

### Community 73 - "Styling & Customization"
Cohesion: 0.15
Nodes (13): Built-in variants first, className for layout only, Contents, No manual dark: color overrides, No manual z-index on overlay components, No raw color values for status/state indicators, No space-x-_ / space-y-_, Prefer size-_ over w-_ h-\* when equal (+5 more)

### Community 74 - "scripts"
Cohesion: 0.15
Nodes (13): scripts, build, check-types, dev, generate-icons, generate-readme-images, serve, start (+5 more)

### Community 75 - "Tools"
Cohesion: 0.17
Nodes (11): Configuring Registries, Setup, `shadcn:get_add_command_for_items`, `shadcn:get_audit_checklist`, `shadcn:get_item_examples_from_registries`, `shadcn:get_project_registries`, `shadcn:list_items_in_registries`, shadcn MCP Server (+3 more)

### Community 76 - "6. Rendering Performance"
Cohesion: 0.17
Nodes (12): 6.10 Use React DOM Resource Hints, 6.11 Use useTransition Over Manual Loading States, 6.1 Animate SVG Wrapper Instead of SVG Element, 6.2 CSS content-visibility for Long Lists, 6.3 Hoist Static JSX Elements, 6.4 Optimize SVG Precision, 6.5 Prevent Hydration Mismatch Without Flickering, 6.6 Suppress Expected Hydration Mismatches (+4 more)

### Community 77 - "React Composition Patterns"
Cohesion: 0.18
Nodes (10): 1. Component Architecture (HIGH), 2. State Management (MEDIUM), 3. Implementation Patterns (MEDIUM), 4. React 19 APIs (MEDIUM), Full Compiled Document, How to Use, Quick Reference, React Composition Patterns (+2 more)

### Community 78 - "3. Server-Side Performance"
Cohesion: 0.18
Nodes (10): 3.10 Use after() for Non-Blocking Operations, 3.1 Authenticate Server Actions Like API Routes, 3.2 Avoid Duplicate Serialization in RSC Props, 3.3 Avoid Shared Module State for Request Data, 3.4 Cross-Request LRU Caching, 3.5 Hoist Static I/O to Module Level, 3.6 Minimize Serialization at RSC Boundaries, 3.7 Parallel Data Fetching with Component Composition (+2 more)

### Community 79 - "React Best Practices"
Cohesion: 0.18
Nodes (10): Acknowledgments, Contributing, Creating a New Rule, File Naming Convention, Getting Started, Impact Levels, React Best Practices, Rule File Structure (+2 more)

### Community 80 - "Locked decisions (map / route / ops plan)"
Cohesion: 0.18
Nodes (10): Camera (`TrackingMap`), Generate route, Locked decisions (map / route / ops plan), Map controls, Markers, Ops cleanup, Ops roster / detail, Rail — full delete (+2 more)

### Community 81 - "React Composition Patterns"
Cohesion: 0.20
Nodes (9): Component Architecture (CRITICAL), Core Principles, Creating a New Rule, Impact Levels, Implementation Patterns (MEDIUM), React Composition Patterns, Rules, State Management (HIGH) (+1 more)

### Community 82 - "React Best Practices"
Cohesion: 0.20
Nodes (9): 4.1 Deduplicate Global Event Listeners, 4.2 Use Passive Event Listeners for Scrolling Performance, 4.3 Use SWR for Automatic Deduplication, 4.4 Version and Minimize localStorage Data, 4. Client-Side Data Fetching, Abstract, React Best Practices, References (+1 more)

### Community 83 - "Sections"
Cohesion: 0.20
Nodes (9): 1. Eliminating Waterfalls (async), 2. Bundle Size Optimization (bundle), 3. Server-Side Performance (server), 4. Client-Side Data Fetching (client), 5. Re-render Optimization (rerender), 6. Rendering Performance (rendering), 7. JavaScript Performance (js), 8. Advanced Patterns (advanced) (+1 more)

### Community 84 - "builder-mirrored-panels.md"
Cohesion: 0.20
Nodes (9): Chrome, Event (Compose right), Hard constraints, Locked UI decisions, Out of scope, Review, Sources of truth, Targets (Compose left) (+1 more)

### Community 86 - "Registry Authoring and Addresses"
Cohesion: 0.22
Nodes (9): Address Schemes, Build and Verify, GitHub Registries, Include, Item Definitions, Mental Model, Registry Authoring and Addresses, Registry Dependencies (+1 more)

### Community 87 - "Base vs Radix"
Cohesion: 0.22
Nodes (9): Accordion, Base vs Radix, Button / trigger as non-button element (base only), Composition: asChild (radix) vs render (base), Contents, Select, Select — multiple selection and object values (base only), Slider (+1 more)

### Community 88 - "Chat & Messaging"
Cohesion: 0.22
Nodes (9): Attachments use Attachment, Chat & Messaging, Contents, Escape hatch: the scroller hooks, Message rows use Message, Message surfaces use Bubble, Scrollable threads use MessageScroller, Streaming, anchoring, and jump-to-latest are built in (+1 more)

### Community 89 - "Implementation checklist"
Cohesion: 0.22
Nodes (8): 1. Tokens + ops CSS, 2. Theme-aware online map, 3. Browser chrome sync, 4. Accessibility e2e, Implementation checklist, Locked decisions, Out of scope, Workflow

### Community 90 - "Forms & Inputs"
Cohesion: 0.25
Nodes (8): Buttons inside inputs use InputGroup + InputGroupAddon, Contents, Field validation and disabled states, FieldSet + FieldLegend for grouping related fields, Forms & Inputs, Forms use FieldGroup + Field, InputGroup requires InputGroupInput/InputGroupTextarea, Option sets (2–7 choices) use ToggleGroup

### Community 91 - "1. Eliminating Waterfalls"
Cohesion: 0.29
Nodes (7): 1.1 Check Cheap Conditions Before Async Flags, 1.2 Defer Await Until Needed, 1.3 Dependency-Based Parallelization, 1.4 Prevent Waterfall Chains in API Routes, 1.5 Promise.all() for Independent Operations, 1.6 Strategic Suspense Boundaries, 1. Eliminating Waterfalls

### Community 92 - "2. Bundle Size Optimization"
Cohesion: 0.29
Nodes (7): 2.1 Avoid Barrel File Imports, 2.2 Conditional Module Loading, 2.3 Defer Non-Critical Third-Party Libraries, 2.4 Dynamic Imports for Heavy Components, 2.5 Prefer Statically Analyzable Paths, 2.6 Preload Based on User Intent, 2. Bundle Size Optimization

### Community 93 - "Sections"
Cohesion: 0.33
Nodes (5): 1. Component Architecture (architecture), 2. State Management (state), 3. Implementation Patterns (patterns), 4. React 19 APIs (react19), Sections

### Community 94 - "generate-readme-images.mjs"
Cohesion: 0.40
Nodes (5): __dir, jobs, mark(), markBadge(), outDir

### Community 95 - "Icons"
Cohesion: 0.40
Nodes (4): Icons, Icons in Button use data-icon attribute, No sizing classes on icons inside components, Pass icons as component objects, not string keys

### Community 96 - "8. Advanced Patterns"
Cohesion: 0.40
Nodes (5): 8.1 Do Not Put Effect Events in Dependency Arrays, 8.2 Initialize App Once, Not Per Mount, 8.3 Store Event Handlers in Refs, 8.4 useEffectEvent for Stable Callback Refs, 8. Advanced Patterns

### Community 97 - "Web Interface Guidelines"
Cohesion: 0.40
Nodes (4): Guidelines Source, How It Works, Usage, Web Interface Guidelines

### Community 98 - "web/package.json"
Cohesion: 0.40
Nodes (4): name, private, type, version

### Community 99 - "fix-a11y-violation.md"
Cohesion: 0.40
Nodes (4): Common axe → fix map, Fix principles, Output format, When invoked

### Community 102 - "Prefer Statically Analyzable Paths"
Cohesion: 0.50
Nodes (3): File-System Paths, Import Paths, Prefer Statically Analyzable Paths

## Knowledge Gaps
- **673 isolated node(s):** `$schema`, `style`, `rsc`, `tsx`, `config` (+668 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **102 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `cn()` connect `cn` to `event-generator.ts`, `scenario-builder.tsx`, `operations-dashboard.tsx`, `map-data-provider.tsx`, `tracking-map.tsx`, `simulation-import.tsx`, `simulation-engine.ts`, `button.tsx`, `attachment.tsx`, `input-group.tsx`, `build-event-graph.ts`, `bubble.tsx`?**
  _High betweenness centrality (0.051) - this node is a cross-community bridge._
- **Why does `Loader()` connect `loader.tsx` to `attachment.tsx`?**
  _High betweenness centrality (0.008) - this node is a cross-community bridge._
- **Why does `Button()` connect `button.tsx` to `event-generator.ts`, `scenario-builder.tsx`, `operations-dashboard.tsx`, `tracking-map.tsx`, `simulation-import.tsx`, `cn`, `attachment.tsx`, `input-group.tsx`, `build-event-graph.ts`?**
  _High betweenness centrality (0.004) - this node is a cross-community bridge._
- **What connects `$schema`, `style`, `rsc` to the rest of the system?**
  _673 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `event-generator.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.11 - nodes in this community are weakly interconnected._
- **Should `scenario-builder.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.05669199298655757 - nodes in this community are weakly interconnected._
- **Should `operations-dashboard.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.12307692307692308 - nodes in this community are weakly interconnected._