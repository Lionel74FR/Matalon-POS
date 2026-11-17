// Réservations : services réglés dans l'administration, balise posée sur un site, réservation sur iPhone
// (personnes, date, horaire, coordonnées), e-mail de confirmation et lien d'annulation, table attribuée
// d'office et affichée sur le plan de l'iPad, installation de la table, saisie au téléphone depuis la caisse
// (liste du jour et panneau de saisie façon Zenchef, 17 novembre 2026).
// Usage : serveur local vierge (apps/caisse : node scripts/serveur-local.mjs 4180), puis
//         URL=http://localhost:4180 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/reservations.mjs [dossier-captures]
// Le service d'essai couvre toute la journée : le créneau réservé est le prochain quart d'heure (avant 23 h 30).
import { chromium } from "playwright";
import { accepterConfirmations, preparerServeur, rubriqueAdmin } from "./preparer-caisse.mjs";

const URL = process.env.URL ?? "http://localhost:4180";
const sortie = process.argv[2] ?? "captures";
const { code, cookie } = await preparerServeur(URL, "Comptoir");
const [nomCookie, valeurCookie] = cookie.split("=");
// Le site de l'établissement (http://site.test) charge la balise depuis la caisse locale.
const b = await chromium.launch({ args: ["--disable-features=BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,LocalNetworkAccessChecks"] });
const erreurs = [];
const echecs = [];
const verifier = (nom, ok, detail) => ok || echecs.push(`${nom} : ${JSON.stringify(detail)}`);
const resultats = {};

