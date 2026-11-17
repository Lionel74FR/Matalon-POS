// Commentaires d'articles (17 novembre 2026, Lionel : cuissons des viandes, groupes liés aux articles depuis la carte).
// Administration : groupes « Cuisson » (obligatoire) et « Sauce » (plusieurs à la fois), proposés sur le Plat du jour.
// iPad : la cuisson est exigée avant l'ajout, deux cuissons font deux lignes, la cuisson se change sur la ligne avant
// envoi, la formule la demande sous le plat choisi ; le bon de cuisine porte chaque commentaire, le ticket aucun.
// Usage : serveur local vierge (apps/caisse : node scripts/serveur-local.mjs 4180), puis
//         URL=http://localhost:4180 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/commentaires.mjs [dossier-captures]
import { chromium } from "playwright";
import { declarerImprimantes } from "./imprimantes-e2e.mjs";
import { accepterConfirmations, preparerServeur, rubriqueAdmin } from "./preparer-caisse.mjs";

const URL = process.env.URL ?? "http://localhost:4180";
const sortie = process.argv[2] ?? "captures";
const { code, cookie, appel } = await preparerServeur(URL, "Comptoir");
const [nomCookie, valeurCookie] = cookie.split("=");
const CUISINE = "10.0.0.22";
const recus = [];
const erreurs = [];
const r = {};
const b = await chromium.launch();

// ── Administration : groupes de commentaires, liés au Plat du jour ──
const bureau = await b.newContext({ viewport: { width: 1280, height: 900 } });
await bureau.addCookies([{ name: nomCookie, value: valeurCookie, url: `${URL}/api/admin` }]);
const a = await bureau.newPage();
a.on("pageerror", (e) => erreurs.push(`admin : ${e.message}`));
await accepterConfirmations(a);
await a.goto(`${URL}/admin`);
await rubriqueAdmin(a, "Cartes et prix");
await a.getByRole("button", { name: "Modifier" }).first().click();
await a.getByRole("button", { name: /^Commentaires/ }).click();
const fenetre = a.getByRole("dialog", { name: "Commentaires" });
for (const [nom, liste, obligatoire, plusieurs] of [
  ["Cuisson", "Bleu\nSaignant\nÀ point\nBien cuit", true, false],
  ["Sauce", "Poivre\nBéarnaise\nRoquefort", false, true],
]) {
  await fenetre.getByRole("button", { name: "Groupe de commentaires" }).click();
  const groupe = fenetre.locator(".groupe-commentaires-edition").last();
  await groupe.getByPlaceholder("Ex. Cuisson").fill(nom);
  await groupe.locator("textarea").fill(liste);
  if (obligatoire) await groupe.getByLabel(/^Obligatoire/).check();
  if (plusieurs) await groupe.getByLabel("Plusieurs à la fois").check();
}
await fenetre.screenshot({ path: `${sortie}/cm01-groupes.png` });
await fenetre.getByRole("button", { name: "Valider" }).click();
await a.getByRole("button", { name: "Chercher un article", exact: true }).click();
await a.getByPlaceholder("Nom de l'article").fill("Plat du jour");
await a.locator(".editeur-recherche .editeur-cat-nom", { hasText: "Plat du jour" }).click();
const fiche = a.locator(".fiche-article");
await fiche.getByRole("group", { name: "Commentaires proposés en caisse" }).getByLabel(/^Cuisson/).check();
await fiche.getByRole("group", { name: "Commentaires proposés en caisse" }).getByLabel(/^Sauce/).check();
await fiche.screenshot({ path: `${sortie}/cm02-fiche-article.png` });
await fiche.getByRole("button", { name: "Valider" }).click();
await a.getByRole("button", { name: "Enregistrer", exact: true }).click();
await a.getByText("Enregistrée").waitFor();
const { carte, version } = await appel("GET", "/cartes/carte-automne-2026");
r.carte = {
  groupes: carte.commentaires.map((g) => `${g.id}:${g.commentaires.join("/")}:${g.obligatoire ? "o" : ""}${g.plusieurs ? "p" : ""}`),
  plat: carte.categories.flatMap((c) => c.articles).find((x) => x.id === "plat-du-jour").commentaires,
};
// Cuisine : plats et formules partent en cuisine.
for (const c of carte.categories) if (c.rayon === "Cuisine" || c.id === "formules" || c.articles.some((x) => x.formule)) c.poste = "Cuisine";
await appel("PUT", "/cartes/carte-automne-2026", { carte, version });

// ── iPad : imprimante de cuisine simulée ──
const ctx = await b.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true });
await ctx.route(/https?:\/\/10\.0\.0\.22\//, async (route) => {
  const q = route.request();
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, OPTIONS" };
  if (q.method() === "OPTIONS") return route.fulfill({ status: 200, headers: cors });
  const textes = [...(q.postData() ?? "").matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]).join(" ");
  if (textes.trim()) recus.push(textes.replace(/\s+/g, " "));
  return route.fulfill({
    status: 200,
    headers: { ...cors, "content-type": "text/xml" },
    body: '<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><response success="true" code="" status="251658262" battery="0"/></s:Body></s:Envelope>',
  });
});
const p = await ctx.newPage();
p.on("pageerror", (e) => erreurs.push(e.message));
const clic = (n) => p.getByRole("button", { name: n, exact: true }).first().click();
await p.goto(URL);
await p.locator(".champ-code input").fill(code);
await clic("Rattacher l'iPad");
await clic("Configurer plus tard");
await p.locator(".carte-personne", { hasText: "Lionel" }).click();
for (const x of "1234") await p.locator(".pave .touche", { hasText: new RegExp(`^${x}$`) }).last().click();
await clic("Plus tard");
await p.locator(".puce-synchro.synchronise").waitFor({ timeout: 15000 });
await p.getByRole("button", { name: /^Menu/ }).click().then(() => p.getByRole("menuitem", { name: "Réglages" }).click());
await declarerImprimantes(p, [{ nom: "Cuisine", type: "epson", adresse: CUISINE }], { Cuisine: "Cuisine" });

