// Écran Tickets : période, recherche et filtres (montant, moyen de paiement, nature, lieu), totaux par
// moyen de paiement. Quelques ventes au comptoir et à table, une annulation. Captures iPad et iPhone.
// Usage : serveur local vierge (apps/caisse : node scripts/serveur-local.mjs 4180), puis
//         URL=http://localhost:4180 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/tickets.mjs [dossier-captures]
import { chromium } from "playwright";
import { preparerServeur } from "./preparer-caisse.mjs";

const URL = process.env.URL ?? "http://localhost:4180";
const sortie = process.argv[2] ?? "captures";
const { code } = await preparerServeur(URL, "Comptoir");
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
const lignes = () => p.locator(".tableau-tickets tbody tr").count();
const totaux = async () => ((await p.locator(".totaux-tickets").textContent()) ?? "").replace(/\s+/g, " ").trim();
const echecs = [];
const verifier = (nom, ok, detail) => {
  if (!ok) echecs.push(`${nom} : ${detail}`);
};

await p.goto(URL);
await p.locator(".champ-code input").fill(code);
await clic("Rattacher l'iPad");
await clic("Configurer plus tard");
await p.locator(".carte-personne", { hasText: "Lionel" }).click();
await pin("1234");
await clic("Plus tard");

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
await encaisser("Carte bancaire");
await p.getByRole("tab", { name: "Tickets" }).click();
await p.locator(".tableau-tickets tbody tr").first().click();
await clic("Annuler ce ticket");
await clic("Erreur de saisie");
await p.locator(".modale").getByRole("button", { name: /^Annuler \d/ }).click();
await p.waitForTimeout(500);

// ── Tous les tickets récents ──
const resultats = {};
resultats.recents = await lignes();
resultats.totauxRecents = await totaux();
verifier("récents", resultats.recents === 5, resultats.recents);

// Recherche par n° de ticket.
const recherche = p.getByLabel("Rechercher un ticket");
await recherche.fill("2");
resultats.recherche = await lignes();
verifier("recherche n° 2", resultats.recherche === 1, resultats.recherche);
await recherche.fill("table 4");
resultats.rechercheTable = await lignes();
verifier("recherche table 4", resultats.rechercheTable === 2, resultats.rechercheTable);
await recherche.fill("");

// Filtres : espèces, puis ventes annulées, puis à table.
await p.getByRole("button", { name: /^Filtres/ }).click();
const panneau = p.locator(".filtres-panneau");
await panneau.getByRole("button", { name: "Espèces", exact: true }).click();
resultats.especes = await lignes();
resultats.totauxEspeces = await totaux();
verifier("espèces", resultats.especes === 1, resultats.especes);
verifier("totaux espèces", /1 ticket sur 5/.test(resultats.totauxEspeces) && /Espèces/.test(resultats.totauxEspeces), resultats.totauxEspeces);
await p.screenshot({ path: `${sortie}/tk01-filtres.png` });
await panneau.getByRole("button", { name: "Espèces", exact: true }).click();
await panneau.getByRole("button", { name: "Ventes annulées", exact: true }).click();
resultats.annulees = await lignes();
verifier("ventes annulées", resultats.annulees === 1, resultats.annulees);
await panneau.getByRole("button", { name: "Ventes annulées", exact: true }).click();
await panneau.getByRole("button", { name: "À table", exact: true }).click();
resultats.table = await lignes();
verifier("à table (vente et son annulation)", resultats.table === 2, resultats.table);
resultats.bouton = await p.getByRole("button", { name: /^Filtres/ }).textContent();
verifier("compteur de filtres", /Filtres \(1\)/.test(resultats.bouton), resultats.bouton);
await clic("Effacer");
// Montant : au moins 1 000 € → rien.
await panneau.getByLabel("Montant minimum").fill("1000");
resultats.montant = (await p.locator(".vide").textContent()) ?? "";
verifier("montant", /Aucun ticket ne correspond/.test(resultats.montant), resultats.montant);
await clic("Effacer");

// ── Périodes ──
await clic("Hier");
await p.waitForTimeout(800);
resultats.hier = (await p.locator(".vide").textContent()) ?? "";
verifier("hier", /Aucun ticket sur cette période/.test(resultats.hier), resultats.hier);
await clic("Aujourd'hui");
await p.locator(".tableau-tickets tbody tr").first().waitFor();
resultats.aujourdhui = await lignes();
verifier("aujourd'hui", resultats.aujourdhui === 5, resultats.aujourdhui);
await p.screenshot({ path: `${sortie}/tk02-aujourdhui.png` });

// ── iPhone ──
await p.setViewportSize({ width: 390, height: 844 });
await p.waitForTimeout(300);
await p.screenshot({ path: `${sortie}/tk03-iphone.png`, fullPage: true });
resultats.debordIphone = await p.evaluate(() => document.documentElement.scrollWidth - 390);
verifier("iPhone sans débordement", resultats.debordIphone <= 0, resultats.debordIphone);

await b.close();
console.log(JSON.stringify({ resultats, echecs, erreurs }, null, 2));
if (echecs.length || erreurs.length) process.exit(1);
