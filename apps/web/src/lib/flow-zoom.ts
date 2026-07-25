import { useStore } from "@xyflow/react";

/** Keep strokes ~constant on screen as React Flow scales the viewport. */
export function zoomCompensatedWidth(zoom: number, basePx: number, maxPx = 6) {
  const safeZoom = Math.max(zoom, 0.05);
  return Math.min(maxPx, Math.max(basePx, basePx / safeZoom));
}

export function useZoomCompensatedWidth(basePx: number, maxPx = 6) {
  return useStore((state) => zoomCompensatedWidth(state.transform[2] || 1, basePx, maxPx));
}

export function useFlowZoom() {
  return useStore((state) => state.transform[2] || 1);
}

/** Progressive node content as the viewport zooms in. */
export type EventGraphDetailLevel = "type" | "summary" | "full";

export function eventGraphDetailLevel(zoom: number): EventGraphDetailLevel {
  if (zoom < 0.65) return "type";
  if (zoom < 1) return "summary";
  return "full";
}

export function useEventGraphDetailLevel() {
  return useStore((state) => eventGraphDetailLevel(state.transform[2] || 1));
}
