// Moments de la journée (demande de Lionel du 20 octobre) : l'administration les crée depuis les statistiques
// (proposition Matin, Après-midi, Soir ; un chevauchement est refusé avant l'envoi), l'iPad vend, et la carte
// « CA par moment » range la vente dans le moment de son heure, sur l'administration comme sur la caisse.
// Usage : serveur local vierge (apps/caisse : node scripts/serveur-local.mjs 4180), puis
//         URL=http://localhost:4180 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/moments.mjs [dossier-captures]
import { chromium } from "playwright";
import { preparerServeur } from "./preparer-caisse.mjs";

const URL = process.env.URL ?? "http://localhost:4180";
const sortie = process.argv[2] ?? "captures";
const { code, cookie } = await preparerServeur(URL, "Comptoir");
const [nomCookie, valeurCookie] = cookie.split("=");
const erreurs = [];
const b = await chromium.launch();
const texte = async (loc) => ((await loc.textContent()) ?? "").replace(/\s+/g, " ").trim();
const r = {};

// Moment attendu pour une vente faite maintenant (heure de Paris), d'après la proposition enregistrée.
const heure = Number(
  new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "numeric", hourCycle: "h23" }).formatToParts(new Date()).find((x) => x.type === "hour").value,
);
const attendu = heure >= 8 && heure < 12 ? "Matin" : heure >= 12 && heure < 18 ? "Après-midi" : heure >= 18 || heure < 3 ? "Soir" : "Hors moments";

async function administration(nom, viewport) {
  const c = await b.newContext({ viewport, hasTouch: nom === "iphone" });
  await c.addCookies([{ name: nomCookie, value: valeurCookie, url: `${URL}/api/admin` }]);
  const a = await c.newPage();
  a.on("pageerror", (e) => erreurs.push(`${nom} : ${e.message}`));
  return a;
}

// ── Administration : définir les moments ──
const a = await administration("admin", { width: 1280, height: 860 });
await a.goto(`${URL}/admin#/moka/statistiques`);
const carte = a.locator(".stat-moments");
await carte.waitFor({ timeout: 15000 });
r.vide = await texte(carte);
await a.getByRole("button", { name: "Définir les moments" }).click();
const modale = a.getByRole("dialog", { name: "Moments de la journée" });
await modale.waitFor();
r.proposition = await modale.getByLabel("Nom du moment").evaluateAll((l) => l.map((x) => x.value));
// Le Soir commencé à 17:00 chevauche l'Après-midi : refusé avant l'envoi.
await modale.getByLabel("Soir : début").fill("17:00");
r.chevauchement = await texte(modale.locator(".erreur"));
r.enregistrerBloque = await modale.getByRole("button", { name: "Enregistrer les moments" }).isDisabled();
await modale.getByLabel("Soir : début").fill("18:00");
await a.screenshot({ path: `${sortie}/mo01-moments.png` });
await modale.getByRole("button", { name: "Enregistrer les moments" }).click();
await modale.waitFor({ state: "detached" });
await carte.locator("tbody tr").first().waitFor();
r.lignes = await carte.locator("tbody tr td:first-child").evaluateAll((l) => l.map((x) => x.textContent.replace(/[\s\u00a0\u202f]+/g, " ").trim()));

// ── iPad : un cappuccino au comptoir ──
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
await clic("Vente Directe");
await p.locator(".tuile", { hasText: "Cappuccino" }).first().click();
await clic("Encaisser");
await p.locator(".mode", { hasText: "Carte bancaire" }).click();
await p.getByRole("button", { name: /^Valider l'encaissement/ }).click();
await clic("Terminé");

// ── Administration : la vente arrive dans son moment, en direct ──
// Les montants s'écrivent avec des espaces insécables : on compare un texte aux espaces ramenés à l'ordinaire.
const ligneDe = (page, nom) =>
  page.evaluate(
    (nom) =>
      [...document.querySelectorAll(".stat-moments tbody tr")].map((tr) => tr.textContent.replace(/[\s\u00a0\u202f]+/g, " ").trim()).find((t) => t.startsWith(nom)) ?? "",
    nom,
  );
await a.waitForFunction(
  (nom) => [...document.querySelectorAll(".stat-moments tbody tr")].some((tr) => tr.textContent.replace(/[\s\u00a0\u202f]+/g, " ").startsWith(nom) && /4,00 €/.test(tr.textContent.replace(/[\s\u00a0\u202f]+/g, " "))),
  attendu,
  { timeout: 30000 },
).catch(async (e) => {
  console.log(JSON.stringify({ attendu, lignes: await a.evaluate(() => [...document.querySelectorAll(".stat-moments tbody tr")].map((tr) => [...tr.textContent].map((c) => (c.charCodeAt(0) > 126 ? `<${c.charCodeAt(0).toString(16)}>` : c)).join(""))) }));
  throw e;
});
r.ligneAttendue = await ligneDe(a, attendu);
await a.screenshot({ path: `${sortie}/mo02-ca-par-moment.png`, fullPage: true });

// ── Caisse : même carte, sans bouton de modification ──
await p.getByRole("button", { name: /^Menu/ }).click().then(() => p.getByRole("menuitem", { name: "Stats" }).click());
await p.locator(".stat-moments tbody tr").first().waitFor({ timeout: 15000 });
r.caisse = await ligneDe(p, attendu);
r.caisseModifier = await p.locator(".stat-moments").getByRole("button").count();

// ── iPhone : éditeur sans débordement ──
const m = await administration("iphone", { width: 390, height: 844 });
await m.goto(`${URL}/admin#/moka/statistiques`);
await m.getByRole("button", { name: "Modifier les moments" }).click();
await m.getByRole("dialog", { name: "Moments de la journée" }).waitFor();
r.debordementIphone = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
await m.screenshot({ path: `${sortie}/mo03-iphone.png` });
await b.close();

console.log(JSON.stringify({ attendu, ...r, erreurs }, null, 2));
const ok =
  /Aucun moment défini/.test(r.vide) &&
  r.proposition.join(",") === "Matin,Après-midi,Soir" &&
  r.chevauchement === "« Après-midi » et « Soir » se chevauchent." &&
  r.enregistrerBloque &&
  r.lignes.length === 3 &&
  /^Matin\s*8 h – 12 h$/.test(r.lignes[0]) &&
  /^Soir\s*18 h – 3 h$/.test(r.lignes[2]) &&
  /4,00 €/.test(r.ligneAttendue) &&
  /100 %/.test(r.ligneAttendue) &&
  /4,00 €/.test(r.caisse) &&
  r.caisseModifier === 0 &&
  r.debordementIphone <= 0 &&
  !erreurs.length;
if (!ok) process.exit(1);
