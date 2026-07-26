import { useEffect, useMemo, useRef, useState } from "react";
import {
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
  type GeoJSONSource,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MinusIcon, PlusIcon } from "lucide-react";

import { Button } from "@adversary/ui/components/button";
import { ButtonGroup } from "@adversary/ui/components/button-group";
import { Input } from "@adversary/ui/components/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@adversary/ui/components/input-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@adversary/ui/components/select";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@adversary/ui/components/field";
import { cn } from "@adversary/ui/lib/utils";

import { useMapData } from "@/components/map-data-provider";
import {
  SPEED_UNITS,
  formatSpeedInUnit,
  parseSpeedInput,
  type SpeedUnit,
} from "@/lib/speed-units";
import type { PositionPayload } from "@/types/target";

const EVENT_TRAIL_SOURCE = "schedule-event-trail";
const EVENT_TRAIL_LAYER = "schedule-event-trail";
const EVENT_NEIGHBOR_SOURCE = "schedule-event-neighbors";
const EVENT_NEIGHBOR_LAYER = "schedule-event-neighbors";
const DEFAULT_TRAIL_COLOR = "#38bdf8";
const FALLBACK_CENTER: [number, number] = [-0.1278, 51.5074];

function isFiniteLngLat(longitude: number, latitude: number): boolean {
  return (
    Number.isFinite(longitude) &&
    Number.isFinite(latitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

function lngLatPair(
  longitude: number,
  latitude: number,
): [number, number] | null {
  if (!isFiniteLngLat(longitude, latitude)) return null;
  return [longitude, latitude];
}

export interface ExistingMapPoint {
  id: string;
  latitude: number;
  longitude: number;
  at: string;
}

export interface CompanionMapPoint {
  latitude: number;
  longitude: number;
  /** Short label for the companion marker tooltip (e.g. "Start", "End"). */
  label?: string;
}

interface MapLocationPickerProps {
  value: PositionPayload;
  onChange: (value: PositionPayload) => void;
  idPrefix?: string;
  /** Existing position events for the selected target, any order (sorted by `at` for display). */
  existingPoints?: ExistingMapPoint[];
  /**
   * Optional second geography (e.g. the other end of an A→B route) shown as a
   * reference marker and included when fitting the camera.
   */
  companionPoint?: CompanionMapPoint | null;
  /** Draft event time used to connect the picker marker to nearest existing points. */
  previewAt?: string;
  trailColor?: string;
  /** Override map container height/size classes (default `h-56`). */
  mapClassName?: string;
  disabled?: boolean;
  /** When false, hides the speed field (route generation authors speed). Default true. */
  showSpeedField?: boolean;
  /** Accessible name for the map surface. */
  mapAriaLabel?: string;
}

type TrailFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    properties: { color: string };
    geometry: {
      type: "LineString";
      coordinates: Array<[number, number]>;
    };
  }>;
};

const EMPTY_TRAIL: TrailFeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

function createEventPointElement(point: ExistingMapPoint, color: string) {
  const element = document.createElement("div");
  element.className = "schedule-event-point";
  element.style.setProperty("--event-point-color", color);
  element.title = new Date(point.at).toLocaleString();
  element.setAttribute("aria-hidden", "true");
  return element;
}

function createCompanionPointElement(label: string, color: string) {
  const element = document.createElement("div");
  element.className = "schedule-event-point schedule-companion-point";
  element.style.setProperty("--event-point-color", color);
  element.title = label;
  element.setAttribute("aria-hidden", "true");
  return element;
}

function buildTrailCollection(
  points: ExistingMapPoint[],
  color: string,
): TrailFeatureCollection {
  if (points.length < 2) return EMPTY_TRAIL;
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { color },
        geometry: {
          type: "LineString",
          coordinates: points.map((point) => [point.longitude, point.latitude]),
        },
      },
    ],
  };
}

