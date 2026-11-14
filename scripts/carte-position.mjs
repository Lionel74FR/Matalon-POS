// La carte rouvre là où on l'a laissée (demande de Lionel du 14 novembre 2026) : sur l'iPad, table 4,
// rayon « Cuisine », catégorie « Salades » ; une Salade Moka encaissée ; la table 7 (nouvelle commande)
// s'ouvre sur Cuisine › Salades, la Vente Directe aussi, et encore après un redémarrage de l'app. Un
// autre rayon choisi ensuite est repris à son tour.
// Usage : serveur local vierge (apps/caisse : node scripts/serveur-local.mjs 4180), puis
//         URL=http://localhost:4180 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/carte-position.mjs [dossier-captures]
import { chromium } from "playwright";
import { preparerServeur } from "./preparer-caisse.mjs";

const URL = process.env.URL ?? "http://localhost:4180";
const sortie = process.argv[2] ?? "captures";
const { code } = await preparerServeur(URL, "Comptoir");
const erreurs = [];
const b = await chromium.launch();
const texte = async (loc) => ((await loc.textContent()) ?? "").replace(/[\s  ]+/g, " ").trim();
const r = {};

const ctx = await b.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true });
const p = await ctx.newPage();
p.on("pageerror", (e) => erreurs.push(`ipad : ${e.message}`));
const clic = (n) => p.getByRole("button", { name: n, exact: true }).first().click();
const connexion = async () => {
  await p.locator(".carte-personne", { hasText: "Lionel" }).click();
  for (const x of "1234") await p.locator(".pave .touche", { hasText: new RegExp(`^${x}$`) }).last().click();
};
/** Rayon et catégorie actifs de la carte. */
const position = async () => ({
  rayon: await texte(p.locator(".rayons [role=tab][aria-selected=true]")),
  categorie: (await p.locator(".categories .pastille.active").count()) ? await texte(p.locator(".categories .pastille.active")) : null,
});
await p.goto(URL);
await p.locator(".champ-code input").fill(code);
await clic("Rattacher l'iPad");
await clic("Configurer plus tard");
await connexion();
await clic("Plus tard");
await p.locator(".puce-synchro.synchronise").waitFor({ timeout: 20000 });

// ── Table 4 : première commande, la carte s'ouvre sur le premier rayon ──
await p.getByRole("button", { name: /^Table 4,/ }).click();
r.premiere = await position();
await p.getByRole("tab", { name: "Cuisine" }).click();
await p.locator(".categories .pastille", { hasText: "Salades" }).click();
await p.locator(".tuile", { hasText: "Salade Moka" }).first().click();
await clic("Encaisser");
await p.locator(".mode", { hasText: "Carte bancaire" }).click();
await p.getByRole("button", { name: /^Valider l'encaissement/ }).click();
await clic("Terminé");

// ── Table 7, nouvelle commande : Cuisine › Salades ──
await p.getByRole("button", { name: /^Table 7,/ }).click();
r.table7 = await position();
await p.screenshot({ path: `${sortie}/cp01-table7.png` });
await p.getByRole("button", { name: "Retour à la salle" }).click();
await clic("Vente Directe");
r.venteDirecte = await position();

// ── Redémarrage de l'app ──
await p.reload();
await connexion();
await clic("Plus tard");
await p.getByRole("button", { name: /^Table 2,/ }).click();
r.apresRedemarrage = await position();

// ── Un autre rayon, repris à son tour ──
await p.getByRole("tab", { name: "Bar" }).click();
await p.getByRole("button", { name: "Retour à la salle" }).click();
await p.getByRole("button", { name: /^Table 3,/ }).click();
r.ensuite = await position();
await b.close();

console.log(JSON.stringify({ ...r, erreurs }, null, 2));
const salades = (x) => x.rayon === "Cuisine" && x.categorie === "Salades";
const ok =
  r.premiere.rayon === "Boissons" &&
  salades(r.table7) &&
  salades(r.venteDirecte) &&
  salades(r.apresRedemarrage) &&
  r.ensuite.rayon === "Bar" &&
  !erreurs.length;
if (!ok) process.exit(1);
