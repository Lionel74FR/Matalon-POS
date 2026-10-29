// Motifs de remise et d'offert (29 octobre 2026, demande de Lionel : isoler les offerts à Camby) :
// l'administration ajoute « Camby » (Réglages › Établissement › Remises et offerts) et le met en tête ;
// l'iPad le reçoit à la synchronisation et le propose en offrant un article ; les statistiques de
// l'administration donnent « Offert · Camby ». Un motif en double est refusé à l'écran.
// Usage : serveur local vierge (apps/caisse : node scripts/serveur-local.mjs 4180), puis
//         URL=http://localhost:4180 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/motifs-remise.mjs [dossier-captures]
import { chromium } from "playwright";
import { preparerServeur, rubriqueAdmin } from "./preparer-caisse.mjs";

const URL = process.env.URL ?? "http://localhost:4180";
const sortie = process.argv[2] ?? "captures";
const { code, cookie, appel } = await preparerServeur(URL, "Comptoir");
const [nomCookie, valeurCookie] = cookie.split("=");
const erreurs = [];
const b = await chromium.launch();
const texte = async (loc) => ((await loc.textContent()) ?? "").replace(/[\s  ]+/g, " ").trim();
const r = {};

// ── iPad rattaché d'abord (il reçoit les motifs par la synchronisation suivante) ──
const ctx = await b.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true });
const p = await ctx.newPage();
p.on("pageerror", (e) => erreurs.push(`ipad : ${e.message}`));
const clic = (n) => p.getByRole("button", { name: n, exact: true }).first().click();
await p.goto(URL);
await p.locator(".champ-code input").fill(code);
await clic("Rattacher l'iPad");
await clic("Configurer plus tard");
await p.locator(".carte-personne", { hasText: "Lionel" }).click();
for (const x of "1234") await p.locator(".pave .touche", { hasText: new RegExp(`^${x}$`) }).last().click();
await clic("Plus tard");

// ── Administration : « Camby » en tête des motifs ──
const ca = await b.newContext({ viewport: { width: 1440, height: 900 } });
await ca.addCookies([{ name: nomCookie, value: valeurCookie, url: `${URL}/api/admin` }]);
const a = await ca.newPage();
a.on("pageerror", (e) => erreurs.push(`admin : ${e.message}`));
await a.goto(`${URL}/admin#/moka/accueil`);
await rubriqueAdmin(a, "Établissement");
const section = a.locator(".motifs-remise");
await section.waitFor();
r.defaut = await section.locator(".motifs-liste input").evaluateAll((l) => l.map((x) => x.value));
await section.getByRole("button", { name: "Ajouter un motif" }).click();
const dernier = section.locator(".motifs-liste input").last();
await dernier.fill("geste commercial");
r.doublon = await texte(section.locator(".erreur"));
r.boutonBloque = await section.getByRole("button", { name: "Enregistrer les motifs" }).isDisabled();
await dernier.fill("Camby");
for (let i = 0; i < 5; i++) await section.getByRole("button", { name: "Monter « Camby »" }).click();
await section.getByRole("button", { name: "Enregistrer les motifs" }).click();
await section.locator(".succes").waitFor();
await a.screenshot({ path: `${sortie}/mr01-motifs.png` });
r.serveur = (await appel("GET", "/etablissements")).etablissements.find((e) => e.id === "moka").motifsRemise;

// ── iPad : synchronisation, puis un cappuccino offert à Camby ──
await p.locator(".puce-synchro").click();
await p.locator(".puce-synchro.synchronise").waitFor({ timeout: 20000 });
await p.getByRole("button", { name: /Vente Directe/ }).click();
await p.locator(".tuile", { hasText: "Cappuccino" }).first().click();
await p.locator(".ticket-ligne", { hasText: "Cappuccino" }).click();
await clic("Offert");
r.motifsCaisse = (await p.locator(".modale .groupe-choix .options").last().locator("button").allTextContents()).map((x) => x.trim());
await p.screenshot({ path: `${sortie}/mr02-caisse.png` });
await clic("Camby");
await p.getByRole("button", { name: /^Valider/ }).click();
await clic("Encaisser");
await p.getByRole("button", { name: /^Valider l'encaissement/ }).click();
await clic("Terminé");
await p.locator(".puce-synchro.synchronise").waitFor({ timeout: 20000 });

// ── Statistiques de l'administration : « Offert · Camby » ──
await rubriqueAdmin(a, "Statistiques");
const tableau = a.locator(".stat-carte", { hasText: "Remises et offerts par motif" });
await tableau.locator("td", { hasText: "Offert · Camby" }).waitFor({ timeout: 20000 });
r.stat = (await tableau.locator("tr", { hasText: "Offert · Camby" }).locator("td").allTextContents()).map((x) => x.trim());
await tableau.scrollIntoViewIfNeeded();
await a.screenshot({ path: `${sortie}/mr03-stats.png` });
await b.close();

console.log(JSON.stringify({ ...r, erreurs }, null, 2));
const ok =
  JSON.stringify(r.defaut) === JSON.stringify(["Geste commercial", "Client habitué", "Erreur de service", "Repas du personnel", "Offert maison"]) &&
  /figure deux fois/.test(r.doublon) &&
  r.boutonBloque &&
  JSON.stringify(r.serveur) === JSON.stringify(["Camby", "Geste commercial", "Client habitué", "Erreur de service", "Repas du personnel", "Offert maison"]) &&
  r.motifsCaisse[0] === "Camby" &&
  r.motifsCaisse.length === 6 &&
  r.stat[0] === "Offert · Camby" &&
  r.stat[1] === "1" &&
  /4,00/.test(r.stat[2]) &&
  !erreurs.length;
if (!ok) process.exit(1);
