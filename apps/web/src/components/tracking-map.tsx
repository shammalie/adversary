import { Button } from "@adversary/ui/components/button";
import { ButtonGroup } from "@adversary/ui/components/button-group";
import { ToggleGroup, ToggleGroupItem } from "@adversary/ui/components/toggle-group";
import { cn } from "@adversary/ui/lib/utils";
import {
  CompassIcon,
  CrosshairIcon,
  LocateFixedIcon,
  MinusIcon,
  MoveIcon,
  PlusIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  type GeoJSONSource,
  type LngLatBoundsLike,
  Map as MapLibreMap,
  Marker,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { useMapData } from "@/components/map-data-provider";
import { useTheme } from "@/components/theme-provider";
import {
  resolveAffiliationColor,
  resolveAffiliationColorTheme,
} from "@/lib/affiliation-colors";
import {
  lngLatBoundsForPoints,
  shortestLongitudeDelta,
  unwrapLineLongitudes,
} from "@/lib/geo-longitude";
import {
  vehicleCategoryIconSvg,
  vehicleCategoryMarkerRotationDegrees,
} from "@/lib/vehicle-icon";
import type {
  Affiliation,
  MapMode,
  RuntimeTargetState,
  VehicleCategory,
} from "@/types/target";

export type CameraMode = "track" | "overview" | "pan";

export interface MapTargetDisplay {
  targetId: string;
  callsign: string;
  color: string;
  affiliation?: Affiliation;
  vehicleCategory?: VehicleCategory;
  heading?: number;
  position?: { latitude: number; longitude: number };
  trail: Array<{ latitude: number; longitude: number }>;
}

interface TrackingMapProps {
  targets: MapTargetDisplay[] | RuntimeTargetState[];
  selectedTargetId?: string;
  trackedTargetIds?: string[];
  /** When true, only tracked contacts are drawn on the map. */
  showTrackedOnly?: boolean;
  highlightedEventId?: string;
  mode?: MapMode;
  cameraMode?: CameraMode;
  onCameraModeChange?: (mode: CameraMode) => void;
  availableCameraModes?: CameraMode[];
  onSelectTarget?: (targetId: string) => void;
  fitTargetsKey?: string;
  continuousMotion?: boolean;
}

const OVERVIEW_MAX_ZOOM = 12;
/** Track frames as tightly as possible while keeping every tracked contact on screen. */
const TRACK_MAX_ZOOM = 16;
const FIT_PADDING = 48;

type TrailFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    properties: { color: string; targetId: string };
    geometry: {
      type: "LineString";
      coordinates: Array<[number, number]>;
    };
  }>;
};

const EMPTY_TRAIL_COLLECTION: TrailFeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

const VIEWPORT_PADDING = 56;

function toDisplayTarget(target: MapTargetDisplay | RuntimeTargetState): MapTargetDisplay {
  if ("profile" in target) {
    return {
      targetId: target.targetId,
      callsign: target.callsign,
      color: target.color,
      affiliation: target.profile.affiliation,
      vehicleCategory: target.profile.vehicleCategory,
      heading: target.position?.heading,
      position: target.position
        ? { latitude: target.position.latitude, longitude: target.position.longitude }
        : undefined,
      trail: target.trail.map((point) => ({
        latitude: point.latitude,
        longitude: point.longitude,
      })),
    };
  }
  return target;
}

function buildBounds(targets: MapTargetDisplay[]): LngLatBoundsLike | null {
  const points = targets.flatMap((target) => (target.position ? [target.position] : []));
  return lngLatBoundsForPoints(points);
}

function isOutsideViewport(
  map: MapLibreMap,
  latitude: number,
  longitude: number,
  padding = VIEWPORT_PADDING,
) {
  const point = map.project([longitude, latitude]);
  const canvas = map.getCanvas();
  return (
    point.x < padding ||
    point.y < padding ||
    point.x > canvas.clientWidth - padding ||
    point.y > canvas.clientHeight - padding
  );
}

