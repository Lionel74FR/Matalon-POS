// Division de la note (demande de Lionel du 16 octobre) : sur l'iPad, une personne règle ses articles
// (un ticket, le reste demeure sur la table) ; sur l'iPhone, une autre verse sa part en espèces (acompte,
// rendu monnaie) ; la Z est refusée tant que la table porte un acompte ; un montant libre est pris puis
// rendu ; le dernier paiement édite le ticket final, qui reprend l'acompte. Au comptoir, un espresso offert se solde à 0,00 €. Trois tickets, 18,00 € en tout.
// Usage : serveur local vierge (apps/caisse : node scripts/serveur-local.mjs 4180), puis
//         URL=http://localhost:4180 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/division-note.mjs [dossier-captures]
import { chromium } from "playwright";
import { preparerServeur } from "./preparer-caisse.mjs";

const URL = process.env.URL ?? "http://localhost:4180";
const sortie = process.argv[2] ?? "captures";
const { code, appel } = await preparerServeur(URL, "Comptoir");
const { code: codeIphone } = await appel("POST", "/etablissements/moka/codes", { nomCaisse: "Salle" });
const erreurs = [];
const b = await chromium.launch();

async function appareil(nom, options, codeRattachement, bouton) {
  const ctx = await b.newContext(options);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => erreurs.push(`${nom} : ${e.message}`));
  const clic = (n) => p.getByRole("button", { name: n, exact: true }).first().click();
  await p.goto(URL);
  await p.locator(".champ-code input").fill(codeRattachement);
  await clic(bouton);
  await clic("Configurer plus tard");
  await p.locator(".carte-personne", { hasText: "Lionel" }).click();
  for (const x of "1234") await p.locator(".pave .touche", { hasText: new RegExp(`^${x}$`) }).last().click();
  await clic("Plus tard");
  await p.locator(".puce-synchro.synchronise").waitFor({ timeout: 15000 });
  return { p, clic };
}
const table = (a, n) => a.p.getByRole("button", { name: new RegExp(`^Table ${n},`) });
const ajouter = (a, article) => a.p.locator(".tuile", { hasText: article }).first().click();
const texte = async (loc) => ((await loc.textContent()) ?? "").replace(/\s+/g, " ").trim();
const toast = async (a, motif) => {
  const t = a.p.locator(".toast", { hasText: motif }).first();
  await t.waitFor({ timeout: 10000 });
  return texte(t);
};

const ipad = await appareil("ipad", { viewport: { width: 1180, height: 820 }, hasTouch: true }, code, "Rattacher l'iPad");
const iphone = await appareil(
  "iphone",
  {
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  },
  codeIphone,
  "Rattacher l'iPhone",
);
const r = {};

// ── iPad, table 6 : 3 couverts, 3 cappuccinos, un cortado, un espresso (18,00 €) ──
await table(ipad, 6).click();
await ipad.p.getByRole("button", { name: "Indiquer les couverts" }).click();
await ipad.p.locator(".couverts-choix", { hasText: /^3$/ }).click();
for (let i = 0; i < 3; i++) await ajouter(ipad, "Cappuccino");
await ajouter(ipad, "Cortado");
await ajouter(ipad, "Espresso");
r.total = await texte(ipad.p.locator(".ticket-total strong"));

