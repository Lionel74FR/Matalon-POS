// Administration (refonte du 25 octobre 2026) : accueil « Aujourd'hui » par défaut, menu latéral en
// quatre familles (réductible), onglets du bas et feuille « Plus » sur iPhone, établissement choisi
// dans un vrai menu, thème clair par défaut (sombre au menu du compte). Chaque rubrique s'affiche sans
// déborder sur ordinateur, iPad (paysage, portrait) et iPhone ; l'adresse (#/moka/equipe) ramène à la
// même rubrique après rechargement, et le bouton Retour du navigateur à la rubrique précédente.
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
const r = {};
// Rubrique → libellé du menu.
const RUBRIQUES = {
  accueil: "Aujourd'hui",
  statistiques: "Statistiques",
  tickets: "Tickets",
  clotures: "Clôtures",
  alertes: "Alertes",
  reservations: "Réservations",
  stock: "Stock et recettes",
  comptes: "Comptes clients",
  fidelite: "Fidélité",
  cartes: "Cartes et prix",
  identite: "Établissement",
  equipe: "Équipe",
  plan: "Plan de salle",
  appareils: "Appareils",
  imprimantes: "Imprimantes",
};
const ONGLETS = { accueil: "Aujourd'hui", statistiques: "Stats", reservations: "Réservations", stock: "Stock" };

