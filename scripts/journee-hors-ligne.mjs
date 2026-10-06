// Critère de sortie du lot 2 : une journée de service entièrement hors ligne
// (ventes, annulation, facture, comptage et Z), puis retour du réseau. La copie
// du serveur doit être identique à celle de l'iPad, enregistrement par enregistrement.
// Usage : serveur local vierge (apps/caisse : node scripts/serveur-local.mjs 4180), puis
//         URL=http://localhost:4180 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/journee-hors-ligne.mjs [dossier-captures]
import { chromium } from "playwright";
import { preparerServeur } from "./preparer-caisse.mjs";

const URL = process.env.URL ?? "http://localhost:4180";
const sortie = process.argv[2] ?? "captures";
const VENTES = Number(process.env.VENTES ?? 40);
const { code, appel } = await preparerServeur(URL, "Comptoir");
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true });
const p = await ctx.newPage();
const erreurs = [];
p.on("pageerror", (e) => erreurs.push(e.message));
const clic = (nom) => p.getByRole("button", { name: nom, exact: true }).first().click();
const champ = (libelle) => p.locator(".modale label.champ", { hasText: libelle }).locator("input");

await p.goto(URL);
await p.locator(".champ-code input").fill(code);
await clic("Rattacher l'iPad");
await clic("Configurer plus tard");
await p.locator(".carte-personne", { hasText: "Lionel" }).click();
for (const x of "1234") await p.locator(".pave .touche", { hasText: new RegExp(`^${x}$`) }).last().click();
await p.getByRole("dialog", { name: "Fond de caisse" }).waitFor();
await p.locator(".puce-synchro.synchronise").waitFor({ timeout: 15000 });

// ── Coupure réseau pour toute la journée ──
await ctx.setOffline(true);
await champ("Fond de caisse").fill("150");
await clic("Enregistrer le fond");
const articles = ["Espresso", "Cappuccino", "Flat white", "Latte"];
for (let i = 0; i < VENTES; i++) {
  await clic("Vente comptoir");
  await p.locator(".tuile", { hasText: articles[i % articles.length] }).first().click();
  if (i % 5 === 0) await p.locator(".tuile", { hasText: "Espresso" }).first().click();
  await clic("Encaisser");
  await p.locator(".mode", { hasText: i % 3 === 0 ? "Espèces" : "Carte bancaire" }).click();
  await p.getByRole("button", { name: /^Valider l'encaissement/ }).click();
  await clic("Terminé");
}
await p.locator(".puce-synchro.hors_ligne").waitFor({ timeout: 90000 });
await p.screenshot({ path: `${sortie}/h01-hors-ligne.png` });

// Annulation et facture, toujours sans réseau.
await p.getByRole("tab", { name: "Tickets" }).click();
await p.locator(".tableau-tickets tbody tr").nth(2).click();
await clic("Facture");
await champ("Nom ou raison sociale").fill("SARL Alpes Conseil");
await champ("Adresse").fill("3 avenue de Genève");
await champ("Code postal et ville").fill("74000 Annecy");
await clic("Émettre la facture");
await p.locator(".apercu-facture").waitFor();
await p.getByRole("button", { name: "Fermer" }).last().click();
await clic("Annuler ce ticket");
await clic("Erreur de saisie");
await p.locator(".modale").getByRole("button", { name: /^Annuler \d/ }).click();
await p.waitForTimeout(500);

// Comptage et Z.
await p.getByRole("tab", { name: "Clôtures" }).click();
await clic("Clôturer la journée (Z)");
const attendu = (await p.locator(".comptage-lignes div", { hasText: "Attendu dans le tiroir" }).locator("dd").textContent()).replace(/[^\d,]/g, "");
await clic("Saisir le total directement");
await champ("Espèces comptées").fill(attendu);
const cb = (await p.locator(".modale label.champ", { hasText: "Total CB du TPE" }).locator("small").textContent()).replace(/[^\d,]/g, "");
await champ("Total CB du TPE").fill(cb);
await champ("Titres-restaurant carte du TPE").fill("0");
await p.getByRole("button", { name: /^Valider.*clôturer/ }).click();
await p.getByText(/clôturée/).first().waitFor();

// Copie de l'iPad, avant le retour du réseau.
const local = await p.evaluate(async () => {
  const db = await new Promise((ok, ko) => {
    const r = indexedDB.open("matalon-pos");
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
  });
  const resultat = {};
  for (const chaine of ["tickets", "evenements", "clotures"]) {
    const tous = await new Promise((ok) => {
      const r = db.transaction(chaine).objectStore(chaine).getAll();
      r.onsuccess = () => ok(r.result);
    });
    resultat[chaine] = tous.map((e) => `${e.numero}:${e.hash}`);
  }
  return resultat;
});

// ── Retour du réseau ──
await ctx.setOffline(false);
await p.locator(".puce-synchro").click();
await p.locator(".puce-synchro.synchronise").waitFor({ timeout: 60000 });
await p.screenshot({ path: `${sortie}/h02-resynchronise.png` });

const { etablissements } = await appel("GET", "/etablissements");
const caisse = etablissements[0].caisses[0];
const verification = await appel("GET", `/caisses/${caisse.id}/verification`);
const journal = await appel("GET", `/caisses/${caisse.id}/journal.json`);
const serveur = Object.fromEntries(["tickets", "evenements", "clotures"].map((c) => [c, journal[c].map((e) => `${e.numero}:${e.hash}`)]));
const codes = journal.evenements.map((e) => e.code);
const identiques = ["tickets", "evenements", "clotures"].every((c) => JSON.stringify(local[c]) === JSON.stringify(serveur[c]));
await b.close();

const resultat = {
  ventes: VENTES,
  local: Object.fromEntries(Object.entries(local).map(([k, v]) => [k, v.length])),
  serveur: Object.fromEntries(Object.entries(serveur).map(([k, v]) => [k, v.length])),
  identiques,
  integre: verification.integre,
  evenements: codes,
  erreurs,
};
console.log(JSON.stringify(resultat, null, 2));
const attendus = ["FOND_DE_CAISSE", "FACTURE", "ANNULATION", "COMPTAGE_CAISSE", "CLOTURE"];
if (!identiques || !verification.integre || erreurs.length || local.tickets.length !== VENTES + 1 || attendus.some((c) => !codes.includes(c))) process.exit(1);