// ── Par articles : le cortado et un cappuccino (7,50 €), par carte ──
await ipad.clic("Diviser");
await ipad.p.getByRole("button", { name: /^Par articles/ }).click();
await ipad.p.locator(".division-libelle", { hasText: "Cortado" }).click();
await ipad.p.getByRole("button", { name: "Une unité de plus : Cappuccino" }).click();
await ipad.p.screenshot({ path: `${sortie}/d01-division-articles.png` });
r.boutonSelection = await texte(ipad.p.getByRole("button", { name: /^Encaisser la sélection/ }));
await ipad.p.getByRole("button", { name: /^Encaisser la sélection/ }).click();
await ipad.p.locator(".mode", { hasText: "Carte bancaire" }).click();
await ipad.p.getByRole("button", { name: /^Valider l'encaissement/ }).click();
await ipad.p.getByRole("button", { name: "Retour à la table" }).click();
r.regleesIpad = await ipad.p.locator(".ticket-ligne.reglee").count();
r.resteApresArticles = await texte(ipad.p.locator(".ticket-total strong"));
await ipad.p.screenshot({ path: `${sortie}/d02-table-apres-articles.png` });
await ipad.p.getByRole("button", { name: "Retour à la salle" }).click();

// ── iPhone : la table montre le reste ; une part sur deux (5,25 €), payée avec un billet de 10 € ──
await iphone.p.getByRole("button", { name: /^Table 6, occupée/ }).waitFor({ timeout: 15000 });
await iphone.p.getByRole("button", { name: /^Table 6, occupée, 10,50 €/ }).waitFor({ timeout: 15000 });
await table(iphone, 6).click();
await iphone.p.locator(".resume-mobile").click();
await iphone.clic("Diviser");
await iphone.p.getByRole("button", { name: /^En parts égales/ }).click();
await iphone.p.locator(".parts .option", { hasText: /^2$/ }).click();
r.partIphone = await texte(iphone.p.locator(".ligne-montant.part strong"));
await iphone.p.locator(".billets .option", { hasText: "10,00 €" }).click();
await iphone.p.screenshot({ path: `${sortie}/d03-iphone-part.png` });
r.debordementIphone = await iphone.p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
await iphone.p.getByRole("button", { name: /^Valider la part/ }).click();
await iphone.p.getByRole("dialog", { name: "Acompte enregistré" }).waitFor();
r.acompteIphone = await texte(iphone.p.getByRole("dialog", { name: "Acompte enregistré" }).locator(".fin-encaissement"));
await iphone.p.screenshot({ path: `${sortie}/d04-iphone-acompte.png` });
await iphone.clic("Terminé");
await iphone.p.locator(".fermer-mobile").click();
await iphone.p.getByRole("tab", { name: "Salle" }).click();

// ── iPad : la Z est refusée tant que la table porte l'acompte ──
await ipad.p.getByRole("button", { name: /^Table 6, occupée, 5,25 €/ }).waitFor({ timeout: 15000 });
await ipad.p.getByRole("button", { name: /^Menu/ }).click().then(() => ipad.p.getByRole("menuitem", { name: "Clôtures" }).click());
await ipad.clic("Clôturer la journée (Z)");
r.refusZ = await toast(ipad, /Z impossible/);
await ipad.p.getByRole("tab", { name: "Salle" }).click();

// ── iPad : montant libre de 2,00 € par carte, rendu au client, puis le reste ──
await table(ipad, 6).click();
r.ticketIpad = await texte(ipad.p.locator(".ticket-acomptes"));
await ipad.clic("Encaisser");
// La table a été partagée en 2 : la part est proposée ; « Tout » pour un montant libre.
r.partProposee = await ipad.p.locator(".parts .option.active").textContent();
await ipad.p.locator(".parts .option", { hasText: /^Tout$/ }).click();
for (const x of ["2", "00"]) await ipad.p.locator(".encaissement-saisie .touche", { hasText: new RegExp(`^${x}$`) }).click();
await ipad.p.locator(".mode", { hasText: "Carte bancaire" }).click();
await ipad.p.getByRole("button", { name: /^Acompte de 2,00 €/ }).click();
await ipad.p.getByRole("dialog", { name: "Acompte enregistré" }).waitFor();
await ipad.clic("Terminé");
r.resteApresLibre = await texte(ipad.p.locator(".ticket-total strong"));
await ipad.clic("Encaisser");
await ipad.p.getByRole("button", { name: /^Rendre l'acompte Carte bancaire de 2,00/ }).click();
r.rendu = await toast(ipad, /Acompte annulé/);
await ipad.p.locator(".ligne-montant.acompte.annule").waitFor();
await ipad.p.screenshot({ path: `${sortie}/d05-ipad-acomptes.png` });
await ipad.p.locator(".parts .option", { hasText: /^Tout$/ }).click();
await ipad.p.locator(".mode", { hasText: "Carte bancaire" }).click();
r.boutonFinal = await texte(ipad.p.getByRole("button", { name: /^Valider l'encaissement/ }));
await ipad.p.getByRole("button", { name: /^Valider l'encaissement/ }).click();
await ipad.clic("Terminé");
await ipad.p.getByRole("button", { name: /^Table 6, libre/ }).waitFor({ timeout: 10000 });

// ── Comptoir : un espresso offert se solde à 0,00 €, sans paiement (régression du 16 octobre) ──
await ipad.p.getByRole("button", { name: /Vente Directe/ }).click();
await ajouter(ipad, "Espresso");
await ipad.p.locator(".ticket-ligne", { hasText: "Espresso" }).click();
await ipad.clic("Offert");
await ipad.clic("Offert maison");
await ipad.p.getByRole("button", { name: /^Valider/ }).click();
await ipad.clic("Encaisser");
r.boutonOffert = await texte(ipad.p.getByRole("button", { name: /^Valider l'encaissement/ }));
await ipad.p.getByRole("button", { name: /^Valider l'encaissement/ }).click();
await ipad.clic("Terminé");
await ipad.p.locator(".salle").waitFor();

// ── Serveur : trois tickets (dont l'offert), 18,00 €, 3 couverts (sur le ticket final), espèces nettes du rendu ──
await ipad.p.locator(".puce-synchro").click();
await ipad.p.locator(".puce-synchro.synchronise").waitFor({ timeout: 15000 });
await iphone.p.getByRole("button", { name: /^Table 6, libre/ }).waitFor({ timeout: 15000 });
const jour = new Date().toISOString().slice(0, 10);
const stats = await appel("GET", `/etablissements/moka/statistiques?du=${jour}&au=${jour}`);
r.serveur = {
  nbVentes: stats.indicateurs.nbVentes,
  caTTC: stats.indicateurs.caTTC,
  couverts: stats.indicateurs.couverts,
  paiements: Object.fromEntries(stats.paiements.map((p) => [p.mode, p.montant])),
};
await b.close();

console.log(JSON.stringify({ ...r, erreurs }, null, 2));
const ok =
  r.total === "18,00 €" &&
  /7,50 €/.test(r.boutonSelection) &&
  r.regleesIpad === 2 &&
  r.resteApresArticles === "10,50 €" &&
  r.partIphone === "5,25 €" &&
  /Rendu monnaie\s*4,75 €/.test(r.acompteIphone) &&
  /Reste sur la table\s*5,25 €/.test(r.acompteIphone) &&
  /Z impossible : Table 6 porte des acomptes/.test(r.refusZ) &&
  /1 acompte 5,25 €/.test(r.ticketIpad) &&
  r.partProposee === "2" &&
  r.resteApresLibre === "3,25 €" &&
  /rendez 2,00 €/.test(r.rendu) &&
  /5,25 €/.test(r.boutonFinal) &&
  r.serveur.nbVentes === 3 &&
  /0,00 €/.test(r.boutonOffert) &&
  r.serveur.caTTC === 1800 &&
  r.serveur.couverts === 3 &&
  r.serveur.paiements.CB === 1275 &&
  r.serveur.paiements.ESPECES === 525 &&
  r.debordementIphone <= 0 &&
  !erreurs.length;
if (!ok) process.exit(1);