/** True when track camera should reframe — zoom in/out or recenter to keep a tight fit. */
function needsTrackRefit(map: MapLibreMap, tracked: MapTargetDisplay[], bounds: LngLatBoundsLike) {
  const anyOutside = tracked.some(
    (target) =>
      target.position &&
      isOutsideViewport(map, target.position.latitude, target.position.longitude),
  );
  if (anyOutside) return true;

  const camera = map.cameraForBounds(bounds, {
    padding: FIT_PADDING,
    maxZoom: TRACK_MAX_ZOOM,
  });
  if (!camera || typeof camera.zoom !== "number") return true;

  // Zoom in (or out) when the ideal framing differs from the current view.
  if (Math.abs(camera.zoom - map.getZoom()) > 0.2) return true;

  const current = map.getCenter();
  if (camera.center) {
    const targetLng = Array.isArray(camera.center)
      ? camera.center[0]
      : "lng" in camera.center
        ? camera.center.lng
        : camera.center.lon;
    const targetLat = Array.isArray(camera.center) ? camera.center[1] : camera.center.lat;
    if (Math.abs(current.lng - targetLng) > 1e-5 || Math.abs(current.lat - targetLat) > 1e-5) {
      return true;
    }
  }
  return false;
}

function buildTrailCoordinates(
  target: MapTargetDisplay,
): Array<[number, number]> {
  const coordinates = target.trail.map(
    (point) => [point.longitude, point.latitude] as [number, number],
  );
  if (!target.position) return unwrapLineLongitudes(coordinates);

  const lastTrailPoint = target.trail.at(-1);
  if (
    !lastTrailPoint ||
    lastTrailPoint.latitude !== target.position.latitude ||
    lastTrailPoint.longitude !== target.position.longitude
  ) {
    coordinates.push([target.position.longitude, target.position.latitude]);
  }
  return unwrapLineLongitudes(coordinates);
}

function createMarkerElement(
  target: MapTargetDisplay,
  selectable: boolean,
  onSelect?: (targetId: string) => void,
) {
  const element = document.createElement("button");
  element.type = "button";
  element.className = "tracking-marker";
  element.setAttribute("aria-label", `Focus ${target.callsign}`);
  element.dataset.targetId = target.targetId;
  element.innerHTML = vehicleCategoryIconSvg(target.vehicleCategory);
  if (selectable && onSelect) {
    element.addEventListener("click", () => onSelect(target.targetId));
  } else {
    element.disabled = true;
  }
  return element;
}

