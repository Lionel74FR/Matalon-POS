// Suites (« courses ») : à la table 5, cafés en direct, salades « À suivre 1 », viennoiserie
// « À suivre 2 ». « Envoyer » fait tout partir, chaque bon rangé et marqué par suite ; « Réclamer
// AS1 » imprime un bon de réclame en cuisine ; un article ajouté à une suite déjà réclamée part
// marqué « réclamé ». La salle montre la prochaine suite à réclamer et le temps écoulé. Les
// imprimantes sont simulées : le scénario intercepte les requêtes ePOS-Print.
// Usage : serveur local vierge (apps/caisse : node scripts/serveur-local.mjs 4180), puis
//         URL=http://localhost:4180 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/suites.mjs [dossier-captures]
import { chromium } from "playwright";
import { preparerServeur } from "./preparer-caisse.mjs";

const URL = process.env.URL ?? "http://localhost:4180";
const sortie = process.argv[2] ?? "captures";
const { code, appel } = await preparerServeur(URL, "Comptoir");

// Carte : cafés au bar, tout le rayon Cuisine en cuisine.
const { carte, version } = await appel("GET", "/cartes/carte-automne-2026");
for (const c of carte.categories) {
  if (c.id === "cafes") c.poste = "Bar";
  if (c.rayon === "Cuisine") c.poste = "Cuisine";
}
await appel("PUT", "/cartes/carte-automne-2026", { carte, version });

const BAR = "10.0.0.21";
const CUISINE = "10.0.0.22";
const recus = [];
const b = await chromium.launch();
const erreurs = [];
const ctx = await b.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true });
await ctx.route(/https:\/\/10\.0\.0\.2[12]\//, async (route) => {
  const r = route.request();
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, OPTIONS" };
  if (r.method() === "OPTIONS") return route.fulfill({ status: 200, headers: cors });
  const xml = r.postData() ?? "";
  const textes = [...xml.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]).join(" | ");
  recus.push({ imprimante: new globalThis.URL(r.url()).hostname === BAR ? "bar" : "cuisine", textes });
  return route.fulfill({
    status: 200,
    headers: { ...cors, "content-type": "text/xml" },
    body: '<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><response success="true" code="" status="251658262" battery="0"/></s:Body></s:Envelope>',
  });
});
const p = await ctx.newPage();
p.on("pageerror", (e) => erreurs.push(e.message));
const clic = (n) => p.getByRole("button", { name: n, exact: true }).first().click();
const tuile = (nom) => p.locator(".tuile", { hasText: nom }).first().click();
const suite = (nom) => p.locator(".selecteur-suite").getByRole("radio", { name: nom, exact: true }).click();
const rayon = (nom) => p.getByRole("tab", { name: nom, exact: true }).click();
const categorie = (nom) => p.locator(".categories .pastille", { hasText: nom }).click();
await p.goto(URL);
await p.locator(".champ-code input").fill(code);
await clic("Rattacher l'iPad");
await clic("Configurer plus tard");
await p.locator(".carte-personne", { hasText: "Lionel" }).click();
for (const x of "1234") await p.locator(".pave .touche", { hasText: new RegExp(`^${x}$`) }).last().click();
await clic("Plus tard");
await p.locator(".puce-synchro.synchronise").waitFor({ timeout: 15000 });

await p.getByRole("button", { name: /^Menu/ }).click().then(() => p.getByRole("menuitem", { name: "Réglages" }).click());
await p.getByLabel("Adresse IP de l'imprimante Bar").fill(BAR);
await p.getByLabel("Adresse IP de l'imprimante Cuisine").fill(CUISINE);
await clic("Enregistrer les imprimantes");
await p.getByText("Imprimantes de production enregistrées").waitFor();

// ── Comptoir : pas de suites ──
await p.getByRole("tab", { name: "Salle" }).click();
await clic("Vente comptoir");
const selecteurComptoir = await p.locator(".selecteur-suite").count();
await p.getByRole("button", { name: "Retour à la salle" }).click();

// ── Table 5 : direct, AS1, AS2 ──
await p.getByRole("button", { name: /^Table 5,/ }).click();
const parDefaut = await p.locator(".selecteur-suite [aria-checked=true]").textContent();
await tuile("Cappuccino");
await tuile("Cappuccino");
await suite("AS1");
await rayon("Cuisine");
await categorie("Salades");
await tuile("Salade Moka");
await tuile("César revisitée");
await suite("AS2");
await categorie("Viennoiseries");
await tuile("Pain au chocolat");
const entetes = await p.locator(".entete-suite .nom-suite").allTextContents();
await p.screenshot({ path: `${sortie}/su01-suites.png` });
await clic("Envoyer (4)");
await p.getByRole("button", { name: "Envoyé", exact: true }).waitFor();
const envoi = recus.slice();
await p.screenshot({ path: `${sortie}/su02-envoye.png` });

