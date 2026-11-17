// Formules découpées entre les cours (17 novembre 2026, Lionel : les menus respectent Direct, AS1, AS2),
// et couverts exigés avant d'envoyer en cuisine.
// Administration : cours de chaque choix du « Déjeuner Moka » (plat en Direct, dessert en À suivre 1,
// boisson chaude en À suivre 2). iPad : la formule se montre sous chaque cours (prix sous le premier),
// « Envoyer » range chaque choix sous son cours sur les bons, « Réclamer AS1 » ne rappelle que le dessert.
// Usage : serveur local vierge (apps/caisse : node scripts/serveur-local.mjs 4180), puis
//         URL=http://localhost:4180 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/formule-cours.mjs [dossier-captures]
import { chromium } from "playwright";
import { declarerImprimantes } from "./imprimantes-e2e.mjs";
import { accepterConfirmations, preparerServeur, rubriqueAdmin } from "./preparer-caisse.mjs";

const URL = process.env.URL ?? "http://localhost:4180";
const sortie = process.argv[2] ?? "captures";
const { code, cookie, appel } = await preparerServeur(URL, "Comptoir");
const [nomCookie, valeurCookie] = cookie.split("=");
const BAR = "10.0.0.21";
const CUISINE = "10.0.0.22";
const recus = [];
const erreurs = [];
const r = {};
const b = await chromium.launch();

// ── Administration : cours des choix de la formule ──
const bureau = await b.newContext({ viewport: { width: 1280, height: 900 } });
await bureau.addCookies([{ name: nomCookie, value: valeurCookie, url: `${URL}/api/admin` }]);
const a = await bureau.newPage();
a.on("pageerror", (e) => erreurs.push(`admin : ${e.message}`));
await accepterConfirmations(a);
await a.goto(`${URL}/admin`);
await rubriqueAdmin(a, "Cartes et prix");
await a.getByRole("button", { name: "Modifier" }).first().click();
await a.locator(".editeur-cat-nom", { hasText: "Formules" }).click();
await a.getByRole("button", { name: "Déjeuner Moka", exact: true }).click();
await a.getByRole("radiogroup", { name: "Cours du choix Dessert de la vitrine" }).getByRole("radio", { name: "À suivre 1" }).click();
await a.getByRole("radiogroup", { name: "Cours du choix Boisson chaude" }).getByRole("radio", { name: "À suivre 2" }).click();
await a.locator(".fiche-article").screenshot({ path: `${sortie}/fc01-cours-choix.png` });
await a.getByRole("button", { name: "Valider" }).click();
await a.getByRole("button", { name: "Enregistrer", exact: true }).click();
await a.getByText("Enregistrée").waitFor();
const { carte, version } = await appel("GET", "/cartes/carte-automne-2026");
r.carte = carte.categories.flatMap((c) => c.articles).find((x) => x.id === "dejeuner-moka").formule.map((c) => `${c.id}:${c.suite ?? 0}`);
// Postes de production : boissons chaudes au bar, plat et desserts en cuisine.
for (const c of carte.categories) {
  if (c.id === "cafes") c.poste = "Bar";
  if (c.id === "gouter" || c.articles.some((x) => x.id === "plat-du-jour")) c.poste = "Cuisine";
}
await appel("PUT", "/cartes/carte-automne-2026", { carte, version });

// ── iPad : imprimantes de production simulées ──
const ctx = await b.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true });
await ctx.route(/https:\/\/10\.0\.0\.2[12]\//, async (route) => {
  const q = route.request();
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, OPTIONS" };
  if (q.method() === "OPTIONS") return route.fulfill({ status: 200, headers: cors });
  const textes = [...(q.postData() ?? "").matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]).join(" ");
  if (textes.trim()) recus.push({ poste: new globalThis.URL(q.url()).hostname === BAR ? "bar" : "cuisine", textes: textes.replace(/\s+/g, " ") });
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
await declarerImprimantes(p, [{ nom: "Bar", type: "epson", adresse: BAR }, { nom: "Cuisine", type: "epson", adresse: CUISINE }], { Bar: "Bar", Cuisine: "Cuisine" });

