// Réservations façon Zenchef (demande de Lionel du 17 novembre 2026) : liste du jour à gauche (services, créneaux,
// compteurs, répartition par taille), plan au centre, saisie dans un panneau à droite (raccourcis de date, personnes,
// créneaux avec remplissage, table touchée sur le plan, client, prise par, canal, allergies, étiquettes, mémo,
// couleur, sous option), dans l'administration puis sur l'iPad (installation, autre jour) et sur l'iPhone.
// Usage : serveur local vierge (apps/caisse : node scripts/serveur-local.mjs 4180), puis
//         URL=http://localhost:4180 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/reservations-zenchef.mjs [dossier-captures]
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { accepterConfirmations, preparerServeur } from "./preparer-caisse.mjs";

const URL = process.env.URL ?? "http://localhost:4180";
const sortie = process.argv[2] ?? "captures";
mkdirSync(sortie, { recursive: true });
const { code, cookie, appel } = await preparerServeur(URL, "Comptoir");
const [nomCookie, valeurCookie] = cookie.split("=");
const r = {};
const echecs = [];
const erreurs = [];
const verifier = (nom, ok, detail) => {
  if (!ok) echecs.push(`${nom} : ${JSON.stringify(detail)}`);
};
const texte = async (loc) => ((await loc.innerText()) ?? "").replace(/[\s  ]+/g, " ").trim();
const aujourdhui = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
const demain = new Date(Date.now() + 86_400_000).toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });

// Services : déjeuner et dîner tous les jours, réservation en ligne ouverte.
const tous = [1, 2, 3, 4, 5, 6, 7];
const { version } = await appel("GET", "/etablissements/moka/reservations/reglages");
await appel("PUT", "/etablissements/moka/reservations/reglages", {
  version,
  reglages: {
    actif: true,
    dureeMinutes: 90,
    pasMinutes: 30,
    delaiMinutes: 0,
    horizonJours: 60,
    groupeMax: 8,
    fermetures: [],
    accueil: "",
    services: [
      { id: "dej", nom: "Déjeuner", jours: tous, debut: "12:00", fin: "14:00", couvertsMax: 20, simultanesMax: null, arriveesMax: 20 },
      { id: "din", nom: "Dîner", jours: tous, debut: "19:00", fin: "23:00", couvertsMax: 30, simultanesMax: null, arriveesMax: 30 },
    ],
  },
});
// Plan : tables 1 à 12 sur deux rangées, la 9 en rectangle de six places pour les groupes.
await appel("PUT", "/etablissements/moka/plan", {
  version: 0,
  zones: [{ nom: "Salle", largeur: 44, hauteur: 24, decor: [{ id: "bar", type: "bar", x: 2, y: 1, largeur: 12, hauteur: 2 }] }],
  tables: Array.from({ length: 12 }, (_, i) => ({
    id: `t${i + 1}`,
    nom: String(i + 1),
    zone: "Salle",
    forme: i === 8 ? "rectangle" : i % 3 === 2 ? "rond" : "carre",
    chaises: i === 8 ? 6 : 4,
    x: 2 + (i % 6) * 7 + (i > 8 ? 2 : 0),
    y: i < 6 ? 6 : 15,
  })),
});
const saisir = (c) => appel("POST", "/etablissements/moka/reservations", { date: aujourdhui, telephone: "0612345678", ...c });
await saisir({ heure: "12:00", couverts: 3, prenom: "Annabelle", nom: "Degand", source: "telephone", tables: ["t1"] });
await saisir({ heure: "19:00", couverts: 3, prenom: "Mathilde", nom: "Lepers", email: "mathilde@exemple.fr", source: "email", tables: ["t1"], notifier: false });
await saisir({ heure: "19:30", couverts: 3, prenom: "Sabrina", nom: "Laurey", tables: ["t5"] });
await saisir({ heure: "20:00", couverts: 4, prenom: "Claudine", nom: "Proulx", commentaire: "J'ai un bon de réduction de 20 % offert par mon logement", tables: ["t6"] });
await saisir({ heure: "21:30", couverts: 5, prenom: "Claire", nom: "Esseiva", source: "sur_place", tables: ["t9"], tags: ["Anniversaire"] });
await saisir({ heure: "21:30", couverts: 5, prenom: "Johannes", nom: "Favre", statut: "attente" });

