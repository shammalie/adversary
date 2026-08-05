import { Button } from "@adversary/ui/components/button";
import { Checkbox } from "@adversary/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@adversary/ui/components/dialog";
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@adversary/ui/components/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@adversary/ui/components/select";
import { toast } from "sonner";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ClipboardCopyIcon, DownloadIcon, RadioIcon } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import {
  DEFAULT_EVENT_MESSAGE_EXPORT_OPTIONS,
  downloadEventMessages,
  formatEventMessages,
  type EventMessageExportOptions,
} from "@/lib/event-message-export";
import type { SimulationScenario } from "@/types/target";

const PREVIEW_LINE_HEIGHT_PX = 20;
const PREVIEW_OVERSCAN = 8;
const TIME_MULTIPLIERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

function VirtualizedMessagePreview({ lines }: { lines: string[] }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => PREVIEW_LINE_HEIGHT_PX,
    overscan: PREVIEW_OVERSCAN,
    getItemKey: (index) => index,
  });

  if (lines.length === 0) {
    return (
      <div className="min-h-56 flex-1 overflow-hidden rounded-md border bg-muted/30">
        <p className="p-3 font-mono text-xs text-muted-foreground">
          No positioned events in this scenario.
        </p>
      </div>
    );
  }

  const virtualItems = virtualizer.getVirtualItems();
  const paddingTop = virtualItems[0]?.start ?? 0;
  const paddingBottom =
    virtualizer.getTotalSize() - (virtualItems.at(-1)?.end ?? 0);

  return (
    <div
      ref={parentRef}
      className="min-h-56 flex-1 overflow-auto rounded-md border bg-muted/30 [overflow-anchor:none] scrollbar-thin"
      role="region"
      aria-label="Message export preview"
    >
      <div className="font-mono text-xs leading-5">
        {paddingTop > 0 ? (
          <div aria-hidden style={{ height: paddingTop }} />
        ) : null}
        {virtualItems.map((item) => {
          const line = lines[item.index] ?? "";
          return (
            <div
              key={item.key}
              className="overflow-hidden text-ellipsis whitespace-nowrap px-3"
              style={{ height: PREVIEW_LINE_HEIGHT_PX }}
              title={line}
            >
              {line}
            </div>
          );
        })}
        {paddingBottom > 0 ? (
          <div aria-hidden style={{ height: paddingBottom }} />
        ) : null}
      </div>
    </div>
  );
}

export function EventMessageExportDialog({
  scenario,
  disabled,
}: {
  scenario: SimulationScenario;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<EventMessageExportOptions>(
    DEFAULT_EVENT_MESSAGE_EXPORT_OPTIONS,
  );

  const preview = useMemo(
    () => (open ? formatEventMessages(scenario, options) : ""),
    [open, scenario, options],
  );
  const lines = useMemo(() => (preview ? preview.split("\n") : []), [preview]);
  const lineCount = lines.length;

  function setOption(
    key: "includeAltitude" | "includeHeading" | "includeSpeed",
    checked: boolean,
  ) {
    setOptions((current) => ({ ...current, [key]: checked }));
  }

  async function handleCopy() {
    if (!preview) {
      toast.error("No positioned events to copy.");
      return;
    }
    try {
      await navigator.clipboard.writeText(preview);
      toast.success(
        `Copied ${lineCount} message${lineCount === 1 ? "" : "s"}.`,
      );
    } catch {
      toast.error("Could not copy to clipboard.");
    }
  }

  function handleDownload() {
    if (!preview) {
      toast.error("No positioned events to export.");
      return;
    }
    downloadEventMessages(scenario.name, preview);
    toast.success(
      `Exported ${lineCount} message${lineCount === 1 ? "" : "s"}.`,
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setOptions(DEFAULT_EVENT_MESSAGE_EXPORT_OPTIONS);
      }}
    >
      <DialogTrigger
        render={<Button variant="outline" size="sm" disabled={disabled} />}
      >
        <RadioIcon data-icon="inline-start" />
        Messages
      </DialogTrigger>
      <DialogContent className="flex max-h-[90vh] max-w-[calc(100%-2rem)] flex-col overflow-hidden sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Export event messages</DialogTitle>
          <DialogDescription>
            One line per positioned event. Optional altitude, heading, and
            speed. Messages are included when present.
          </DialogDescription>
        </DialogHeader>
        <div className="-mx-4 flex min-h-0 flex-1 flex-col gap-4 overflow-hidden border-y px-4 py-4">
          <Field className="shrink-0">
            <FieldLabel htmlFor="export-time-multiplier">
              Time multiplier
            </FieldLabel>
            <Select
              value={String(options.timeMultiplier)}
              onValueChange={(next) => {
                if (!next) return;
                const multiplier = Number(next);
                if (!Number.isFinite(multiplier)) return;
                setOptions((current) => ({
                  ...current,
                  timeMultiplier: multiplier,
                }));
              }}
            >
              <SelectTrigger
                id="export-time-multiplier"
                className="w-full"
                aria-describedby="export-time-multiplier-hint"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  {TIME_MULTIPLIERS.map((multiplier) => (
                    <SelectItem key={multiplier} value={String(multiplier)}>
                      {multiplier}×
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <FieldDescription id="export-time-multiplier-hint">
              Compresses relative OUT seconds from the first exported line. 1× =
              off. Authored times stay unchanged.
            </FieldDescription>
          </Field>

          <Field className="shrink-0">
            <FieldLabel>Include fields</FieldLabel>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={options.includeAltitude}
                  onCheckedChange={(checked) =>
                    setOption("includeAltitude", checked === true)
                  }
                />
                ALT
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={options.includeHeading}
                  onCheckedChange={(checked) =>
                    setOption("includeHeading", checked === true)
                  }
                />
                HDG
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={options.includeSpeed}
                  onCheckedChange={(checked) =>
                    setOption("includeSpeed", checked === true)
                  }
                />
                SPD
              </label>
            </div>
          </Field>

          <Field className="flex min-h-0 flex-1 flex-col gap-2">
            <FieldLabel className="shrink-0">
              Preview{lineCount > 0 ? ` (${lineCount})` : ""}
            </FieldLabel>
            <VirtualizedMessagePreview lines={lines} />
          </Field>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={!preview}
            onClick={handleCopy}
          >
            <ClipboardCopyIcon data-icon="inline-start" />
            Copy
          </Button>
          <Button type="button" disabled={!preview} onClick={handleDownload}>
            <DownloadIcon data-icon="inline-start" />
            Export to file
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
