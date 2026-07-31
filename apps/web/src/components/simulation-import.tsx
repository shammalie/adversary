import { Badge } from "@adversary/ui/components/badge";
import { Button } from "@adversary/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@adversary/ui/components/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@adversary/ui/components/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@adversary/ui/components/tabs";
import { cn } from "@adversary/ui/lib/utils";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  BookOpenIcon,
  FileJsonIcon,
  RadioIcon,
  UploadCloudIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { useSimulation } from "@/components/simulation-provider";
import { useImportScenarioMutation } from "@/hooks/use-scenarios";
import {
  getExampleScenarioJson,
  SCHEMA_CONSTRAINTS,
  SCHEMA_DOC_SECTIONS,
} from "@/lib/simulation-schema-docs";
import { getScenarioValidationIssues } from "@/lib/scenario-validation-ui";
import { validateScenario } from "@/lib/simulation-schema";

type UploadState = "idle" | "drag-over" | "processing" | "done" | "error";

type SchemaTocItem = {
  id: string;
  title: string;
  depth: 0 | 1;
};

const CROSS_FIELD_RULES_ID = "cross-field-rules";

const SCHEMA_TOC_ITEMS: SchemaTocItem[] = [
  ...SCHEMA_DOC_SECTIONS.flatMap((section) => {
    const sectionId = slugifySchemaHeading(section.title);
    return [
      { id: sectionId, title: section.title, depth: 0 as const },
      ...section.fields.map((field) => ({
        id: schemaFieldId(sectionId, field.name),
        title: field.name,
        depth: 1 as const,
      })),
    ];
  }),
  { id: CROSS_FIELD_RULES_ID, title: "Cross-field rules", depth: 0 },
];

function slugifySchemaHeading(title: string) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function schemaFieldId(sectionId: string, fieldName: string) {
  return `${sectionId}-${slugifySchemaHeading(fieldName)}`;
}

/** Horizontal offset of the TOC track line by nesting depth (clerk-style). */
function getTocLineOffset(depth: 0 | 1) {
  return depth === 0 ? 2 : 12;
}

/** Text padding so labels sit clear of the stepped track. */
function getTocItemOffset(depth: 0 | 1) {
  return depth === 0 ? 14 : 28;
}

function countPayloadStats(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return { targets: 0, events: 0 };
  }
  const record = payload as { targets?: unknown; events?: unknown };
  return {
    targets: Array.isArray(record.targets) ? record.targets.length : 0,
    events: Array.isArray(record.events) ? record.events.length : 0,
  };
}

