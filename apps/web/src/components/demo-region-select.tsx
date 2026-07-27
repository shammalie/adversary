import { Checkbox } from "@adversary/ui/components/checkbox";
import {
  FieldDescription,
  FieldLegend,
  FieldSet,
} from "@adversary/ui/components/field";
import { CircleAlertIcon } from "lucide-react";

import { DEMO_REGIONS } from "@/lib/demo-regions";
import type { VehicleCategory } from "@/types/target";

export interface DemoRegionSelectProps {
  regionIds: readonly string[];
  onRegionIdsChange: (regionIds: string[]) => void;
  /** Categories used for the mismatch warning (e.g. selected vehicles). */
  vehicleCategories?: readonly VehicleCategory[];
  disabled?: boolean;
  /**
   * When true, shows pin-override copy and keeps the control disabled.
   * Parent should also pass `disabled`.
   */
  pinOverrides?: boolean;
  /** Prefix for element ids so dialog + events tab can coexist. */
  idPrefix?: string;
  className?: string;
}

function formatRegionSupports(supports: readonly VehicleCategory[]): string {
  return supports.join(", ");
}

export function incompatibleRegionCategories(
  regionIds: readonly string[],
  vehicleCategories: readonly VehicleCategory[],
): VehicleCategory[] {
  if (regionIds.length === 0 || vehicleCategories.length === 0) return [];
  const selected = DEMO_REGIONS.filter((region) => regionIds.includes(region.id));
  return vehicleCategories.filter(
    (category) => !selected.some((region) => region.supports.includes(category)),
  );
}

/**
 * Anywhere + multi-select region catalogue with per-region `supports` labels.
 * Empty `regionIds` means Anywhere (world sampling).
 */
export function DemoRegionSelect({
  regionIds,
  onRegionIdsChange,
  vehicleCategories = [],
  disabled = false,
  pinOverrides = false,
  idPrefix = "demo-region",
  className,
}: DemoRegionSelectProps) {
  const anywhere = regionIds.length === 0;
  const incompatible = incompatibleRegionCategories(regionIds, vehicleCategories);
  const hintId = `${idPrefix}-hint`;
  const mismatchId = `${idPrefix}-mismatch`;
  const anywhereDescId = `${idPrefix}-anywhere-desc`;

  function selectAnywhere() {
    onRegionIdsChange([]);
  }

  function toggleRegion(regionId: string, checked: boolean) {
    if (checked) {
      onRegionIdsChange(
        regionIds.includes(regionId) ? [...regionIds] : [...regionIds, regionId],
      );
      return;
    }
    onRegionIdsChange(regionIds.filter((id) => id !== regionId));
  }

  return (
    <FieldSet className={className}>
      <FieldLegend>Regions</FieldLegend>
      <FieldDescription id={hintId}>
        {pinOverrides
          ? "A map pin is set — it overrides region selection until cleared."
          : "Select one or more regions, or Anywhere for world sampling. Each region lists the vehicle categories it can host."}
      </FieldDescription>
      <div
        data-slot="checkbox-group"
        aria-disabled={disabled ? true : undefined}
        aria-describedby={
          incompatible.length > 0 ? `${hintId} ${mismatchId}` : hintId
        }
        className="mt-2 flex max-h-48 flex-col gap-2 overflow-y-auto rounded-md border p-3"
      >
        <label className="flex items-start gap-2 text-sm">
          <Checkbox
            checked={anywhere}
            disabled={disabled}
            onCheckedChange={(checked) => {
              if (checked) selectAnywhere();
            }}
            aria-describedby={anywhereDescId}
          />
          <span>
            <span className="font-medium">Anywhere</span>
            <span
              id={anywhereDescId}
              className="mt-0.5 block text-xs text-muted-foreground"
            >
              World sampling (default when no regions are selected)
            </span>
          </span>
        </label>
        {DEMO_REGIONS.map((region) => {
          const supportsLabel = formatRegionSupports(region.supports);
          const descriptionId = `${idPrefix}-${region.id}-supports`;
          return (
            <label key={region.id} className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={regionIds.includes(region.id)}
                disabled={disabled}
                onCheckedChange={(checked) => {
                  toggleRegion(region.id, checked === true);
                }}
                aria-describedby={descriptionId}
              />
              <span>
                <span className="font-medium">{region.name}</span>
                <span
                  id={descriptionId}
                  className="mt-0.5 block text-xs capitalize text-muted-foreground"
                >
                  Supports: {supportsLabel}
                </span>
              </span>
            </label>
          );
        })}
      </div>
      {incompatible.length > 0 ? (
        <FieldDescription
          id={mismatchId}
          className="flex items-start gap-1.5 text-amber-700 dark:text-amber-400"
        >
          <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            Selected regions do not support{" "}
            <span className="capitalize">{incompatible.join(", ")}</span>. Those
            contacts will relocate (anywhere-sample) when generating.
          </span>
        </FieldDescription>
      ) : null}
    </FieldSet>
  );
}
