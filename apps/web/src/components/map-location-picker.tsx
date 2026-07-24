import { useEffect, useMemo, useRef, useState } from "react";
import {
  AttributionControl,
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
import { Field, FieldDescription, FieldLabel } from "@adversary/ui/components/field";

import { useMapData } from "@/components/map-data-provider";
import { isWithinBounds } from "@/lib/offline-regions/manifest";
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

export interface ExistingMapPoint {
  id: string;
  latitude: number;
  longitude: number;
  at: string;
}

interface MapLocationPickerProps {
  value: PositionPayload;
  onChange: (value: PositionPayload) => void;
  idPrefix?: string;
  /** Existing position events for the selected target, any order (sorted by `at` for display). */
  existingPoints?: ExistingMapPoint[];
  /** Draft event time used to connect the picker marker to nearest existing points. */
  previewAt?: string;
  trailColor?: string;
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
  previewAt,
  trailColor = DEFAULT_TRAIL_COLOR,
}: MapLocationPickerProps) {
  const { mapStyle, activeRegion } = useMapData();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const eventMarkersRef = useRef(new Map<string, Marker>());
  const trailCollectionRef = useRef<TrailFeatureCollection>(EMPTY_TRAIL);
  const neighborCollectionRef = useRef<TrailFeatureCollection>(EMPTY_TRAIL);
  const onChangeRef = useRef(onChange);
  const valueRef = useRef(value);
  const fittedPointsKeyRef = useRef<string | null>(null);
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

  const outsideRegion =
    activeRegion && !isWithinBounds(value.latitude, value.longitude, activeRegion.bounds);

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
    if (!containerRef.current || mapRef.current) return;
    const map = new MapLibreMap({
      container: containerRef.current,
      style: mapStyle,
      center: [value.longitude, value.latitude],
      zoom: 8,
      attributionControl: false,
    });
    map.addControl(new AttributionControl({ compact: true }), "bottom-right");

    const marker = new Marker({ draggable: true })
      .setLngLat([value.longitude, value.latitude])
      .addTo(map);

    const syncFromMarker = () => {
      const lngLat = marker.getLngLat();
      onChangeRef.current({
        ...valueRef.current,
        latitude: Number(lngLat.lat.toFixed(6)),
        longitude: Number(lngLat.lng.toFixed(6)),
      });
    };

    marker.on("dragend", syncFromMarker);
    map.on("click", (event) => {
      marker.setLngLat(event.lngLat);
      onChangeRef.current({
        ...valueRef.current,
        latitude: Number(event.lngLat.lat.toFixed(6)),
        longitude: Number(event.lngLat.lng.toFixed(6)),
      });
    });
    map.on("load", () => {
      ensureOverlayLayers(map, trailCollectionRef.current, neighborCollectionRef.current);
      setMapReady(true);
    });

    markerRef.current = marker;
    mapRef.current = map;
    return () => {
      for (const eventMarker of eventMarkersRef.current.values()) {
        eventMarker.remove();
      }
      eventMarkersRef.current.clear();
      marker.remove();
      map.remove();
      markerRef.current = null;
      mapRef.current = null;
      setMapReady(false);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const restoreOverlay = () => {
      if (!map.isStyleLoaded()) return;
      ensureOverlayLayers(map, trailCollectionRef.current, neighborCollectionRef.current);
    };

    map.on("style.load", restoreOverlay);
    void map.setStyle(mapStyle);
    return () => {
      map.off("style.load", restoreOverlay);
    };
  }, [mapReady, mapStyle]);

  useEffect(() => {
    if (!mapReady || !markerRef.current) return;
    markerRef.current.setLngLat([value.longitude, value.latitude]);
    if (sortedExistingPoints.length === 0) {
      mapRef.current?.setCenter([value.longitude, value.latitude]);
    }
  }, [mapReady, sortedExistingPoints.length, value.latitude, value.longitude]);

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
      let marker = eventMarkersRef.current.get(point.id);
      if (!marker) {
        marker = new Marker({
          element: createEventPointElement(point, trailColor),
          anchor: "center",
        })
          .setLngLat([point.longitude, point.latitude])
          .addTo(map);
        eventMarkersRef.current.set(point.id, marker);
      } else {
        marker.setLngLat([point.longitude, point.latitude]);
        const element = marker.getElement();
        element.style.setProperty("--event-point-color", trailColor);
        element.title = new Date(point.at).toLocaleString();
      }
    }

    if (sortedExistingPoints.length === 0) {
      fittedPointsKeyRef.current = null;
      return;
    }

    if (fittedPointsKeyRef.current === existingPointsKey) return;
    fittedPointsKeyRef.current = existingPointsKey;

    const bounds = new LngLatBounds();
    for (const point of sortedExistingPoints) {
      bounds.extend([point.longitude, point.latitude]);
    }
    bounds.extend([value.longitude, value.latitude]);
    map.fitBounds(bounds, { padding: 40, maxZoom: 12, duration: 0 });
  }, [
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
    <div className="flex flex-col gap-3">
      <div className="relative">
        <div
          ref={containerRef}
          className="h-56 w-full overflow-hidden rounded-lg border bg-muted"
          role="application"
          aria-label="Map location picker. Click or tap to place a marker."
        />
        <div className="pointer-events-none absolute top-3 right-3 z-10">
          <ButtonGroup orientation="vertical" className="pointer-events-auto bg-card/75 shadow-sm backdrop-blur-md">
            <Button
              type="button"
              size="icon"
              variant="outline"
              aria-label="Zoom in"
              onClick={() => zoomBy(1)}
            >
              <PlusIcon />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="outline"
              aria-label="Zoom out"
              onClick={() => zoomBy(-1)}
            >
              <MinusIcon />
            </Button>
          </ButtonGroup>
        </div>
      </div>
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
      {outsideRegion ? (
        <p
          className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100"
          role="alert"
        >
          Selected coordinates fall outside the active offline region ({activeRegion.name}). Offline
          maps may not render this location.
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field>
          <FieldLabel htmlFor={`${idPrefix}-latitude`}>Latitude</FieldLabel>
          <Input
            id={`${idPrefix}-latitude`}
            type="number"
            step="0.000001"
            value={value.latitude}
            onChange={(event) => updateCoordinate("latitude", event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${idPrefix}-longitude`}>Longitude</FieldLabel>
          <Input
            id={`${idPrefix}-longitude`}
            type="number"
            step="0.000001"
            value={value.longitude}
            onChange={(event) => updateCoordinate("longitude", event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${idPrefix}-altitude`}>Altitude (ft)</FieldLabel>
          <Input
            id={`${idPrefix}-altitude`}
            type="number"
            step="100"
            value={value.altitude ?? 0}
            onChange={(event) => updateCoordinate("altitude", event.target.value)}
          />
          <FieldDescription>Optional.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor={`${idPrefix}-speed`}>Speed</FieldLabel>
          <InputGroup>
            <InputGroupInput
              id={`${idPrefix}-speed`}
              inputMode="decimal"
              placeholder="Auto or 450 mph"
              value={speedDraft}
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
                onValueChange={(next) => {
                  if (!next) return;
                  setSpeedUnit(next as SpeedUnit);
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="w-19 border-0 bg-transparent shadow-none"
                  aria-label="Speed unit"
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
      </div>
    </div>
  );
}
