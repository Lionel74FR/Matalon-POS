// Un article dans plusieurs catégories (Lionel, 16 novembre 2026 : écran « Nuit » du Chardon). Dans l'éditeur
// de carte, la catégorie Cafés reprend « Spritz Aperol » (catégorie Spritz) ; enregistrée, la carte garde
// l'article une seule fois. Sur l'iPad, Cafés montre le Spritz à la suite des cafés, Spritz le montre toujours ;
// le toucher l'ajoute au prix de la carte. Le serveur refuse un raccourci vers un article inconnu.
// Usage : serveur local vierge (apps/caisse : node scripts/serveur-local.mjs 4180), puis
//         URL=http://localhost:4180 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/raccourcis.mjs [dossier-captures]
import { chromium } from "playwright";
import { accepterConfirmations, preparerServeur, rubriqueAdmin } from "./preparer-caisse.mjs";

const URL = process.env.URL ?? "http://localhost:4180";
const sortie = process.argv[2] ?? "captures";
const { code, cookie, appel } = await preparerServeur(URL, "Comptoir");
const [nomCookie, valeurCookie] = cookie.split("=");
const b = await chromium.launch();
const erreurs = [];
const r = {};
const texte = async (loc) => ((await loc.textContent()) ?? "").replace(/[\s  ]+/g, " ").trim();

// ── Administration : Cafés reprend le Spritz Aperol ──
const bureau = await b.newContext({ viewport: { width: 1280, height: 900 } });
await bureau.addCookies([{ name: nomCookie, value: valeurCookie, url: `${URL}/api/admin` }]);
const a = await bureau.newPage();
a.on("pageerror", (e) => erreurs.push(`admin : ${e.message}`));
await accepterConfirmations(a);
await a.goto(`${URL}/admin`);
await rubriqueAdmin(a, "Cartes et prix");
await a.getByRole("button", { name: "Modifier" }).first().click();
await a.locator(".editeur-cat-nom", { hasText: "Cafés" }).click();
const bloc = a.locator(".editeur-raccourcis");
await bloc.getByLabel("Ajouter un article d'une autre catégorie").selectOption("spritz-aperol");
r.repris = await Promise.all((await bloc.locator("tbody tr").all()).map(texte));
await a.screenshot({ path: `${sortie}/ra01-editeur.png`, fullPage: true });
await a.getByRole("button", { name: "Enregistrer", exact: true }).click();
await a.getByText("Enregistrée").waitFor();
const { carte } = await appel("GET", "/cartes/carte-automne-2026");
r.raccourcisCafes = carte.categories.find((c) => c.nom === "Cafés").raccourcis;
r.occurrencesSpritz = carte.categories.flatMap((c) => c.articles).filter((x) => x.id === "spritz-aperol").length;
// Refus serveur : raccourci vers un article inconnu.
const fausse = structuredClone(carte);
fausse.categories.find((c) => c.nom === "Cafés").raccourcis = ["spritz-aperol", "fantome"];
const v = (await appel("GET", "/cartes/carte-automne-2026")).version;
r.refus = await appel("PUT", "/cartes/carte-automne-2026", { carte: fausse, version: v }).then(
  () => "accepté",
  (e) => e.message,
);

// ── iPad : le Spritz dans Cafés, et toujours dans Spritz ──
const ctx = await b.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true });
const p = await ctx.newPage();
p.on("pageerror", (e) => erreurs.push(`ipad : ${e.message}`));
const clic = (n) => p.getByRole("button", { name: n, exact: true }).first().click();
await p.goto(URL);
await p.locator(".champ-code input").fill(code);
await clic("Rattacher l'iPad");
await clic("Configurer plus tard");
await p.locator(".carte-personne", { hasText: "Lionel" }).click();
for (const x of "1234") await p.locator(".pave .touche", { hasText: new RegExp(`^${x}$`) }).last().click();
await clic("Plus tard");
await p.locator(".puce-synchro.synchronise").waitFor({ timeout: 15000 });
await p.getByRole("button", { name: /^Table 4,/ }).click();
await p.locator(".pastille", { hasText: /^Cafés$/ }).click();
r.tuilesCafes = await p.locator(".grille-articles .tuile .tuile-nom").allTextContents();
await p.screenshot({ path: `${sortie}/ra02-cafes.png` });
await p.locator(".grille-articles .tuile", { hasText: "Spritz Aperol" }).click();
r.ligne = await texte(p.locator(".ticket-ligne", { hasText: "Spritz Aperol" }));
await p.getByRole("tab", { name: "Bar", exact: true }).click();
await p.locator(".pastille", { hasText: /^Spritz$/ }).click();
r.tuilesSpritz = await p.locator(".grille-articles .tuile .tuile-nom").allTextContents();

await b.close();

console.log(JSON.stringify({ ...r, erreurs }, null, 2));
const cafes = r.tuilesCafes;
const ok =
  r.repris.length === 1 &&
  /Spritz Aperol.*Spritz.*11,00/.test(r.repris[0]) &&
  JSON.stringify(r.raccourcisCafes) === JSON.stringify(["spritz-aperol"]) &&
  r.occurrencesSpritz === 1 &&
  /fantome introuvable/.test(r.refus) &&
  cafes.at(-1) === "Spritz Aperol" &&
  cafes.length > 1 &&
  /Spritz Aperol/.test(r.ligne) &&
  /11,00/.test(r.ligne) &&
  r.tuilesSpritz.includes("Spritz Aperol") &&
  !erreurs.length;
if (!ok) process.exit(1);