const b = await chromium.launch();

// ── Administration : liste à gauche, plan du jour au centre ──
const bureau = await b.newContext({ viewport: { width: 1440, height: 900 } });
await bureau.addCookies([{ name: nomCookie, value: valeurCookie, url: `${URL}/api/admin` }]);
const a = await bureau.newPage();
a.on("pageerror", (e) => erreurs.push(`admin : ${e.message}`));
await accepterConfirmations(a);
await a.goto(`${URL}/admin#/moka/reservations`);
const liste = a.locator(".resa-liste");
await liste.locator(".resa-ligne", { hasText: "DEGAND Annabelle" }).waitFor({ timeout: 20000 });
await a.screenshot({ path: `${sortie}/rz01-admin-liste.png` });
r.groupes = await liste.locator(".resa-groupe-tete").allInnerTexts();
r.creneaux = (await liste.locator(".resa-creneau-tete").allInnerTexts()).map((t) => t.replace(/\s+/g, " "));
r.compteurs = await liste.locator(".resa-compteur").evaluateAll((l) => l.map((x) => x.getAttribute("aria-label")));
verifier("services", r.groupes.length === 2 && /Déjeuner/i.test(r.groupes[0]) && /3\/20/.test(r.groupes[0]) && /15\/30/.test(r.groupes[1]), r.groupes);
verifier("créneaux", r.creneaux.join("|") === "12:00 1 3/20|19:00 1 3/30|19:30 1 3/30|20:00 1 4/30|21:30 2 5/30", r.creneaux);
verifier("compteurs", r.compteurs.join("|") === "Couverts réservés (confirmés et installés) : 18|Couverts à venir : 18|Couverts installés : 0|Couverts sous option ou en liste d'attente : 5", r.compteurs);
r.repartition = await liste.locator(".resa-repartition tr").nth(1).innerText();
verifier("répartition", r.repartition.replace(/\s+/g, " ").trim() === "Réservations 0 0 3 1 2 0 0 0", r.repartition);
r.planTable1 = await a.locator(".plan-table", { has: a.locator("text.plan-nom", { hasText: /^1$/ }) }).getAttribute("aria-label");
verifier("plan du jour", /12:00 Annabelle Degand \(3\), 19:00 Mathilde Lepers \(3\)/.test(r.planTable1 ?? ""), r.planTable1);
// Filtre « Dîner » : le déjeuner disparaît, les compteurs suivent.
await liste.getByRole("button", { name: "Dîner", exact: true }).click();
r.filtreDiner = await liste.locator(".resa-groupe-tete").count();
r.totalDiner = await liste.locator(".resa-compteur").first().getAttribute("aria-label");
verifier("filtre dîner", r.filtreDiner === 1 && /: 15$/.test(r.totalDiner ?? ""), [r.filtreDiner, r.totalDiner]);
await liste.getByRole("button", { name: "Tous", exact: true }).click();

