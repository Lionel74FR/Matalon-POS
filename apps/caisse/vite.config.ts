/// <reference types="vitest" />
import { execSync } from "node:child_process";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

function versionBuild(): string {
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return "local";
  }
}

export default defineConfig({
  build: {
    rollupOptions: {
      // Deux pages : la caisse, et la note numérique ouverte par le client (QR code).
      input: { caisse: "index.html", note: "n.html" },
    },
  },
  define: {
    __BUILD__: JSON.stringify(`${versionBuild()}-${new Date().toISOString().slice(0, 10)}`),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["icone.svg", "icone-180.png"],
      manifest: {
        name: "Moka Caisse",
        short_name: "Caisse",
        description: "Caisse du Moka — Matalon POS",
        lang: "fr",
        display: "standalone",
        orientation: "any",
        background_color: "#2B1E18",
        theme_color: "#2B1E18",
        icons: [
          { src: "icone-192.png", sizes: "192x192", type: "image/png" },
          { src: "icone-512.png", sizes: "512x512", type: "image/png" },
          { src: "icone.svg", sizes: "any", type: "image/svg+xml" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff,woff2}"],
        navigateFallback: "index.html",
        navigateFallbackDenylist: [/^\/guide/, /^\/n(\.html)?$/],
      },
    }),
  ],
  test: {
    environment: "node",
  },
});
