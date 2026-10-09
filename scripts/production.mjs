// Imprimantes de production : la carte envoie les cafés au poste « Bar » et les viennoiseries au
// poste « Cuisine » ; chaque poste est relié à son imprimante depuis les Réglages de l'iPad.
// « Envoyer » imprime les nouveaux articles par poste, un retrait après envoi imprime un bon
// d'annulation, et ce qui reste part d'office à l'encaissement. Les imprimantes sont simulées :
// le scénario intercepte les requêtes ePOS-Print et vérifie ce que chacune a reçu.
// Usage : serveur local vierge (apps/caisse : node scripts/serveur-local.mjs 4180), puis
//         URL=http://localhost:4180 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/production.mjs [dossier-captures]
import { chromium } from "playwright";
import { preparerServeur } from "./preparer-caisse.mjs";

const URL = process.env.URL ?? "http://localhost:4180";
const sortie = process.argv[2] ?? "captures";
const { code, appel } = await preparerServeur(URL, "Comptoir");

// Carte : un poste par catégorie concernée (ce que fait l'éditeur de carte, champ « Poste de production »).
const { carte, version } = await appel("GET", "/cartes/carte-automne-2026");
for (const c of carte.categories) {
  if (c.id === "cafes") c.poste = "Bar";
  if (c.id === "viennoiseries") c.poste = "Cuisine";
}
await appel("PUT", "/cartes/carte-automne-2026", { carte, version });

const BAR = "10.0.0.21";
const CUISINE = "10.0.0.22";
const recus = [];
const b = await chromium.launch();
const erreurs = [];
const ctx = await b.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true });
// Imprimantes simulées : réponse ePOS-Print « imprimé », en-têtes CORS comme une Epson.
await ctx.route(/https:\/\/10\.0\.0\.2[12]\//, async (route) => {
  const r = route.request();
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, OPTIONS" };
  if (r.method() === "OPTIONS") return route.fulfill({ status: 200, headers: cors });
  const xml = r.postData() ?? "";
  const textes = [...xml.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]).join(" ");
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
await p.goto(URL);
await p.locator(".champ-code input").fill(code);
await clic("Rattacher l'iPad");
await clic("Configurer plus tard");
await p.locator(".carte-personne", { hasText: "Lionel" }).click();
for (const x of "1234") await p.locator(".pave .touche", { hasText: new RegExp(`^${x}$`) }).last().click();
await clic("Plus tard");
await p.locator(".puce-synchro.synchronise").waitFor({ timeout: 15000 });

// ── Sans imprimante de production, Envoyer valide la commande sans imprimer ──
await p.getByRole("button", { name: /^Table 5,/ }).click();
await p.locator(".tuile", { hasText: "Cappuccino" }).first().click();
// Brouillon : supprimé avant envoi, l'article disparaît sans trace.
await p.locator(".ticket-ligne", { hasText: "Cappuccino" }).click();
await clic("Supprimer");
const envoyerAvant = await p.locator(".ticket-ligne").count();
await p.getByRole("button", { name: "Retour à la salle" }).click();

// ── Réglages : une imprimante par poste, bon d'essai ──
await p.getByRole("button", { name: /^Menu/ }).click().then(() => p.getByRole("menuitem", { name: "Réglages" }).click());
await p.getByLabel("Adresse IP de l'imprimante Bar").fill(BAR);
await p.getByLabel("Adresse IP de l'imprimante Cuisine").fill(CUISINE);
await clic("Enregistrer les imprimantes");
await p.getByText("Imprimantes de production enregistrées").waitFor();
await p.getByRole("button", { name: "Imprimer un bon d'essai sur Cuisine" }).click();
await p.getByText("Bon d'essai envoyé à Cuisine").waitFor();
await p.locator(".postes-production").screenshot({ path: `${sortie}/p01-postes.png` });
const essai = recus.at(-1);

// ── Table 5 : envoi par poste ──
await p.getByRole("tab", { name: "Salle" }).click();
await p.getByRole("button", { name: /^Table 5,/ }).click();
await p.locator(".tuile", { hasText: "Cappuccino" }).first().click();
await p.locator(".tuile", { hasText: "Cappuccino" }).first().click();
await p.getByRole("tab", { name: "Cuisine", exact: true }).click();
await p.locator(".tuile", { hasText: "Croissant" }).first().click();
await clic("Envoyer (2)");
await p.getByRole("button", { name: "Envoyé", exact: true }).waitFor();
const apresEnvoi = recus.slice(1).map((r) => r.imprimante);
const envoyees = await p.locator(".ticket-ligne .mention-envoyee", { hasText: "Envoyé" }).count();
await p.screenshot({ path: `${sortie}/p02-envoye.png` });

// Un cappuccino de plus : nouvelle ligne à envoyer, pas de fusion avec la ligne partie.
await p.getByRole("tab", { name: "Boissons", exact: true }).click();
await p.locator(".tuile", { hasText: "Cappuccino" }).first().click();
const lignesCappuccino = await p.locator(".ticket-ligne", { hasText: "Cappuccino" }).count();
await p.getByRole("button", { name: "Envoyer (1)" }).waitFor();

// Retrait du croissant déjà parti : bon d'annulation en cuisine.
const avantRetrait = recus.length;
await p.locator(".ticket-ligne", { hasText: "Croissant" }).click();
await clic("Retirer de la commande");
await p.locator(".ticket-ligne.retiree", { hasText: "Croissant" }).waitFor();
await p.waitForFunction(() => document.querySelectorAll(".ticket-ligne .mention-envoyee").length === 1);
const annulation = recus.slice(avantRetrait);

// Encaissement : le cappuccino pas encore envoyé part au bar.
const avantEncaissement = recus.length;
await clic("Encaisser");
await p.locator(".mode", { hasText: "Carte bancaire" }).click();
await p.getByRole("button", { name: /^Valider l'encaissement/ }).click();
await p.getByRole("button", { name: "Terminé" }).waitFor();
await p.waitForTimeout(1000);
const aLEncaissement = recus.slice(avantEncaissement);
await p.screenshot({ path: `${sortie}/p03-encaisse.png` });
await b.close();

const resultat = { envoyerAvant, essai, apresEnvoi, envoyees, lignesCappuccino, annulation, aLEncaissement, nbRecus: recus.length, erreurs };
console.log(JSON.stringify(resultat, null, 2));
const ok =
  envoyerAvant === 0 &&
  essai?.imprimante === "cuisine" &&
  /Bon d(&apos;|')essai/.test(essai.textes) &&
  JSON.stringify(apresEnvoi.sort()) === '["bar","cuisine"]' &&
  recus.some((r) => r.imprimante === "bar" && /2 x Cappuccino/.test(r.textes)) &&
  envoyees === 2 &&
  lignesCappuccino === 2 &&
  annulation.length === 1 &&
  annulation[0].imprimante === "cuisine" &&
  /ANNULATION/.test(annulation[0].textes) &&
  /Croissant/.test(annulation[0].textes) &&
  aLEncaissement.length === 1 &&
  aLEncaissement[0].imprimante === "bar" &&
  /1 x Cappuccino/.test(aLEncaissement[0].textes) &&
  erreurs.length === 0;
if (!ok) process.exit(1);
