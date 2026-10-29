// Transfert d'une partie des articles (demande de Lionel du 29 octobre) : sur l'iPad, table 4 avec
// 3 cappuccinos et un cortado (envoyés) ; 2 cappuccinos partent vers la table 9 (libre), puis le
// cortado rejoint la table 9 (déjà ouverte : regroupé). La table 4 garde un cappuccino et ses
// couverts. L'iPhone voit les deux tables à jour ; le journal note les transferts partiels.
// Usage : serveur local vierge (apps/caisse : node scripts/serveur-local.mjs 4180), puis
//         URL=http://localhost:4180 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/transfert-articles.mjs [dossier-captures]
import { chromium } from "playwright";
import { preparerServeur } from "./preparer-caisse.mjs";

const URL = process.env.URL ?? "http://localhost:4180";
const sortie = process.argv[2] ?? "captures";
const { code, appel } = await preparerServeur(URL, "Comptoir");
const { code: codeIphone } = await appel("POST", "/etablissements/moka/codes", { nomCaisse: "Salle" });
const erreurs = [];
const b = await chromium.launch();
const texte = async (loc) => ((await loc.textContent()) ?? "").replace(/[\s  ]+/g, " ").trim();

async function appareil(nom, options, codeRattachement, bouton) {
  const ctx = await b.newContext(options);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => erreurs.push(`${nom} : ${e.message}`));
  const clic = (n) => p.getByRole("button", { name: n, exact: true }).first().click();
  await p.goto(URL);
  await p.locator(".champ-code input").fill(codeRattachement);
  await clic(bouton);
  await clic("Configurer plus tard");
  await p.locator(".carte-personne", { hasText: "Lionel" }).click();
  for (const x of "1234") await p.locator(".pave .touche", { hasText: new RegExp(`^${x}$`) }).last().click();
  await clic("Plus tard");
  await p.locator(".puce-synchro.synchronise").waitFor({ timeout: 15000 });
  return { p, clic };
}
const ipad = await appareil("ipad", { viewport: { width: 1180, height: 820 }, hasTouch: true }, code, "Rattacher l'iPad");
const iphone = await appareil(
  "iphone",
  {
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  },
  codeIphone,
  "Rattacher l'iPhone",
);
const r = {};
const lignes = async (a) => (await a.p.locator(".ticket-ligne:not(.retiree)").allTextContents()).map((t) => t.replace(/\s+/g, " ").trim());

// ── iPad, table 4 : 2 couverts, 3 cappuccinos, un cortado, envoyés ──
const { p, clic } = ipad;
await p.getByRole("button", { name: /^Table 4,/ }).click();
await p.getByRole("button", { name: "Indiquer les couverts" }).click();
await p.locator(".couverts-choix", { hasText: /^2$/ }).click();
for (let i = 0; i < 3; i++) await p.locator(".tuile", { hasText: "Cappuccino" }).first().click();
await p.locator(".tuile", { hasText: "Cortado" }).first().click();
await p.getByRole("button", { name: /^Envoyer \(\d+\)/ }).click();
r.totalAvant = await texte(p.locator(".ticket-total strong"));

// ── 2 cappuccinos sur 3 vers la table 9, libre ──
await clic("Transférer vers une autre table");
await p.getByRole("button", { name: "Ne transférer que certains articles" }).click();
await p.getByRole("button", { name: "Une unité de plus : Cappuccino" }).click();
await p.getByRole("button", { name: "Une unité de plus : Cappuccino" }).click();
await p.screenshot({ path: `${sortie}/ta01-choix.png` });
await p.getByRole("button", { name: /^Choisir la table d'arrivée/ }).click();
r.titre = await texte(p.locator(".modale h2").first());
await p.locator(".modale .grille-tables .table", { hasText: /^9/ }).click();
r.toast1 = await texte(p.locator(".toast", { hasText: "transféré" }).first());
r.table4 = await lignes(ipad);
r.couverts4 = await texte(p.getByRole("button", { name: /couverts/i }).first());

// ── Le cortado rejoint la table 9 (ouverte : regroupé) ──
await clic("Transférer vers une autre table");
await p.getByRole("button", { name: "Ne transférer que certains articles" }).click();
await p.locator(".division-libelle", { hasText: "Cortado" }).click();
await p.getByRole("button", { name: /^Choisir la table d'arrivée/ }).click();
await p.locator(".modale .grille-tables .table", { hasText: /^9/ }).click();
r.fusion = await texte(p.locator(".modale .explication").first());
await p.getByRole("button", { name: /^Regrouper sur Table 9/ }).click();
await p.locator(".toast", { hasText: "ajouté à Table 9" }).waitFor();
r.table4Apres = await lignes(ipad);
await p.getByRole("button", { name: "Retour à la salle" }).click();
await p.getByRole("button", { name: /^Table 9,/ }).click();
r.table9 = await lignes(ipad);
r.envoyes9 = await p.locator(".ticket-ligne.envoyee, .ticket-ligne [class*=envoy]").count();
await p.screenshot({ path: `${sortie}/ta02-table9.png` });

// ── L'iPhone voit les deux tables ──
await iphone.p.waitForTimeout(6000);
await iphone.p.getByRole("button", { name: /^Table 9,/ }).click();
await iphone.p.locator(".ticket-ligne", { hasText: "Cortado" }).waitFor({ state: "attached", timeout: 15000 });
r.iphone9 = await lignes(iphone);
await iphone.p.screenshot({ path: `${sortie}/ta03-iphone.png` });

// ── Journal : transferts partiels ──
await p.locator(".puce-synchro.synchronise").waitFor({ timeout: 20000 });
await p.waitForTimeout(1500);
const verif = await appel("GET", "/etablissements");
const caisseId = verif.etablissements.find((e) => e.id === "moka").caisses.find((c) => c.nom === "Comptoir").id;
const journal = await appel("GET", `/caisses/${caisseId}/journal.json`);
const evenements = journal.evenements ?? journal.chaines?.evenements ?? [];
r.journal = evenements.filter((e) => e.code === "TRANSFERT_TABLE").map((e) => `${e.details.de}>${e.details.vers}:${e.details.partiel}:${e.details.fusion}:${e.details.nbArticles}`);
await b.close();

console.log(JSON.stringify({ ...r, erreurs }, null, 2));
const ok =
  /Transférer 2 articles/.test(r.titre) &&
  /2 articles de Table 4 transférés vers Table 9/.test(r.toast1) &&
  r.table4.length === 2 &&
  r.table4.some((l) => /^1\s*Cappuccino/.test(l)) &&
  r.table4.some((l) => /Cortado/.test(l)) &&
  /2/.test(r.couverts4) &&
  /: 1 article \(3,50 €\) s'y ajoute\./.test(r.fusion) &&
  r.table4Apres.length === 1 &&
  /^1\s*Cappuccino/.test(r.table4Apres[0]) &&
  r.table9.some((l) => /^2\s*Cappuccino/.test(l)) &&
  r.table9.some((l) => /Cortado/.test(l)) &&
  r.iphone9.length === 2 &&
  r.journal.length === 2 &&
  r.journal.every((j) => j.includes(":true:")) &&
  !erreurs.length;
if (!ok) process.exit(1);
