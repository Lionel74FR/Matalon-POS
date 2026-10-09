// Écran Statistiques de la caisse : quelques ventes (comptoir et table 4 avec couverts, un offert, une
// annulation), puis l'écran du responsable : indicateurs, CA par heure, moyens de paiement, articles,
// équipe, alerte à lire (code PIN bloqué) marquée vue avec le code d'un responsable. Captures iPad et iPhone.
// Usage : serveur local vierge (apps/caisse : node scripts/serveur-local.mjs 4180), puis
//         URL=http://localhost:4180 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/statistiques.mjs [dossier-captures]
import { chromium } from "playwright";
import { preparerServeur } from "./preparer-caisse.mjs";

const URL = process.env.URL ?? "http://localhost:4180";
const sortie = process.argv[2] ?? "captures";
const { code, appel } = await preparerServeur(URL, "Comptoir");
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true });
const p = await ctx.newPage();
const erreurs = [];
p.on("pageerror", (e) => erreurs.push(e.message));
const clic = (nom) => p.getByRole("button", { name: nom, exact: true }).first().click();
const pin = async (code) => {
  for (const x of code) await p.locator(".pave .touche", { hasText: new RegExp(`^${x}$`) }).last().click();
};
const encaisser = async (mode) => {
  await clic("Encaisser");
  await p.locator(".mode", { hasText: mode }).click();
  await p.getByRole("button", { name: /^Valider l'encaissement/ }).click();
  await clic("Terminé");
};

await p.goto(URL);
await p.locator(".champ-code input").fill(code);
await clic("Rattacher l'iPad");
await clic("Configurer plus tard");
// Un code PIN bloqué : l'alerte arrivera sur l'écran Statistiques.
await p.locator(".carte-personne", { hasText: "Lionel" }).click();
for (let i = 0; i < 5; i++) await pin("0000");
await p.waitForTimeout(1000); // le blocage s'écrit au journal
await p.evaluate(() => {
  for (const k of Object.keys(localStorage)) if (k.startsWith("matalon.pin.")) localStorage.removeItem(k);
});
await p.reload();
const plusTard = p.getByRole("button", { name: "Configurer plus tard", exact: true });
await plusTard.waitFor({ timeout: 4000 }).then(() => plusTard.click()).catch(() => undefined);
await p.locator(".carte-personne", { hasText: "Lionel" }).click();
await pin("1234");
await clic("Plus tard");

// Ventes : comptoir (CB, espèces), table 4 avec 2 couverts, puis une annulation.
for (const [articles, mode] of [
  [["Cappuccino", "Latte"], "Carte bancaire"],
  [["Espresso"], "Espèces"],
  [["Flat white", "Cappuccino"], "Carte bancaire"],
]) {
  await clic("Vente comptoir");
  for (const a of articles) await p.locator(".tuile", { hasText: a }).first().click();
  await encaisser(mode);
}
await p.getByRole("button", { name: "Afficher la liste des tables" }).click().catch(() => undefined);
await p.locator(".grille-tables .table", { hasText: /^4/ }).first().click();
await p.locator(".tuile", { hasText: "Cappuccino" }).first().click();
await p.locator(".tuile", { hasText: "Cappuccino" }).first().click();
await p.getByRole("button", { name: "Indiquer les couverts" }).click();
await clic("2");
await encaisser("Carte bancaire");
await p.getByRole("tab", { name: "Tickets" }).click();
await p.locator(".tableau-tickets tbody tr").first().click();
await clic("Annuler ce ticket");
await clic("Erreur de saisie");
await p.locator(".modale").getByRole("button", { name: /^Annuler \d/ }).click();
await p.waitForTimeout(500);
await p.locator(".puce-synchro").click();
await p.locator(".puce-synchro.synchronise").waitFor({ timeout: 20000 });

// ── Écran Statistiques ──
await p.getByRole("button", { name: /^Menu/ }).click().then(() => p.getByRole("menuitem", { name: "Stats" }).click());
await p.locator(".stat-tuile.heros").waitFor();
await p.waitForTimeout(500);
const tuiles = (await p.locator(".stat-tuiles").textContent()).replace(/\s+/g, " ");
const paiements = (await p.locator(".stat-carte", { hasText: "Moyens de paiement" }).textContent()).replace(/\s+/g, " ");
const articles = (await p.locator(".stat-carte", { hasText: "Les plus vendus" }).textContent()).replace(/\s+/g, " ");
const alertes = await p.locator(".stat-alertes li").count();
await p.screenshot({ path: `${sortie}/st01-statistiques.png`, fullPage: false });
await p.locator(".stat-col").first().hover();
await p.locator(".page.statistiques").evaluate((e) => e.scrollTo(0, 700));
await p.screenshot({ path: `${sortie}/st02-statistiques-suite.png` });
await p.locator(".page.statistiques").evaluate((e) => e.scrollTo(0, 1500));
await p.screenshot({ path: `${sortie}/st03-statistiques-fin.png` });
await p.locator(".page.statistiques").evaluate((e) => e.scrollTo(0, 0));

// Alerte lue : code du responsable.
await p.locator(".stat-alertes").getByRole("button", { name: "Vu" }).first().click();
await p.getByRole("dialog", { name: "Validation responsable" }).waitFor();
await pin("1234");
await p.getByText("Alerte marquée comme vue").waitFor();
await p.waitForFunction(() => document.querySelectorAll(".stat-alertes li").length === 0, null, { timeout: 5000 }).catch(() => undefined);
const alertesApres = await p.locator(".stat-alertes li").count();

// Période « 7 jours » : comparaison et graphique par jour.
await clic("7 jours");
await p.locator(".stat-carte", { hasText: "CA par jour" }).waitFor();
await p.screenshot({ path: `${sortie}/st04-sept-jours.png` });

// iPhone : même écran, une colonne, sans débordement.
await p.setViewportSize({ width: 390, height: 844 });
await p.waitForTimeout(400);
const debordement = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
await p.screenshot({ path: `${sortie}/st05-iphone.png` });
const admin = await appel("GET", `/etablissements/moka/statistiques?du=${new Date().toISOString().slice(0, 10)}&au=${new Date().toISOString().slice(0, 10)}`).catch((e) => ({ erreur: String(e) }));
await b.close();

const resultat = { tuiles: tuiles.slice(0, 300), paiements, articles: articles.slice(0, 200), alertes, alertesApres, debordement, adminCa: admin.indicateurs?.caTTC, erreurs };
console.log(JSON.stringify(resultat, null, 2));
const ok =
  /Chiffre d'affaires TTC/.test(tuiles) &&
  /Tickets ?3/.test(tuiles) &&
  /Annulations ?1/.test(tuiles) &&
  /Carte bancaire/.test(paiements) &&
  /Espèces/.test(paiements) &&
  /Cappuccino/.test(articles) &&
  alertes === 1 &&
  alertesApres === 0 &&
  debordement <= 0 &&
  erreurs.length === 0;
if (!ok) process.exit(1);
