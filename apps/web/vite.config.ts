import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";
import { VitePWA } from "vite-plugin-pwa";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export default defineConfig({
  envDir: repoRoot,
  optimizeDeps: {
    // Keep maplibre out of the dep optimizer so `*.mjs?url` worker imports
    // resolve to the real package file instead of a missing `.vite/deps` path.
    exclude: ["maplibre-gl"],
  },
  server: {
    port: 3001,
    warmup: {
      clientFiles: [
        "./src/main.tsx",
        "./src/routes/__root.tsx",
        "./src/routes/_map.tsx",
        "./src/routes/_map.builder.tsx",
        "./src/index.css",
      ],
    },
  },
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    tailwindcss(),
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
    }),
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: [
        "favicon.ico",
        "favicon-16.png",
        "favicon-32.png",
        "apple-touch-icon.png",
        "icon.svg",
        "logo.svg",
      ],
      manifest: {
        name: "Adversary",
        short_name: "Adversary",
        description: "Target tracking simulation and operations dashboard.",
        theme_color: "#0c1014",
        background_color: "#0c1014",
        display: "standalone",
        start_url: "/",
        icons: [
          {
            src: "/icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2,mjs,json}"],
        navigateFallback: "/index.html",
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/basemaps\.cartocdn\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "carto-basemap",
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 60 * 60 * 24 * 7,
              },
            },
          },
          {
            urlPattern: /^http:\/\/tiles\.adversary\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "local-tileserver",
              expiration: {
                // Route generation fetches many corridor tiles per demo;
                // 64 was far too small and thrashed the cache.
                maxEntries: 512,
                maxAgeSeconds: 60 * 60 * 24 * 7,
              },
            },
          },
          {
            urlPattern: /^https:\/\/tiles\.openfreemap\.org\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "openfreemap-tiles",
              expiration: {
                maxEntries: 512,
                maxAgeSeconds: 60 * 60 * 24 * 7,
              },
            },
          },
        ],
      },
    }),
  ],
  test: {
    environment: "node",
    setupFiles: ["./src/test-setup.ts"],
    // Playwright specs live under e2e/ and must not run under Vitest.
    exclude: ["**/node_modules/**", "**/dist/**", "**/e2e/**"],
  },
});
