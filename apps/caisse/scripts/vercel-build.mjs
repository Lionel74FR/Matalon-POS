/**
 * Construction pour Vercel (Build Output API v3) :
 * - la caisse, la note client et l'administration en fichiers statiques ;
 * - l'API en une fonction Edge unique, région Paris (cdg1), qui parle à Neon.
 * Lancé par Vercel (commande de build du projet) ou à la main : node scripts/vercel-build.mjs
 */
import { execSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const racine = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sortie = resolve(racine, ".vercel/output");

execSync("pnpm run build", { cwd: racine, stdio: "inherit" });

rmSync(sortie, { recursive: true, force: true });
mkdirSync(resolve(sortie, "static"), { recursive: true });
cpSync(resolve(racine, "dist"), resolve(sortie, "static"), { recursive: true });

const fonction = resolve(sortie, "functions/api.func");
mkdirSync(fonction, { recursive: true });
await build({
  entryPoints: [resolve(racine, "../../packages/serveur/src/vercel.ts")],
  outfile: resolve(fonction, "index.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  conditions: ["edge-light", "worker", "browser"],
  target: "es2022",
  minify: false,
  sourcemap: false,
  legalComments: "none",
  logLevel: "info",
});
writeFileSync(
  resolve(fonction, ".vc-config.json"),
  JSON.stringify({ runtime: "edge", entrypoint: "index.js", regions: ["cdg1"], envVarsInUse: ["DATABASE_URL", "POSTGRES_URL", "BREVO_CLE", "EMAIL_EXPEDITEUR"] }, null, 2),
);

const sansCache = { "Cache-Control": "no-cache" };
const securite = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000",
};
writeFileSync(
  resolve(sortie, "config.json"),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: "/sw\\.js", headers: sansCache, continue: true },
        { src: "/(index|admin|n)?(\\.html)?", headers: sansCache, continue: true },
        { src: "/assets/(.*)", headers: { "Cache-Control": "public, max-age=31536000, immutable" }, continue: true },
        { src: "/admin(\\.html)?", headers: { "X-Frame-Options": "DENY", "X-Robots-Tag": "noindex" }, continue: true },
        // Module de réservation : affiché dans un cadre sur le site de l'établissement.
        { src: "/reservation\\.js", headers: { "Cache-Control": "public, max-age=300" }, continue: true },
        { src: "/reserver(/.*)?", headers: { ...sansCache, "Content-Security-Policy": "frame-ancestors *" }, continue: true },
        { src: "/(.*)", headers: securite, continue: true },
        { src: "/api/(.*)", dest: "/api" },
        { handle: "filesystem" },
        { src: "/admin", dest: "/admin.html" },
        { src: "/n", dest: "/n.html" },
        { src: "/guide", dest: "/guide.html" },
        { src: "/reserver(/.*)?", dest: "/reserver.html" },
        { src: "/(.*)", dest: "/index.html" },
      ],
    },
    null,
    2,
  ),
);
console.log("Sortie Vercel prête :", sortie);
