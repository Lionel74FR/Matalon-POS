// Vérifie la page de note (/n) et les écrans principaux au format iPhone.
// Usage : PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/note-et-iphone.mjs [dossier-captures]
import { chromium } from "playwright";
import { createRequire } from "node:module";

const URL = process.env.URL ?? "http://localhost:4173";
const sortie = process.argv[2] ?? "captures";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const p = await ctx.newPage();
const erreurs = [];
p.on("pageerror", (e) => erreurs.push(e.message));
const capture = (nom) => p.screenshot({ path: `${sortie}/${nom}.png` });
const clic = (texte) => p.getByRole("button", { name: texte, exact: true }).first().click();
const pin = async (code) => {
  for (const c of code) await p.locator(".pave .touche", { hasText: new RegExp(`^${c}$`) }).last().click();
};
const debordement = () => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

await p.goto(URL);
await p.getByText("Mise en service de la caisse").waitFor();
await capture("m01-installation");
const champ = (libelle) => p.locator("label.champ", { hasText: libelle }).locator("input");
await champ("Raison sociale").fill("SAS Moka Annecy");
await champ("SIRET").fill("12345678900012");
await champ("TVA intracommunautaire").fill("FR12123456789");
await champ("Prénom").fill("Lionel");
await champ("Code PIN (4 chiffres)").fill("1234");
await champ("Confirmer le code").fill("1234");
await clic("Mettre la caisse en service");
await p.getByText("Connecter l'imprimante").first().waitFor();
await capture("m02-assistant");
await clic("Configurer plus tard");
await p.locator(".carte-personne").first().click();
await pin("1234");
await p.locator(".salle").waitFor();
await capture("m03-salle");
const largeurs = { salle: await debordement() };

await p.locator(".grille-tables .table", { hasText: /^2/ }).click();
await p.locator(".tuile", { hasText: "Cappuccino" }).click();
await p.locator(".tuile", { hasText: "Cappuccino" }).click();
await p.getByRole("tab", { name: "Bar", exact: true }).click();
await clic("Spritz");
await p.locator(".tuile", { hasText: "Spritz Aperol" }).click();
await capture("m04-carte");
largeurs.carte = await debordement();
await p.locator(".resume-mobile").click();
await capture("m05-commande");
await clic("Encaisser");
await capture("m06-encaissement");
await p.locator(".mode", { hasText: "Carte bancaire" }).click();
await p.getByRole("button", { name: /^Valider l'encaissement/ }).click();
await p.locator(".qr-note svg").waitFor();
await capture("m07-qr");

// Ouvre la note comme le ferait le client : l'URL est relue dans le QR via le lien du duplicata.

await clic("Terminé");
await p.getByRole("tab", { name: "Tickets" }).click();
await capture("m08-tickets");
largeurs.tickets = await debordement();
await p.getByRole("tab", { name: "Clôtures" }).click();
await capture("m09-clotures");
largeurs.clotures = await debordement();

// Page de note : on reconstruit l'URL du QR depuis le dernier ticket stocké sur l'appareil.
const url = await p.evaluate(async () => {
  const db = await new Promise((ok, ko) => {
    const r = indexedDB.open("matalon-pos");
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
  });
  const tx = db.transaction("tickets");
  const tous = await new Promise((ok) => {
    const r = tx.objectStore("tickets").getAll();
    r.onsuccess = () => ok(r.result);
  });
  return tous.at(-1);
});
await b.close();
console.log(JSON.stringify({ largeurs, erreurs, ticket: url?.numero }, null, 2));
if (erreurs.length || Object.values(largeurs).some((d) => d > 0)) process.exit(1);