/** True when every previous point id is still present (trail grew or stayed — e.g. after Add event). */
function isExistingPointsAppend(previousKey: string, nextKey: string): boolean {
  if (!previousKey || previousKey === nextKey) return false;
  const previousIds = new Set(
    previousKey
      .split("|")
      .filter(Boolean)
      .map((entry) => entry.slice(0, entry.indexOf(":"))),
  );
  if (previousIds.size === 0) return false;
  const nextIds = new Set(
    nextKey
      .split("|")
      .filter(Boolean)
      .map((entry) => entry.slice(0, entry.indexOf(":"))),
  );
  for (const id of previousIds) {
    if (!nextIds.has(id)) return false;
  }
  return true;
}

/** Previous/next existing points relative to `at` (sorted points required). */
function findTimeNeighbors(points: ExistingMapPoint[], at: string) {
  let previous: ExistingMapPoint | null = null;
  let next: ExistingMapPoint | null = null;
  for (const point of points) {
    if (point.at <= at) {
      previous = point;
    } else {
      next = point;
      break;
    }
  }
  return { previous, next };
}

function buildNeighborCollection(
  draft: { latitude: number; longitude: number },
  points: ExistingMapPoint[],
  at: string | undefined,
  color: string,
): TrailFeatureCollection {
  if (!at || points.length === 0) return EMPTY_TRAIL;

  const { previous, next } = findTimeNeighbors(points, at);
  const draftCoord: [number, number] = [draft.longitude, draft.latitude];
  const features: TrailFeatureCollection["features"] = [];

  if (previous) {
    features.push({
      type: "Feature",
      properties: { color },
      geometry: {
        type: "LineString",
        coordinates: [
          [previous.longitude, previous.latitude],
          draftCoord,
        ],
      },
    });
  }
  if (next) {
    features.push({
      type: "Feature",
      properties: { color },
      geometry: {
        type: "LineString",
        coordinates: [
          draftCoord,
          [next.longitude, next.latitude],
        ],
      },
    });
  }

  return features.length === 0 ? EMPTY_TRAIL : { type: "FeatureCollection", features };
}

function ensureLineLayer(
  map: MapLibreMap,
  sourceId: string,
  layerId: string,
  data: TrailFeatureCollection,
  paint: {
    "line-color": string | ["get", string];
    "line-width": number;
    "line-opacity": number;
    "line-dasharray"?: [number, number];
  },
) {
  const source = map.getSource(sourceId) as GeoJSONSource | undefined;
  if (!source) {
    map.addSource(sourceId, {
      type: "geojson",
      data,
    });
    map.addLayer({
      id: layerId,
      type: "line",
      source: sourceId,
      paint,
    });
    return;
  }
  source.setData(data);
}

function ensureOverlayLayers(
  map: MapLibreMap,
  trailData: TrailFeatureCollection,
  neighborData: TrailFeatureCollection,
) {
  ensureLineLayer(map, EVENT_TRAIL_SOURCE, EVENT_TRAIL_LAYER, trailData, {
    "line-color": ["get", "color"],
    "line-width": 2,
    "line-opacity": 0.85,
  });
  ensureLineLayer(map, EVENT_NEIGHBOR_SOURCE, EVENT_NEIGHBOR_LAYER, neighborData, {
    "line-color": ["get", "color"],
    "line-width": 2,
    "line-opacity": 0.95,
    "line-dasharray": [1.5, 1.5],
  });
}

