// Recherche universelle de l'administration (⌘K, refonte du 25 octobre 2026) : un article de la
// carte s'ouvre dans l'éditeur, un produit et une fiche technique dans le stock, une personne et un
// client dans leur panneau, une sous-page s'ouvre par son nom ; clavier (↓, Entrée, Échap) et « / ».
// Le ticket du jour est vérifié dans tickets-admin. Captures ordinateur et iPhone.
// Usage : serveur local vierge (apps/caisse : node scripts/serveur-local.mjs 4180), puis
//         URL=http://localhost:4180 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/admin-recherche.mjs [dossier-captures]
import { chromium } from "playwright";
import { preparerServeur } from "./preparer-caisse.mjs";

const URL = process.env.URL ?? "http://localhost:4180";
const sortie = process.argv[2] ?? "captures";
const { cookie, appel } = await preparerServeur(URL, "Comptoir");
await appel("POST", "/stock/import", {
  etablissementId: "moka",
  tableau: [
    ["produit", "unite", "famille", "zone", "fournisseur", "reference", "conditionnement", "quantite", "prix_ht"],
    ["Aperol", "L", "Spiritueux", "Bar", "Caves du Mont", "APE-1L", "Bouteille 1 L", "1", "14,90"],
  ],
});
await appel("PUT", "/etablissements/moka/clients", { id: "cli-0000c4b1", nom: "Camby", telephone: "0450000000", email: "", actif: true });
const [nomCookie, valeurCookie] = cookie.split("=");
const b = await chromium.launch();
const erreurs = [];
const r = {};

const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addCookies([{ name: nomCookie, value: valeurCookie, url: `${URL}/api/admin` }]);
const a = await ctx.newPage();
a.on("pageerror", (e) => erreurs.push(e.message));
await a.goto(`${URL}/admin#/moka/accueil`);
await a.locator(".accueil").waitFor({ timeout: 15000 });
const recherche = () => a.getByRole("dialog", { name: "Recherche" });
const chercher = async (texte, ouvrir = "clavier") => {
  if (ouvrir === "clavier") await a.keyboard.press("ControlOrMeta+k");
  else await a.getByRole("button", { name: /^Rechercher/ }).click();
  await recherche().getByRole("combobox").fill(texte);
  await recherche().getByRole("option").first().waitFor();
};

// Sans saisie : les rubriques.
await a.keyboard.press("ControlOrMeta+k");
await recherche().waitFor();
r.vide = await recherche().getByRole("option").count();
await a.keyboard.press("Escape");
r.fermee = (await recherche().count()) === 0;

// Article de la carte → éditeur ouvert sur sa fiche.
await chercher("cappu", "bouton");
r.groupes = await recherche().locator(".a-recherche-groupe").allTextContents();
await a.screenshot({ path: `${sortie}/re01-recherche.png` });
await a.keyboard.press("Enter");
await a.waitForFunction(() => location.hash === "#/moka/cartes");
await a.locator(".fiche-article").waitFor({ timeout: 15000 });
r.article = await a.locator(".fiche-article input").first().inputValue();
await a.keyboard.press("Escape");

// Produit → fiche du stock ; fiche technique par son nom (↓ pour la choisir).
await a.keyboard.press("/");
await recherche().getByRole("combobox").fill("aperol");
const produit = recherche().getByRole("option", { name: /^Aperol\s*Produit/ });
await produit.waitFor({ timeout: 15000 });
await produit.click();
await a.waitForFunction(() => location.hash === "#/moka/stock");
await a.getByRole("dialog", { name: "Aperol" }).waitFor({ timeout: 15000 });
r.produit = true;
await a.keyboard.press("Escape");

// Personne → panneau de l'équipe ; client → panneau du compte.
await chercher("lionel");
await recherche().getByRole("option", { name: /Lionel.*Responsable/ }).click();
await a.getByRole("dialog", { name: "Lionel" }).waitFor();
r.personne = await a.evaluate(() => location.hash);
await a.getByRole("dialog", { name: "Lionel" }).getByRole("button", { name: "Fermer", exact: true }).click();
await chercher("camby");
await recherche().getByRole("option", { name: /Camby/ }).click();
await a.getByRole("dialog", { name: "Camby" }).waitFor({ timeout: 15000 });
r.client = await a.evaluate(() => location.hash);
await a.getByRole("dialog", { name: "Camby" }).getByRole("button", { name: "Fermer", exact: true }).click();

// Sous-page par son nom.
await chercher("inventaire");
await recherche().getByRole("option", { name: /Stock › Inventaire/ }).click();
await a.waitForFunction(() => location.hash === "#/moka/stock/inventaire");
r.sousPage = await a.getByRole("tab", { selected: true }).textContent();

// Rien ne correspond.
await a.keyboard.press("ControlOrMeta+k");
await recherche().getByRole("combobox").fill("zzzz");
r.rien = await recherche().locator(".a-recherche-vide").textContent();
await a.keyboard.press("Escape");

// iPhone : la loupe de la barre, recherche plein écran, bouton Fermer.
const m = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
await m.addCookies([{ name: nomCookie, value: valeurCookie, url: `${URL}/api/admin` }]);
const mp = await m.newPage();
mp.on("pageerror", (e) => erreurs.push(`iphone : ${e.message}`));
await mp.goto(`${URL}/admin#/moka/accueil`);
await mp.getByRole("button", { name: /^Rechercher/ }).click();
await mp.getByRole("dialog", { name: "Recherche" }).getByRole("combobox").fill("spritz");
await mp.getByRole("dialog", { name: "Recherche" }).getByRole("option").first().waitFor({ timeout: 15000 });
r.debordementIphone = await mp.evaluate(() => document.documentElement.scrollWidth - innerWidth);
await mp.screenshot({ path: `${sortie}/re02-iphone.png` });
await mp.getByRole("button", { name: "Fermer la recherche" }).click();
r.fermeeIphone = (await mp.getByRole("dialog", { name: "Recherche" }).count()) === 0;
await b.close();

console.log(JSON.stringify({ ...r, erreurs }, null, 2));
const ok =
  r.vide >= 8 &&
  r.fermee &&
  r.groupes[0] === "Carte" &&
  /cappuccino/i.test(r.article) &&
  r.produit &&
  r.personne === "#/moka/equipe" &&
  r.client === "#/moka/comptes" &&
  r.sousPage === "Inventaire" &&
  r.rien.includes("zzzz") &&
  r.debordementIphone <= 0 &&
  r.fermeeIphone &&
  !erreurs.length;
if (!ok) process.exit(1);
