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
await a.getByRole("button", { name: "Enregistrer les réglages" }).click();
resultats.reglages = await a.locator(".succes").textContent();
verifier("réglages enregistrés", /ouverte/.test(resultats.reglages ?? ""), resultats.reglages);
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
resultats.courriels = courriels.map((c) => `${c.a} · ${c.sujet.split(" · ")[0]}`);
verifier("e-mails", resultats.courriels.join() === "lea@exemple.fr · Réservation confirmée,bonjour@moka.test · Nouvelle réservation", resultats.courriels);
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
verifier("liste de l'administration", resultats.admin.length === 3 && resultats.admin.some((l) => /Paul Durand/.test(l)), resultats.admin);
const statuts = await a.locator(".resa-table tbody tr select[aria-label^='Statut']").evaluateAll((l) => l.map((s) => s.value).sort());
verifier("statuts", statuts.join() === "annulee,arrivee,confirmee", statuts);

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
