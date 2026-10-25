// Clôtures et exports comptables dans l'administration (demande de Lionel du 21 octobre) : l'iPad déclare
// son fond, vend en espèces et fait la Z avec un écart d'un euro et son motif ; l'administration voit la Z
// du mois (appareil, tickets, écart), son détail (totaux, comptage, empreinte), télécharge l'export comptable,
// les comptages de caisse et l'archive de la Z ; l'année passe en revue la même Z ; l'iPhone ne déborde pas.
// Usage : serveur local vierge (apps/caisse : node scripts/serveur-local.mjs 4180), puis
//         URL=http://localhost:4180 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/clotures-admin.mjs [dossier-captures]
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { preparerServeur, rubriqueAdmin } from "./preparer-caisse.mjs";

const URL = process.env.URL ?? "http://localhost:4180";
const sortie = process.argv[2] ?? "captures";
const { code, cookie } = await preparerServeur(URL, "Comptoir");
const [nomCookie, valeurCookie] = cookie.split("=");
const erreurs = [];
const b = await chromium.launch();
const texte = async (loc) => ((await loc.textContent()) ?? "").replace(/[\s  ]+/g, " ").trim();
const r = {};

// ── iPad : fond de 150 €, un cappuccino en espèces, Z avec 1 € manquant ──
const ctx = await b.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true });
const p = await ctx.newPage();
p.on("pageerror", (e) => erreurs.push(`ipad : ${e.message}`));
const clic = (n) => p.getByRole("button", { name: n, exact: true }).first().click();
const champ = (libelle) => p.locator(".modale label.champ", { hasText: libelle }).locator("input");
await p.goto(URL);
await p.locator(".champ-code input").fill(code);
await clic("Rattacher l'iPad");
await clic("Configurer plus tard");
await p.locator(".carte-personne", { hasText: "Lionel" }).click();
for (const x of "1234") await p.locator(".pave .touche", { hasText: new RegExp(`^${x}$`) }).last().click();
await p.getByRole("dialog", { name: "Fond de caisse" }).waitFor();
await champ("Fond de caisse").fill("150");
await clic("Enregistrer le fond");
await clic("Vente Directe");
await p.locator(".tuile", { hasText: "Cappuccino" }).first().click();
await clic("Encaisser");
await p.locator(".mode", { hasText: "Espèces" }).click();
await p.getByRole("button", { name: /^Valider l'encaissement/ }).click();
await clic("Terminé");
await p.getByRole("button", { name: /^Menu/ }).click().then(() => p.getByRole("menuitem", { name: "Clôtures" }).click());
await clic("Clôturer la journée (Z)");
await p.locator(".comptage-lignes").first().waitFor();
const attendu = Number((await p.locator(".comptage-lignes div", { hasText: "Attendu dans le tiroir" }).locator("dd").textContent()).replace(/[^\d,]/g, "").replace(",", "."));
await clic("Saisir le total directement");
await champ("Espèces comptées").fill(String(attendu - 1).replace(".", ","));
await champ("Total CB du TPE").fill("0");
await champ("Titres-restaurant carte du TPE").fill("0");
await p.locator(".champ-motif input").fill("pièce perdue");
await p.getByRole("button", { name: /^Valider.*clôturer/ }).click();
await p.getByText(/clôturée/).first().waitFor();
await p.locator(".puce-synchro.synchronise").waitFor({ timeout: 20000 });
r.attendu = attendu;

// ── Administration : la Z du mois ──
async function administration(nom, viewport) {
  const c = await b.newContext({ viewport, hasTouch: nom === "iphone", acceptDownloads: true });
  await c.addCookies([{ name: nomCookie, value: valeurCookie, url: `${URL}/api/admin` }]);
  const a = await c.newPage();
  a.on("pageerror", (e) => erreurs.push(`${nom} : ${e.message}`));
  return a;
}
const a = await administration("admin", { width: 1280, height: 900 });
await a.goto(`${URL}/admin#/moka/appareils`);
await rubriqueAdmin(a, "Clôtures");
await a.waitForFunction(() => location.hash === "#/moka/clotures");
const liste = a.getByRole("list", { name: "Clôtures" });
const ligne = liste.locator(".ticket-admin").first();
await ligne.waitFor({ timeout: 15000 });
r.ligne = await texte(ligne);
r.total = await texte(a.locator(".clotures-total"));
await a.screenshot({ path: `${sortie}/ca01-clotures-mois.png`, fullPage: true });

// Détail : totaux, comptage avec son écart et son motif, empreinte ; l'archive se télécharge.
await ligne.click();
const modale = a.getByRole("dialog");
await modale.waitFor();
r.detail = await texte(modale);
await a.screenshot({ path: `${sortie}/ca02-detail-z.png` });
const [archive] = await Promise.all([a.waitForEvent("download"), modale.getByRole("link", { name: "Télécharger l'archive (JSON)" }).click()]);
const json = JSON.parse(await readFile(await archive.path(), "utf8"));
r.archive = { nom: archive.suggestedFilename(), format: json.format, tickets: json.tickets?.length };
await modale.getByRole("button", { name: "Fermer" }).click();

// Exports de la période.
const telecharger = async (nom) => {
  const [d] = await Promise.all([a.waitForEvent("download"), a.getByRole("link", { name: nom }).click()]);
  return { nom: d.suggestedFilename(), lignes: (await readFile(await d.path(), "utf8")).replace(/^﻿/, "").trim().split(/\r?\n/) };
};
const compta = await telecharger("Export comptable (CSV)");
const comptages = await telecharger("Comptages de caisse (CSV)");
r.compta = { nom: compta.nom, n: compta.lignes.length, entete: compta.lignes[0]?.slice(0, 80), z: compta.lignes[1]?.slice(0, 80) };
r.comptages = { nom: comptages.nom, n: comptages.lignes.length, z: comptages.lignes[1] };

// Mois précédent : vide ; année : la même Z.
await a.getByRole("button", { name: "Mois précédent" }).click();
await a.locator(".clotures-admin .vide").waitFor();
r.moisPrecedent = await texte(a.locator(".clotures-admin .vide"));
await a.getByRole("button", { name: "Mois suivant" }).click();
await a.getByRole("button", { name: "Année", exact: true }).click();
await liste.locator(".ticket-admin").first().waitFor();
r.annee = { lignes: await liste.locator(".ticket-admin").count(), lien: await a.getByRole("link", { name: "Export comptable (CSV)" }).getAttribute("href") };

// ── iPhone : sans débordement, détail compris ──
const m = await administration("iphone", { width: 390, height: 844 });
await m.goto(`${URL}/admin#/moka/clotures`);
await m.getByRole("list", { name: "Clôtures" }).locator(".ticket-admin").first().click();
await m.getByRole("dialog").waitFor();
r.debordementIphone = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
await m.screenshot({ path: `${sortie}/ca03-iphone.png` });
await b.close();

console.log(JSON.stringify({ ...r, erreurs }, null, 2));
const an = new Date().getFullYear();
const ok =
  r.attendu === 154 &&
  /^Z .* · n° 1 ?Comptoir · 1 ticket · écart espèces -1,00 € ?4,00 €$/.test(r.ligne) &&
  /^4,00 € TTC sur 1 Z · .* HT · TVA .* · 1 vente ?Espèces 4,00 €$/.test(r.total) &&
  /Total TTC ?4,00/.test(r.detail) &&
  /Comptage/.test(r.detail) &&
  /motif : pièce perdue/.test(r.detail) &&
  /Empreinte [0-9a-f]{64}/.test(r.detail) &&
  r.archive.format?.startsWith("matalon-archive") &&
  r.archive.tickets === 1 &&
  /^clotures-moka-\d{4}-\d{2}-01_\d{4}-\d{2}-\d{2}\.csv$/.test(r.compta.nom) &&
  r.compta.n === 2 &&
  /^comptages-moka-/.test(r.comptages.nom) &&
  r.comptages.n === 2 &&
  /;Comptoir;1;oui;150,00;/.test(r.comptages.z) &&
  /;-1,00;/.test(r.comptages.z) &&
  /pièce perdue$/.test(r.comptages.z) &&
  /^Aucune clôture sur /.test(r.moisPrecedent) &&
  r.annee.lignes === 1 &&
  r.annee.lien?.includes(`du=${an}-01-01&au=${an}-12-31`) &&
  r.debordementIphone <= 0 &&
  !erreurs.length;
if (!ok) process.exit(1);
