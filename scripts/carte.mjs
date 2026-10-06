// Carte éditée dans l'administration puis reçue par l'iPad : prix modifié,
// article ajouté, article indisponible, nouvelle version à chaud.
// Usage : serveur local vierge (apps/caisse : node scripts/serveur-local.mjs 4180), puis
//         URL=http://localhost:4180 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/carte.mjs [dossier-captures]
import { chromium } from "playwright";
import { preparerServeur } from "./preparer-caisse.mjs";

const URL = process.env.URL ?? "http://localhost:4180";
const sortie = process.argv[2] ?? "captures";
const { code, cookie, appel } = await preparerServeur(URL, "Comptoir");
const [nomCookie, valeurCookie] = cookie.split("=");
const b = await chromium.launch();
const erreurs = [];

// ── Administration : édition de la carte ──
const bureau = await b.newContext({ viewport: { width: 1280, height: 900 } });
await bureau.addCookies([{ name: nomCookie, value: valeurCookie, url: `${URL}/api/admin` }]);
const a = await bureau.newPage();
a.on("pageerror", (e) => erreurs.push(`admin : ${e.message}`));
a.on("dialog", (d) => void d.accept());
await a.goto(`${URL}/admin`);
await a.getByRole("button", { name: /Cartes et prix/ }).click();
await a.getByRole("button", { name: "Modifier" }).first().click();
await a.locator(".editeur-cat-nom", { hasText: "Cafés" }).click();
await a.getByRole("button", { name: "Espresso", exact: true }).click();
await a.locator(".fiche-article label.champ", { hasText: "Prix TTC" }).locator("input").fill("2,70");
await a.getByRole("button", { name: "Valider" }).click();
await a.locator(".editeur-ajout-article input[name=nom]").fill("Ristretto");
await a.locator(".editeur-ajout-article input[name=prix]").fill("2,50");
await a.getByRole("button", { name: "Ajouter", exact: true }).click();
await a.locator("tr", { hasText: "Cortado" }).locator("input[type=checkbox]").uncheck();
await a.screenshot({ path: `${sortie}/c01-editeur.png`, fullPage: true });
await a.getByRole("button", { name: "Enregistrer la carte" }).click();
await a.getByText("Enregistrée").waitFor();
// Contrôle : un prix illisible est refusé avant l'envoi.
await a.getByRole("button", { name: "Ristretto", exact: true }).click();
await a.locator(".fiche-article label.champ", { hasText: "Prix TTC" }).locator("input").fill("2,5,0");
await a.getByRole("button", { name: "Valider" }).click();
const refusPrix = await a.getByText("Prix illisible").count();
// Variante au prix tapé au clavier (« 3,50 » doit rester 3,50).
await a.locator(".fiche-article label.champ", { hasText: "Prix TTC" }).locator("input").fill("2,50");
await a.getByRole("button", { name: "+ Variante" }).click();
await a.locator(".fiche-article .sous-ligne input").first().fill("Double");
await a.locator(".fiche-article .sous-ligne input").nth(1).pressSequentially("3,50");
await a.getByRole("button", { name: "Valider" }).click();
// Suppression d'une catégorie citée par des formules : les références sont retirées, la carte s'enregistre.
await a.locator(".editeur-cat-nom", { hasText: "Thés" }).click();
await a.getByRole("button", { name: "Supprimer la catégorie" }).click();
await a.getByRole("button", { name: "Enregistrer la carte" }).click();
await a.getByText("Enregistrée").waitFor();
const enregistree = (await appel("GET", "/cartes/carte-automne-2026")).carte;
const articlesEnregistres = enregistree.categories.flatMap((c) => c.articles);
const varianteDouble = articlesEnregistres.find((x) => x.id === "ristretto")?.variantes?.[0]?.prixTTC;
const thesPurges = !JSON.stringify(enregistree).includes('"thes"');

// ── iPad : la carte arrive avec le rattachement ──
const ctx = await b.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true });
const p = await ctx.newPage();
p.on("pageerror", (e) => erreurs.push(e.message));
await p.goto(URL);
await p.locator(".champ-code input").fill(code);
await p.getByRole("button", { name: "Rattacher l'iPad" }).click();
await p.getByRole("button", { name: "Configurer plus tard" }).click();
await p.locator(".carte-personne", { hasText: "Lionel" }).click();
for (const x of "1234") await p.locator(".pave .touche", { hasText: new RegExp(`^${x}$`) }).last().click();
await p.getByRole("dialog", { name: "Fond de caisse" }).waitFor();
await p.getByRole("button", { name: "Plus tard" }).click();
await p.getByRole("button", { name: "Vente comptoir" }).click();
const tuile = (nom) => p.locator(".tuile", { hasText: nom }).first();
const avant = {
  espresso: await tuile("Espresso").textContent(),
  ristretto: await tuile("Ristretto").count(),
  cortado: await tuile("Cortado").textContent(),
};
await p.screenshot({ path: `${sortie}/c02-ipad-carte.png` });

// ── Nouvelle version publiée pendant le service ──
await a.getByRole("button", { name: "Espresso", exact: true }).click();
await a.locator(".fiche-article label.champ", { hasText: "Prix TTC" }).locator("input").fill("2,80");
await a.getByRole("button", { name: "Valider" }).click();
await a.getByRole("button", { name: "Enregistrer la carte" }).click();
await a.getByText("Enregistrée").waitFor();
await p.locator(".puce-synchro").click();
await p.locator(".tuile", { hasText: "2,80" }).first().waitFor({ timeout: 15000 });
const apres = await tuile("Espresso").textContent();

await b.close();
const resultat = { avant, apres, refusPrix: refusPrix > 0, varianteDouble, thesPurges, erreurs };
console.log(JSON.stringify(resultat, null, 2));
const ok = avant.espresso.includes("2,70") && avant.ristretto === 1 && avant.cortado.includes("Indisponible") && apres.includes("2,80") && refusPrix && varianteDouble === 350 && thesPurges && !erreurs.length;
if (!ok) process.exit(1);
