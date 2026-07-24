import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
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
      includeAssets: ["favicon.ico"],
      manifest: {
        name: "Adversary",
        short_name: "Adversary",
        description: "Target tracking simulation and operations dashboard.",
        theme_color: "#09090b",
        background_color: "#09090b",
        display: "standalone",
        start_url: "/",
        icons: [
          {
            src: "/favicon.ico",
            sizes: "64x64",
            type: "image/x-icon",
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
        ],
      },
    }),
  ],
  test: {
    environment: "node",
    setupFiles: ["./src/test-setup.ts"],
  },
});