// ── Table 3 : la formule se découpe entre les cours ──
await p.getByRole("button", { name: /^Salle/ }).first().click().catch(() => undefined);
await p.getByRole("tab", { name: "Salle" }).click().catch(() => undefined);
await p.getByRole("button", { name: /^Table 3,/ }).click();
await p.getByRole("tab", { name: "Formules", exact: true }).click();
await p.locator(".tuile", { hasText: "Déjeuner Moka" }).click();
for (const choix of ["Plat du jour", "Cheesecake citron", "Flat white"]) await clic(choix);
await p.getByRole("button", { name: /^Ajouter/ }).click();
r.groupes = await p.locator(".groupe-suite").evaluateAll((gs) =>
  gs.map((g) => ({
    suite: g.querySelector(".nom-suite")?.textContent ?? "",
    ligne: [...g.querySelectorAll(".ticket-ligne")].map((l) => [l.querySelector(".libelle")?.textContent?.replace(/\s+/g, " ").trim(), l.querySelector(".montant")?.textContent?.trim()]),
  })),
);
await p.locator(".ticket").first().screenshot({ path: `${sortie}/fc02-commande.png` }).catch(() => p.screenshot({ path: `${sortie}/fc02-commande.png` }));
// Couverts exigés : des articles partent en cuisine (17 novembre 2026).
await p.getByRole("button", { name: /^Envoyer/ }).click();
const fenetre = p.getByRole("dialog", { name: "Couverts" });
await fenetre.waitFor();
r.couverts = { exiges: await fenetre.getByText("Des articles partent en cuisine").count(), avantEnvoi: recus.length, sansCouverts: await fenetre.getByRole("button", { name: "Sans couverts" }).count() };
await fenetre.getByRole("button", { name: "2", exact: true }).click();
await p.getByText("Envoyé").first().waitFor();
r.couverts.titre = await p.locator(".ticket-titre").textContent();
await p.waitForTimeout(500);
r.envoi = recus.map((x) => `${x.poste}: ${x.textes}`);
const avant = recus.length;
await p.getByRole("button", { name: "Réclamer AS1" }).click();
await p.getByText(/À suivre 1 réclamée/).first().waitFor();
await p.waitForTimeout(500);
r.reclame = recus.slice(avant).map((x) => `${x.poste}: ${x.textes}`);
r.boutonAS2 = await p.getByRole("button", { name: "Réclamer AS2" }).count();
await b.close();

console.log(JSON.stringify({ ...r, erreurs }, null, 2));
const tout = r.envoi.join(" | ");
const ok =
  r.carte.join() === "plat:0,dessert:1,boisson-chaude:2" &&
  r.couverts.exiges === 1 &&
  r.couverts.avantEnvoi === 0 &&
  r.couverts.sansCouverts === 0 &&
  /2 couverts/.test(r.couverts.titre) &&
  JSON.stringify(r.groupes.map((g) => g.suite)) === JSON.stringify(["En direct", "À suivre 1", "À suivre 2"]) &&
  /Plat du jour/.test(r.groupes[0].ligne[0][0]) &&
  /19,00/.test(r.groupes[0].ligne[0][1]) &&
  /Cheesecake citron.*Suite de la formule/.test(r.groupes[1].ligne[0][0]) &&
  r.groupes[1].ligne[0][1] === "" &&
  /Flat white/.test(r.groupes[2].ligne[0][0]) &&
  /À SUIVRE 2.*Flat white/i.test(tout) &&
  /À SUIVRE 1.*Cheesecake citron/i.test(tout) &&
  r.reclame.length >= 1 &&
  r.reclame.every((x) => !/Flat white|Plat du jour/.test(x)) &&
  r.reclame.some((x) => /Cheesecake citron/.test(x)) &&
  r.boutonAS2 === 1 &&
  !erreurs.length;
if (!ok) process.exit(1);
