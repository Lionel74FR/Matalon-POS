// Parcours de bout en bout dans Chromium : administration (compte 2FA, équipe,
// code de rattachement), puis caisse au format iPad paysage : rattachement,
// connexion, commande en salle, remise, encaissement, Z, synchronisation.
// Usage (dans apps/caisse) : pnpm build && node scripts/serveur-local.mjs 4180, puis à la racine :
//         URL=http://localhost:4180 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/parcours.mjs [dossier-captures]
import { chromium } from "playwright";
import { totp } from "./preparer-caisse.mjs";

const URL = process.env.URL ?? "http://localhost:4180";
const sortie = process.argv[2] ?? "captures";
const b = await chromium.launch();
const erreurs = [];

// ── Administration, sur ordinateur ──
const bureau = await b.newContext({ viewport: { width: 1280, height: 900 } });
const a = await bureau.newPage();
a.on("pageerror", (e) => erreurs.push(`admin : ${e.message}`));
const champA = (libelle) => a.locator("label.champ", { hasText: libelle }).locator("input");
await a.goto(`${URL}/admin`);
await a.getByText("Créer le compte administrateur").waitFor();
await champA("Identifiant").fill("lionel");
await champA(/^Mot de passe/).fill("un-mot-de-passe-solide");
await champA("Confirmer le mot de passe").fill("un-mot-de-passe-solide");
await a.getByRole("button", { name: "Continuer" }).click();
const secret = await a.locator(".admin-totp code").textContent();
await a.screenshot({ path: `${sortie}/00a-admin-2fa.png` });
await champA("Code à 6 chiffres").fill(totp(secret));
await a.getByRole("button", { name: "Activer et se connecter" }).click();
await a.getByRole("heading", { name: "Moka" }).waitFor();
// Équipe : un responsable d'abord.
await a.getByPlaceholder("Prénom").fill("Lionel");
await a.locator(".admin-section", { hasText: "Équipe" }).locator("select").last().selectOption("responsable");
await a.getByPlaceholder("Code PIN").fill("1234");
await a.getByRole("button", { name: "Ajouter", exact: true }).click();
await a.locator(".admin-tableau td", { hasText: "Lionel" }).waitFor();
// Identité légale.
await champA("Raison sociale").fill("SAS Moka Annecy");
await champA("SIRET").fill("123 456 789 00012");
await champA("TVA intracommunautaire").fill("FR12123456789");
await a.getByRole("button", { name: "Enregistrer", exact: true }).click();
await a.getByText("Enregistré.").waitFor();
// Code de rattachement.
await a.getByPlaceholder("Nom de l'iPad").fill("Comptoir");
await a.getByRole("button", { name: "Générer un code" }).click();
const code = (await a.locator(".admin-code span").textContent()).trim();
await a.screenshot({ path: `${sortie}/00b-admin-code.png`, fullPage: true });

// ── Caisse, sur iPad ──
const ctx = await b.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1, hasTouch: true });
const p = await ctx.newPage();
p.on("pageerror", (e) => erreurs.push(e.message));
p.on("console", (m) => m.type() === "error" && erreurs.push(m.text()));
const capture = (nom) => p.screenshot({ path: `${sortie}/${nom}.png` });
const clic = (texte) => p.getByRole("button", { name: texte, exact: true }).first().click();
const pin = async (c) => {
  for (const x of c) await p.locator(".pave .touche", { hasText: new RegExp(`^${x}$`) }).last().click();
};

await p.goto(URL);
await p.getByText("Rattacher cet iPad à un établissement").waitFor();
await p.locator(".champ-code input").fill(code);
await capture("01-rattachement");
await clic("Rattacher l'iPad");

// Assistant imprimante : on parcourt les premières étapes puis on remet à plus tard.
await p.getByText("Connecter l'imprimante").first().waitFor();
await capture("01b-assistant-brancher");
await clic("C'est branché");
await p.locator(".champ-ip input").fill("192.168.1.50");
await capture("01c-assistant-adresse");
await clic("Continuer");
await capture("01d-assistant-certificat");
await clic("Configurer plus tard");

await p.getByText("Qui prend le service ?").waitFor();
await capture("02-connexion");
await p.locator(".carte-personne", { hasText: "Lionel" }).click();
await pin("1234");
await p.locator(".salle").waitFor();

