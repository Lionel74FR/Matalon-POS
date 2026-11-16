// Imprimantes de l'établissement (16 novembre 2026, demande de Lionel) : déclarées une fois dans la liste
// (Réglages ou administration), les postes de production y choisissent la leur, et chaque appareil y
// choisit celle de ses tickets et de ses additions, sans valeur par défaut. Les imprimantes Epson sont
// simulées (requêtes ePOS-Print interceptées).
// Usage : serveur local vierge (apps/caisse : node scripts/serveur-local.mjs 4180), puis
//         URL=http://localhost:4180 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/imprimantes-etablissement.mjs [dossier-captures]
import { chromium } from "playwright";
import { choisirImprimantes, declarerImprimantes, ongletReglages } from "./imprimantes-e2e.mjs";
import { preparerServeur } from "./preparer-caisse.mjs";

const URL = process.env.URL ?? "http://localhost:4180";
const sortie = process.argv[2] ?? "captures";
const { code, appel } = await preparerServeur(URL, "Comptoir");
const { code: codeIphone } = await appel("POST", "/etablissements/moka/codes", { nomCaisse: "Salle" });
const SALLE = "10.0.0.30";
const BAR = "10.0.0.31";
const recus = [];
const erreurs = [];
const b = await chromium.launch();

async function appareil(nom, options, codeRattachement, bouton) {
  const ctx = await b.newContext(options);
  await ctx.route(/https:\/\/10\.0\.0\.3[01]\//, async (route) => {
    const r = route.request();
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, OPTIONS" };
    if (r.method() === "OPTIONS") return route.fulfill({ status: 200, headers: cors });
    recus.push(`${nom}→${new globalThis.URL(r.url()).hostname}`);
    return route.fulfill({
      status: 200,
      headers: { ...cors, "content-type": "text/xml" },
      body: '<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><response success="true" code="" status="251658262" battery="0"/></s:Body></s:Envelope>',
    });
  });
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
  const reglages = async () => {
    await p.getByRole("button", { name: /^Menu/ }).click();
    await p.getByRole("menuitem", { name: "Réglages" }).click();
    await p.locator(".reglages").waitFor();
  };
  const synchroniser = async () => {
    await p.locator(".puce-synchro").click();
    await p.locator(".puce-synchro.synchronise").waitFor({ timeout: 15000 });
    await p.waitForTimeout(500);
  };
  return { p, clic, reglages, synchroniser };
}
const r = {};
const attendreRecus = async (n) => {
  for (let i = 0; i < 50 && recus.length < n; i++) await new Promise((ok) => setTimeout(ok, 100));
};

// ── iPad : déclare les imprimantes de l'établissement, choisit celle de ses tickets ──
const ipad = await appareil("ipad", { viewport: { width: 1180, height: 820 }, hasTouch: true }, code, "Rattacher l'iPad");
r.bandeauIpadAvant = await ipad.p.getByText("Caisse sans imprimante").count();
await ipad.reglages();
await ongletReglages(ipad.p, "Imprimantes");
const postes = await ipad.p.locator(".postes-production select").count();
await declarerImprimantes(
  ipad.p,
  [
    { nom: "Epson salle", type: "epson", adresse: SALLE },
    { nom: "Epson bar", type: "epson", adresse: BAR },
  ],
  postes ? { [((await ipad.p.locator(".postes-production .champ > span").first().textContent()) ?? "").trim()]: "Epson bar" } : {},
);
await choisirImprimantes(ipad.p, "Epson salle");
await ipad.p.getByRole("button", { name: "Imprimer un essai", exact: true }).first().click();
await attendreRecus(1);
await ipad.p.screenshot({ path: `${sortie}/ie01-ipad-imprimantes.png`, fullPage: true });
r.bandeauIpadApres = await ipad.p.getByText("Caisse sans imprimante").count();

// ── iPhone : reçoit la liste, mais rien n'est choisi à sa place ──
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
r.bandeauIphone = await iphone.p.getByText("Caisse sans imprimante").count();
await iphone.reglages();
await iphone.p.screenshot({ path: `${sortie}/ie02a-iphone-menu-reglages.png` });
r.menuIphone = await iphone.p.locator(".menu-reglages-entree strong").allTextContents();
await ongletReglages(iphone.p, "Cet appareil");
r.listeIphone = await iphone.p.getByLabel("Imprimante des tickets", { exact: true }).locator("option").allTextContents();
await choisirImprimantes(iphone.p, "Epson bar", "Epson salle");
await iphone.p.getByRole("button", { name: "Imprimer un essai", exact: true }).first().click();
await attendreRecus(2);
await iphone.p.getByRole("button", { name: "Imprimer une addition d'essai" }).click();
await attendreRecus(3);
await iphone.p.screenshot({ path: `${sortie}/ie02-iphone-imprimantes.png` });
r.debordementIphone = await iphone.p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

// ── Administration : la même liste ; un renommage arrive sur les appareils, le choix reste ──
const etab = (await appel("GET", "/etablissements")).etablissements.find((e) => e.id === "moka");
r.serveur = etab.imprimantes.map((i) => `${i.nom} ${i.branchement.adresse}`);
r.postesAnciens = etab.postesProduction;
const renommees = etab.imprimantes.map((i) => (i.nom === "Epson bar" ? { ...i, nom: "Epson comptoir" } : i));
r.renommage = (await appel("PUT", "/etablissements/moka/imprimantes", { imprimantes: renommees, postes: etab.postesImprimantes })).etablissement?.imprimantes.length;
await iphone.p.getByRole("tab", { name: "Salle" }).click().catch(() => undefined);
await iphone.synchroniser();
await iphone.reglages();
await ongletReglages(iphone.p, "Cet appareil");
r.choixIphone = await iphone.p.getByLabel("Imprimante des tickets", { exact: true }).evaluate((s) => s.selectedOptions[0]?.textContent ?? "");
await b.close();

console.log(JSON.stringify({ ...r, recus, erreurs }, null, 2));
const ok =
  r.bandeauIpadAvant === 1 &&
  r.bandeauIpadApres === 0 &&
  r.bandeauIphone === 1 &&
  r.listeIphone.length === 3 &&
  JSON.stringify(r.menuIphone) === JSON.stringify(["Cet appareil", "Imprimantes", "Établissement", "Équipe"]) &&
  r.listeIphone[0] === "À choisir" &&
  r.listeIphone[1] === "Epson salle (Epson)" &&
  !r.debordementIphone &&
  JSON.stringify(r.serveur) === JSON.stringify(["Epson salle 10.0.0.30", "Epson bar 10.0.0.31"]) &&
  r.renommage === 2 &&
  r.choixIphone === "Epson comptoir (Epson)" &&
  JSON.stringify(recus) === JSON.stringify(["ipad→10.0.0.30", "iphone→10.0.0.31", "iphone→10.0.0.30"]) &&
  !erreurs.length;
if (!ok) process.exit(1);