// ── Table 3 : deux plats du jour, saignant au poivre et à point ──
await p.getByRole("button", { name: /^Salle/ }).first().click().catch(() => undefined);
await p.getByRole("tab", { name: "Salle" }).click().catch(() => undefined);
await p.getByRole("button", { name: /^Table 3,/ }).click();
const plat = async () => {
  const champ = p.getByLabel("Article à chercher");
  if (!(await champ.count())) await p.getByRole("button", { name: "Rechercher un article", exact: true }).click();
  await champ.fill("Plat du jour");
  await p.locator(".tuile", { hasText: "Plat du jour" }).first().click();
};
await plat();
const modale = p.getByRole("dialog", { name: "Plat du jour" });
r.avantCuisson = { bouton: (await modale.getByRole("button", { name: /^Choisissez/ }).textContent())?.trim(), desactive: await modale.getByRole("button", { name: /^Choisissez/ }).isDisabled() };
await modale.getByRole("radiogroup", { name: "Cuisson" }).getByRole("radio", { name: "Saignant" }).click();
await modale.getByRole("group", { name: "Sauce" }).getByRole("button", { name: "Poivre" }).click();
await modale.screenshot({ path: `${sortie}/cm03-caisse-cuisson.png` });
await modale.getByRole("button", { name: /^Ajouter/ }).click();
await plat();
await modale.getByRole("radiogroup", { name: "Cuisson" }).getByRole("radio", { name: "À point" }).click();
await modale.getByRole("button", { name: /^Ajouter/ }).click();
await plat();
await modale.getByRole("radiogroup", { name: "Cuisson" }).getByRole("radio", { name: "Saignant" }).click();
await modale.getByRole("group", { name: "Sauce" }).getByRole("button", { name: "Poivre" }).click();
await modale.getByRole("button", { name: /^Ajouter/ }).click();
// Avant envoi : la ligne à point passe bleue.
await p.locator(".ticket-ligne", { hasText: "À point" }).click();
const ligne = p.getByRole("dialog", { name: "Plat du jour" });
await ligne.getByRole("radiogroup", { name: "Cuisson" }).getByRole("radio", { name: "Bleu" }).click();
await ligne.getByRole("button", { name: /^Valider/ }).click();
// Formule : la cuisson est demandée sous le plat choisi.
if (await p.getByLabel("Article à chercher").count()) await p.getByRole("button", { name: "Fermer la recherche" }).click();
await p.getByRole("tab", { name: "Formules", exact: true }).click();
await p.locator(".tuile", { hasText: "Déjeuner Moka" }).click();
const formule = p.getByRole("dialog", { name: "Déjeuner Moka" });
await formule.getByRole("button", { name: "Plat du jour", exact: true }).click();
await formule.getByRole("button", { name: "Cheesecake citron", exact: true }).click();
await formule.getByRole("button", { name: "Flat white", exact: true }).click();
r.formuleAvant = (await formule.getByRole("button", { name: /^Choisissez/ }).textContent())?.trim();
await formule.getByRole("radiogroup", { name: "Cuisson · Plat du jour" }).getByRole("radio", { name: "Bien cuit" }).click();
await formule.screenshot({ path: `${sortie}/cm04-formule-cuisson.png` });
await formule.getByRole("button", { name: /^Ajouter/ }).click();
r.lignes = await p.locator(".ticket-ligne").evaluateAll((ls) => ls.map((l) => [l.querySelector(".qte")?.textContent, l.querySelector(".libelle")?.textContent?.replace(/\s+/g, " ").trim()]));
await p.locator(".ticket").first().screenshot({ path: `${sortie}/cm05-commande.png` }).catch(() => undefined);
await p.getByRole("button", { name: /^Envoyer/ }).click();
await p.getByRole("dialog", { name: "Couverts" }).getByRole("button", { name: "3", exact: true }).click();
await p.getByText("Envoyé").first().waitFor();
await p.waitForTimeout(500);
r.bons = recus.join(" | ");
await b.close();

console.log(JSON.stringify({ ...r, erreurs }, null, 2));
const ok =
  r.carte.groupes.join() === "cuisson:Bleu/Saignant/À point/Bien cuit:o,sauce:Poivre/Béarnaise/Roquefort:p" &&
  r.carte.plat.join() === "cuisson,sauce" &&
  r.avantCuisson.bouton === "Choisissez : Cuisson" &&
  r.avantCuisson.desactive &&
  r.formuleAvant === "Choisissez : Cuisson" &&
  r.lignes.some(([q, l]) => q === "2" && /Plat du jour.*Saignant · Poivre/.test(l)) &&
  r.lignes.some(([q, l]) => q === "1" && /Plat du jour.*Bleu/.test(l) && !/À point/.test(l)) &&
  r.lignes.some(([, l]) => /Déjeuner Moka.*Plat du jour \(Bien cuit\)/.test(l)) &&
  /2 x Plat du jour.*Saignant.*Poivre/i.test(r.bons) &&
  /1 x Plat du jour.*Bleu/i.test(r.bons) &&
  /Plat du jour \(Bien cuit\)/.test(r.bons) &&
  !erreurs.length;
if (!ok) process.exit(1);
