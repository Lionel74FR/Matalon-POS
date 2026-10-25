// Réservation de groupe sur plusieurs tables (demande de Lionel du 20 octobre) : saisie de 15 personnes dans
// l'administration sur les tables 1 à 4, places comptées face aux personnes, changement d'une table dans la liste,
// puis sur l'iPad : la réservation montre ses tables, l'installation les ouvre ensemble, et une saisie à la caisse
// réunit trois tables.
// Usage : serveur local vierge (apps/caisse : node scripts/serveur-local.mjs 4180), puis
//         URL=http://localhost:4180 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/reservation-groupe.mjs [dossier-captures]
import { chromium } from "playwright";
import { accepterConfirmations, preparerServeur } from "./preparer-caisse.mjs";

const URL = process.env.URL ?? "http://localhost:4180";
const sortie = process.argv[2] ?? "captures";
const { code, cookie } = await preparerServeur(URL, "Comptoir");
const [nomCookie, valeurCookie] = cookie.split("=");
const erreurs = [];
const b = await chromium.launch();
const texte = async (loc) => ((await loc.textContent()) ?? "").replace(/[\s  ]+/g, " ").trim();
const r = {};
const table = (fenetre, nom) => fenetre.locator(".choix-table").filter({ has: fenetre.page().locator("strong", { hasText: new RegExp(`^${nom}$`) }) });

// ── Administration : 15 personnes sur les tables 1 à 4 ──
const bureau = await b.newContext({ viewport: { width: 1280, height: 900 } });
await bureau.addCookies([{ name: nomCookie, value: valeurCookie, url: `${URL}/api/admin` }]);
const a = await bureau.newPage();
a.on("pageerror", (e) => erreurs.push(`admin : ${e.message}`));
await accepterConfirmations(a);
await a.goto(`${URL}/admin#/moka/reservations`);
await a.getByRole("button", { name: "Nouvelle réservation" }).click();
const f = a.locator(".resa-saisie");
await f.getByLabel("Heure").fill("23:45");
await f.getByLabel("Personnes").fill("15");
r.avant = await texte(f.getByRole("button", { name: /^Tables de la nouvelle réservation/ }));
await f.getByRole("button", { name: /^Tables de la nouvelle réservation/ }).click();
let fenetre = a.getByRole("dialog", { name: "Tables · 15 personnes" });
for (const n of ["1", "2", "3"]) await table(fenetre, n).click();
r.troisTables = await texte(fenetre.locator(".choix-tables-total"));
await table(fenetre, "4").click();
r.quatreTables = await texte(fenetre.locator(".choix-tables-total"));
await a.screenshot({ path: `${sortie}/rg01-choix-tables.png` });
await fenetre.getByRole("button", { name: "Valider" }).click();
r.boutonSaisie = await f.getByRole("button", { name: /^Tables de la nouvelle réservation/ }).getAttribute("aria-label");
await f.getByLabel("Prénom").fill("Groupe");
await f.getByLabel("Nom", { exact: true }).fill("Anniversaire");
await f.getByRole("textbox", { name: "Téléphone" }).fill("0611223344");
await f.getByRole("button", { name: "Enregistrer la réservation" }).click();
const ligne = a.locator(".resa-table tbody tr", { hasText: "Groupe Anniversaire" });
await ligne.waitFor({ timeout: 15000 });
r.liste = await texte(ligne.locator(".choix-tables"));

// ── Dans la liste : la table 4 remplacée par la 5 ──
await ligne.getByRole("button", { name: /^Tables de Groupe Anniversaire/ }).click();
fenetre = a.getByRole("dialog", { name: "Tables · 15 personnes" });
await table(fenetre, "4").click();
r.manque = await texte(fenetre.locator(".choix-tables-total"));
await table(fenetre, "5").click();
await fenetre.getByRole("button", { name: "Valider" }).click();
await ligne.locator(".choix-tables", { hasText: "1 + 2 + 3 + 5" }).waitFor({ timeout: 10000 });
r.listeApres = await texte(ligne.locator(".choix-tables"));
await a.screenshot({ path: `${sortie}/rg02-liste-admin.png` });