// ── Saisie : 2 personnes au dîner, 22:00, table 4 touchée sur le plan ──
await liste.getByRole("button", { name: "Créer" }).click();
const panneau = a.locator(".resa-panneau");
await panneau.waitFor();
verifier("liste effacée pendant la saisie", !(await a.locator(".resa-liste").isVisible()), "liste visible");
await panneau.getByRole("group", { name: "Nombre de personnes" }).getByRole("button", { name: "2", exact: true }).click();
await panneau.getByLabel("Filtrer par service").selectOption({ label: "Dîner" });
await panneau.getByRole("button", { name: "Autres créneaux horaires" }).click();
r.creneauxSaisie = (await panneau.locator(".resa-p-creneau").allInnerTexts()).map((t) => t.replace(/\s+/g, " "));
verifier("créneaux de la saisie", r.creneauxSaisie[0] === "19:00 3/30 15/30" && r.creneauxSaisie.length === 9, r.creneauxSaisie);
await panneau.locator(".resa-p-creneau", { hasText: "22:00" }).click();
await a.locator(".plan-table", { has: a.locator("text.plan-nom", { hasText: /^4$/ }) }).click();
r.recap = await texte(panneau.locator(".resa-p-recap"));
verifier("récapitulatif", / 2 22:00 4$/.test(r.recap), r.recap);
await panneau.getByRole("group", { name: "Civilité" }).getByRole("button", { name: "Mme" }).click();
await panneau.getByLabel("Prénom", { exact: true }).fill("Jeanne");
await panneau.getByLabel("Nom", { exact: true }).fill("Dupont");
await panneau.getByLabel("Indicatif du pays").selectOption("+41");
await panneau.getByRole("textbox", { name: "Téléphone" }).fill("079 123 45 67");
await panneau.getByRole("textbox", { name: "E-mail" }).fill("jeanne@exemple.ch");
await panneau.getByLabel("Prise par", { exact: true }).selectOption("Lionel");
await panneau.getByLabel("Canal", { exact: true }).selectOption({ label: "Messagerie" });
await panneau.getByLabel("Allergies", { exact: true }).fill("Pistaches");
await panneau.getByRole("button", { name: /étiquettes/ }).click();
await panneau.getByRole("group", { name: "Étiquettes" }).getByRole("button", { name: "Anniversaire" }).click();
await panneau.getByRole("group", { name: "Étiquettes" }).getByRole("button", { name: "Au calme" }).click();
await panneau.getByLabel("Mémo", { exact: true }).fill("Gâteau apporté par la famille");
await panneau.getByRole("radio", { name: "Vert" }).click();
await a.screenshot({ path: `${sortie}/rz02-admin-saisie.png` });
await panneau.getByRole("button", { name: "Enregistrer" }).click();
const jeanne = a.locator(".resa-ligne", { hasText: "DUPONT Jeanne" });
await jeanne.waitFor({ timeout: 15000 });
r.jeanne = await texte(jeanne);
verifier("ligne enregistrée", /^22:00 DUPONT Jeanne 4 2 personnes Confirmée .* Messagerie Pistaches Gâteau apporté par la famille Anniversaire Au calme$/.test(r.jeanne), r.jeanne);
r.couleur = await jeanne.evaluate((e) => getComputedStyle(e).borderLeftColor);
verifier("couleur", r.couleur === "rgb(134, 192, 138)", r.couleur);
const [enBase] = (await appel("GET", `/etablissements/moka/reservations?du=${aujourdhui}`)).reservations.filter((x) => x.nom === "Dupont");
verifier("données gardées", enBase?.telephone === "+41791234567" && enBase.source === "messagerie" && enBase.prisePar === "Lionel" && enBase.tables.join() === "t4" && enBase.civilite === "Mme", enBase);
await a.screenshot({ path: `${sortie}/rz03-admin-liste-apres.png` });

