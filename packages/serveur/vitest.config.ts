import { defineConfig } from "vitest/config";

// Scénarios complets sur base embarquée (PGlite) : au-delà de 5 s sur une machine chargée.
export default defineConfig({ test: { testTimeout: 20_000 } });