export function TrackingMap({
  targets,
  selectedTargetId,
  trackedTargetIds = [],
  showTrackedOnly = false,
  highlightedEventId,
  mode = "2d",
  cameraMode = "overview",
  onCameraModeChange,
  availableCameraModes = ["overview", "pan"],
  onSelectTarget,
  fitTargetsKey,
  continuousMotion = false,
}: TrackingMapProps) {
  const { mapStyle } = useMapData();
  const { resolvedTheme } = useTheme();
  const affiliationTheme = resolveAffiliationColorTheme(resolvedTheme);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef(new Map<string, Marker>());
  const markerAnimationsRef = useRef(new Map<string, number>());
  const selectHandlerRef = useRef(onSelectTarget);
  const fittedKeyRef = useRef<string | null>(null);
  const overviewVisibleKeyRef = useRef<string>("");
  const trailCollectionRef = useRef<TrailFeatureCollection>(EMPTY_TRAIL_COLLECTION);
  const cameraModeRef = useRef(cameraMode);
  const [mapReady, setMapReady] = useState(false);
  selectHandlerRef.current = onSelectTarget;
  cameraModeRef.current = cameraMode;

  const displayTargets = useMemo(() => targets.map(toDisplayTarget), [targets]);
  const trackedSet = useMemo(() => new Set(trackedTargetIds), [trackedTargetIds]);
  const visibleTargets = useMemo(() => {
    if (!showTrackedOnly || trackedSet.size === 0) return displayTargets;
    return displayTargets.filter((target) => trackedSet.has(target.targetId));
  }, [displayTargets, showTrackedOnly, trackedSet]);
  const targetsMotionKey = useMemo(
    () =>
      visibleTargets
        .map((target) => {
          const position = target.position;
          const lastTrail = target.trail.at(-1);
          return [
            target.targetId,
            position?.latitude ?? "",
            position?.longitude ?? "",
            target.heading ?? "",
            target.trail.length,
            lastTrail?.latitude ?? "",
            lastTrail?.longitude ?? "",
          ].join(":");
        })
        .join("|"),
    [visibleTargets],
  );
  const interactive = cameraMode === "pan";

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new MapLibreMap({
      container: containerRef.current,
      style: mapStyle,
      center: [-0.1278, 51.5074],
      zoom: 7,
      attributionControl: false,
      interactive: true,
    });
    map.on("load", () => {
      map.addSource("target-trails", {
        type: "geojson",
        data: trailCollectionRef.current,
      });
      map.addLayer({
        id: "target-trails",
        type: "line",
        source: "target-trails",
        paint: {
          "line-color": ["get", "color"],
          "line-width": 2,
          "line-opacity": 0.8,
        },
      });
      setMapReady(true);
    });
    mapRef.current = map;
    return () => {
      for (const frame of markerAnimationsRef.current.values()) {
        window.cancelAnimationFrame(frame);
      }
      markerAnimationsRef.current.clear();
      markersRef.current.clear();
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (interactive) {
      map.dragPan.enable();
      map.scrollZoom.enable();
      map.boxZoom.enable();
      map.dragRotate.enable();
      map.keyboard.enable();
      map.doubleClickZoom.enable();
      map.touchZoomRotate.enable();
    } else {
      map.dragPan.disable();
      map.scrollZoom.disable();
      map.boxZoom.disable();
      map.dragRotate.disable();
      map.keyboard.disable();
      map.doubleClickZoom.disable();
      map.touchZoomRotate.disable();
    }
  }, [interactive, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const ensureTrailLayer = () => {
      if (!map.getSource("target-trails")) {
        map.addSource("target-trails", {
          type: "geojson",
          data: trailCollectionRef.current,
        });
        map.addLayer({
          id: "target-trails",
          type: "line",
          source: "target-trails",
          paint: {
            "line-color": ["get", "color"],
            "line-width": 2,
            "line-opacity": 0.8,
          },
        });
        return;
      }
      const source = map.getSource("target-trails") as GeoJSONSource | undefined;
      source?.setData(trailCollectionRef.current);
    };

    const restoreTrails = () => {
      if (!map.isStyleLoaded()) return;
      ensureTrailLayer();
    };

    const onStyleLoad = () => {
      ensureTrailLayer();
    };

    map.on("style.load", onStyleLoad);
    void map.setStyle(mapStyle);

    if (map.isStyleLoaded()) {
      restoreTrails();
    } else {
      map.once("idle", restoreTrails);
    }

    return () => {
      map.off("style.load", onStyleLoad);
      map.off("idle", restoreTrails);
    };
  }, [mapReady, mapStyle]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    map.setProjection({ type: mode === "globe" ? "globe" : "mercator" });
    map.easeTo({
      pitch: mode === "globe" ? 18 : 0,
      zoom: mode === "globe" ? 1.7 : Math.max(map.getZoom(), 5),
      duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 700,
    });
  }, [mapReady, mode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const positionedTargets = visibleTargets.filter((target) => target.position);
    const activeIds = new Set(positionedTargets.map((target) => target.targetId));
    for (const [targetId, marker] of markersRef.current) {
      if (!activeIds.has(targetId)) {
        const frame = markerAnimationsRef.current.get(targetId);
        if (frame) window.cancelAnimationFrame(frame);
        markerAnimationsRef.current.delete(targetId);
        marker.remove();
        markersRef.current.delete(targetId);
      }
    }

    for (const target of positionedTargets) {
      const position = target.position;
      if (!position) continue;
      let marker = markersRef.current.get(target.targetId);
      if (!marker) {
        const element = createMarkerElement(target, Boolean(onSelectTarget), (id) =>
          selectHandlerRef.current?.(id),
        );
        marker = new Marker({ element, anchor: "center" })
          .setLngLat([position.longitude, position.latitude])
          .addTo(map);
        markersRef.current.set(target.targetId, marker);
      } else {
        const destination = { lng: position.longitude, lat: position.latitude };
        const existingFrame = markerAnimationsRef.current.get(target.targetId);
        if (existingFrame) window.cancelAnimationFrame(existingFrame);
        if (continuousMotion || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          marker.setLngLat(destination);
        } else {
          const origin = marker.getLngLat();
          if (
            !origin ||
            !Number.isFinite(origin.lng) ||
            !Number.isFinite(origin.lat) ||
            !Number.isFinite(destination.lng) ||
            !Number.isFinite(destination.lat)
          ) {
            marker.setLngLat(destination);
          } else {
            const startedAt = performance.now();
            const deltaLng = shortestLongitudeDelta(origin.lng, destination.lng);
            const animate = (frameTime: number) => {
              const progress = Math.min((frameTime - startedAt) / 650, 1);
              const eased = 1 - (1 - progress) ** 3;
              marker?.setLngLat({
                lng: origin.lng + deltaLng * eased,
                lat: origin.lat + (destination.lat - origin.lat) * eased,
              });
              if (progress < 1) {
                markerAnimationsRef.current.set(
                  target.targetId,
                  window.requestAnimationFrame(animate),
                );
              } else {
                markerAnimationsRef.current.delete(target.targetId);
              }
            };
            markerAnimationsRef.current.set(target.targetId, window.requestAnimationFrame(animate));
          }
        }
        const iconHost = marker.getElement();
        iconHost.innerHTML = vehicleCategoryIconSvg(target.vehicleCategory);
      }
      const element = marker.getElement();
      element.style.setProperty("--target-color", target.color);
      element.style.setProperty(
        "--affiliation-color",
        resolveAffiliationColor(target.affiliation, affiliationTheme),
      );
      const hasHeading =
        typeof target.heading === "number" &&
        Number.isFinite(target.heading) &&
        target.trail.length > 1;
      const markerRotate = vehicleCategoryMarkerRotationDegrees(
        hasHeading ? target.heading : undefined,
        target.vehicleCategory,
      );
      element.style.setProperty("--marker-rotate", `${markerRotate}deg`);
      element.dataset.selected = String(target.targetId === selectedTargetId);
      element.dataset.tracked = String(trackedSet.has(target.targetId));
      element.dataset.highlighted = String(Boolean(highlightedEventId));
      element.setAttribute("aria-pressed", String(target.targetId === selectedTargetId));
      element.title = target.callsign;
    }

    const trailCollection: TrailFeatureCollection = {
      type: "FeatureCollection",
      features: positionedTargets
        .map((target) => {
          const coordinates = buildTrailCoordinates(target);
          if (coordinates.length < 2) return null;
          return {
            type: "Feature" as const,
            properties: { color: target.color, targetId: target.targetId },
            geometry: {
              type: "LineString" as const,
              coordinates,
            },
          };
        })
        .filter((feature): feature is NonNullable<typeof feature> => feature !== null),
    };
    trailCollectionRef.current = trailCollection;
    const source = map.getSource("target-trails") as GeoJSONSource | undefined;
    source?.setData(trailCollection);
  }, [
    affiliationTheme,
    continuousMotion,
    highlightedEventId,
    mapReady,
    onSelectTarget,
    selectedTargetId,
    targetsMotionKey,
    trackedSet,
    visibleTargets,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || cameraMode === "pan") return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const duration = reduced || continuousMotion ? 0 : 700;

    if (cameraMode === "track") {
      const tracked = displayTargets.filter(
        (target) => trackedSet.has(target.targetId) && target.position,
      );
      if (tracked.length === 0) return;
      const bounds = buildBounds(tracked);
      if (!bounds) return;
      if (!needsTrackRefit(map, tracked, bounds)) return;
      // Fit as tightly as possible while keeping every tracked contact in view.
      map.fitBounds(bounds, {
        padding: FIT_PADDING,
        duration: reduced || continuousMotion ? 0 : 450,
        maxZoom: TRACK_MAX_ZOOM,
      });
      return;
    }

    const positioned = visibleTargets.filter((target) => target.position);
    if (positioned.length === 0) return;
    const visibleKey = positioned
      .map((target) => target.targetId)
      .toSorted()
      .join("|");
    const visibilityChanged = overviewVisibleKeyRef.current !== visibleKey;
    overviewVisibleKeyRef.current = visibleKey;
    const anyOutside = positioned.some(
      (target) =>
        target.position &&
        isOutsideViewport(map, target.position.latitude, target.position.longitude),
    );
    if (!anyOutside && !visibilityChanged && fittedKeyRef.current) return;
    const bounds = buildBounds(positioned);
    if (!bounds) return;
    if (fitTargetsKey) fittedKeyRef.current = fitTargetsKey;
    map.fitBounds(bounds, { padding: FIT_PADDING, duration, maxZoom: OVERVIEW_MAX_ZOOM });
  }, [
    cameraMode,
    continuousMotion,
    displayTargets,
    fitTargetsKey,
    mapReady,
    trackedSet,
    visibleTargets,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !fitTargetsKey || cameraMode !== "overview") return;
    if (fittedKeyRef.current === fitTargetsKey) return;
    const bounds = buildBounds(visibleTargets);
    if (!bounds) return;
    fittedKeyRef.current = fitTargetsKey;
    map.fitBounds(bounds, {
      padding: FIT_PADDING,
      duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 700,
      maxZoom: OVERVIEW_MAX_ZOOM,
    });
  }, [cameraMode, fitTargetsKey, mapReady, visibleTargets]);

  function zoomBy(delta: number) {
    const map = mapRef.current;
    if (!map) return;
    map.zoomTo(map.getZoom() + delta, {
      duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 200,
    });
  }

  function resetNorth() {
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({
      bearing: 0,
      pitch: mode === "globe" ? 18 : 0,
      duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 400,
    });
  }

  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden rounded-lg bg-muted">
      <div
        ref={containerRef}
        className="h-full min-h-0 w-full"
        role="region"
        aria-label={`${mode === "globe" ? "3D globe" : "2D map"} target tracking view`}
      />
      <div className="pointer-events-none absolute top-3 right-3 z-10 flex flex-col items-end gap-2">
        {onCameraModeChange ? (
          <ToggleGroup
            value={[cameraMode]}
            onValueChange={(values) => {
              const next = values[0] as CameraMode | undefined;
              if (!next || !availableCameraModes.includes(next)) return;
              onCameraModeChange(next);
            }}
            variant="outline"
            spacing={0}
            className="pointer-events-auto bg-card/75 shadow-sm backdrop-blur-md"
            aria-label="Map camera mode"
          >
            {availableCameraModes.includes("track") ? (
              <ToggleGroupItem value="track" aria-label="Track mode" disabled={trackedSet.size === 0}>
                <LocateFixedIcon />
                Track
              </ToggleGroupItem>
            ) : null}
            {availableCameraModes.includes("overview") ? (
              <ToggleGroupItem value="overview" aria-label="Overview mode">
                <CrosshairIcon />
                Overview
              </ToggleGroupItem>
            ) : null}
            {availableCameraModes.includes("pan") ? (
              <ToggleGroupItem value="pan" aria-label="Pan mode">
                <MoveIcon />
                Pan
              </ToggleGroupItem>
            ) : null}
          </ToggleGroup>
        ) : null}
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
          <Button type="button" size="icon" variant="outline" aria-label="Reset north" onClick={resetNorth}>
            <CompassIcon />
          </Button>
        </ButtonGroup>
      </div>
      <div
        className={cn(
          "pointer-events-none absolute bottom-3 left-3 z-10 rounded-md border bg-card/75 px-2 py-1 text-xs text-muted-foreground backdrop-blur-md",
          interactive ? "opacity-100" : "opacity-80",
        )}
      >
        {cameraMode === "pan" ? "Pan mode — drag to move" : "Auto camera — switch to Pan to drag"}
      </div>
    </div>
  );
}
