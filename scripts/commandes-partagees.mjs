// Commandes en cours partagées : une table ouverte sur l'iPad apparaît sur l'iPhone (et inversement)
// en quelques secondes, chacun peut y ajouter, l'encaissement sur l'un la libère partout, et l'autre
// ne peut plus l'encaisser. Le comptoir reste propre à chaque appareil.
// Usage : serveur local vierge (apps/caisse : node scripts/serveur-local.mjs 4180), puis
//         URL=http://localhost:4180 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/commandes-partagees.mjs [dossier-captures]
import { chromium } from "playwright";
import { preparerServeur } from "./preparer-caisse.mjs";

const URL = process.env.URL ?? "http://localhost:4180";
const sortie = process.argv[2] ?? "captures";
const { code, appel } = await preparerServeur(URL, "Comptoir");
const { code: codeIphone } = await appel("POST", "/etablissements/moka/codes", { nomCaisse: "Salle" });
const erreurs = [];
const b = await chromium.launch();

async function appareil(nom, options, codeRattachement, bouton) {
  const ctx = await b.newContext(options);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => erreurs.push(`${nom} : ${e.message}`));
  const clic = (n) => p.getByRole("button", { name: n, exact: true }).first().click();
  await p.goto(URL);
  await p.locator(".champ-code input").fill(codeRattachement);
  await clic(bouton);
  await clic("Configurer plus tard");
  await p.locator(".carte-personne", { hasText: "Lionel" }).click();
  for (const x of "1234") await p.locator(".pave .touche", { hasText: new RegExp(`^${x}$`) }).last().click();
  await clic("Plus tard");
  await p.locator(".puce-synchro.synchronise").waitFor({ timeout: 15000 });
  return { p, clic };
}
const table = (a, n) => a.p.getByRole("button", { name: new RegExp(`^Table ${n},`) });
const ajouter = (a, article) => a.p.locator(".tuile", { hasText: article }).first().click();
const lignes = async (a) => (await a.p.locator(".ticket-ligne").allTextContents()).map((t) => t.replace(/\s+/g, " ").trim());

const ipad = await appareil("ipad", { viewport: { width: 1180, height: 820 }, hasTouch: true }, code, "Rattacher l'iPad");
const iphone = await appareil(
  "iphone",
  {
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  },
  codeIphone,
  "Rattacher l'iPhone",
);
const resultats = {};

// ── iPad : table 5, un cappuccino ──
await table(ipad, 5).click();
await ajouter(ipad, "Cappuccino");
await ipad.p.getByRole("button", { name: "Retour à la salle" }).click();
// Comptoir de l'iPad : il ne doit pas apparaître sur l'iPhone.
await ipad.p.getByRole("button", { name: /Vente Directe/ }).click();
await ajouter(ipad, "Cappuccino");
await ipad.p.getByRole("button", { name: "Retour à la salle" }).click();

// ── iPhone : la table 5 est occupée, avec son montant ──
const debut = Date.now();
await iphone.p.getByRole("button", { name: /^Table 5, occupée/ }).waitFor({ timeout: 15000 });
resultats.delaiVisibleMs = Date.now() - debut;
await table(iphone, 5).click();
await iphone.p.locator(".resume-mobile", { hasText: "1 article" }).waitFor();
resultats.lignesIphone = await lignes(iphone);
await ajouter(iphone, "Cortado");
await iphone.p.screenshot({ path: `${sortie}/c01-iphone-table5.png` });
await iphone.p.getByRole("tab", { name: "Salle" }).click();

// ── iPad : l'ajout de l'iPhone arrive sur la table ouverte ──
await table(ipad, 5).click();
await ipad.p.locator(".ticket-ligne", { hasText: "Cortado" }).waitFor({ timeout: 15000 });
resultats.lignesIpad = await lignes(ipad);
await ipad.p.screenshot({ path: `${sortie}/c02-ipad-table5.png` });

// ── L'iPhone ouvre l'encaissement, l'iPad encaisse d'abord ──
await table(iphone, 5).click();
await iphone.p.locator(".resume-mobile").click();
await iphone.clic("Encaisser");
await iphone.p.locator(".mode", { hasText: "Carte bancaire" }).click();
await ipad.clic("Encaisser");
await ipad.p.locator(".mode", { hasText: "Carte bancaire" }).click();
await ipad.p.getByRole("button", { name: /^Valider l'encaissement/ }).click();
await ipad.p.getByRole("button", { name: "Terminé" }).click();
await ipad.p.locator(".salle").waitFor();
await iphone.p.getByRole("button", { name: /^Valider l'encaissement/ }).click();
await iphone.p.locator(".toast", { hasText: /encaissée/ }).first().waitFor({ timeout: 10000 });
resultats.refusIphone = (await iphone.p.locator(".toast", { hasText: /encaissée/ }).first().textContent())?.trim();
await iphone.p.screenshot({ path: `${sortie}/c03-iphone-refus.png` });

// ── Table libérée partout ; un seul ticket ──
await iphone.p.locator(".fermer-mobile").click();
await iphone.p.getByRole("tab", { name: "Salle" }).click();
await iphone.p.getByRole("button", { name: /^Table 5, libre/ }).waitFor({ timeout: 15000 });
// Un seul ticket au serveur (après la synchronisation de l'iPad).
await ipad.p.locator(".puce-synchro").click();
await ipad.p.locator(".puce-synchro.synchronise").waitFor({ timeout: 15000 });
const jour = new Date().toISOString().slice(0, 10);
resultats.ticketsServeur = (await appel("GET", `/etablissements/moka/statistiques?du=${jour}&au=${jour}`)).indicateurs?.nbVentes ?? null;
await b.close();

console.log(JSON.stringify({ ...resultats, erreurs }, null, 2));
const ok =
  resultats.delaiVisibleMs < 12000 &&
  resultats.lignesIphone.some((l) => /Cappuccino/.test(l)) &&
  resultats.lignesIpad.some((l) => /Cortado/.test(l)) &&
  /déjà été encaissée/.test(resultats.refusIphone ?? "") &&
  resultats.ticketsServeur === 1 &&
  !erreurs.length;
if (!ok) process.exit(1);
