// Tickets dans l'administration (demande de Lionel du 17 octobre) : Lionel puis Léa encaissent sur l'iPad ;
// l'administration résume par serveur, filtre la liste en touchant un serveur, montre le détail d'un ticket,
// et les statistiques (Équipe) ouvrent les tickets d'une personne. Sans débordement sur iPhone.
// Usage : serveur local vierge (apps/caisse : node scripts/serveur-local.mjs 4180), puis
//         URL=http://localhost:4180 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/tickets-admin.mjs [dossier-captures]
import { chromium } from "playwright";
import { preparerServeur, rubriqueAdmin } from "./preparer-caisse.mjs";

const URL = process.env.URL ?? "http://localhost:4180";
const sortie = process.argv[2] ?? "captures";
const { code, cookie, appel } = await preparerServeur(URL, "Comptoir");
await appel("POST", "/etablissements/moka/utilisateurs", { nom: "Léa", role: "serveur", pin: "5678", actif: true });
const [nomCookie, valeurCookie] = cookie.split("=");
const erreurs = [];
const b = await chromium.launch();
const texte = async (loc) => ((await loc.textContent()) ?? "").replace(/\s+/g, " ").trim();
const r = {};

// ── iPad : Lionel encaisse un cappuccino au comptoir et la table 2 ; Léa, un cortado ──
const ctx = await b.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true });
const p = await ctx.newPage();
p.on("pageerror", (e) => erreurs.push(`ipad : ${e.message}`));
const clic = (n) => p.getByRole("button", { name: n, exact: true }).first().click();
const connexion = async (nom, pin) => {
  await p.locator(".carte-personne", { hasText: nom }).click();
  for (const x of pin) await p.locator(".pave .touche", { hasText: new RegExp(`^${x}$`) }).last().click();
};
const encaisserCB = async () => {
  await clic("Encaisser");
  await p.locator(".mode", { hasText: "Carte bancaire" }).click();
  await p.getByRole("button", { name: /^Valider l'encaissement/ }).click();
  await clic("Terminé");
};
await p.goto(URL);
await p.locator(".champ-code input").fill(code);
await clic("Rattacher l'iPad");
await clic("Configurer plus tard");
await connexion("Lionel", "1234");
await clic("Plus tard");
await p.locator(".puce-synchro.synchronise").waitFor({ timeout: 15000 });
await clic("Vente Directe");
await p.locator(".tuile", { hasText: "Cappuccino" }).first().click();
await encaisserCB();
await p.getByRole("button", { name: /^Table 2,/ }).click();
await p.locator(".tuile", { hasText: "Espresso" }).first().click();
await p.locator(".tuile", { hasText: "Cortado" }).first().click();
await encaisserCB();
await p.getByRole("button", { name: /^Quitter/ }).click();
await connexion("Léa", "5678");
await clic("Plus tard");
await clic("Vente Directe");
await p.locator(".tuile", { hasText: "Cortado" }).first().click();
await encaisserCB();
await p.locator(".puce-synchro").click();
await p.locator(".puce-synchro.synchronise").waitFor({ timeout: 15000 });

// ── Administration › Tickets ──
async function administration(nom, viewport) {
  const c = await b.newContext({ viewport, hasTouch: nom === "iphone" });
  await c.addCookies([{ name: nomCookie, value: valeurCookie, url: `${URL}/api/admin` }]);
  const a = await c.newPage();
  a.on("pageerror", (e) => erreurs.push(`${nom} : ${e.message}`));
  return a;
}
const a = await administration("admin", { width: 1280, height: 860 });
await a.goto(`${URL}/admin#/moka/tickets`);
await a.locator(".tickets-serveur").first().waitFor({ timeout: 15000 });
r.serveurs = await a.locator(".tickets-serveur").evaluateAll((l) => l.map((x) => x.textContent.replace(/\s+/g, " ").trim()));
r.tous = await a.locator(".ticket-admin").count();
await a.locator(".tickets-serveur", { hasText: "Léa" }).click();
r.lea = await a.locator(".ticket-admin").count();
r.totauxLea = await texte(a.locator(".totaux-tickets"));
await a.locator(".ticket-admin").first().click();
const fiche = a.getByRole("dialog");
await fiche.waitFor();
r.titre = await texte(fiche.locator("h2").first());
r.fiche = await texte(fiche);
await a.screenshot({ path: `${sortie}/ta01-ticket-lea.png` });
await a.keyboard.press("Escape");

// ── Statistiques › Équipe › Lionel : ses tickets ──
await rubriqueAdmin(a, "Statistiques");
await a.getByRole("button", { name: "Voir les tickets de Lionel" }).click();
await a.waitForFunction(() => location.hash === "#/moka/tickets");
await a.locator(".tickets-serveur.actif", { hasText: "Lionel" }).waitFor();
r.lionel = await a.locator(".ticket-admin").count();
await a.screenshot({ path: `${sortie}/ta02-tickets-lionel.png` });
// Le menu rouvre la rubrique sans filtre.
await rubriqueAdmin(a, "Tickets");
await a.locator(".tickets-serveur.actif").waitFor({ state: "detached" });
await a.locator(".ticket-admin").nth(2).waitFor({ timeout: 10000 });
r.apresMenu = await a.locator(".ticket-admin").count();

// ── iPhone ──
const m = await administration("iphone", { width: 390, height: 844 });
await m.goto(`${URL}/admin#/moka/tickets`);
await m.locator(".ticket-admin").first().waitFor({ timeout: 15000 });
r.debordementIphone = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
await m.screenshot({ path: `${sortie}/ta03-iphone.png`, fullPage: true });
await b.close();

console.log(JSON.stringify({ ...r, erreurs }, null, 2));
const ok =
  r.serveurs.length === 2 &&
  /^Lionel.*2 tickets.*10,00 €$/.test(r.serveurs[0]) &&
  /^Léa.*1 ticket.*3,50 €$/.test(r.serveurs[1]) &&
  r.tous === 3 &&
  r.lea === 1 &&
  /1 ticket sur 3/.test(r.totauxLea) &&
  /^Ticket n° \d+$/.test(r.titre) &&
  /encaissé par Léa/.test(r.fiche) &&
  /Cortado/.test(r.fiche) &&
  /Carte bancaire/.test(r.fiche) &&
  /empreinte [0-9a-f]{16}/.test(r.fiche) &&
  r.lionel === 2 &&
  r.apresMenu === 3 &&
  r.debordementIphone <= 0 &&
  !erreurs.length;
if (!ok) process.exit(1);
