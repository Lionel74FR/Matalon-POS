// Plan de salle : dessiné dans l'administration (formes, chaises, décor, table masquée), reçu par
// l'iPad ; tables assemblées pour un groupe ; plan retouché sur l'iPad par un responsable ; une
// modification concurrente de l'administration est refusée au lieu d'écraser celle de l'iPad.
// Usage : serveur local vierge (apps/caisse : node scripts/serveur-local.mjs 4180), puis
//         URL=http://localhost:4180 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/plan.mjs [dossier-captures]
import { chromium } from "playwright";
import { preparerServeur } from "./preparer-caisse.mjs";

const URL = process.env.URL ?? "http://localhost:4180";
const sortie = process.argv[2] ?? "captures";
const { code, cookie, appel } = await preparerServeur(URL, "Comptoir");
const [nomCookie, valeurCookie] = cookie.split("=");
const b = await chromium.launch();
const erreurs = [];

/** Glisse un élément du plan de (dx, dy) pixels. */
async function glisser(page, element, dx, dy) {
  const r = await element.boundingBox();
  const x = r.x + r.width / 2;
  const y = r.y + r.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 5; i++) await page.mouse.move(x + (dx * i) / 5, y + (dy * i) / 5);
  await page.mouse.up();
}

// ── Administration : le plan ──
const bureau = await b.newContext({ viewport: { width: 1280, height: 1000 } });
await bureau.addCookies([{ name: nomCookie, value: valeurCookie, url: `${URL}/api/admin` }]);
const a = await bureau.newPage();
a.on("pageerror", (e) => erreurs.push(`admin : ${e.message}`));
await a.goto(`${URL}/admin`);
const section = a.locator(".admin-section", { has: a.getByRole("heading", { name: "Plan de salle" }) });
await section.scrollIntoViewIfNeeded();
await section.getByRole("button", { name: "Table ronde" }).click();
await section.getByRole("button", { name: "Une chaise de plus" }).click();
await section.getByRole("button", { name: "Une chaise de plus" }).click();
await glisser(a, section.getByRole("button", { name: "Table 13" }), 140, 60);
await section.getByRole("button", { name: "Bar", exact: true }).click();
await section.getByRole("button", { name: "Table 1", exact: true }).click();
await section.getByRole("radio", { name: "Rectangle" }).click();
await section.getByRole("button", { name: "Tourner" }).click();
await section.getByRole("button", { name: "Table 12", exact: true }).click();
await section.getByRole("button", { name: "Masquer" }).click();
await section.screenshot({ path: `${sortie}/s01-editeur-admin.png` });
await section.getByRole("button", { name: "Enregistrer le plan" }).click();
await section.getByText("Plan enregistré.").waitFor();
const moka = (await appel("GET", "/etablissements")).etablissements.find((e) => e.id === "moka");
const t13 = moka.tables.find((t) => t.nom === "13");
const t1 = moka.tables.find((t) => t.id === "t1");

// ── iPad : le plan reçu ──
const ctx = await b.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true });
const p = await ctx.newPage();
p.on("pageerror", (e) => erreurs.push(`iPad : ${e.message}`));
const clic = (n) => p.getByRole("button", { name: n, exact: true }).first().click();
await p.goto(URL);
await p.locator(".champ-code input").fill(code);
await clic("Rattacher l'iPad");
await clic("Configurer plus tard");
await p.locator(".carte-personne", { hasText: "Lionel" }).click();
for (const x of "1234") await p.locator(".pave .touche", { hasText: new RegExp(`^${x}$`) }).last().click();
await clic("Plus tard");
await p.locator(".puce-synchro.synchronise").waitFor({ timeout: 15000 });
const tablesPlan = await p.locator(".plan-salle .plan-table").count();
const decorBar = await p.locator(".plan-salle .plan-decor.bar").count();