export function MapLocationPicker({
  value,
  onChange,
  idPrefix = "map-point",
  existingPoints = [],
  companionPoint = null,
  previewAt,
  trailColor = DEFAULT_TRAIL_COLOR,
  mapClassName,
  disabled = false,
  showSpeedField = true,
  mapAriaLabel = "Map location picker. Click or tap to place a marker.",
}: MapLocationPickerProps) {
  const { mapStyle } = useMapData();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const companionMarkerRef = useRef<Marker | null>(null);
  const eventMarkersRef = useRef(new Map<string, Marker>());
  const trailCollectionRef = useRef<TrailFeatureCollection>(EMPTY_TRAIL);
  const neighborCollectionRef = useRef<TrailFeatureCollection>(EMPTY_TRAIL);
  const onChangeRef = useRef(onChange);
  const valueRef = useRef(value);
  const fittedPointsKeyRef = useRef<string | null>(null);
  const userAdjustedCameraRef = useRef(false);
  const programmaticCameraRef = useRef(false);
  const appliedStyleRef = useRef<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [speedUnit, setSpeedUnit] = useState<SpeedUnit>("kt");
  const [speedDraft, setSpeedDraft] = useState("");
  const skipSpeedSyncRef = useRef(false);
  onChangeRef.current = onChange;
  valueRef.current = value;

  const sortedExistingPoints = useMemo(
    () =>
      existingPoints
        .filter(
          (point) =>
            Number.isFinite(point.latitude) && Number.isFinite(point.longitude),
        )
        .toSorted((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id)),
    [existingPoints],
  );

  const existingPointsKey = useMemo(
    () =>
      sortedExistingPoints
        .map(
          (point) =>
            `${point.id}:${point.latitude}:${point.longitude}:${point.at}`,
        )
        .join("|"),
    [sortedExistingPoints],
  );

  const timeNeighbors = useMemo(
    () => (previewAt ? findTimeNeighbors(sortedExistingPoints, previewAt) : null),
    [previewAt, sortedExistingPoints],
  );

  useEffect(() => {
    if (skipSpeedSyncRef.current) {
      skipSpeedSyncRef.current = false;
      return;
    }
    if (value.speed == null) {
      setSpeedDraft("");
      return;
    }
    setSpeedDraft(formatSpeedInUnit(value.speed, speedUnit));
  }, [value.speed, speedUnit]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    let cancelled = false;
    let map: MapLibreMap | null = null;
    let marker: Marker | null = null;

    const markUserCamera = () => {
      if (programmaticCameraRef.current) return;
      userAdjustedCameraRef.current = true;
    };

    const handleMapClick = (event: { lngLat?: { lat: number; lng: number } }) => {
      if (!marker || !event.lngLat) return;
      marker.setLngLat(event.lngLat);
      onChangeRef.current({
        ...valueRef.current,
        latitude: Number(event.lngLat.lat.toFixed(6)),
        longitude: Number(event.lngLat.lng.toFixed(6)),
      });
    };

    const syncFromMarker = () => {
      if (!marker) return;
      const lngLat = marker.getLngLat();
      if (!lngLat || !Number.isFinite(lngLat.lng) || !Number.isFinite(lngLat.lat)) return;
      onChangeRef.current({
        ...valueRef.current,
        latitude: Number(lngLat.lat.toFixed(6)),
        longitude: Number(lngLat.lng.toFixed(6)),
      });
    };

    const initMap = () => {
      if (cancelled || mapRef.current || !containerRef.current) return;
      // KeepMounted / hidden tabs mount with zero size — MapLibre breaks click coords.
      if (container.clientWidth === 0 || container.clientHeight === 0) return;

      const center =
        lngLatPair(valueRef.current.longitude, valueRef.current.latitude) ??
        FALLBACK_CENTER;

      map = new MapLibreMap({
        container: containerRef.current,
        style: mapStyle,
        center,
        zoom: 8,
        attributionControl: false,
      });

      // MapLibre Marker._update reads lngLat on addTo — set coords first.
      marker = new Marker({ draggable: true }).setLngLat(center).addTo(map);

      marker.on("dragend", syncFromMarker);
      map.on("click", handleMapClick);
      map.on("zoomend", markUserCamera);
      map.on("dragend", markUserCamera);
      map.on("load", () => {
        if (!map) return;
        ensureOverlayLayers(map, trailCollectionRef.current, neighborCollectionRef.current);
        map.resize();
        setMapReady(true);
      });

      markerRef.current = marker;
      mapRef.current = map;
      appliedStyleRef.current = mapStyle;
    };

    const resizeObserver = new ResizeObserver(() => {
      if (!mapRef.current) {
        initMap();
        return;
      }
      mapRef.current.resize();
    });
    resizeObserver.observe(container);
    initMap();

    return () => {
      cancelled = true;
      resizeObserver.disconnect();
      for (const eventMarker of eventMarkersRef.current.values()) {
        eventMarker.remove();
      }
      eventMarkersRef.current.clear();
      companionMarkerRef.current?.remove();
      companionMarkerRef.current = null;
      if (marker) {
        marker.off("dragend", syncFromMarker);
        marker.remove();
      }
      if (map) {
        map.off("click", handleMapClick);
        map.off("zoomend", markUserCamera);
        map.off("dragend", markUserCamera);
        map.remove();
      }
      markerRef.current = null;
      mapRef.current = null;
      appliedStyleRef.current = null;
      fittedPointsKeyRef.current = null;
      userAdjustedCameraRef.current = false;
      programmaticCameraRef.current = false;
      setMapReady(false);
    };
    // Intentionally mount once; style swaps happen in the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mapStyle used only for first paint
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    // Avoid reloading the style we already initialized with — mid-reload
    // Marker._update can run with undefined lngLat (smartWrap crash).
    if (appliedStyleRef.current === mapStyle) return;

    const restoreOverlay = () => {
      if (!map.isStyleLoaded()) return;
      ensureOverlayLayers(map, trailCollectionRef.current, neighborCollectionRef.current);
    };

    appliedStyleRef.current = mapStyle;
    map.on("style.load", restoreOverlay);
    void map.setStyle(mapStyle);
    return () => {
      map.off("style.load", restoreOverlay);
    };
  }, [mapReady, mapStyle]);

  useEffect(() => {
    if (!mapReady || !markerRef.current) return;
    const next = lngLatPair(value.longitude, value.latitude);
    if (!next) return;
    markerRef.current.setLngLat(next);
    if (sortedExistingPoints.length === 0 && !companionPoint) {
      mapRef.current?.setCenter(next);
    }
  }, [
    companionPoint,
    mapReady,
    sortedExistingPoints.length,
    value.latitude,
    value.longitude,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const companionLngLat = companionPoint
      ? lngLatPair(companionPoint.longitude, companionPoint.latitude)
      : null;

    if (!companionLngLat) {
      companionMarkerRef.current?.remove();
      companionMarkerRef.current = null;
      return;
    }

    const label = companionPoint?.label ?? "Related point";

    const attachCompanion = () => {
      if (!map.isStyleLoaded()) return false;

      let marker = companionMarkerRef.current;
      if (!marker) {
        try {
          // setLngLat before addTo — Marker._update → smartWrap requires defined lngLat.
          marker = new Marker({
            element: createCompanionPointElement(label, trailColor),
            anchor: "center",
          })
            .setLngLat(companionLngLat)
            .addTo(map);
          companionMarkerRef.current = marker;
        } catch {
          companionMarkerRef.current = null;
          return false;
        }
        return true;
      }

      const element = marker.getElement();
      element.title = label;
      element.style.setProperty("--event-point-color", trailColor);
      marker.setLngLat(companionLngLat);
      return true;
    };

    if (attachCompanion()) return;

    const onStyleLoad = () => {
      attachCompanion();
    };
    map.on("style.load", onStyleLoad);
    return () => {
      map.off("style.load", onStyleLoad);
    };
  }, [companionPoint, mapReady, trailColor]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const trailCollection = buildTrailCollection(sortedExistingPoints, trailColor);
    const neighborCollection = buildNeighborCollection(
      value,
      sortedExistingPoints,
      previewAt,
      trailColor,
    );
    trailCollectionRef.current = trailCollection;
    neighborCollectionRef.current = neighborCollection;
    if (map.isStyleLoaded()) {
      ensureOverlayLayers(map, trailCollection, neighborCollection);
    }

    const nextIds = new Set(sortedExistingPoints.map((point) => point.id));
    for (const [id, marker] of eventMarkersRef.current) {
      if (!nextIds.has(id)) {
        marker.remove();
        eventMarkersRef.current.delete(id);
      }
    }

    for (const point of sortedExistingPoints) {
      const pointLngLat = lngLatPair(point.longitude, point.latitude);
      if (!pointLngLat) continue;
      let marker = eventMarkersRef.current.get(point.id);
      if (!marker) {
        marker = new Marker({
          element: createEventPointElement(point, trailColor),
          anchor: "center",
        })
          .setLngLat(pointLngLat)
          .addTo(map);
        eventMarkersRef.current.set(point.id, marker);
      } else {
        marker.setLngLat(pointLngLat);
        const element = marker.getElement();
        element.style.setProperty("--event-point-color", trailColor);
        element.title = new Date(point.at).toLocaleString();
      }
    }

    const companionLngLat = companionPoint
      ? lngLatPair(companionPoint.longitude, companionPoint.latitude)
      : null;
    const companionKey = companionLngLat
      ? `companion:${companionLngLat[1]}:${companionLngLat[0]}`
      : "";
    const fitKey = `${existingPointsKey}|${companionKey}`;

    if (sortedExistingPoints.length === 0 && !companionKey) {
      fittedPointsKeyRef.current = null;
      return;
    }

    const previousKey = fittedPointsKeyRef.current;
    if (previousKey === fitKey) return;

    // Adding another event only appends points — keep the user's zoom/pan.
    if (
      previousKey &&
      !companionKey &&
      isExistingPointsAppend(previousKey.split("|")[0] ?? "", existingPointsKey)
    ) {
      fittedPointsKeyRef.current = fitKey;
      return;
    }

    const valueLngLat = lngLatPair(value.longitude, value.latitude);
    if (!valueLngLat) return;

    fittedPointsKeyRef.current = fitKey;
    if (previousKey) {
      userAdjustedCameraRef.current = false;
    } else if (userAdjustedCameraRef.current) {
      return;
    }

    const bounds = new LngLatBounds();
    for (const point of sortedExistingPoints) {
      const pointLngLat = lngLatPair(point.longitude, point.latitude);
      if (pointLngLat) bounds.extend(pointLngLat);
    }
    bounds.extend(valueLngLat);
    if (companionLngLat) bounds.extend(companionLngLat);
    if (!bounds.getSouthWest() || !bounds.getNorthEast()) return;

    programmaticCameraRef.current = true;
    try {
      map.resize();
      map.fitBounds(bounds, { padding: 40, maxZoom: 12, duration: 0 });
    } catch {
      programmaticCameraRef.current = false;
      return;
    }
    map.once("moveend", () => {
      programmaticCameraRef.current = false;
    });
  }, [
    companionPoint,
    existingPointsKey,
    mapReady,
    previewAt,
    sortedExistingPoints,
    trailColor,
    value.latitude,
    value.longitude,
  ]);

  function updateCoordinate(field: "latitude" | "longitude" | "altitude", raw: string) {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    if (field === "latitude" && (parsed < -90 || parsed > 90)) return;
    if (field === "longitude" && (parsed < -180 || parsed > 180)) return;
    onChange({ ...value, [field]: parsed });
  }

  function commitSpeedDraft(raw: string) {
    if (raw.trim() === "") {
      const { speed: _removed, ...rest } = value;
      onChange(rest);
      setSpeedDraft("");
      return;
    }

    const parsed = parseSpeedInput(raw, speedUnit);
    if (!parsed) return;

    skipSpeedSyncRef.current = true;
    setSpeedUnit(parsed.unit);
    onChange({ ...value, speed: parsed.knots });
    setSpeedDraft(String(parsed.amount));
  }

  function zoomBy(delta: number) {
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({ zoom: map.getZoom() + delta, duration: 200 });
  }

  return (
    <div
      className={cn("flex flex-col gap-3", disabled && "opacity-50")}
      aria-disabled={disabled || undefined}
    >
      <div className={cn("relative", disabled && "pointer-events-none")}>
        <div
          ref={containerRef}
          className={cn(
            "h-56 w-full overflow-hidden rounded-lg border bg-muted",
            mapClassName,
          )}
          role="application"
          aria-label={mapAriaLabel}
          aria-disabled={disabled || undefined}
        />
        <div className="pointer-events-none absolute top-3 right-3 z-10">
          <ButtonGroup orientation="vertical" className="pointer-events-auto bg-card/75 shadow-sm backdrop-blur-md">
            <Button
              type="button"
              size="icon"
              variant="outline"
              aria-label="Zoom in"
              disabled={disabled}
              onClick={() => zoomBy(1)}
            >
              <PlusIcon />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="outline"
              aria-label="Zoom out"
              disabled={disabled}
              onClick={() => zoomBy(-1)}
            >
              <MinusIcon />
            </Button>
          </ButtonGroup>
        </div>
      </div>
      {companionPoint ? (
        <p className="text-sm text-muted-foreground" role="status">
          Showing companion point
          {companionPoint.label ? ` (${companionPoint.label})` : ""} on the map for reference.
        </p>
      ) : null}
      {sortedExistingPoints.length > 0 ? (
        <p className="text-sm text-muted-foreground" role="status">
          Showing {sortedExistingPoints.length} existing position
          {sortedExistingPoints.length === 1 ? "" : "s"} for this target
          {sortedExistingPoints.length > 1 ? ", connected in time order" : ""}
          {timeNeighbors?.previous || timeNeighbors?.next
            ? "; dashed lines link the draft to its nearest events by time"
            : ""}
          .
        </p>
      ) : null}
      <FieldGroup
        className={cn(
          "gap-3",
          "grid sm:grid-cols-2",
          showSpeedField ? "lg:grid-cols-4" : "lg:grid-cols-3",
        )}
      >
        <Field data-disabled={disabled || undefined}>
          <FieldLabel htmlFor={`${idPrefix}-latitude`}>Latitude</FieldLabel>
          <Input
            id={`${idPrefix}-latitude`}
            type="number"
            step="0.000001"
            value={value.latitude}
            disabled={disabled}
            onChange={(event) => updateCoordinate("latitude", event.target.value)}
          />
        </Field>
        <Field data-disabled={disabled || undefined}>
          <FieldLabel htmlFor={`${idPrefix}-longitude`}>Longitude</FieldLabel>
          <Input
            id={`${idPrefix}-longitude`}
            type="number"
            step="0.000001"
            value={value.longitude}
            disabled={disabled}
            onChange={(event) => updateCoordinate("longitude", event.target.value)}
          />
        </Field>
        <Field data-disabled={disabled || undefined}>
          <FieldLabel htmlFor={`${idPrefix}-altitude`}>Altitude (ft)</FieldLabel>
          <Input
            id={`${idPrefix}-altitude`}
            type="number"
            step="100"
            value={value.altitude ?? 0}
            disabled={disabled}
            onChange={(event) => updateCoordinate("altitude", event.target.value)}
          />
        </Field>
        {showSpeedField ? (
          <Field data-disabled={disabled || undefined}>
            <FieldLabel htmlFor={`${idPrefix}-speed`}>Speed</FieldLabel>
            <InputGroup>
              <InputGroupInput
                id={`${idPrefix}-speed`}
                inputMode="decimal"
                placeholder="Auto or 450 mph"
                value={speedDraft}
                disabled={disabled}
                onChange={(event) => setSpeedDraft(event.target.value)}
                onBlur={() => commitSpeedDraft(speedDraft)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitSpeedDraft(speedDraft);
                  }
                }}
              />
              <InputGroupAddon align="inline-end">
                <Select
                  value={speedUnit}
                  disabled={disabled}
                  onValueChange={(next) => {
                    if (!next) return;
                    setSpeedUnit(next as SpeedUnit);
                  }}
                >
                  <SelectTrigger
                    size="sm"
                    className="w-19 border-0 bg-transparent shadow-none"
                    aria-label="Speed unit"
                    disabled={disabled}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="end">
                    <SelectGroup>
                      {SPEED_UNITS.map((unit) => (
                        <SelectItem key={unit} value={unit}>
                          {unit}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </InputGroupAddon>
            </InputGroup>
            <FieldDescription>
              {value.speed == null
                ? "Optional. Enter a value with unit (e.g. 450 mph); stored as knots."
                : `Stored as ${value.speed} kt. Leave blank to derive from track.`}
            </FieldDescription>
          </Field>
        ) : null}
      </FieldGroup>
    </div>
  );
}
