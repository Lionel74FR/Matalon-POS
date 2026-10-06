// Comptes clients : une table part sans payer, hors ligne, au compte d'un client créé sur place ;
// le lendemain, la dette est réglée en espèces sur un autre appareil. La Z distingue le chiffre
// d'affaires (le jour de la vente) de la TVA exigible (le jour du règlement), et le serveur
// recalcule le solde à zéro.
// Usage : serveur local vierge (apps/caisse : node scripts/serveur-local.mjs 4180), puis
//         URL=http://localhost:4180 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/comptes.mjs [dossier-captures]
import { chromium } from "playwright";
import { preparerServeur } from "./preparer-caisse.mjs";

const URL = process.env.URL ?? "http://localhost:4180";
const sortie = process.argv[2] ?? "captures";
const { code, appel } = await preparerServeur(URL, "Comptoir");
const { code: codeIphone } = await appel("POST", "/etablissements/moka/codes", { nomCaisse: "iPhone" });
const b = await chromium.launch();
const erreurs = [];

async function appareil(nom, options, codeRattachement, libelleRattacher) {
  const ctx = await b.newContext(options);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => erreurs.push(`${nom} : ${e.message}`));
  const clic = (n) => p.getByRole("button", { name: n, exact: true }).first().click();
  await p.goto(URL);
  await p.locator(".champ-code input").fill(codeRattachement);
  await clic(libelleRattacher);
  await clic("Configurer plus tard");
  await p.locator(".carte-personne", { hasText: "Lionel" }).click();
  for (const x of "1234") await p.locator(".pave .touche", { hasText: new RegExp(`^${x}$`) }).last().click();
  await clic("Plus tard");
  await p.locator(".puce-synchro.synchronise").waitFor({ timeout: 15000 });
  return { ctx, p, clic };
}

// ── iPad : table 5, partie sans payer, hors ligne ──
const ipad = await appareil("iPad", { viewport: { width: 1180, height: 820 }, hasTouch: true }, code, "Rattacher l'iPad");
await ipad.ctx.setOffline(true);
await ipad.p.locator(".grille-tables .table", { hasText: /^5/ }).click();
await ipad.p.locator(".tuile", { hasText: "Cappuccino" }).first().click();
await ipad.p.getByRole("tab", { name: "Bar", exact: true }).click();
await ipad.clic("Spritz");
await ipad.p.locator(".tuile", { hasText: "Spritz Aperol" }).click();
await ipad.clic("Encaisser");
await ipad.p.locator(".mode", { hasText: "En compte" }).click();
await ipad.clic("Nouveau client");
await ipad.p.locator(".formulaire-client input").first().fill("M. Martin");
await ipad.p.locator(".formulaire-client input").nth(1).fill("06 12 34 56 78");
await ipad.p.screenshot({ path: `${sortie}/k01-nouveau-client.png` });
await ipad.clic("Créer et choisir");
await ipad.p.getByRole("button", { name: /^Valider l'encaissement/ }).click();
await ipad.p.getByText("Au compte de M. Martin").first().waitFor();
await ipad.p.screenshot({ path: `${sortie}/k02-au-compte.png` });
await ipad.clic("Terminé");

// Retour du réseau : le serveur apprend le client par le ticket.
await ipad.ctx.setOffline(false);
await ipad.p.locator(".puce-synchro").click();
await ipad.p.locator(".puce-synchro.synchronise").waitFor({ timeout: 20000 });
const venteZ = await (async () => {
  await ipad.p.getByRole("tab", { name: "Clôtures" }).click();
  await ipad.p.getByRole("button", { name: "Lecture X", exact: true }).click();
  await ipad.p.getByText("Porté en compte").waitFor();
  return ipad.p.locator(".resume-totaux, dl").first().textContent();
})();
await ipad.p.screenshot({ path: `${sortie}/k03-lecture-x.png` });

// ── iPhone : règlement de la dette ──
const iphone = await appareil(
  "iPhone",
  {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  },
  codeIphone,
  "Rattacher l'iPhone",
);
await iphone.p.getByRole("tab", { name: "Comptes" }).click();
await iphone.p.locator(".compte", { hasText: "M. Martin" }).waitFor({ timeout: 15000 });
const soldeAvant = await iphone.p.locator(".compte", { hasText: "M. Martin" }).locator(".montant").textContent();
await iphone.p.screenshot({ path: `${sortie}/k04-comptes-iphone.png` });
await iphone.p.locator(".compte", { hasText: "M. Martin" }).click();
await iphone.p.locator(".modale .mode", { hasText: "Espèces" }).click();
await iphone.p.screenshot({ path: `${sortie}/k05-reglement.png` });
await iphone.p.getByRole("button", { name: /^Encaisser/ }).click();
await iphone.p.getByText("règlement enregistré").waitFor();
await iphone.p.screenshot({ path: `${sortie}/k06-regle.png` });
await iphone.clic("Terminé");
await iphone.p.getByText("Aucune dette en cours").waitFor({ timeout: 15000 });

// Contrôle serveur : solde à zéro, aucune anomalie.
const comptes = await appel("GET", "/etablissements/moka/comptes");
const martin = comptes.comptes.find((c) => c.client.nom === "M. Martin");

// Erreur de saisie : le règlement s'annule, la dette renaît.
await iphone.p.getByRole("tab", { name: "Tickets" }).click();
await iphone.p.locator(".tableau-tickets tbody tr", { hasText: "Règlement" }).first().click();
await iphone.clic("Annuler ce règlement");
await iphone.clic("Erreur de client");
await iphone.p.locator(".modale").getByRole("button", { name: /^Annuler \d/ }).click();
await iphone.p.locator(".tableau-tickets tbody tr", { hasText: "Annulation de règlement" }).waitFor();
await iphone.p.getByRole("tab", { name: "Comptes" }).click();
await iphone.p.locator(".compte", { hasText: "M. Martin" }).waitFor({ timeout: 15000 });
const soldeApresAnnulation = await iphone.p.locator(".compte", { hasText: "M. Martin" }).locator(".montant").textContent();
const comptesFin = await appel("GET", "/etablissements/moka/comptes");
await b.close();
const resultat = { soldeAvant, soldeServeur: martin?.soldeTTC, soldeApresAnnulation, anomaliesFin: comptesFin.anomalies, telephone: martin?.client.telephone, anomalies: comptes.anomalies, lectureX: venteZ?.slice(0, 160), erreurs };
console.log(JSON.stringify(resultat, null, 2));
if (erreurs.length || martin?.soldeTTC !== 0 || comptes.anomalies.length || comptesFin.anomalies.length || !/15,00/.test(soldeAvant ?? "") || !/15,00/.test(soldeApresAnnulation ?? "")) {
  process.exit(1);
}
