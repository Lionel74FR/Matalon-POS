// Vérifie la page de note (/n) et les écrans principaux au format iPhone.
// Usage : serveur local vierge (apps/caisse : node scripts/serveur-local.mjs 4180), puis
//         URL=http://localhost:4180 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/note-et-iphone.mjs [dossier-captures]
import { chromium } from "playwright";
import { preparerServeur } from "./preparer-caisse.mjs";
import { createRequire } from "node:module";

const URL = process.env.URL ?? "http://localhost:4180";
const sortie = process.argv[2] ?? "captures";
const b = await chromium.launch();
const ctx = await b.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
});
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
await p.getByText("Rattacher cet iPhone à un établissement").waitFor();
const { code, cookie } = await preparerServeur(URL, "Salle");
await p.locator(".champ-code input").fill(code);
await capture("m01-rattachement");
const largeurs = { rattachement: await debordement() };
await clic("Rattacher l'iPhone");
await p.getByText("Connecter l'imprimante").first().waitFor();
await capture("m02-assistant");
await clic("Configurer plus tard");
await p.locator(".carte-personne").first().click();
await pin("1234");
await p.locator(".salle").waitFor();
await p.getByRole("dialog", { name: "Fond de caisse" }).waitFor();
await capture("m02b-fond");
await clic("Plus tard");
await capture("m03-salle");
largeurs.salle = await debordement();

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

// Administration sur iPhone : l'appareil apparaît comme iPhone, la page ne déborde pas et défile.
await ctx.addCookies([{ name: cookie.split("=")[0], value: cookie.split("=").slice(1).join("="), url: URL }]);
const admin = await ctx.newPage();
admin.on("pageerror", (e) => erreurs.push(`admin : ${e.message}`));
await admin.goto(`${URL}/admin`);
await admin.locator(".admin-caisse", { hasText: "iPhone ·" }).waitFor();
await admin.screenshot({ path: `${sortie}/m10-admin.png` });
largeurs.admin = await admin.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const tactile = await ctx.newCDPSession(admin);
await tactile.send("Input.synthesizeScrollGesture", { x: 200, y: 600, yDistance: -700, speed: 1500 });
await admin.waitForTimeout(800);
if ((await admin.evaluate(() => window.scrollY)) === 0) erreurs.push("admin : la page ne défile pas au doigt");
await admin.screenshot({ path: `${sortie}/m11-admin-bas.png` });
await b.close();
console.log(JSON.stringify({ largeurs, erreurs, ticket: url?.numero }, null, 2));
if (erreurs.length || Object.values(largeurs).some((d) => d > 0)) process.exit(1);