export function SimulationImport() {
  const navigate = useNavigate();
  const { runtime } = useSimulation();
  const importScenario = useImportScenarioMutation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [lastRecordId, setLastRecordId] = useState<string | null>(null);
  const [lastPayload, setLastPayload] = useState<unknown>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  async function handleFile(file?: File) {
    if (!file) return;
    setUploadState("processing");
    setParseError(null);

    try {
      const text = await file.text();
      const payload = JSON.parse(text) as unknown;
      const record = await importScenario.mutateAsync(payload);
      const validation = validateScenario(payload);
      const issues = getScenarioValidationIssues(payload);
      const stats = countPayloadStats(payload);

      setLastRecordId(record.id);
      setLastPayload(payload);
      setUploadState("done");

      if (validation.success) {
        toast.success("Simulation imported to the server and ready to play.");
      } else {
        toast.warning(
          `Imported as draft with ${issues.length} validation issue(s).`,
        );
      }

      void stats;
    } catch (error) {
      setUploadState("error");
      setLastRecordId(null);
      setLastPayload(null);
      setParseError(
        error instanceof Error ? error.message : "Could not read that file.",
      );
      toast.error(error instanceof Error ? error.message : "Import failed.");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const validation = lastPayload ? validateScenario(lastPayload) : null;
  const issues = lastPayload ? getScenarioValidationIssues(lastPayload) : [];
  const stats = lastPayload ? countPayloadStats(lastPayload) : null;
  const displayName =
    lastPayload && typeof lastPayload === "object" && "name" in lastPayload
      ? String((lastPayload as { name?: unknown }).name ?? "Untitled import")
      : "Untitled import";

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6 sm:p-8">
      <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            Import simulation
          </h1>
          <p className="text-sm text-muted-foreground">
            Upload a scenario JSON file. Valid files are ready for the builder;
            invalid files are saved as drafts you can fix before starting.
          </p>
        </div>
        {runtime?.status === "running" ? (
          <Button variant="secondary" render={<Link to="/operations" />}>
            <RadioIcon data-icon="inline-start" />
            View live simulation
          </Button>
        ) : null}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Upload file</CardTitle>
          <CardDescription>
            Accepts `.json` scenario exports from this app or compatible tools.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <input
            ref={inputRef}
            className="sr-only"
            type="file"
            accept=".json,application/json"
            aria-label="Upload simulation JSON file"
            onChange={(event) => void handleFile(event.target.files?.[0])}
          />

          <button
            type="button"
            className={cn(
              "flex min-h-44 flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-8 text-center transition-colors",
              uploadState === "drag-over"
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/40 hover:bg-muted/30",
            )}
            onClick={() => inputRef.current?.click()}
            onDragOver={(event) => {
              event.preventDefault();
              setUploadState("drag-over");
            }}
            onDragLeave={() =>
              setUploadState((current) =>
                current === "drag-over" ? "idle" : current,
              )
            }
            onDrop={(event) => {
              event.preventDefault();
              setUploadState("idle");
              const file = event.dataTransfer.files[0];
              void handleFile(file);
            }}
          >
            <span className="grid size-12 place-items-center rounded-full bg-muted">
              <UploadCloudIcon
                className="size-6 text-muted-foreground"
                aria-hidden="true"
              />
            </span>
            <div>
              <p className="text-sm font-medium">
                Drop a JSON file here, or click to browse
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {uploadState === "processing"
                  ? "Reading file…"
                  : "Draft imports are stored in this browser."}
              </p>
            </div>
          </button>

          {parseError ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {parseError}
            </p>
          ) : null}

          {lastRecordId && lastPayload ? (
            <Card className="border-primary/20 bg-muted/20">
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-base">{displayName}</CardTitle>
                  <Badge
                    variant={validation?.success ? "secondary" : "outline"}
                  >
                    {validation?.success
                      ? "Ready"
                      : `Draft — ${issues.length} issue(s)`}
                  </Badge>
                </div>
                <CardDescription>
                  {stats?.targets ?? 0} targets · {stats?.events ?? 0} events
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {!validation?.success && issues.length > 0 ? (
                  <ul className="max-h-36 space-y-1 overflow-y-auto rounded-md border bg-background/80 p-3 text-xs text-muted-foreground scrollbar-thin">
                    {issues.slice(0, 8).map((issue) => (
                      <li key={`${issue.path}-${issue.message}`}>
                        <span className="font-mono text-foreground">
                          {issue.path}
                        </span>
                        : {issue.message}
                      </li>
                    ))}
                    {issues.length > 8 ? (
                      <li>…and {issues.length - 8} more in the builder.</li>
                    ) : null}
                  </ul>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() =>
                      void navigate({
                        to: "/builder",
                        search: { scenarioId: lastRecordId },
                      })
                    }
                  >
                    Open in builder
                  </Button>
                  <SchemaDialog />
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="flex justify-end">
              <SchemaDialog />
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-center text-xs text-muted-foreground">
        Need to author from scratch? Use{" "}
        <Link
          to="/builder"
          className="text-foreground underline-offset-4 hover:underline"
        >
          Simulation builder
        </Link>{" "}
        in Settings.
      </p>
    </main>
  );
}

function SchemaDialog() {
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" />}>
        <BookOpenIcon data-icon="inline-start" />
        View schema
      </DialogTrigger>
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col overflow-hidden sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Simulation schema</DialogTitle>
          <DialogDescription>
            Reference for building compatible scenario JSON files.
          </DialogDescription>
        </DialogHeader>
        <Tabs
          defaultValue="example"
          className="flex min-h-0 flex-1 flex-col gap-4"
        >
          <TabsList>
            <TabsTrigger value="example">
              <FileJsonIcon data-icon="inline-start" />
              Example
            </TabsTrigger>
            <TabsTrigger value="schema">Schema breakdown</TabsTrigger>
          </TabsList>
          <TabsContent value="example" className="min-h-0 overflow-hidden">
            <pre
              tabIndex={0}
              className="max-h-[55vh] overflow-auto rounded-lg border bg-muted/30 p-4 text-xs leading-relaxed scrollbar-thin scroll-fade outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {getExampleScenarioJson()}
            </pre>
          </TabsContent>
          <TabsContent value="schema" className="min-h-0 overflow-hidden">
            <SchemaBreakdown />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function SchemaBreakdown() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const tocListRef = useRef<HTMLDivElement>(null);
  const linkRefs = useRef(new Map<string, HTMLButtonElement>());
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const ignoreScrollSpyRef = useRef(false);
  const [activeId, setActiveId] = useState<string>(SCHEMA_TOC_ITEMS[0].id);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [thumb, setThumb] = useState({ top: 0, height: 0, visible: false });
  const [trackSvg, setTrackSvg] = useState<{
    d: string;
    width: number;
    height: number;
  } | null>(null);

  useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current)
        clearTimeout(highlightTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;

    function updateActiveFromScroll() {
      if (!root || ignoreScrollSpyRef.current) return;
      const rootRect = root.getBoundingClientRect();
      const maxScroll = root.scrollHeight - root.clientHeight;
      // Move the activation line down as we approach the bottom so later
      // headings can become active even when they can't scroll to the top.
      const scrollRatio = maxScroll > 0 ? root.scrollTop / maxScroll : 0;
      const offset = 24 + scrollRatio * Math.max(root.clientHeight - 48, 0);
      let nextId = SCHEMA_TOC_ITEMS[0].id;

      for (const item of SCHEMA_TOC_ITEMS) {
        const target = root.querySelector<HTMLElement>(
          `#${CSS.escape(item.id)}`,
        );
        if (!target) continue;
        if (target.getBoundingClientRect().top - rootRect.top <= offset) {
          nextId = item.id;
        }
      }

      setActiveId((current) => (current === nextId ? current : nextId));
    }

    updateActiveFromScroll();
    root.addEventListener("scroll", updateActiveFromScroll, { passive: true });
    return () => root.removeEventListener("scroll", updateActiveFromScroll);
  }, []);

  useEffect(() => {
    const list = tocListRef.current;
    if (!list) return;

    function rebuildTrack() {
      if (!list || list.clientHeight === 0) return;

      let width = 0;
      let height = 0;
      let upperBottom = 0;
      let path = "";

      for (let index = 0; index < SCHEMA_TOC_ITEMS.length; index++) {
        const item = SCHEMA_TOC_ITEMS[index];
        const element = linkRefs.current.get(item.id);
        if (!element) continue;

        const styles = getComputedStyle(element);
        const x = getTocLineOffset(item.depth) + 0.5;
        const top = element.offsetTop + parseFloat(styles.paddingTop);
        const bottom =
          element.offsetTop +
          element.clientHeight -
          parseFloat(styles.paddingBottom);

        width = Math.max(x + 0.5, width);
        height = Math.max(height, bottom);

        if (index === 0) {
          path += ` M${x} ${top} L${x} ${bottom}`;
        } else {
          const upperX =
            getTocLineOffset(SCHEMA_TOC_ITEMS[index - 1].depth) + 0.5;
          path += ` C ${upperX} ${top - 4} ${x} ${upperBottom + 4} ${x} ${top} L${x} ${bottom}`;
        }

        upperBottom = bottom;
      }

      setTrackSvg({ d: path, width: width + 1, height });
    }

    rebuildTrack();
    const observer = new ResizeObserver(rebuildTrack);
    observer.observe(list);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const list = tocListRef.current;
    if (!list) return;

    function updateThumb() {
      const link = linkRefs.current.get(activeId);
      if (!link || link.offsetHeight === 0) {
        setThumb((current) => ({ ...current, visible: false }));
        return;
      }

      const styles = getComputedStyle(link);
      const top = link.offsetTop + parseFloat(styles.paddingTop);
      const bottom =
        link.offsetTop + link.clientHeight - parseFloat(styles.paddingBottom);

      setThumb({
        top,
        height: Math.max(bottom - top, 0),
        visible: true,
      });
    }

    updateThumb();
    const observer = new ResizeObserver(updateThumb);
    observer.observe(list);
    return () => observer.disconnect();
  }, [activeId]);

  function flashHighlight(id: string) {
    setHighlightedId(id);
    if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
    highlightTimeoutRef.current = setTimeout(() => {
      setHighlightedId(null);
      highlightTimeoutRef.current = null;
    }, 1600);
  }

  function scrollToSection(id: string) {
    const root = scrollRef.current;
    const target = root?.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
    if (!root || !target) return;

    setActiveId(id);
    flashHighlight(id);
    ignoreScrollSpyRef.current = true;
    const top =
      root.scrollTop +
      (target.getBoundingClientRect().top - root.getBoundingClientRect().top);
    root.scrollTo({ top, behavior: "smooth" });

    window.setTimeout(() => {
      ignoreScrollSpyRef.current = false;
    }, 500);
  }

  return (
    <div className="flex max-h-[55vh] min-h-0 gap-6">
      <div
        ref={scrollRef}
        tabIndex={0}
        className="min-h-0 min-w-0 flex-1 overflow-y-auto pr-1 scrollbar-thin scroll-fade-b overscroll-contain scrollbar-gutter-stable outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <div className="flex flex-col gap-4 p-1.5">
          {SCHEMA_DOC_SECTIONS.map((section) => {
            const sectionId = slugifySchemaHeading(section.title);
            return (
              <section
                key={section.title}
                id={sectionId}
                className={cn(
                  "flex scroll-mt-3 flex-col gap-2 rounded-lg p-1 transition-[box-shadow,background-color] duration-300",
                  highlightedId === sectionId &&
                    "bg-primary/5 ring-2 ring-primary/40",
                )}
              >
                <div className="flex flex-col gap-1">
                  <h3 className="text-sm font-semibold">{section.title}</h3>
                  {section.notes ? (
                    <p className="text-xs text-muted-foreground">{section.notes}</p>
                  ) : null}
                </div>
                <ul className="flex flex-col gap-2 text-sm">
                  {section.fields.map((field) => {
                    const fieldId = schemaFieldId(sectionId, field.name);
                    return (
                      <li
                        key={`${section.title}-${field.name}`}
                        id={fieldId}
                        className={cn(
                          "scroll-mt-3 rounded-md border px-3 py-2 transition-[border-color,box-shadow,background-color] duration-300",
                          highlightedId === fieldId
                            ? "border-primary bg-primary/5 ring-2 ring-primary/35"
                            : "border-border",
                        )}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <code className="text-xs">{field.name}</code>
                          <Badge variant="outline">{field.type}</Badge>
                          {field.required ? (
                            <Badge variant="secondary">required</Badge>
                          ) : null}
                        </div>
                        {field.notes ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {field.notes}
                          </p>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
          <section
            id={CROSS_FIELD_RULES_ID}
            className={cn(
              "flex scroll-mt-3 flex-col gap-2 rounded-lg p-1 transition-[box-shadow,background-color] duration-300",
              highlightedId === CROSS_FIELD_RULES_ID &&
                "bg-primary/5 ring-2 ring-primary/40",
            )}
          >
            <h3 className="text-sm font-semibold">Cross-field rules</h3>
            <ul className="list-disc pl-5 text-sm text-muted-foreground [&>li+li]:mt-1">
              {SCHEMA_CONSTRAINTS.map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ul>
          </section>
        </div>
      </div>

      <nav
        aria-label="Schema sections"
        className="sticky top-0 hidden max-h-[55vh] w-56 shrink-0 self-start overflow-y-auto scrollbar-thin overscroll-contain md:block"
      >
        <p className="mb-2 text-xs font-medium text-muted-foreground">
          On this page
        </p>
        <div ref={tocListRef} className="relative">
          {trackSvg ? (
            <>
              <svg
                aria-hidden="true"
                xmlns="http://www.w3.org/2000/svg"
                viewBox={`0 0 ${trackSvg.width} ${trackSvg.height}`}
                className="pointer-events-none absolute top-0 left-0"
                style={{ width: trackSvg.width, height: trackSvg.height }}
              >
                <path
                  d={trackSvg.d}
                  fill="none"
                  strokeWidth="1"
                  className="stroke-foreground/15"
                />
              </svg>
              <svg
                aria-hidden="true"
                xmlns="http://www.w3.org/2000/svg"
                viewBox={`0 0 ${trackSvg.width} ${trackSvg.height}`}
                className="pointer-events-none absolute top-0 left-0 transition-[clip-path,opacity] duration-200 ease-out"
                style={{
                  width: trackSvg.width,
                  height: trackSvg.height,
                  opacity: thumb.visible ? 1 : 0,
                  clipPath: `polygon(0 ${thumb.top}px, 100% ${thumb.top}px, 100% ${thumb.top + thumb.height}px, 0 ${thumb.top + thumb.height}px)`,
                }}
              >
                <path
                  d={trackSvg.d}
                  fill="none"
                  strokeWidth="1.5"
                  className="stroke-primary"
                />
              </svg>
            </>
          ) : null}
          <ul className="flex flex-col">
            {SCHEMA_TOC_ITEMS.map((item) => {
              const isActive = activeId === item.id;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    data-active={isActive}
                    ref={(node) => {
                      if (node) linkRefs.current.set(item.id, node);
                      else linkRefs.current.delete(item.id);
                    }}
                    onClick={() => scrollToSection(item.id)}
                    style={{ paddingInlineStart: getTocItemOffset(item.depth) }}
                    className={cn(
                      "block w-full py-1.5 text-left text-xs transition-colors",
                      item.depth === 0 ? "font-medium" : "font-mono",
                      isActive
                        ? "text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {item.title}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </nav>
    </div>
  );
}
