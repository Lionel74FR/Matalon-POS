// Serveur local de bout en bout : les fichiers construits de la caisse (apps/caisse/dist)
// et l'API Matalon POS sur une base Postgres embarquée (PGlite, en mémoire).
// Mêmes règles d'adresses que sur Vercel (scripts/vercel-build.mjs).
// Usage (dans apps/caisse) : pnpm build && node scripts/serveur-local.mjs [port]
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { PGlite } from "@electric-sql/pglite";

const port = Number(process.argv[2] ?? 4180);
const ici = dirname(fileURLToPath(import.meta.url));
const racine = resolve(ici, "../dist");
const paquet = join(tmpdir(), `matalon-serveur-${process.pid}.mjs`);
await build({
  entryPoints: [resolve(ici, "../../../packages/serveur/src/index.ts")],
  outfile: paquet,
  bundle: true,
  format: "esm",
  platform: "node",
  external: ["@neondatabase/serverless"],
  logLevel: "warning",
});
const { traiter } = await import(pathToFileURL(paquet).href);

const pg = new PGlite();
const db = {
  requete: async (t, p = []) => (await pg.query(t, p)).rows,
  lot: async (requetes) => {
    await pg.transaction(async (tx) => {
      for (const r of requetes) await tx.query(r.texte, r.params ?? []);
    });
  },
};

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2", ".woff": "font/woff", ".json": "application/json" };
const REECRITURES = { "/admin": "/admin.html", "/n": "/n.html", "/guide": "/guide.html" };
// E-mails des réservations : gardés en mémoire, lisibles sur /__courriels (essais de bout en bout).
const courriels = [];
const envoyerCourriel = async (c) => void courriels.push(c);
// Clé maîtresse des secrets d'établissement : tirée au hasard à chaque démarrage (base vierge).
const cleSecrets = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith("/api/")) {
    const morceaux = [];
    for await (const m of req) morceaux.push(m);
    const corps = morceaux.length ? Buffer.concat(morceaux) : undefined;
    // Le cookie d'administration est « Secure » : en local (http) on le laisse passer quand même.
    const requete = new Request(url, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : corps });
    const reponse = await traiter(requete, { db, envoyerCourriel, envoiGroupe: true, cleSecrets });
    const entetes = Object.fromEntries(reponse.headers);
    if (entetes["set-cookie"]) entetes["set-cookie"] = entetes["set-cookie"].replace("; Secure", "");
    res.writeHead(reponse.status, entetes);
    res.end(Buffer.from(await reponse.arrayBuffer()));
    return;
  }
  if (url.pathname === "/__courriels") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(courriels));
    return;
  }
  const chemin = REECRITURES[url.pathname] ?? (url.pathname.startsWith("/reserver") ? "/reserver.html" : url.pathname);
  let fichier = join(racine, chemin);
  if (!fichier.startsWith(racine) || !existsSync(fichier) || statSync(fichier).isDirectory()) fichier = join(racine, "index.html");
  res.writeHead(200, { "Content-Type": TYPES[extname(fichier)] ?? "application/octet-stream", "Cache-Control": "no-cache" });
  res.end(readFileSync(fichier));
}).listen(port, () => console.log(`Matalon POS local : http://localhost:${port} (administration : /admin)`));