// ── Administration : services et réglages ──
const bureau = await b.newContext({ viewport: { width: 1280, height: 900 } });
await bureau.addCookies([{ name: nomCookie, value: valeurCookie, url: `${URL}/api/admin` }]);
const a = await bureau.newPage();
a.on("pageerror", (e) => erreurs.push(`admin : ${e.message}`));
await accepterConfirmations(a);
await a.goto(`${URL}/admin`);
await rubriqueAdmin(a, "Réservations");
await a.getByRole("tab", { name: /Services et réglages/ }).click();
await a.getByText("Réservation en ligne ouverte").click();
await a.getByRole("button", { name: "Ajouter un service" }).click();
const service = a.locator(".resa-service-carte").first();
await service.getByLabel("Nom du service").fill("Toute la journée");
await service.getByLabel("Première arrivée").fill("00:00");
await service.getByLabel("Dernière arrivée").fill("23:30");
await service.getByLabel("Couverts du service").fill("40");
await service.getByLabel("En même temps").fill("30");
await service.getByLabel("Arrivées par créneau").fill("8");
await a.getByLabel("Durée par défaut (min)").fill("90");
await a.getByLabel("Au plus tard (min avant)").fill("0");
await a.getByLabel("Groupe en ligne (pers. max)").fill("8");
await a.getByLabel("Message d'accueil").fill("Bienvenue au Moka");
await a.getByLabel("Téléphone (groupes)").fill("04 56 19 02 68");
await a.getByLabel("E-mail de l'établissement").fill("bonjour@moka.test");
await a.getByLabel("Adresse d'expédition").fill("reservations@moka.test");
// Clé Resend propre au Moka (valeur d'essai) : chiffrée sur le serveur, seul son aperçu revient.
await a.getByRole("button", { name: "Ajouter la clé" }).click();
await a.getByLabel("Clé API Resend").fill("re_Essai_Moka_0000000000");
await a.getByRole("button", { name: "Enregistrer la clé" }).click();
await a.locator(".resa-cle .succes").waitFor();
resultats.cle = (await a.locator(".resa-cle p").first().textContent())?.replace(/\s+/g, " ");
verifier("aperçu de la clé", /re_…0000, enregistrée/.test(resultats.cle ?? "") && !/Essai_Moka/.test(await a.content()), resultats.cle);
await a.getByRole("button", { name: "Enregistrer les réglages" }).click();
resultats.reglages = await a.locator(".resa-reglages > .succes").textContent();
verifier("réglages enregistrés", /ouverte/.test(resultats.reglages ?? ""), resultats.reglages);
// E-mail d'essai à l'établissement, depuis l'adresse d'expédition réglée.
await a.getByRole("button", { name: "Envoyer un e-mail d'essai" }).click();
await a.locator(".resa-reglages > .succes", { hasText: "essai" }).waitFor();
resultats.essai = await a.locator(".resa-reglages > .succes").textContent();
verifier("e-mail d'essai", /envoyé à bonjour@moka\.test depuis reservations@moka\.test/.test(resultats.essai ?? ""), resultats.essai);
await a.screenshot({ path: `${sortie}/rv01-reglages.png`, fullPage: true });
await a.getByRole("tab", { name: /Sur votre site/ }).click();
resultats.balise = await a.locator(".resa-code").first().textContent();
verifier("balise", /reservation\.js" data-etablissement="moka"/.test(resultats.balise ?? ""), resultats.balise);
await a.screenshot({ path: `${sortie}/rv02-site.png` });

// ── Le client réserve depuis le site, sur iPhone ──
const tel = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const site = await tel.newPage();
site.on("pageerror", (e) => erreurs.push(`site : ${e.message}`));
await site.route("http://site.test/", (r) =>
  r.fulfill({
    contentType: "text/html; charset=utf-8",
    body: `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><body style="margin:0;background:#3b2a1f;color:#f3e6d3;font-family:Georgia;min-height:1400px"><h1 style="text-align:center;padding-top:180px">Moka</h1><p style="text-align:center"><a href="#reserver" style="display:inline-block;padding:14px 26px;background:#b49e6a;color:#1d140f;text-decoration:none;letter-spacing:.15em">RÉSERVER UNE TABLE</a></p>${resultats.balise}</body>`,
  }),
);
await site.goto("http://site.test/");
await site.locator(".mtl-bouton").waitFor();
await site.screenshot({ path: `${sortie}/rv03-site-iphone.png` });
// Le bouton du site ouvre le même panneau.
await site.getByRole("link", { name: "RÉSERVER UNE TABLE" }).click();
const cadre = site.frameLocator(".mtl-panneau iframe");
await cadre.getByRole("button", { name: "4", exact: true }).click();
await cadre.getByText("Prochaine disponibilité").waitFor();
await site.waitForTimeout(400);
await site.screenshot({ path: `${sortie}/rv04-panneau-date.png` });
await cadre.locator(".carte-jour").first().click();
await cadre.locator(".creneau:not([disabled])").first().waitFor();
resultats.heure = (await cadre.locator(".creneau:not([disabled])").first().textContent())?.trim();
await site.screenshot({ path: `${sortie}/rv05-panneau-horaire.png` });
await cadre.locator(".creneau:not([disabled])").first().click();
await cadre.getByRole("button", { name: "Réserver", exact: true }).click();
await cadre.getByText("Madame").click();
await cadre.getByLabel("Prénom").fill("Léa");
await cadre.getByLabel("Nom", { exact: true }).fill("Martin");
await cadre.locator(".telephone input").fill("06 12 34 56 78");
await cadre.getByLabel("Email").fill("lea@exemple.fr");
await cadre.locator("textarea").fill("Anniversaire, une bougie au dessert");
await site.screenshot({ path: `${sortie}/rv06-panneau-contact.png` });
// Sans accepter les conditions : refus à l'écran.
await cadre.getByRole("button", { name: "Réserver", exact: true }).click();
resultats.sansConditions = await cadre.locator(".erreur").textContent();
verifier("conditions obligatoires", /conditions/.test(resultats.sansConditions ?? ""), resultats.sansConditions);
await cadre.locator(".case-cocher input").first().check();
await cadre.getByRole("button", { name: "Réserver", exact: true }).click();
await cadre.getByRole("heading", { name: "Réservation confirmée" }).waitFor();
await site.screenshot({ path: `${sortie}/rv07-confirmee.png` });
const courriels = await (await fetch(`${URL}/__courriels`)).json();
verifier("clé du Moka sur chaque e-mail", courriels.every((c) => c.cle === "re_Essai_Moka_0000000000"), courriels.map((c) => c.cle));
resultats.courriels = courriels.filter((c) => !/essai/.test(c.sujet)).map((c) => `${c.a} · ${c.sujet.split(" · ")[0]} · de ${c.de}`);
verifier("e-mails", resultats.courriels.join() === "lea@exemple.fr · Réservation confirmée · de reservations@moka.test,bonjour@moka.test · Nouvelle réservation · de reservations@moka.test", resultats.courriels);
await cadre.getByRole("button", { name: "Fermer" }).last().click();
await site.waitForTimeout(400);
verifier("panneau fermé", (await site.locator(".mtl-panneau").count()) === 0, "panneau encore ouvert");

// Deuxième réservation (lien direct), puis annulée par le lien de l'e-mail.
const direct = await tel.newPage();
await direct.goto(`${URL}/reserver/moka`);
await direct.getByRole("button", { name: "2", exact: true }).click();
await direct.locator(".carte-jour").first().click();
await direct.locator(".creneau:not([disabled])").last().click(); // le dernier créneau : encore à venir au moment d'annuler
await direct.getByRole("button", { name: "Réserver", exact: true }).click();
await direct.getByLabel("Prénom").fill("Paul");
await direct.getByLabel("Nom", { exact: true }).fill("Durand");
await direct.locator(".telephone input").fill("0699999999");
await direct.getByLabel("Email").fill("paul@exemple.fr");
await direct.locator(".case-cocher input").first().check();
await direct.getByRole("button", { name: "Réserver", exact: true }).click();
await direct.getByRole("heading", { name: "Réservation confirmée" }).waitFor();
const lien = /href="([^"]+annuler[^"]+)"/.exec((await (await fetch(`${URL}/__courriels`)).json()).find((c) => c.a === "paul@exemple.fr").html)[1].replace(/&amp;/g, "&");
await direct.goto(lien.replace(/^https?:\/\/[^/]+/, URL));
await direct.getByRole("button", { name: "Annuler ma réservation" }).click();
await direct.getByText("Votre réservation est annulée").waitFor();
await direct.screenshot({ path: `${sortie}/rv08-annulation.png` });

// ── iPad : la table réservée sur le plan, la liste du jour à gauche (façon Zenchef), installation ──
const ipad = await b.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true });
const p = await ipad.newPage();
p.on("pageerror", (e) => erreurs.push(`caisse : ${e.message}`));
await accepterConfirmations(p);
const clic = (nom) => p.getByRole("button", { name: nom, exact: true }).first().click();
await p.goto(URL);
await p.locator(".champ-code input").fill(code);
await clic("Rattacher l'iPad");
await clic("Configurer plus tard");
await p.locator(".carte-personne", { hasText: "Lionel" }).click();
for (const x of "1234") await p.locator(".pave .touche", { hasText: new RegExp(`^${x}$`) }).last().click();
await clic("Plus tard");
await p.getByRole("button", { name: /^Réservations · 1/ }).waitFor();
resultats.planTable = await p.locator(".plan-table.reservee").first().getAttribute("aria-label");
verifier("table réservée sur le plan", /réservée à .* pour 4 \(Léa Martin\)/.test(resultats.planTable ?? ""), resultats.planTable);
const liste = p.locator(".resa-liste");
await liste.locator(".resa-ligne", { hasText: "MARTIN Léa" }).waitFor();
await p.screenshot({ path: `${sortie}/rv09-plan.png` });
// Saisie au téléphone depuis la caisse, dans le panneau de droite.
const panneau = p.locator(".resa-panneau");
const saisir = async (c) => {
  await liste.getByRole("button", { name: "Créer" }).click();
  if (c.date) {
    await panneau.getByRole("group", { name: "Jour" }).getByRole("button", { name: "Autre" }).click();
    await panneau.locator(".resa-p-date input").fill(c.date);
  }
  await panneau.getByRole("group", { name: "Nombre de personnes" }).getByRole("button", { name: String(c.couverts), exact: true }).click();
  await panneau.getByLabel("Autre heure").fill(c.heure);
  await panneau.getByLabel("Prénom", { exact: true }).fill(c.prenom);
  await panneau.getByLabel("Nom", { exact: true }).fill(c.nom);
  await panneau.getByRole("textbox", { name: "Téléphone" }).fill(c.telephone);
  await panneau.getByRole("button", { name: "Enregistrer" }).click();
  await panneau.waitFor({ state: "detached" });
};
await saisir({ heure: "23:30", couverts: 6, prenom: "Zoé", nom: "Roux", telephone: "0655555555" });
await liste.locator(".resa-ligne", { hasText: "ROUX Zoé" }).waitFor();
resultats.lignes = await liste.locator(".resa-ligne").allInnerTexts();
await p.screenshot({ path: `${sortie}/rv10-liste-caisse.png` });
verifier("deux réservations à venir", resultats.lignes.length === 2, resultats.lignes);
// Réservations des jours suivants depuis la caisse : saisie pour demain, jour suivant, recherche, fiche.
const demain = new Date(Date.now() + 86_400_000).toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
await saisir({ date: demain, heure: "20:00", couverts: 2, prenom: "Hugo", nom: "Blanc", telephone: "0644444444" });
await p.getByText(/Réservation de Hugo Blanc enregistrée \(.*\), 20:00\./).waitFor();
resultats.aujourdhuiSansDemain = await liste.locator(".resa-ligne", { hasText: "BLANC Hugo" }).count();
verifier("demain absent de la liste du jour", resultats.aujourdhuiSansDemain === 0, resultats.aujourdhuiSansDemain);
await liste.getByRole("button", { name: "Rechercher une réservation" }).click();
await liste.getByLabel("Rechercher dans les réservations à venir").fill("0644");
await liste.locator(".resa-groupe-tete", { hasText: /^Demain/ }).waitFor();
resultats.rechercheCaisse = (await liste.locator(".resa-groupe-tete").allInnerTexts()).map((t) => t.replace(/\s+/g, " "));
verifier("recherche dans les jours à venir", resultats.rechercheCaisse.length === 1, resultats.rechercheCaisse);
await p.screenshot({ path: `${sortie}/rv10b-recherche-caisse.png` });
await liste.getByRole("button", { name: "Fermer la recherche" }).click();
await liste.getByRole("button", { name: "Jour suivant" }).click();
await liste.locator(".resa-ligne", { hasText: "BLANC Hugo" }).waitFor();
resultats.parJourCaisse = await liste.locator(".resa-ligne").count();
verifier("jour suivant en caisse", resultats.parJourCaisse === 1, resultats.parJourCaisse);
await liste.getByRole("button", { name: "Ouvrir la réservation de Hugo Blanc" }).click();
await panneau.getByRole("heading", { name: "Réservation de Hugo Blanc" }).waitFor();
await panneau.getByRole("group", { name: "Nombre de personnes" }).getByRole("button", { name: "3", exact: true }).click();
await panneau.getByRole("button", { name: "Enregistrer" }).click();
await liste.locator(".resa-ligne", { hasText: "BLANC Hugo" }).locator(".resa-couverts", { hasText: "3" }).waitFor();
await p.screenshot({ path: `${sortie}/rv10c-fiche-caisse.png` });
await liste.getByRole("button", { name: "Jour précédent" }).click();
await liste.locator(".resa-ligne", { hasText: "MARTIN Léa" }).waitFor();
// Installer Léa : la table s'ouvre avec 4 couverts et la note.
await liste.locator(".resa-ligne", { hasText: "MARTIN Léa" }).getByRole("button", { name: "Installer" }).click();
await p.getByText(/4 couverts/).first().waitFor();
resultats.note = await p.getByText(/Réservation Léa Martin/).first().textContent();
verifier("note de la table", /Anniversaire/.test(resultats.note ?? ""), resultats.note);
await p.screenshot({ path: `${sortie}/rv11-table-installee.png` });

