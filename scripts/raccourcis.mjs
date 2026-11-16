// Un article dans plusieurs catégories (Lionel, 16 novembre 2026 : écran « Nuit » du Chardon). Dans l'éditeur
// de carte, la catégorie Cafés reprend « Spritz Aperol » (catégorie Spritz) ; enregistrée, la carte garde
// l'article une seule fois. Sur l'iPad, Cafés montre le Spritz à la suite des cafés, Spritz le montre toujours ;
// le toucher l'ajoute au prix de la carte. Cafés a aussi une tuile vers la catégorie Spritz (dossier de Domino),
// en tête, qui l'ouvre. Le serveur refuse un raccourci vers un article inconnu. Recherche par nom : dans
// l'éditeur (« Chercher un article », l'article s'ouvre) et en caisse (loupe, « aperol » trouve le Spritz).
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
await bloc.getByLabel("Ajouter une tuile vers une catégorie").selectOption({ label: "Bar › Spritz" });
r.repris = await Promise.all((await bloc.locator("tbody tr").all()).map(texte));
// Recherche dans l'éditeur : l'article s'ouvre dans sa catégorie.
await a.getByRole("button", { name: "Chercher un article", exact: true }).click();
await a.getByLabel("Article à chercher").fill("LATTE");
r.resultatsEditeur = await a.locator(".editeur-recherche li").allTextContents();
await a.locator(".editeur-recherche li button").first().click();
r.ficheOuverte = await a.locator(".fiche-article").count();
await a.locator(".voile").getByRole("button", { name: "Fermer", exact: true }).click();
await a.screenshot({ path: `${sortie}/ra01-editeur.png`, fullPage: true });
await a.getByRole("button", { name: "Enregistrer", exact: true }).click();
await a.getByText("Enregistrée").waitFor();
const { carte } = await appel("GET", "/cartes/carte-automne-2026");
r.raccourcisCafes = carte.categories.find((c) => c.nom === "Cafés").raccourcis;
r.liensCafes = carte.categories.find((c) => c.nom === "Cafés").liens;
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
r.tuilesCafes = await p.locator(".grille-articles .tuile:not(.tuile-lien) .tuile-nom").allTextContents();
r.liensIpad = await p.locator(".grille-articles .tuile-lien .tuile-nom").allTextContents();
r.premiereTuile = await p.locator(".grille-articles .tuile .tuile-nom").first().textContent();
await p.screenshot({ path: `${sortie}/ra02-cafes.png` });
await p.locator(".grille-articles .tuile", { hasText: "Spritz Aperol" }).click();
r.ligne = await texte(p.locator(".ticket-ligne", { hasText: "Spritz Aperol" }));
await p.getByRole("tab", { name: "Bar", exact: true }).click();
await p.locator(".pastille", { hasText: /^Spritz$/ }).click();
r.tuilesSpritz = await p.locator(".grille-articles .tuile .tuile-nom").allTextContents();
// Le lien de Cafés ouvre la catégorie Spritz, dans son rayon.
await p.getByRole("tab", { name: "Boissons", exact: true }).click();
await p.locator(".pastille", { hasText: /^Cafés$/ }).click();
await p.locator(".grille-articles .tuile-lien", { hasText: "Spritz" }).click();
r.apresLien = { rayon: await p.locator('.rayon[aria-selected="true"]').textContent(), categorie: await p.locator(".categories .pastille.active").textContent() };
// Recherche en caisse : la loupe, « aperol », la tuile ajoute l'article.
await p.getByRole("button", { name: "Rechercher un article" }).click();
await p.getByLabel("Article à chercher").fill("a");
r.indice = await p.locator(".recherche-vide").textContent();
await p.getByLabel("Article à chercher").fill("aperol");
r.resultatsCaisse = await p.locator(".grille-articles .tuile .tuile-nom").allTextContents();
await p.screenshot({ path: `${sortie}/ra03-recherche.png` });
await p.locator(".grille-articles .tuile", { hasText: "Spritz Aperol" }).click();
r.quantiteSpritz = await texte(p.locator(".ticket-ligne", { hasText: "Spritz Aperol" }));
await p.getByLabel("Article à chercher").fill("zzz");
r.aucun = await p.locator(".recherche-vide").textContent();
await p.getByRole("button", { name: "Fermer la recherche" }).click();
r.rechercheFermee = await p.getByLabel("Article à chercher").count();

await b.close();

console.log(JSON.stringify({ ...r, erreurs }, null, 2));
const cafes = r.tuilesCafes;
const ok =
  r.repris.length === 2 &&
  /Spritz.*Bar/.test(r.repris[0]) &&
  /Spritz Aperol.*Spritz.*11,00/.test(r.repris[1]) &&
  JSON.stringify(r.liensCafes) === JSON.stringify(["spritz"]) &&
  r.resultatsEditeur.length >= 1 &&
  /^Latte/.test(r.resultatsEditeur[0]) &&
  r.ficheOuverte === 1 &&
  r.premiereTuile === "Spritz" &&
  JSON.stringify(r.liensIpad) === JSON.stringify(["Spritz"]) &&
  r.apresLien.rayon === "Bar" &&
  r.apresLien.categorie === "Spritz" &&
  /deux lettres/.test(r.indice) &&
  JSON.stringify(r.resultatsCaisse) === JSON.stringify(["Spritz Aperol"]) &&
  /^2 ?Spritz Aperol/.test(r.quantiteSpritz) &&
  /Aucun article/.test(r.aucun) &&
  r.rechercheFermee === 0 &&
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