// ── Sous option, puis confirmée depuis la pastille du statut ──
await liste.getByRole("button", { name: "Créer" }).click();
await panneau.getByRole("group", { name: "Jour" }).getByRole("button", { name: "Autre" }).click();
await panneau.locator(".resa-p-date input").fill(demain);
await panneau.getByRole("group", { name: "Nombre de personnes" }).getByRole("button", { name: "Plus" }).click();
await panneau.locator(".resa-p-plus input").fill("12");
await panneau.locator(".resa-p-creneau", { hasText: "12:00" }).click();
await panneau.getByLabel("Prénom", { exact: true }).fill("Paul");
await panneau.getByLabel("Nom", { exact: true }).fill("Martin");
await panneau.getByRole("textbox", { name: "Téléphone" }).fill("0611223344");
await panneau.getByLabel("Prise par", { exact: true }).selectOption("Lionel");
await panneau.getByRole("group", { name: "Statut temporaire" }).getByRole("button", { name: "Sous option" }).click();
await panneau.getByRole("button", { name: "Enregistrer" }).click();
await a.locator(".resa-panneau").waitFor({ state: "detached" });
await liste.getByRole("button", { name: "Jour suivant" }).click();
const paul = a.locator(".resa-ligne", { hasText: "MARTIN Paul" });
await paul.waitFor();
r.option = await paul.getByLabel("Statut de Paul Martin").inputValue();
r.optionTotal = await liste.locator(".resa-compteur").last().getAttribute("aria-label");
verifier("sous option", r.option === "option" && /: 12$/.test(r.optionTotal ?? ""), [r.option, r.optionTotal]);
// Confirmée depuis la pastille : elle compte (aucune table de 12 : à placer).
await paul.getByLabel("Statut de Paul Martin").selectOption("confirmee");
await a.waitForFunction(() => document.querySelector("[aria-label='Statut de Paul Martin']")?.value === "confirmee", null, { timeout: 10000 });
await a.waitForFunction(() => /: 12$/.test(document.querySelector(".resa-compteur")?.getAttribute("aria-label") ?? ""), null, { timeout: 10000 });
r.paulConfirme = await texte(paul);
verifier("confirmée depuis la liste", /^12:00 MARTIN Paul À placer 12 personnes/.test(r.paulConfirme), r.paulConfirme);
await a.screenshot({ path: `${sortie}/rz04-admin-demain.png` });
// Recherche : toutes les réservations à venir, rangées par jour.
await liste.getByRole("button", { name: "Rechercher une réservation" }).click();
await liste.getByLabel("Rechercher dans les réservations à venir").fill("dupont");
await liste.locator(".resa-groupe-tete", { hasText: "Aujourd'hui" }).waitFor();
r.recherche = await liste.locator(".resa-ligne").count();
verifier("recherche", r.recherche === 1, r.recherche);
await liste.getByRole("button", { name: "Fermer la recherche" }).click();

// Fiche de Jeanne : le panneau s'ouvre prérempli ; le mémo change, la couleur s'efface.
await liste.getByRole("button", { name: "Jour précédent" }).click();
await jeanne.getByRole("button", { name: "Ouvrir la réservation de Jeanne Dupont" }).click();
await panneau.getByRole("heading", { name: "Réservation de Jeanne Dupont" }).waitFor();
r.ficheTel = await panneau.getByRole("textbox", { name: "Téléphone" }).inputValue();
verifier("fiche préremplie", r.ficheTel === "+41791234567" && (await panneau.getByLabel("Allergies", { exact: true }).inputValue()) === "Pistaches", r.ficheTel);
await panneau.getByLabel("Mémo", { exact: true }).fill("Gâteau à 22 h 30");
await panneau.getByRole("radio", { name: "Sans couleur" }).click();
await a.screenshot({ path: `${sortie}/rz05-admin-fiche.png` });
await panneau.getByRole("button", { name: "Enregistrer" }).click();
await jeanne.filter({ hasText: "Gâteau à 22 h 30" }).waitFor();
r.historique = (await appel("GET", `/etablissements/moka/reservations?du=${aujourdhui}`)).reservations.find((x) => x.nom === "Dupont").historique.at(-1).action;
verifier("historique de la fiche", r.historique === "mémo modifié · couleur modifiée", r.historique);

