// Remise en euros sur un article (demande de Lionel du 29 octobre 2026), à côté de la remise en % :
// sur l'iPad, table 4 avec 3 cappuccinos (12,00 €) ; « En euros » au pavé : 15,00 € est refusé (plus
// que la ligne), 2,00 € « Geste commercial » est accepté (ligne à 10,00 €, rouverte en euros). Un
// cappuccino part vers la table 9 : la remise se partage (0,67 € et 1,33 €, rien de perdu). La table 4
// est encaissée : le ticket du serveur porte 1,33 € de remise et son motif. La fenêtre tient sur iPhone.
// Usage : serveur local vierge (apps/caisse : node scripts/serveur-local.mjs 4180), puis
//         URL=http://localhost:4180 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/remise-euros.mjs [dossier-captures]
import { chromium } from "playwright";
import { preparerServeur } from "./preparer-caisse.mjs";

const URL = process.env.URL ?? "http://localhost:4180";
const sortie = process.argv[2] ?? "captures";
const { code, appel } = await preparerServeur(URL, "Comptoir");
const erreurs = [];
const b = await chromium.launch();
const texte = async (loc) => ((await loc.textContent()) ?? "").replace(/[\s  ]+/g, " ").trim();
const r = {};

const ctx = await b.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true });
const p = await ctx.newPage();
p.on("pageerror", (e) => erreurs.push(`ipad : ${e.message}`));
const clic = (n) => p.getByRole("button", { name: n, exact: true }).first().click();
await p.goto(URL);
await p.locator(".champ-code input").fill(code);
await clic("Rattacher l'iPad");
await clic("Configurer plus tard");
await p.locator(".carte-personne", { hasText: "Lionel" }).click();
for (const x of "1234") await p.locator(".pave .touche", { hasText: new RegExp(`^${x}$`) }).last().click();
await clic("Plus tard");
await p.locator(".puce-synchro.synchronise").waitFor({ timeout: 15000 });

// ── Table 4 : 3 cappuccinos ──
await p.getByRole("button", { name: /^Table 4,/ }).click();
for (let i = 0; i < 3; i++) await p.locator(".tuile", { hasText: "Cappuccino" }).first().click();
r.totalAvant = await texte(p.locator(".ticket-total strong"));

// ── Remise en euros : 15,00 € refusé, puis 2,00 € ──
const modale = p.locator(".modale");
const touche = (t) => modale.locator(".remise-euros .pave").getByRole("button", { name: t, exact: true }).click();
await p.locator(".ticket-ligne", { hasText: "Cappuccino" }).click();
await clic("En euros");
for (const t of ["1", "5", "00"]) await touche(t);
r.afficheurTrop = await texte(modale.locator(".remise-euros .afficheur"));
await clic("Geste commercial");
await p.getByRole("button", { name: /^Valider/ }).click();
r.refus = await texte(modale.locator(".erreur"));
for (let i = 0; i < 4; i++) await touche("Effacer");
for (const t of ["2", "00"]) await touche(t);
r.afficheur = await texte(modale.locator(".remise-euros .afficheur"));
r.explication = await texte(modale.locator(".remise-euros .explication"));
r.bouton = await texte(p.getByRole("button", { name: /^Valider/ }));
await p.screenshot({ path: `${sortie}/re01-remise.png` });
await p.getByRole("button", { name: /^Valider/ }).click();
await modale.waitFor({ state: "detached" });
r.ligne = await texte(p.locator(".ticket-ligne", { hasText: "Cappuccino" }));
r.total = await texte(p.locator(".ticket-total strong"));

// Rouverte : la remise est en euros, au montant saisi.
await p.locator(".ticket-ligne", { hasText: "Cappuccino" }).click();
r.rouverte = { enEuros: await modale.getByRole("button", { name: "En euros", exact: true }).evaluate((x) => x.classList.contains("active")), afficheur: await texte(modale.locator(".remise-euros .afficheur")) };

// ── Format iPhone : la fenêtre et le pavé tiennent dans l'écran ──
await p.setViewportSize({ width: 390, height: 844 });
await modale.locator(".remise-euros .pave").scrollIntoViewIfNeeded();
const boite = await modale.locator(".remise-euros .pave").boundingBox();
r.paveDansEcran = !!boite && boite.x >= 0 && boite.x + boite.width <= 391;
r.debordementIphone = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
await p.screenshot({ path: `${sortie}/re02-iphone.png` });
await p.setViewportSize({ width: 1180, height: 820 });
await p.keyboard.press("Escape");
await modale.waitFor({ state: "detached" });

// ── Un cappuccino vers la table 9 : la remise se partage ──
await clic("Transférer vers une autre table");
await p.getByRole("button", { name: "Ne transférer que certains articles" }).click();
await p.getByRole("button", { name: "Une unité de plus : Cappuccino" }).click();
await p.getByRole("button", { name: /^Choisir la table d'arrivée/ }).click();
await p.locator(".modale .grille-tables .table", { hasText: /^9/ }).click();
await p.locator(".toast", { hasText: "transféré" }).first().waitFor();
r.total4 = await texte(p.locator(".ticket-total strong"));
r.ligne4 = await texte(p.locator(".ticket-ligne", { hasText: "Cappuccino" }));
await p.getByRole("button", { name: "Retour à la salle" }).click();
await p.getByRole("button", { name: /^Table 9,/ }).click();
r.total9 = await texte(p.locator(".ticket-total strong"));
await p.screenshot({ path: `${sortie}/re03-table9.png` });

// ── Table 4 encaissée : ticket du serveur ──
await p.getByRole("button", { name: "Retour à la salle" }).click();
await p.getByRole("button", { name: /^Table 4,/ }).click();
await clic("Encaisser");
await p.locator(".mode", { hasText: "Espèces" }).click();
await p.getByRole("button", { name: /^Valider l'encaissement/ }).click();
await clic("Terminé");
await p.locator(".puce-synchro.synchronise").waitFor({ timeout: 20000 });
await p.waitForTimeout(1500);
const jour = new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris" }).format(new Date(Date.now() - 5 * 3600_000));
const { tickets } = await appel("GET", `/etablissements/moka/tickets?du=${jour}&au=${jour}`);
const t = tickets.find((x) => x.type === "VENTE");
r.ticket = t ? { totalTTC: t.totalTTC, lignes: t.lignes.map((l) => `${l.quantite}×${l.prixUnitaireTTC}-${l.remiseTTC}:${l.motifRemise}`) } : null;
await b.close();

console.log(JSON.stringify({ ...r, erreurs }, null, 2));
const ok =
  r.totalAvant === "12,00 €" &&
  r.afficheurTrop === "15,00 €" &&
  /dépasse le montant de la ligne \(12,00 €\)/.test(r.refus) &&
  r.afficheur === "2,00 €" &&
  /ensemble des 3 articles/.test(r.explication) &&
  /10,00 €/.test(r.bouton) &&
  /Remise 2,00 €\s*·\s*Geste commercial/.test(r.ligne) &&
  r.total === "10,00 €" &&
  r.rouverte.enEuros &&
  r.rouverte.afficheur === "2,00 €" &&
  r.paveDansEcran &&
  r.debordementIphone <= 0 &&
  r.total4 === "6,67 €" &&
  /Remise 1,33 €/.test(r.ligne4) &&
  r.total9 === "3,33 €" &&
  r.ticket?.totalTTC === 667 &&
  r.ticket.lignes.length === 1 &&
  r.ticket.lignes[0] === "2×400-133:Geste commercial" &&
  !erreurs.length;
if (!ok) process.exit(1);