// Table 4 : deux cappuccinos, un spritz, une eau 100 cl, un bubble tea taro + perles.
await p.locator(".grille-tables .table", { hasText: /^4/ }).click();
await p.locator(".tuile", { hasText: "Cappuccino" }).click();
await p.locator(".tuile", { hasText: "Cappuccino" }).click();
await clic("Bubble tea");
await p.locator(".tuile", { hasText: "Bubble tea" }).click();
await clic("Taro");
await p.getByRole("button", { name: /Perles popping/ }).click();
await p.getByRole("button", { name: /^Ajouter/ }).click();
await p.getByRole("tab", { name: "Bar", exact: true }).click();
await clic("Spritz");
await p.locator(".tuile", { hasText: "Spritz Aperol" }).click();
await p.getByRole("tab", { name: "Cuisine", exact: true }).click();
await clic("Œufs & egg muffins");
await p.locator(".tuile", { hasText: "Egg muffin Moka" }).click();
await p.getByRole("tab", { name: "Formules", exact: true }).click();
await p.locator(".tuile", { hasText: "Déjeuner Moka" }).click();
await capture("03-formule");
for (const choix of ["Plat du jour", "Cheesecake citron", "Flat white"]) await clic(choix);
await p.getByRole("button", { name: /^Ajouter/ }).click();
await p.getByRole("button", { name: "Indiquer les couverts" }).click();
await clic("2");
await capture("04-commande");

// Remise : spritz offert (responsable connecté, pas de code demandé).
await p.locator(".ticket-ligne", { hasText: "Spritz Aperol" }).click();
await clic("Offert");
await clic("Offert maison");
await p.getByRole("button", { name: /^Valider/ }).click();

// Retrait d'un egg muffin : tracé au journal.
await p.locator(".ticket-ligne", { hasText: "Egg muffin" }).click();
await clic("Retirer de la commande");
await capture("05-commande-remise");

await clic("Encaisser");
await p.locator(".mode", { hasText: "Espèces" }).click();
await capture("06-encaissement");
await p.locator(".modale").getByRole("button", { name: /Retirer le paiement/ }).click();
await p.locator(".billets .option").last().click();
await capture("07-encaissement-especes");
await p.getByRole("button", { name: /^Valider l'encaissement/ }).click();
await p.getByText("Rendu monnaie", { exact: true }).waitFor();
await p.locator(".qr-note svg").waitFor();
await capture("08-rendu-qr");
await p.getByRole("button", { name: "Terminé" }).click();

await p.locator(".salle").waitFor();
await capture("09-salle");
await p.getByRole("tab", { name: "Tickets" }).click();
await capture("10-tickets");
// Duplicata en QR code depuis l'historique, puis ouverture de la note comme le ferait le téléphone du client.
await p.locator(".tableau-tickets tbody tr").first().click();
await clic("QR code");
await p.locator(".qr-note svg").waitFor();
await capture("10b-duplicata-qr");
await p.getByRole("button", { name: "Fermer" }).last().click();
await p.getByRole("button", { name: "Fermer" }).last().click();
await p.getByRole("tab", { name: "Clôtures" }).click();
await clic("Lecture X");
await clic("Clôturer la journée (Z)");
await p.locator(".modale").getByRole("button", { name: "Clôturer la journée" }).click();
await p.getByText(/clôturée/).first().waitFor();
await p.locator(".tableau-clotures tbody tr").first().click();
await clic("Voir le ticket Z");
await p.locator(".apercu-recu").waitFor();
await capture("11-apercu-z");
await p.getByRole("button", { name: "Fermer" }).last().click();
await p.getByRole("button", { name: "Fermer" }).last().click().catch(() => {});
await clic("Vérifier l'intégrité");
await p.getByText(/Chaînes intactes|anomalie/).waitFor();
await capture("12-integrite");
const integre = await p.getByText(/Chaînes intactes/).count();
await p.getByRole("button", { name: "Fermer" }).last().click().catch(() => {});

// Synchronisation : la pastille repasse au vert, et le serveur vérifie la copie reçue.
await p.locator(".puce-synchro").click();
await p.locator(".puce-synchro.synchronise").waitFor({ timeout: 15000 });
await capture("13-synchronise");
await a.reload();
await a.getByRole("button", { name: "Vérifier la chaîne" }).click();
await a.getByText(/Chaîne intègre|anomalie/).waitFor();
const serveurIntegre = await a.getByText(/Chaîne intègre/).count();
await a.screenshot({ path: `${sortie}/14-admin-verification.png`, fullPage: true });

await b.close();
console.log(JSON.stringify({ integre: integre > 0, serveurIntegre: serveurIntegre > 0, erreurs }, null, 2));
if (!integre || !serveurIntegre || erreurs.length) process.exit(1);
