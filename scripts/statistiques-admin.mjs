// Statistiques dans l'administration (demande de Lionel du 16 octobre), en direct : la page reste ouverte
// sur l'ordinateur, l'iPad ouvre une table puis l'encaisse ; sans rechargement, « En salle maintenant »
// montre la table ouverte, puis le chiffre d'affaires prend la vente et la table quitte la salle.
// Le CA par heure suit la journée de service (8 h → 3 h du matin).
// Usage : serveur local vierge (apps/caisse : node scripts/serveur-local.mjs 4180), puis
//         URL=http://localhost:4180 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/statistiques-admin.mjs [dossier-captures]
import { chromium } from "playwright";
import { preparerServeur } from "./preparer-caisse.mjs";

const URL = process.env.URL ?? "http://localhost:4180";
const sortie = process.argv[2] ?? "captures";
const { code, cookie } = await preparerServeur(URL, "Comptoir");
const [nomCookie, valeurCookie] = cookie.split("=");
const erreurs = [];
const b = await chromium.launch();
const texte = async (loc) => ((await loc.textContent()) ?? "").replace(/\s+/g, " ").trim();
const r = {};

// ── Administration, rubrique Statistiques ──
const ctxAdmin = await b.newContext({ viewport: { width: 1280, height: 860 } });
await ctxAdmin.addCookies([{ name: nomCookie, value: valeurCookie, url: `${URL}/api/admin` }]);
const admin = await ctxAdmin.newPage();
admin.on("pageerror", (e) => erreurs.push(`admin : ${e.message}`));
await admin.goto(`${URL}/admin#/moka/statistiques`);
await admin.locator(".stat-direct").waitFor({ timeout: 15000 });
await admin.evaluate(() => (window.__sansRechargement = true));
const ca = admin.locator(".stat-tuile.heros .stat-valeur");
const salle = admin.locator(".stat-en-salle");
r.caDepart = await texte(ca);
r.salleDepart = await texte(salle);

// ── iPad : table 3, deux cappuccinos, laissée ouverte ──
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
await p.locator(".puce-synchro.synchronise").waitFor({ timeout: 15000 });
await p.getByRole("button", { name: /^Table 3,/ }).click();
for (let i = 0; i < 2; i++) await p.locator(".tuile", { hasText: "Cappuccino" }).first().click();
await p.getByRole("button", { name: "Retour à la salle" }).click();

let t0 = Date.now();
await salle.filter({ hasText: "À encaisser 8,00 €" }).waitFor({ timeout: 40000 });
r.delaiSalleMs = Date.now() - t0;
r.salleOuverte = await texte(salle);
await admin.screenshot({ path: `${sortie}/sa01-admin-en-salle.png` });

// ── iPad : encaissement par carte ──
await p.getByRole("button", { name: /^Table 3,/ }).click();
await clic("Encaisser");
await p.locator(".mode", { hasText: "Carte bancaire" }).click();
await p.getByRole("button", { name: /^Valider l'encaissement/ }).click();
await clic("Terminé");
t0 = Date.now();
await admin.locator(".stat-tuile.heros .stat-valeur", { hasText: "8,00 €" }).waitFor({ timeout: 40000 });
r.delaiCaMs = Date.now() - t0;
await salle.filter({ hasText: "Aucune table ouverte" }).waitFor({ timeout: 40000 });
r.sansRechargement = await admin.evaluate(() => window.__sansRechargement === true);
r.direct = await texte(admin.locator(".stat-direct"));
// CA par heure dans l'ordre du service : de 8 h à 3 h du matin, minuit passé après 23 h.
r.heures = await admin.locator(".stat-carte", { hasText: "CA par heure" }).locator(".stat-col").evaluateAll((cols) => cols.map((c) => c.getAttribute("aria-label").split(" h")[0]));
await admin.screenshot({ path: `${sortie}/sa02-admin-vente.png`, fullPage: true });
// Une période passée n'est pas « en direct » et n'a pas de salle en cours.
await admin.getByRole("button", { name: "Hier", exact: true }).click();
await admin.locator(".stat-direct").waitFor({ state: "detached", timeout: 10000 });
r.hierSansSalle = (await salle.count()) === 0;
await b.close();

console.log(JSON.stringify({ ...r, erreurs }, null, 2));
const ok =
  r.caDepart === "0,00 €" &&
  /Aucune table ouverte/.test(r.salleDepart) &&
  /1 table ouverte/.test(r.salleOuverte) &&
  r.delaiSalleMs < 15000 &&
  r.delaiCaMs < 15000 &&
  r.sansRechargement &&
  /En direct · mis à jour à \d\d:\d\d:\d\d/.test(r.direct) &&
  r.hierSansSalle &&
  r.heures[0] === "8" &&
  r.heures.indexOf("23") + 1 === r.heures.indexOf("0") &&
  r.heures.at(-1) === "2" &&
  !erreurs.length;
if (!ok) process.exit(1);