// ── Administration : la même liste, le plan du jour ──
await a.getByRole("tab", { name: /^Réservations/ }).click();
const listeAdmin = a.locator(".resa-liste");
await listeAdmin.locator(".resa-ligne").first().waitFor();
await listeAdmin.getByRole("button", { name: "Filtres de la liste" }).click();
await a.getByText("Annulées et absentes").click();
await a.keyboard.press("Escape");
await listeAdmin.locator(".resa-ligne", { hasText: "DURAND Paul" }).waitFor();
resultats.admin = (await listeAdmin.locator(".resa-ligne").allInnerTexts()).map((l) => l.replace(/\s+/g, " ").trim());
await a.screenshot({ path: `${sortie}/rv12-liste-admin.png` });
// Aujourd'hui : Léa, Paul (annulée) et Zoé ; Hugo est demain.
verifier("liste de l'administration", resultats.admin.length === 3 && resultats.admin.some((l) => /DURAND Paul/.test(l)), resultats.admin);
const statuts = await listeAdmin.locator("select.resa-statut").evaluateAll((l) => l.map((s) => s.value).sort());
verifier("statuts", statuts.join() === "annulee,arrivee,confirmee", statuts);

// Recherche, fiche, modification (heure, personnes, message), puis annulation.
await listeAdmin.getByRole("button", { name: "Rechercher une réservation" }).click();
await listeAdmin.getByLabel("Rechercher dans les réservations à venir").fill("roux");
await listeAdmin.locator(".resa-ligne", { hasText: "ROUX Zoé" }).waitFor();
resultats.recherche = await listeAdmin.locator(".resa-ligne").count();
verifier("recherche à venir", resultats.recherche === 1, resultats.recherche);
await listeAdmin.getByRole("button", { name: "Ouvrir la réservation de Zoé Roux" }).click();
const fiche = a.locator(".resa-panneau");
await fiche.getByLabel("Autre heure").fill("23:15");
await fiche.getByRole("group", { name: "Nombre de personnes" }).getByRole("button", { name: "4", exact: true }).click();
await fiche.getByLabel("Message du client").fill("Table au calme");
await fiche.getByRole("button", { name: "Enregistrer" }).click();
await listeAdmin.locator(".resa-ligne", { hasText: "Table au calme" }).waitFor();
resultats.modifiee = (await listeAdmin.locator(".resa-ligne", { hasText: "ROUX Zoé" }).innerText()).replace(/\s+/g, " ");
verifier("réservation modifiée", /^23:15 ROUX Zoé/.test(resultats.modifiee), resultats.modifiee);
await a.screenshot({ path: `${sortie}/rv14-a-venir.png` });
await listeAdmin.getByRole("button", { name: "Ouvrir la réservation de Zoé Roux" }).click();
await fiche.getByRole("button", { name: "Annuler la réservation" }).click();
await fiche.waitFor({ state: "detached" });
await listeAdmin.locator(".resa-ligne.annulee", { hasText: "ROUX Zoé" }).waitFor();
resultats.annulee = await listeAdmin.getByLabel("Statut de Zoé Roux").inputValue();
verifier("annulée depuis la fiche", resultats.annulee === "annulee", resultats.annulee);
await listeAdmin.getByRole("button", { name: "Fermer la recherche" }).click();

// Administration sur iPhone : rien ne dépasse, sur les trois onglets.
await a.setViewportSize({ width: 390, height: 844 });
for (const onglet of [/^Réservations/, /Services et réglages/, /Sur votre site/]) {
  await a.getByRole("tab", { name: onglet }).click();
  await a.waitForTimeout(300);
  const debord = await a.evaluate(() => document.documentElement.scrollWidth - 390);
  verifier(`iPhone ${onglet}`, debord <= 0, debord);
}
await a.getByRole("tab", { name: /^Réservations/ }).click();
await a.screenshot({ path: `${sortie}/rv13-admin-iphone.png`, fullPage: true });

await b.close();
console.log(JSON.stringify({ resultats, echecs, erreurs }, null, 2));
if (echecs.length || erreurs.length) process.exit(1);
