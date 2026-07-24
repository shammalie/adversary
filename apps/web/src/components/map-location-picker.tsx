import { useEffect, useRef, useState } from "react";
import { AttributionControl, Map as MapLibreMap, Marker } from "maplibre-gl";
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

interface MapLocationPickerProps {
  value: PositionPayload;
  onChange: (value: PositionPayload) => void;
  idPrefix?: string;
}

export function MapLocationPicker({
  value,
  onChange,
  idPrefix = "map-point",
}: MapLocationPickerProps) {
  const { mapStyle, activeRegion } = useMapData();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const onChangeRef = useRef(onChange);
  const valueRef = useRef(value);
  const [mapReady, setMapReady] = useState(false);
  const [speedUnit, setSpeedUnit] = useState<SpeedUnit>("kt");
  const [speedDraft, setSpeedDraft] = useState("");
  const skipSpeedSyncRef = useRef(false);
  onChangeRef.current = onChange;
  valueRef.current = value;

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
    map.on("load", () => setMapReady(true));

    markerRef.current = marker;
    mapRef.current = map;
    return () => {
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
    void map.setStyle(mapStyle);
  }, [mapReady, mapStyle]);

  useEffect(() => {
    if (!mapReady || !markerRef.current) return;
    markerRef.current.setLngLat([value.longitude, value.latitude]);
    mapRef.current?.setCenter([value.longitude, value.latitude]);
  }, [mapReady, value.latitude, value.longitude]);

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