// ── iPad : liste à gauche du plan, saisie, installation ──
const ctx = await b.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true });
const p = await ctx.newPage();
p.on("pageerror", (e) => erreurs.push(`ipad : ${e.message}`));
await accepterConfirmations(p);
const clic = (n) => p.getByRole("button", { name: n, exact: true }).first().click();
await p.goto(URL);
await p.locator(".champ-code input").fill(code);
await clic("Rattacher l'iPad");
await clic("Configurer plus tard");
await p.locator(".carte-personne", { hasText: "Lionel" }).click();
for (const x of "1234") await p.locator(".pave .touche", { hasText: new RegExp(`^${x}$`) }).last().click();
await clic("Plus tard");
const listeCaisse = p.locator(".resa-liste");
await listeCaisse.locator(".resa-ligne", { hasText: "DEGAND Annabelle" }).waitFor({ timeout: 20000 });
await p.screenshot({ path: `${sortie}/rz06-ipad-salle.png` });
// Saisie au téléphone : 6 personnes, la table 9 touchée sur le plan.
await listeCaisse.getByRole("button", { name: "Créer" }).click();
const pc = p.locator(".resa-panneau");
r.priseParCaisse = await pc.getByLabel("Prise par", { exact: true }).inputValue();
verifier("prise par la personne connectée", r.priseParCaisse === "Lionel", r.priseParCaisse);
await pc.getByRole("group", { name: "Nombre de personnes" }).getByRole("button", { name: "6", exact: true }).click();
await pc.getByLabel("Filtrer par service").selectOption({ label: "Dîner" });
await pc.getByRole("button", { name: "Autres créneaux horaires" }).click();
await pc.locator(".resa-p-creneau", { hasText: "23:00" }).click();
await p.locator(".plan-table", { has: p.locator("text.plan-nom", { hasText: /^9$/ }) }).click();
await pc.getByLabel("Prénom", { exact: true }).fill("Zoé");
await pc.getByLabel("Nom", { exact: true }).fill("Roux");
await pc.getByRole("textbox", { name: "Téléphone" }).fill("0655555555");
await p.screenshot({ path: `${sortie}/rz07-ipad-saisie.png` });
await pc.getByRole("button", { name: "Enregistrer" }).click();
await listeCaisse.locator(".resa-ligne", { hasText: "ROUX Zoé" }).waitFor({ timeout: 15000 });
r.zoe = await texte(listeCaisse.locator(".resa-ligne", { hasText: "ROUX Zoé" }).locator(".choix-tables"));
verifier("table touchée sur le plan", r.zoe === "9", r.zoe);
// Installer Jeanne : la table 4 s'ouvre avec ses couverts, son allergie et le mémo.
await listeCaisse.locator(".resa-ligne", { hasText: "DUPONT Jeanne" }).getByRole("button", { name: "Installer" }).click();
await p.getByText(/2 couverts/).first().waitFor();
r.noteTable = await p.getByText(/Réservation Jeanne Dupont/).first().textContent();
verifier("note de la table", /Allergies : Pistaches/.test(r.noteTable ?? "") && /Gâteau à 22 h 30/.test(r.noteTable ?? ""), r.noteTable);
await p.screenshot({ path: `${sortie}/rz08-ipad-installee.png` });
await p.getByRole("tab", { name: "Salle" }).click();
await listeCaisse.locator(".resa-ligne.arrivee", { hasText: "DUPONT Jeanne" }).waitFor({ timeout: 15000 });
r.installes = await listeCaisse.locator(".resa-compteur").nth(2).getAttribute("aria-label");
verifier("compteur des installés", /: 2$/.test(r.installes ?? ""), r.installes);
// Demain : le plan montre les réservations de ce jour-là ; retour au service.
await listeCaisse.getByRole("button", { name: "Jour suivant" }).click();
await p.locator(".salle-autre-jour").waitFor();
r.planDemain = await p.locator(".salle-autre-jour").innerText();
verifier("plan d'un autre jour", /^Plan du .* : les tables montrent ses réservations\./.test(r.planDemain), r.planDemain);
await p.screenshot({ path: `${sortie}/rz09-ipad-demain.png` });
await p.getByRole("button", { name: "Revenir au service" }).click();
await p.locator(".salle-autre-jour").waitFor({ state: "detached" });
// Client de passage : 2 personnes à la table 2, installées aussitôt.
await listeCaisse.getByRole("button", { name: "Créer" }).click();
await pc.getByRole("tab", { name: "Client(e) de passage" }).click();
await pc.getByRole("group", { name: "Nombre de personnes" }).getByRole("button", { name: "2", exact: true }).click();
await p.locator(".plan-table", { has: p.locator("text.plan-nom", { hasText: /^2$/ }) }).click();
await pc.getByRole("button", { name: "Installer" }).click();
await p.getByText(/2 couverts/).first().waitFor();
r.passage = await p.locator(".ticket-titre h1").innerText();
verifier("client de passage installé", /Table 2/.test(r.passage), r.passage);
await p.getByRole("tab", { name: "Salle" }).click();
// Repli de la liste : le plan prend toute la largeur.
await p.getByRole("button", { name: /^Réservations · / }).click();
await listeCaisse.waitFor({ state: "detached" });
r.planLarge = await p.locator(".resa-centre").evaluate((e) => e.getBoundingClientRect().width);
verifier("plan sur toute la largeur", r.planLarge >= 1170, r.planLarge);
await p.screenshot({ path: `${sortie}/rz10-ipad-sans-liste.png` });

