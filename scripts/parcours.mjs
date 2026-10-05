// Parcours de bout en bout de la caisse dans Chromium au format iPad paysage :
// installation, connexion, commande en salle, remise, encaissement, Z.
// Usage : pnpm --filter @matalon/caisse preview (port 4173), puis
//         PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/parcours.mjs [dossier-captures]
import { chromium } from "playwright";

const URL = process.env.URL ?? "http://localhost:4173";
const sortie = process.argv[2] ?? "captures";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1, hasTouch: true });
const p = await ctx.newPage();
const erreurs = [];
p.on("pageerror", (e) => erreurs.push(e.message));
p.on("console", (m) => m.type() === "error" && erreurs.push(m.text()));
const capture = (nom) => p.screenshot({ path: `${sortie}/${nom}.png` });
const clic = (texte) => p.getByRole("button", { name: texte, exact: true }).first().click();
const pin = async (code) => {
  for (const c of code) await p.locator(".pave .touche", { hasText: new RegExp(`^${c}$`) }).last().click();
};

await p.goto(URL);
await p.getByText("Mise en service de la caisse").waitFor();
const champ = (libelle) => p.locator("label.champ", { hasText: libelle }).locator("input");
await champ("Raison sociale").fill("SAS Moka Annecy");
await champ("SIRET").fill("123 456 789 00012");
await champ("TVA intracommunautaire").fill("FR12123456789");
await champ("Prénom").fill("Lionel");
await champ("Code PIN (4 chiffres)").fill("1234");
await champ("Confirmer le code").fill("1234");
await capture("01-installation");
await clic("Mettre la caisse en service");

await p.getByText("Qui prend le service ?").waitFor();
await capture("02-connexion");
await p.locator(".carte-personne", { hasText: "Lionel" }).click();
await pin("1234");
await p.locator(".salle").waitFor();

// Table 4 : deux cappuccinos, un spritz, une eau 100 cl, un bubble tea taro + perles.
await p.locator(".grille-tables .table", { hasText: /^4/ }).click();
await p.locator(".tuile", { hasText: "Cappuccino" }).click();
await p.locator(".tuile", { hasText: "Cappuccino" }).click();
await clic("Bubble tea");
await p.locator(".tuile", { hasText: "Bubble tea" }).click();
await clic("Taro");
await p.getByRole("button", { name: /Perles popping/ }).click();
await p.getByRole("button", { name: /^Ajouter/ }).click();
await p.getByRole("tab", { name: "Bar", exact: true }).click();
await clic("Spritz");
await p.locator(".tuile", { hasText: "Spritz Aperol" }).click();
await p.getByRole("tab", { name: "Cuisine", exact: true }).click();
await clic("Œufs & egg muffins");
await p.locator(".tuile", { hasText: "Egg muffin Charles" }).click();
await p.getByRole("tab", { name: "Formules", exact: true }).click();
await p.locator(".tuile", { hasText: "Déjeuner Charles" }).click();
await capture("03-formule");
for (const choix of ["Plat du jour", "Cheesecake citron", "Flat white"]) await clic(choix);
await p.getByRole("button", { name: /^Ajouter/ }).click();
await p.getByRole("button", { name: "Indiquer les couverts" }).click();
await clic("2");
await capture("04-commande");

// Remise : spritz offert (responsable connecté, pas de code demandé).
await p.locator(".ticket-ligne", { hasText: "Spritz Aperol" }).click();
await clic("Offert");
await clic("Offert maison");
await p.getByRole("button", { name: /^Valider/ }).click();

// Retrait d'un egg muffin : tracé au journal.
await p.locator(".ticket-ligne", { hasText: "Egg muffin" }).click();
await clic("Retirer de la commande");
await capture("05-commande-remise");

await clic("Encaisser");
await p.locator(".mode", { hasText: "Espèces" }).click();
await capture("06-encaissement");
await p.locator(".modale").getByRole("button", { name: /Retirer le paiement/ }).click();
await p.locator(".billets .option").last().click();
await capture("07-encaissement-especes");
await p.getByRole("button", { name: /^Valider l'encaissement/ }).click();
await p.getByText("Rendu monnaie", { exact: true }).waitFor();
await capture("08-rendu");
await p.getByRole("button", { name: "Fermer" }).last().click().catch(() => {});
await p.getByRole("button", { name: "Terminé" }).click().catch(() => {});

await p.locator(".salle").waitFor();
await capture("09-salle");
await p.getByRole("tab", { name: "Tickets" }).click();
await capture("10-tickets");
await p.getByRole("tab", { name: "Clôtures" }).click();
await clic("Lecture X");
await clic("Clôturer la journée (Z)");
await clic("Clôturer et imprimer le Z");
await p.locator(".apercu-recu").waitFor();
await capture("11-apercu-z");
await p.getByRole("button", { name: "Fermer" }).last().click();
await clic("Vérifier l'intégrité");
await p.getByText(/Chaînes intactes|anomalie/).waitFor();
await capture("12-integrite");
const integre = await p.getByText(/Chaînes intactes/).count();

await b.close();
console.log(JSON.stringify({ integre: integre > 0, erreurs }, null, 2));
if (!integre || erreurs.length) process.exit(1);
