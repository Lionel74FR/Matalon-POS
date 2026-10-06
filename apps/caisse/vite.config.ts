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
      // Trois pages : la caisse, la note numérique ouverte par le client (QR code) et l'administration.
      input: { caisse: "index.html", note: "n.html", admin: "admin.html" },
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
        name: "Matalon POS",
        short_name: "Matalon POS",
        description: "Caisse des établissements du groupe Matalon",
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
        // L'administration se consulte en ligne, sur ordinateur : rien à garder sur l'iPad.
        globIgnores: ["admin.html", "assets/admin-*"],
        navigateFallback: "index.html",
        navigateFallbackDenylist: [/^\/guide/, /^\/n(\.html)?$/, /^\/api\//, /^\/admin/],
      },
    }),
  ],
  test: {
    environment: "node",
  },
});