for (const [nom, viewport] of [["ordinateur", { width: 1440, height: 900 }], ["ipad", { width: 1180, height: 820 }], ["portrait", { width: 820, height: 1180 }], ["iphone", { width: 390, height: 844 }]]) {
  const ctx = await b.newContext({ viewport, deviceScaleFactor: 1, hasTouch: nom === "iphone" || nom === "portrait" });
  await ctx.addCookies([{ name: nomCookie, value: valeurCookie, url: `${URL}/api/admin` }]);
  const a = await ctx.newPage();
  a.on("pageerror", (e) => erreurs.push(`${nom} : ${e.message}`));
  await a.goto(`${URL}/admin#/moka`);
  // Sans rubrique dans l'adresse : l'accueil.
  await a.locator(".accueil").waitFor({ timeout: 15000 });
  if (!(await a.evaluate(() => location.hash === "#/moka/accueil"))) erreurs.push(`${nom} : accueil par défaut ${await a.evaluate(() => location.hash)}`);
  r[`${nom}-theme`] = await a.evaluate(() => [document.documentElement.dataset.theme, getComputedStyle(document.body).backgroundColor]);
  await a.waitForTimeout(600);
  await a.screenshot({ path: `${sortie}/n-${nom}-accueil.png`, fullPage: nom === "ordinateur" });
  for (const [id, libelle] of Object.entries(RUBRIQUES)) {
    if (nom === "iphone") {
      const barre = a.getByRole("navigation", { name: "Navigation principale" });
      if (ONGLETS[id]) await barre.getByRole("link", { name: ONGLETS[id], exact: true }).click();
      else {
        await barre.getByRole("button", { name: "Plus" }).click();
        await a.getByRole("dialog", { name: "Toutes les rubriques" }).getByRole("link", { name: libelle, exact: true }).click();
      }
    } else await a.getByRole("navigation", { name: "Rubriques de Moka" }).getByRole("link", { name: libelle, exact: true }).click();
    await a.waitForFunction((id) => location.hash === `#/moka/${id}`, id);
    await a.waitForTimeout(400);
    const d = await a.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (d > 0) debordements[`${nom}/${id}`] = d;
    if (["equipe", "reservations", "stock", "alertes"].includes(id)) await a.screenshot({ path: `${sortie}/n-${nom}-${id}.png` });
  }
  // Retour du navigateur : la rubrique précédente.
  await a.goBack();
  await a.waitForFunction(() => location.hash === "#/moka/appareils");
  r[`${nom}-retour`] = await a.evaluate(() => document.querySelector("[aria-current=page]")?.textContent?.trim());
  await a.goto(`${URL}/admin#/moka/equipe`);
  // Changement d'établissement : la rubrique reste, le contenu suit l'établissement.
  await a.getByRole("button", { name: /Changer d'établissement/ }).click();
  await a.getByRole("menuitemradio", { name: /Chardon/ }).click();
  await a.waitForFunction(() => location.hash === "#/chardon/equipe");
  await a.reload();
  await a.locator(".coque-etab").waitFor();
  const apres = await a.evaluate(() => ({ hash: location.hash, etab: document.querySelector(".coque-etab strong")?.textContent }));
  if (apres.etab !== "Chardon" || apres.hash !== "#/chardon/equipe") erreurs.push(`${nom} : rechargement ${JSON.stringify(apres)}`);
  // Sans adresse, on retrouve le dernier établissement ouvert sur ce poste.
  await a.goto(`${URL}/admin`);
  await a.locator(".coque-etab").waitFor();
  const dernier = await a.locator(".coque-etab strong").textContent();
  if (dernier !== "Chardon") erreurs.push(`${nom} : dernier établissement ${dernier}`);
  await ctx.close();
}

// Sous-pages dans l'adresse : un onglet du stock s'ouvre par son lien, garde l'onglet au rechargement, Retour revient au précédent.
{
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies([{ name: nomCookie, value: valeurCookie, url: `${URL}/api/admin` }]);
  const a = await ctx.newPage();
  a.on("pageerror", (e) => erreurs.push(`sous-pages : ${e.message}`));
  await a.goto(`${URL}/admin#/moka/stock/inventaire`);
  await a.getByRole("tab", { name: "Inventaire", selected: true }).waitFor({ timeout: 15000 });
  r.titreInventaire = await a.locator(".a-page-titre").textContent();
  await a.getByRole("tab", { name: "Food cost" }).click();
  await a.waitForFunction(() => location.hash === "#/moka/stock/foodcost");
  await a.reload();
  await a.getByRole("tab", { name: "Food cost", selected: true }).waitFor();
  await a.goBack();
  await a.waitForFunction(() => location.hash === "#/moka/stock/inventaire");
  r.retourOnglet = await a.getByRole("tab", { selected: true }).textContent();
  await a.getByRole("tab", { name: "Produits" }).click();
  await a.waitForFunction(() => location.hash === "#/moka/stock");
  await a.goto(`${URL}/admin#/moka/reservations/reglages`);
  r.resaReglages = await a.getByRole("tab", { selected: true }).textContent();
  await a.screenshot({ path: `${sortie}/n-ordinateur-sous-page.png` });
  // Aide repliée derrière l'icône (i).
  await a.getByRole("button", { name: "Aide : Réservations" }).click();
  r.aide = (await a.locator(".a-aide-texte").textContent()).slice(0, 30);
  await ctx.close();
}

// Thème sombre choisi au menu du compte, gardé au rechargement ; menu réduit en icônes.
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addCookies([{ name: nomCookie, value: valeurCookie, url: `${URL}/api/admin` }]);
const a = await ctx.newPage();
a.on("pageerror", (e) => erreurs.push(`sombre : ${e.message}`));
await a.goto(`${URL}/admin#/moka/accueil`);
await a.locator(".accueil").waitFor();
await a.getByRole("button", { name: /^Compte lionel/ }).click();
await a.getByRole("menuitemradio", { name: "Sombre" }).click();
await a.keyboard.press("Escape");
await a.reload();
await a.locator(".accueil").waitFor();
r.sombre = await a.evaluate(() => [document.documentElement.dataset.theme, getComputedStyle(document.body).backgroundColor]);
await a.waitForTimeout(600);
await a.screenshot({ path: `${sortie}/n-ordinateur-accueil-sombre.png` });
await a.getByRole("button", { name: "Réduire le menu" }).click();
r.reduit = await a.evaluate(() => document.querySelector(".coque-menu").getBoundingClientRect().width);
await a.screenshot({ path: `${sortie}/n-ordinateur-reduit.png` });
await a.getByRole("button", { name: "Déplier le menu" }).click();
await a.getByRole("button", { name: /^Compte lionel/ }).click();
await a.getByRole("menuitemradio", { name: "Clair" }).click();
await b.close();

console.log(JSON.stringify({ r, debordements, erreurs }, null, 2));
const ok =
  r["ordinateur-theme"][0] === "clair" &&
  r["ordinateur-theme"][1] === "rgb(243, 235, 224)" &&
  r.sombre[0] === "sombre" &&
  r.sombre[1] === "rgb(43, 30, 24)" &&
  r.reduit < 90 &&
  r.titreInventaire === "Inventaire" &&
  r.retourOnglet === "Inventaire" &&
  r.resaReglages === "Services et réglages" &&
  r.aide.startsWith("Le module du site") &&
  Object.keys(r)
    .filter((k) => k.endsWith("-retour"))
    .every((k) => r[k] === "Appareils" || k.startsWith("iphone")) &&
  !erreurs.length &&
  !Object.keys(debordements).length;
if (!ok) process.exit(1);