// ── iPhone : la liste en plein écran par-dessus la salle ──
const tel = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const t = await tel.newPage();
t.on("pageerror", (e) => erreurs.push(`iphone : ${e.message}`));
await accepterConfirmations(t);
const codeIphone = (await appel("POST", "/etablissements/moka/codes", { nomCaisse: "iPhone" })).code;
await t.goto(URL);
await t.locator(".champ-code input").fill(codeIphone);
await t.getByRole("button", { name: /^Rattacher/ }).first().click();
await t.getByRole("button", { name: "Configurer plus tard" }).click();
await t.locator(".carte-personne", { hasText: "Lionel" }).click();
for (const x of "1234") await t.locator(".pave .touche", { hasText: new RegExp(`^${x}$`) }).last().click();
await t.getByRole("button", { name: "Plus tard", exact: true }).click().catch(() => undefined);
await t.getByRole("button", { name: /^Réservations · / }).click();
await t.locator(".resa-liste .resa-ligne").first().waitFor();
r.debordIphone = await t.evaluate(() => document.documentElement.scrollWidth - 390);
await t.screenshot({ path: `${sortie}/rz11-iphone-liste.png` });
await t.locator(".resa-liste").getByRole("button", { name: "Créer" }).click();
await t.locator(".resa-panneau").waitFor();
await t.screenshot({ path: `${sortie}/rz12-iphone-saisie.png` });
r.debordSaisie = await t.evaluate(() => document.documentElement.scrollWidth - 390);
verifier("iPhone sans débordement", r.debordIphone <= 0 && r.debordSaisie <= 0, [r.debordIphone, r.debordSaisie]);

// Administration sur iPhone : la liste dans la page, sans le plan.
await a.setViewportSize({ width: 390, height: 844 });
await a.goto(`${URL}/admin#/moka/reservations`);
await a.locator(".resa-ligne").first().waitFor();
r.debordAdmin = await a.evaluate(() => document.documentElement.scrollWidth - 390);
verifier("administration iPhone", r.debordAdmin <= 0 && !(await a.locator(".resa-centre").isVisible()), r.debordAdmin);
await a.screenshot({ path: `${sortie}/rz13-admin-iphone.png`, fullPage: true });

await b.close();
console.log(JSON.stringify({ r, echecs, erreurs }, null, 2));
if (echecs.length || erreurs.length) process.exit(1);
