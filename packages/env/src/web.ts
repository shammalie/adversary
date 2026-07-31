/// <reference types="vite/client" />

import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  clientPrefix: "VITE_",
  client: {
    VITE_MAP_STYLE_LIGHT: z.string().url(),
    VITE_MAP_STYLE_DARK: z.string().url(),
    VITE_GEO_TILEJSON_URL: z.string().url(),
    /** Base URL for apps/api (no trailing slash). Required for TanStack Query cutover. */
    VITE_API_BASE_URL: z.string().url().optional(),
  },
  // Explicit keys so Vite statically replaces each VITE_* value into the client bundle.
  runtimeEnv: {
    VITE_MAP_STYLE_LIGHT: import.meta.env.VITE_MAP_STYLE_LIGHT,
    VITE_MAP_STYLE_DARK: import.meta.env.VITE_MAP_STYLE_DARK,
    VITE_GEO_TILEJSON_URL: import.meta.env.VITE_GEO_TILEJSON_URL,
    VITE_API_BASE_URL: import.meta.env.VITE_API_BASE_URL,
  },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