// ── iPad ──
const ctx = await b.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true });
const p = await ctx.newPage();
p.on("pageerror", (e) => erreurs.push(`ipad : ${e.message}`));
p.on("dialog", (d) => void d.accept());
const clic = (n) => p.getByRole("button", { name: n, exact: true }).first().click();
await p.goto(URL);
await p.locator(".champ-code input").fill(code);
await clic("Rattacher l'iPad");
await clic("Configurer plus tard");
await p.locator(".carte-personne", { hasText: "Lionel" }).click();
for (const x of "1234") await p.locator(".pave .touche", { hasText: new RegExp(`^${x}$`) }).last().click();
await clic("Plus tard");
await p.getByRole("button", { name: /^Réservations · 1/ }).waitFor({ timeout: 20000 });
await p.getByRole("button", { name: /^Réservations · / }).click();
const ligneCaisse = p.locator(".resa-caisse-ligne", { hasText: "Groupe Anniversaire" });
await ligneCaisse.waitFor();
r.caisse = await texte(ligneCaisse.locator(".choix-tables"));

// Saisie à la caisse : 10 personnes sur les tables 7, 8 et 9.
await clic("Nouvelle");
const fc = p.locator(".resa-caisse-saisie");
await fc.getByLabel("Heure").fill("23:45");
await fc.getByLabel("Personnes").fill("10");
await fc.getByRole("button", { name: /^Tables de la nouvelle réservation/ }).click();
fenetre = p.getByRole("dialog", { name: "Tables · 10 personnes" });
for (const n of ["7", "8"]) await table(fenetre, n).click();
r.caisseManque = await texte(fenetre.locator(".choix-tables-total"));
await table(fenetre, "9").click();
await fenetre.getByRole("button", { name: "Valider" }).click();
await fc.getByLabel("Prénom").fill("Club");
await fc.getByLabel("Nom", { exact: true }).fill("Rando");
await fc.getByLabel("Téléphone").fill("0699887766");
await fc.getByRole("button", { name: "Enregistrer" }).click();
const ligneClub = p.locator(".resa-caisse-ligne", { hasText: "Club Rando" });
await ligneClub.waitFor({ timeout: 15000 });
r.club = await texte(ligneClub.locator(".choix-tables"));
await p.screenshot({ path: `${sortie}/rg03-caisse.png` });

// Installation du groupe : ses quatre tables s'ouvrent ensemble.
await ligneCaisse.getByRole("button", { name: "Installer" }).click();
await p.getByRole("heading", { name: "Table 1 + 2 + 3 + 5" }).waitFor({ timeout: 10000 });
r.titre = await texte(p.locator(".ticket-titre h1"));
r.couverts = await texte(p.locator(".ticket-titre .lien"));
await b.close();

console.log(JSON.stringify({ ...r, erreurs }, null, 2));
const ok =
  r.avant === "Attribuée d'office" &&
  r.troisTables === "12 places pour 15 personnes : ajoutez une table" &&
  r.quatreTables === "16 places pour 15 personnes" &&
  r.boutonSaisie === "Tables de la nouvelle réservation : tables 1 + 2 + 3 + 4" &&
  /^1 \+ 2 \+ 3 \+ 4 ?16 places$/.test(r.liste) &&
  r.manque === "12 places pour 15 personnes : ajoutez une table" &&
  /^1 \+ 2 \+ 3 \+ 5 ?16 places$/.test(r.listeApres) &&
  /^1 \+ 2 \+ 3 \+ 5 ?16 places$/.test(r.caisse) &&
  r.caisseManque === "8 places pour 10 personnes : ajoutez une table" &&
  /^7 \+ 8 \+ 9 ?12 places$/.test(r.club) &&
  r.titre === "Table 1 + 2 + 3 + 5" &&
  /15 couverts/.test(r.couverts) &&
  !erreurs.length;
if (!ok) process.exit(1);
