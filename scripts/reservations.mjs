// Réservations : services réglés dans l'administration, balise posée sur un site, réservation sur iPhone
// (personnes, date, horaire, coordonnées), e-mail de confirmation et lien d'annulation, table attribuée
// d'office et affichée sur le plan de l'iPad, installation de la table, saisie au téléphone depuis la caisse.
// Usage : serveur local vierge (apps/caisse : node scripts/serveur-local.mjs 4180), puis
//         URL=http://localhost:4180 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/reservations.mjs [dossier-captures]
// Le service d'essai couvre toute la journée : le créneau réservé est le prochain quart d'heure (avant 23 h 30).
import { chromium } from "playwright";
import { preparerServeur } from "./preparer-caisse.mjs";

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
a.on("dialog", (d) => void d.accept());
await a.goto(`${URL}/admin`);
await a.locator(".admin-lien", { hasText: "Réservations" }).click();
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

// ── iPad : la table réservée sur le plan, installation ──
const ipad = await b.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true });
const p = await ipad.newPage();
p.on("pageerror", (e) => erreurs.push(`caisse : ${e.message}`));
p.on("dialog", (d) => void d.accept());
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
await p.screenshot({ path: `${sortie}/rv09-plan.png` });
// Saisie au téléphone depuis la caisse.
await p.getByRole("button", { name: /^Réservations · / }).click();
await clic("Nouvelle");
const f = p.locator(".resa-caisse-saisie");
await f.getByLabel("Heure").fill("23:30");
await f.getByLabel("Personnes").fill("6");
await f.getByLabel("Prénom").fill("Zoé");
await f.getByLabel("Nom", { exact: true }).fill("Roux");
await f.getByLabel("Téléphone").fill("0655555555");
await f.getByRole("button", { name: "Enregistrer" }).click();
await p.locator(".resa-caisse-ligne", { hasText: "Zoé Roux" }).waitFor();
resultats.lignes = await p.locator(".resa-caisse-ligne").allInnerTexts();
await p.screenshot({ path: `${sortie}/rv10-liste-caisse.png` });
verifier("deux réservations à venir", resultats.lignes.length === 2, resultats.lignes);
// Réservations des jours suivants depuis la caisse : saisie pour demain, vues « À venir » et « Par jour », fiche.
const demain = new Date(Date.now() + 86_400_000).toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
await clic("Nouvelle");
await f.getByLabel("Date").fill(demain);
await f.getByLabel("Heure").fill("20:00");
await f.getByLabel("Personnes").fill("2");
await f.getByLabel("Prénom").fill("Hugo");
await f.getByLabel("Nom", { exact: true }).fill("Blanc");
await f.getByLabel("Téléphone").fill("0644444444");
await f.getByRole("button", { name: "Enregistrer" }).click();
await p.getByText("Réservation de Hugo Blanc enregistrée.").waitFor();
resultats.aujourdhuiSansDemain = await p.locator(".resa-caisse-ligne", { hasText: "Hugo Blanc" }).count();
verifier("demain absent de la vue du jour", resultats.aujourdhuiSansDemain === 0, resultats.aujourdhuiSansDemain);
await p.getByRole("button", { name: "À venir", exact: true }).click();
await p.locator(".resa-caisse-groupe h3", { hasText: /^Demain/ }).waitFor();
resultats.aVenirCaisse = (await p.locator(".resa-caisse-groupe h3").allInnerTexts()).map((t) => t.replace(/\s+/g, " "));
verifier("à venir en caisse", resultats.aVenirCaisse.length === 2 && /^Aujourd'hui · 2 réservations/i.test(resultats.aVenirCaisse[0] ?? ""), resultats.aVenirCaisse);
await p.screenshot({ path: `${sortie}/rv10b-a-venir-caisse.png` });
await p.getByRole("button", { name: "Par jour", exact: true }).click();
await p.locator(".resa-caisse-ligne", { hasText: "Hugo Blanc" }).waitFor();
resultats.parJourCaisse = await p.locator(".resa-caisse-ligne").count();
verifier("par jour en caisse", resultats.parJourCaisse === 1, resultats.parJourCaisse);
await p.getByRole("button", { name: "Modifier la réservation de Hugo Blanc" }).click();
const ficheCaisse = p.locator(".modale", { has: p.getByRole("heading", { name: "Réservation de Hugo Blanc" }) });
await ficheCaisse.getByLabel("Personnes").fill("3");
await ficheCaisse.getByRole("button", { name: "Enregistrer" }).click();
await p.locator(".resa-caisse-ligne", { hasText: "Hugo Blanc" }).filter({ hasText: "3 pers." }).waitFor();
await p.screenshot({ path: `${sortie}/rv10c-fiche-caisse.png` });
await p.getByRole("button", { name: "Aujourd'hui", exact: true }).click();
await p.locator(".resa-caisse-ligne", { hasText: "Léa Martin" }).waitFor();
// Installer Léa : la table s'ouvre avec 4 couverts et la note.
await p.locator(".resa-caisse-ligne", { hasText: "Léa Martin" }).getByRole("button", { name: "Installer" }).click();
await p.getByText(/4 couverts/).first().waitFor();
resultats.note = await p.getByText(/Réservation Léa Martin/).first().textContent();
verifier("note de la table", /Anniversaire/.test(resultats.note ?? ""), resultats.note);
await p.screenshot({ path: `${sortie}/rv11-table-installee.png` });

// ── Administration : la liste du jour ──
await a.getByRole("tab", { name: /^Réservations/ }).click();
await a.locator(".resa-table tbody tr").first().waitFor();
await a.getByText("Annulées et absentes").click();
resultats.admin = (await a.locator(".resa-table tbody tr").allInnerTexts()).map((l) => l.replace(/\s+/g, " ").trim());
await a.screenshot({ path: `${sortie}/rv12-liste-admin.png`, fullPage: true });
// Aujourd'hui (Léa, Paul, Zoé) et demain (Hugo, saisi depuis la caisse).
verifier("liste de l'administration", resultats.admin.length === 4 && resultats.admin.some((l) => /Paul Durand/.test(l)) && resultats.admin.some((l) => /Hugo Blanc .* 3 /.test(l)), resultats.admin);
const statuts = await a.locator(".resa-table tbody tr select[aria-label^='Statut']").evaluateAll((l) => l.map((s) => s.value).sort());
verifier("statuts", statuts.join() === "annulee,arrivee,confirmee,confirmee", statuts);

// Réservations à venir : recherche, fiche, modification (heure, personnes), puis annulation.
await a.getByLabel("Rechercher une réservation").fill("roux");
resultats.recherche = await a.locator(".resa-table tbody tr").count();
verifier("recherche à venir", resultats.recherche === 1, resultats.recherche);
await a.getByRole("button", { name: "Modifier la réservation de Zoé Roux" }).click();
const fiche = a.locator(".modale");
await fiche.getByLabel("Heure").fill("23:15");
await fiche.getByLabel("Personnes").fill("4");
await fiche.getByLabel("Note").fill("Table au calme");
await fiche.getByRole("button", { name: "Enregistrer" }).click();
await a.locator(".resa-table tbody tr", { hasText: "Table au calme" }).waitFor();
resultats.modifiee = (await a.locator(".resa-table tbody tr").first().innerText()).replace(/\s+/g, " ");
verifier("réservation modifiée", /23:15/.test(resultats.modifiee) && /Zoé Roux/.test(resultats.modifiee), resultats.modifiee);
await a.screenshot({ path: `${sortie}/rv14-a-venir.png`, fullPage: true });
await a.getByRole("button", { name: "Modifier la réservation de Zoé Roux" }).click();
await a.getByRole("button", { name: "Annuler la réservation" }).click();
await a.locator(".modale").waitFor({ state: "detached" });
await a.locator(".resa-table tbody tr.annule", { hasText: "Zoé Roux" }).waitFor();
resultats.annulee = await a.locator(".resa-table tbody tr", { hasText: "Zoé Roux" }).locator("select[aria-label^='Statut']").inputValue();
verifier("annulée depuis la fiche", resultats.annulee === "annulee", resultats.annulee);
await a.getByLabel("Rechercher une réservation").fill("");

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
