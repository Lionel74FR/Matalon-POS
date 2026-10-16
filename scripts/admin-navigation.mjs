// Administration : établissement choisi dans l'en-tête, rubriques au menu latéral (liste « Rubrique »
// sous 800 px). Chaque rubrique s'affiche sans déborder sur iPad (paysage, portrait) et iPhone, et
// l'adresse (#/moka/equipe) ramène à la même rubrique après rechargement.
// Usage : serveur local vierge (apps/caisse : node scripts/serveur-local.mjs 4180), puis
//         URL=http://localhost:4180 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/admin-navigation.mjs [dossier-captures]
import { chromium } from "playwright";
import { preparerServeur } from "./preparer-caisse.mjs";

const URL = process.env.URL ?? "http://localhost:4180";
const sortie = process.argv[2] ?? "captures";
const { cookie, appel } = await preparerServeur(URL, "Comptoir");
await appel("POST", "/etablissements", { id: "chardon", identite: { enseigne: "Chardon" }, carteId: "carte-automne-2026", tables: [], seuilNote: 2500 });
const [nomCookie, valeurCookie] = cookie.split("=");
const b = await chromium.launch();
const erreurs = [];
const debordements = {};
const RUBRIQUES = ["statistiques", "tickets", "appareils", "equipe", "plan", "imprimantes", "reservations", "comptes", "cartes", "stock", "alertes", "identite"];

for (const [nom, viewport] of [["ipad", { width: 1180, height: 820 }], ["portrait", { width: 820, height: 1180 }], ["iphone", { width: 390, height: 844 }]]) {
  const ctx = await b.newContext({ viewport, deviceScaleFactor: 1, hasTouch: nom !== "ipad" });
  await ctx.addCookies([{ name: nomCookie, value: valeurCookie, url: `${URL}/api/admin` }]);
  const a = await ctx.newPage();
  a.on("pageerror", (e) => erreurs.push(`${nom} : ${e.message}`));
  await a.goto(`${URL}/admin#/moka/appareils`);
  await a.locator(".admin-etab select").waitFor();
  for (const r of RUBRIQUES) {
    if (nom === "iphone") await a.locator(".admin-rubrique-mobile select").selectOption(r);
    else await a.locator(".admin-liste .admin-lien").nth(RUBRIQUES.indexOf(r)).click();
    await a.waitForFunction((r) => location.hash === `#/moka/${r}`, r);
    await a.waitForTimeout(400);
    const d = await a.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (d > 0) debordements[`${nom}/${r}`] = d;
    if (["equipe", "reservations", "stock"].includes(r)) await a.screenshot({ path: `${sortie}/n-${nom}-${r}.png` });
  }
  // Changement d'établissement : la rubrique reste, le contenu suit l'établissement.
  await a.locator(".admin-etab select").selectOption("chardon");
  await a.waitForFunction(() => location.hash === "#/chardon/identite");
  await a.reload();
  await a.locator(".admin-etab select").waitFor();
  const apres = await a.evaluate(() => ({ hash: location.hash, etab: document.querySelector(".admin-etab select").value }));
  if (apres.etab !== "chardon" || apres.hash !== "#/chardon/identite") erreurs.push(`${nom} : rechargement ${JSON.stringify(apres)}`);
  // Sans adresse, on retrouve le dernier établissement ouvert sur ce poste.
  await a.goto(`${URL}/admin`);
  await a.locator(".admin-etab select").waitFor();
  const dernier = await a.locator(".admin-etab select").inputValue();
  if (dernier !== "chardon") erreurs.push(`${nom} : dernier établissement ${dernier}`);
  await ctx.close();
}
await b.close();
console.log(JSON.stringify({ debordements, erreurs }, null, 2));
if (erreurs.length || Object.keys(debordements).length) process.exit(1);
