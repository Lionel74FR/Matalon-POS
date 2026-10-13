// Imprimante des tickets commune à l'établissement : réglée sur l'iPad, l'iPhone la reçoit à la
// synchronisation et imprime dessus sans rien saisir ; un appareil peut garder la sienne ; l'adminis-
// tration la règle aussi. Les imprimantes sont simulées (requêtes ePOS-Print interceptées).
// Usage : serveur local vierge (apps/caisse : node scripts/serveur-local.mjs 4180), puis
//         URL=http://localhost:4180 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/imprimante-partagee.mjs [dossier-captures]
import { chromium } from "playwright";
import { preparerServeur } from "./preparer-caisse.mjs";

const URL = process.env.URL ?? "http://localhost:4180";
const sortie = process.argv[2] ?? "captures";
const { code, appel } = await preparerServeur(URL, "Comptoir");
const { code: codeIphone } = await appel("POST", "/etablissements/moka/codes", { nomCaisse: "Salle" });
const COMMUNE = "10.0.0.30";
const PROPRE = "10.0.0.31";
const recus = [];
const erreurs = [];
const b = await chromium.launch();

async function appareil(nom, options, codeRattachement, bouton) {
  const ctx = await b.newContext(options);
  await ctx.route(/https:\/\/10\.0\.0\.3[01]\//, async (route) => {
    const r = route.request();
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, OPTIONS" };
    if (r.method() === "OPTIONS") return route.fulfill({ status: 200, headers: cors });
    recus.push({ appareil: nom, imprimante: new globalThis.URL(r.url()).hostname });
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
  return { p, clic, reglages };
}

// ── iPad : l'imprimante, réglée pour tout l'établissement ──
const ipad = await appareil("ipad", { viewport: { width: 1180, height: 820 }, hasTouch: true }, code, "Rattacher l'iPad");
const resultats = { bandeauIpadAvant: await ipad.p.getByText("Caisse sans imprimante").count() };
await ipad.reglages();
resultats.modeParDefaut = await ipad.p.getByRole("radio", { name: "Tout l'établissement" }).getAttribute("aria-checked");
await ipad.p.getByLabel("Adresse IP").first().fill(COMMUNE);
await ipad.clic("Enregistrer les réglages");
await ipad.p.getByText("partagés avec les autres caisses").waitFor();
await ipad.p.screenshot({ path: `${sortie}/i01-ipad-reglages.png` });

// ── iPhone : rattaché ensuite, il la reçoit sans rien saisir ──
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
resultats.bandeauIphone = await iphone.p.getByText("Caisse sans imprimante").count();
await iphone.reglages();
resultats.aideIphone = (
  await iphone.p.locator("fieldset", { has: iphone.p.locator("legend", { hasText: "Imprimante Epson" }) }).locator(".aide-champ").textContent()
).trim();
resultats.adresseIphone = await iphone.p.getByLabel("Adresse IP").first().inputValue();
await iphone.clic("Imprimer un test");
await iphone.p.waitForTimeout(800);
await iphone.p.screenshot({ path: `${sortie}/i02-iphone-reglages.png` });
resultats.debordementIphone = await iphone.p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

// ── L'iPhone garde une imprimante à lui ; l'iPad reste sur celle de l'établissement ──
await iphone.p.getByRole("radio", { name: "Cet iPhone seulement" }).click();
await iphone.p.getByLabel("Adresse IP").first().fill(PROPRE);
await iphone.clic("Enregistrer les réglages");
await iphone.p.getByText("Réglages de cet iPhone enregistrés").waitFor();
await iphone.clic("Imprimer un test");
await ipad.clic("Imprimer un test");
await ipad.p.waitForTimeout(800);

// ── Administration : la même imprimante commune ──
const etab = (await appel("GET", "/etablissements")).etablissements.find((e) => e.id === "moka");
resultats.serveur = etab.imprimanteTickets;
await b.close();

resultats.recus = recus.map((r) => `${r.appareil}→${r.imprimante}`);
console.log(JSON.stringify({ ...resultats, erreurs }, null, 2));
const ok =
  resultats.bandeauIpadAvant === 1 &&
  resultats.modeParDefaut === "true" &&
  resultats.bandeauIphone === 0 &&
  resultats.adresseIphone === COMMUNE &&
  /actuellement 10\.0\.0\.30/.test(resultats.aideIphone) &&
  !resultats.debordementIphone &&
  resultats.serveur?.adresse === COMMUNE &&
  JSON.stringify(resultats.recus) === JSON.stringify(["iphone→10.0.0.30", "iphone→10.0.0.31", "ipad→10.0.0.30"]) &&
  !erreurs.length;
if (!ok) process.exit(1);