// Groupe : table 3 assemblée avec 4 et 5.
await p.getByRole("button", { name: /^Table 3, libre/ }).click();
await p.locator(".tuile", { hasText: "Cappuccino" }).first().click();
await p.getByRole("button", { name: "Assembler des tables" }).click();
await p.locator(".modale .table", { hasText: /^4/ }).click();
await p.locator(".modale .table", { hasText: /^5/ }).click();
await p.getByRole("button", { name: "Assembler 2 tables" }).click();
const titre = await p.locator(".ticket-titre h1").textContent();
await p.getByRole("button", { name: "Retour à la salle" }).click();
const table4 = await p.getByRole("button", { name: /^Table 4, assemblée à la table 3/ }).count();
await p.screenshot({ path: `${sortie}/s02-plan-ipad.png` });
// Toucher une table assemblée ouvre la commande du groupe.
await p.getByRole("button", { name: /^Table 5, assemblée/ }).click();
const titreDepuis5 = await p.locator(".ticket-titre h1").textContent();
await clic("Encaisser");
await p.locator(".mode", { hasText: "Carte bancaire" }).click();
await p.getByRole("button", { name: /^Valider l'encaissement/ }).click();
await clic("Terminé");
await p.getByRole("button", { name: /^Table 4, libre/ }).waitFor();

// Vue liste.
await p.getByRole("button", { name: "Afficher la liste des tables" }).click();
const listeTables = await p.locator(".grille-tables .table").count();
await p.getByRole("button", { name: "Afficher le plan de salle" }).click();

// Retouche du plan sur l'iPad (Lionel est responsable).
await p.getByRole("button", { name: "Modifier le plan de salle" }).click();
await glisser(p, p.getByRole("button", { name: "Table 2", exact: true }), 0, 90);
await p.screenshot({ path: `${sortie}/s03-editeur-ipad.png` });
await p.getByRole("button", { name: "Enregistrer le plan" }).click();
await p.getByText("Plan de salle enregistré pour toutes les caisses.").waitFor();
const apresIpad = (await appel("GET", "/etablissements")).etablissements.find((e) => e.id === "moka");

// L'administration, restée sur l'ancienne version, ne peut pas écraser la retouche de l'iPad.
// (Le plan iPhone est couvert par note-et-iphone.mjs.)
await section.getByRole("button", { name: "Table carrée" }).click();
await section.getByRole("button", { name: "Enregistrer le plan" }).click();
await section.getByText(/modifié ailleurs/).waitFor();
const conflit = true;

await b.close();

const resultat = {
  t13: t13 && { forme: t13.forme, chaises: t13.chaises, x: t13.x, y: t13.y },
  t1: t1 && { forme: t1.forme, rotation: t1.rotation },
  t12Masquee: moka.tables.find((t) => t.id === "t12")?.masquee,
  toutesPlacees: moka.tables.filter((t) => !t.masquee).every((t) => Number.isInteger(t.x)),
  decor: moka.zones[0]?.decor.map((d) => d.type),
  planVersionAdmin: moka.planVersion,
  tablesPlan,
  decorBar,
  titre,
  table4,
  titreDepuis5,
  listeTables,
  planVersionIpad: apresIpad.planVersion,
  t2Deplacee: apresIpad.tables.find((t) => t.id === "t2").y !== moka.tables.find((t) => t.id === "t2").y,
  conflit,
  erreurs,
};
console.log(JSON.stringify(resultat, null, 2));
const ok =
  resultat.t13?.forme === "rond" &&
  resultat.t13.chaises === 6 &&
  resultat.t1?.forme === "rectangle" &&
  resultat.t1.rotation === 90 &&
  resultat.t12Masquee === true &&
  resultat.toutesPlacees &&
  resultat.decor?.includes("bar") &&
  planVersionOk() &&
  tablesPlan === 12 &&
  decorBar === 1 &&
  /Table 3 \+ 4 \+ 5/.test(titre ?? "") &&
  titreDepuis5 === titre &&
  table4 === 1 &&
  listeTables === 12 &&
  resultat.t2Deplacee &&
  erreurs.length === 0;
function planVersionOk() {
  return resultat.planVersionAdmin === 1 && resultat.planVersionIpad === 2;
}
if (!ok) process.exit(1);
