// Article à prix libre (demande de Lionel du 15 novembre 2026, reprise de la carte du Chardon) :
// « Divers soft » est marqué « Prix saisi en caisse » dans la carte. Sur l'iPad, sa tuile affiche
// « Prix libre » ; la toucher ouvre un pavé : sans montant, rien ne s'ajoute ; 12,50 € (pavé et
// clavier physique), quantité 2, Entrée : la ligne vaut 25,00 €. La table est encaissée : le ticket
// du serveur porte 2 × 12,50 € et aucune alerte de prix n'est levée. La fenêtre tient sur iPhone.
// Usage : serveur local vierge (apps/caisse : node scripts/serveur-local.mjs 4180), puis
//         URL=http://localhost:4180 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/prix-libre.mjs [dossier-captures]
import { chromium } from "playwright";
import { preparerServeur } from "./preparer-caisse.mjs";

const URL = process.env.URL ?? "http://localhost:4180";
const sortie = process.argv[2] ?? "captures";
const { code, appel } = await preparerServeur(URL, "Comptoir");

// La carte reçoit un article à prix libre, à côté du cappuccino.
const lue = await appel("GET", "/cartes/carte-automne-2026");
const carte = structuredClone(lue.carte);
carte.categories.find((c) => c.articles.some((a) => a.id === "cappuccino")).articles.push({ id: "divers-soft", nom: "Divers soft", prixTTC: null, tauxTVA: 1000, prixLibre: true });
await appel("PUT", "/cartes/carte-automne-2026", { carte, version: lue.version });

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

// ── Table 4 : la tuile ──
await p.getByRole("button", { name: /^Table 4,/ }).click();
const tuile = p.locator(".tuile", { hasText: "Divers soft" });
r.tuile = await texte(tuile);
r.tuileIncomplete = await tuile.evaluate((x) => x.classList.contains("incomplete"));
await tuile.click();

// ── Le pavé : rien sans montant, puis 12,50 € (pavé et clavier), quantité 2 ──
const modale = p.locator(".modale");
const ajouter = modale.getByRole("button", { name: /^(Ajouter|Saisissez)/ });
r.boutonVide = { texte: await texte(ajouter), desactive: await ajouter.isDisabled() };
await p.keyboard.press("Enter");
r.rienAjoute = (await p.locator(".ticket-ligne").count()) === 0;
for (const t of ["1", "2"]) await modale.locator(".prix-libre .pave").getByRole("button", { name: t, exact: true }).click();
await p.keyboard.press("5");
await p.keyboard.press("0");
r.afficheur = await texte(modale.locator(".prix-libre .afficheur"));
await modale.getByRole("button", { name: "Un de plus" }).click();
r.bouton = await texte(ajouter);
await p.screenshot({ path: `${sortie}/pl01-pave.png` });

// ── Format iPhone : la fenêtre et le pavé tiennent dans l'écran ──
await p.setViewportSize({ width: 390, height: 844 });
await modale.locator(".prix-libre .pave").scrollIntoViewIfNeeded();
const boite = await modale.locator(".prix-libre .pave").boundingBox();
r.paveDansEcran = !!boite && boite.x >= 0 && boite.x + boite.width <= 391;
r.debordementIphone = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
await p.screenshot({ path: `${sortie}/pl02-iphone.png` });
await p.setViewportSize({ width: 1180, height: 820 });

await p.keyboard.press("Enter");
await modale.waitFor({ state: "detached" });
r.ligne = await texte(p.locator(".ticket-ligne", { hasText: "Divers soft" }));
r.total = await texte(p.locator(".ticket-total strong"));

// ── Encaissée : ticket du serveur, aucune alerte de prix ──
await clic("Encaisser");
await p.locator(".mode", { hasText: "Espèces" }).click();
await p.getByRole("button", { name: /^Valider l'encaissement/ }).click();
await clic("Terminé");
await p.locator(".puce-synchro.synchronise").waitFor({ timeout: 20000 });
await p.waitForTimeout(1500);
const jour = new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris" }).format(new Date(Date.now() - 5 * 3600_000));
const { tickets } = await appel("GET", `/etablissements/moka/tickets?du=${jour}&au=${jour}`);
const t = tickets.find((x) => x.type === "VENTE");
r.ticket = t ? { totalTTC: t.totalTTC, lignes: t.lignes.map((l) => `${l.quantite}×${l.articleId}@${l.prixUnitaireTTC}/${l.tauxTVA}`) } : null;
const { alertes } = await appel("GET", "/etablissements/moka/alertes");
r.alertes = alertes.map((a) => a.type);
await b.close();

console.log(JSON.stringify({ ...r, erreurs }, null, 2));
const ok =
  /Divers soft\s*Prix libre/.test(r.tuile) &&
  !r.tuileIncomplete &&
  r.boutonVide.texte === "Saisissez le prix" &&
  r.boutonVide.desactive &&
  r.rienAjoute &&
  r.afficheur === "12,50 €" &&
  r.bouton === "Ajouter · 25,00 €" &&
  r.paveDansEcran &&
  r.debordementIphone <= 0 &&
  /Divers soft/.test(r.ligne) &&
  r.total === "25,00 €" &&
  r.ticket?.totalTTC === 2500 &&
  r.ticket.lignes.length === 1 &&
  r.ticket.lignes[0] === "2×divers-soft@1250/1000" &&
  !r.alertes.includes("PRIX_DIFFERENT") &&
  !r.alertes.includes("ARTICLE_HORS_CARTE") &&
  !erreurs.length;
if (!ok) process.exit(1);