// ── Salle : prochaine suite à réclamer ──
await p.getByRole("button", { name: "Retour à la salle" }).click();
const planTable5 = await p.getByRole("button", { name: /^Table 5,/ }).getAttribute("aria-label");
await p.waitForTimeout(3600); // notifications refermées
await p.screenshot({ path: `${sortie}/su03-plan.png` });
await p.getByRole("button", { name: "Afficher la liste des tables" }).click();
const listeTable5 = await p.locator(".grille-tables .table", { hasText: /^5/ }).first().locator(".suivi-suite").textContent();
await p.screenshot({ path: `${sortie}/su04-liste.png` });

// ── Réclamer AS1 : bon de réclame en cuisine ──
await p.locator(".grille-tables .table", { hasText: /^5/ }).first().click();
const avantReclame = recus.length;
await clic("Réclamer AS1");
await p.locator(".entete-suite.reclamee").waitFor();
const reclame1 = recus.slice(avantReclame);
const etatAS1 = await p.locator(".entete-suite.reclamee .etat-suite").textContent();

// Un croque ajouté à la suite déjà réclamée part marqué « réclamé ».
await suite("AS1");
await rayon("Cuisine");
await categorie("Les chauds du midi");
await tuile("Croque-madame");
const avantAjout = recus.length;
await clic("Envoyer (1)");
await p.getByRole("button", { name: "Envoyé", exact: true }).waitFor();
const ajout = recus.slice(avantAjout);

// Un latte saisi en direct par erreur : passé en « À suivre 3 » depuis la ligne, avant envoi.
await suite("Direct");
await rayon("Boissons");
await tuile("Latte");
await p.locator(".ticket-ligne", { hasText: "Latte" }).click();
await p.locator(".modale").getByRole("button", { name: "AS3", exact: true }).click();
await p.locator(".modale").getByRole("button", { name: /^Valider/ }).click();
const groupeLatte = await p.locator(".groupe-suite", { hasText: "Latte" }).locator(".nom-suite").textContent();

// Réclamer AS2 : ce qui reste à envoyer part d'abord (le latte AS3), puis la réclame.
const avantAS2 = recus.length;
await clic("Réclamer AS2");
await p.waitForFunction(() => document.querySelectorAll(".entete-suite.reclamee").length === 2);
const reclame2 = recus.slice(avantAS2);
await p.screenshot({ path: `${sortie}/su05-reclames.png` });
await p.getByRole("button", { name: "Retour à la salle" }).click();
const listeApres = await p.locator(".grille-tables .table", { hasText: /^5/ }).first().locator(".suivi-suite").textContent();

// ── iPhone : le sélecteur tient dans la commande ──
await p.setViewportSize({ width: 390, height: 844 });
await p.locator(".grille-tables .table", { hasText: /^5/ }).first().click();
await p.locator(".resume-mobile").click();
await p.waitForTimeout(3600);
const debordement = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
await p.screenshot({ path: `${sortie}/su06-iphone.png` });
await b.close();

const resultat = { selecteurComptoir, parDefaut, entetes, envoi, planTable5, listeTable5, reclame1, etatAS1, ajout, groupeLatte, reclame2, listeApres, debordement, erreurs };
console.log(JSON.stringify(resultat, null, 2));
const cuisine = envoi.find((r) => r.imprimante === "cuisine")?.textes ?? "";
const ok =
  selecteurComptoir === 0 &&
  parDefaut === "Direct" &&
  JSON.stringify(entetes) === '["En direct","À suivre 1","À suivre 2"]' &&
  envoi.length === 2 &&
  envoi.some((r) => r.imprimante === "bar" && /2 x Cappuccino/.test(r.textes) && !/SUIVRE/.test(r.textes)) &&
  /À SUIVRE 1 --.*Salade Moka.*César.*À SUIVRE 2 --.*Pain au chocolat/.test(cuisine) &&
  /À suivre 1 à réclamer/.test(planTable5) &&
  /^AS1 · \d+ min$/.test(listeTable5.trim()) &&
  reclame1.length === 1 &&
  reclame1[0].imprimante === "cuisine" &&
  /RÉCLAME.*À SUIVRE 1.*Salade Moka.*César/.test(reclame1[0].textes) &&
  !/Pain au chocolat/.test(reclame1[0].textes) &&
  /^Réclamée à \d\d:\d\d$/.test(etatAS1.trim()) &&
  ajout.length === 1 &&
  /À SUIVRE 1 · RÉCLAMÉ --.*Croque-madame/.test(ajout[0].textes) &&
  groupeLatte === "À suivre 3" &&
  reclame2.length === 2 &&
  reclame2.some((r) => r.imprimante === "bar" && /À SUIVRE 3 --.*Latte/.test(r.textes)) &&
  reclame2.some((r) => r.imprimante === "cuisine" && /RÉCLAME.*À SUIVRE 2.*Pain au chocolat/.test(r.textes)) &&
  /^AS3 · \d+ min$/.test(listeApres.trim()) &&
  debordement <= 0 &&
  erreurs.length === 0;
if (!ok) process.exit(1);
