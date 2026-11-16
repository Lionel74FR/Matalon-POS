// Impression relayée par une dalle (backlog n° 5, 16 novembre 2026) : l'iPad, qui ne joint pas l'Oxhoo
// série de la dalle, lui confie ses reçus par le serveur. Sans dalle relais, rien n'apparaît sur l'iPad
// (Moka inchangé) ; la dalle coche « Imprimer aussi pour les iPad et iPhone » ; l'iPad la choisit, son
// essai et le tiroir d'une vente en espèces sortent sur le port série de la dalle ; une dalle qui
// n'imprime plus pour les autres : l'iPad montre l'aperçu et l'erreur.
// Usage : serveur local vierge (apps/caisse : node scripts/serveur-local.mjs 4180), puis
//         URL=http://localhost:4180 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/impression-relayee.mjs [dossier-captures]
import { chromium } from "playwright";
import { preparerServeur } from "./preparer-caisse.mjs";

const URL = process.env.URL ?? "http://localhost:4180";
const sortie = process.argv[2] ?? "captures";
const { code, appel } = await preparerServeur(URL, "Dalle bar");
const { code: codeIpad } = await appel("POST", "/etablissements/moka/codes", { nomCaisse: "iPad salle" });
const erreurs = [];
const b = await chromium.launch();
const texte = async (loc) => ((await loc.textContent()) ?? "").replace(/[\s  ]+/g, " ").trim();
const r = {};

/** Port série simulé : chaque port note ses ouvertures, signaux et octets dans window.__serie. */
function simulerPorts() {
  const journal = (window.__serie = []);
  const port = (nom) => ({
    nom,
    async open(o) {
      journal.push({ nom, quoi: "open", o });
    },
    async close() {
      journal.push({ nom, quoi: "close" });
    },
    async setSignals(s) {
      journal.push({ nom, quoi: "signals", s });
    },
    get writable() {
      return new WritableStream({ write: (c) => void journal.push({ nom, quoi: "write", octets: Array.from(c) }) });
    },
    getInfo: () => ({}),
  });
  const tous = [port("COM1"), port("COM2")];
  const autorises = [];
  Object.defineProperty(navigator, "serial", {
    configurable: true,
    value: {
      getPorts: async () => [...autorises],
      // La fenêtre de Chrome : la personne choisit COM2.
      requestPort: async () => {
        if (!autorises.includes(tous[1])) autorises.push(tous[1]);
        return tous[1];
      },
    },
  });
}
const connexion = async (p, codeRattachement, bouton) => {
  const clic = (n) => p.getByRole("button", { name: n, exact: true }).first().click();
  await p.goto(URL);
  await p.locator(".champ-code input").fill(codeRattachement);
  await clic(bouton);
  await clic("Configurer plus tard");
  await p.locator(".carte-personne", { hasText: "Lionel" }).click();
  for (const x of "1234") await p.locator(".pave .touche", { hasText: new RegExp(`^${x}$`) }).last().click();
  await clic("Plus tard");
  await p.locator(".puce-synchro.synchronise").waitFor({ timeout: 20000 });
  return clic;
};
const reglages = async (p) => {
  await p.getByRole("button", { name: /^Menu/ }).click();
  await p.getByRole("menuitem", { name: "Réglages" }).click();
  await p.locator(".reglages").waitFor();
};

const ecritures = async (p) => (await p.evaluate(() => window.__serie)).filter((x) => x.quoi === "write").map((x) => Buffer.from(x.octets));
const attendreEcriture = async (p, n) => {
  for (let i = 0; i < 100 && (await ecritures(p)).length < n; i++) await p.waitForTimeout(100);
  return ecritures(p);
};

// ── iPad, avant toute dalle relais : rien de nouveau dans les Réglages ──
const ci = await b.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true });
await ci.addInitScript(() => delete Navigator.prototype.serial);
const ipad = await ci.newPage();
ipad.on("pageerror", (e) => erreurs.push(`ipad : ${e.message}`));
const clicIpad = await connexion(ipad, codeIpad, "Rattacher l'iPad");
await reglages(ipad);
await ipad.waitForTimeout(500);
r.ipadSansDalle = (await ipad.getByText("Imprimer sur une dalle").count()) === 0;
await ipad.keyboard.press("Escape");

// ── Dalle : imprimante série, relais pour les iPad ──
const cd = await b.newContext({ viewport: { width: 1366, height: 768 } });
await cd.addInitScript(simulerPorts);
const p = await cd.newPage();
p.on("pageerror", (e) => erreurs.push(`dalle : ${e.message}`));
await connexion(p, code, "Rattacher l'iPad");
await reglages(p);
const bloc = p.locator("fieldset", { hasText: "Imprimante série (port COM)" });
await bloc.getByRole("button", { name: "Utiliser une imprimante série" }).click();
await bloc.locator(".imprimante-serie-etat").waitFor();
await bloc.getByLabel(/Imprimer aussi pour les iPad et iPhone/).click();
await bloc.locator(".succes", { hasText: "imprime aussi pour les iPad" }).waitFor();
await p.screenshot({ path: `${sortie}/ir01-dalle-relais.png` });

// ── iPad : choisit la dalle, essai ──
await ipad.reload();
await ipad.locator(".carte-personne", { hasText: "Lionel" }).click();
for (const x of "1234") await ipad.locator(".pave .touche", { hasText: new RegExp(`^${x}$`) }).last().click();
const plusTard = ipad.getByRole("button", { name: "Plus tard", exact: true });
await plusTard.waitFor({ timeout: 3000 }).then(() => plusTard.click()).catch(() => undefined);
await reglages(ipad);
const dalle = ipad.locator("fieldset", { hasText: "Imprimer sur une dalle" });
await dalle.getByRole("radio", { name: /Dalle bar/ }).waitFor();
r.choix = await texte(dalle.getByRole("radio", { name: /Dalle bar/ }));
await dalle.getByRole("radio", { name: /Dalle bar/ }).click();
await dalle.getByRole("button", { name: "Imprimer un essai sur la dalle" }).click();
await ipad.screenshot({ path: `${sortie}/ir02-ipad-dalle.png` });
let w = await attendreEcriture(p, 1);
r.essai = { ecrit: w.length === 1, test: w[0]?.toString("latin1").includes("Test") ?? false, coupe: [...(w[0] ?? [])].slice(-3).join(" ") };
r.ipadSansApercu = (await ipad.locator(".apercu-recu").count()) === 0;
await ipad.keyboard.press("Escape");
r.ipadBandeauParti = (await ipad.locator(".bandeau-info", { hasText: "Caisse sans imprimante" }).count()) === 0;

// ── Vente en espèces sur l'iPad : le tiroir de la dalle s'ouvre ──
await p.evaluate(() => (window.__serie.length = 0));
await ipad.getByRole("tab", { name: "Salle" }).click();
await clicIpad("Vente Directe");
await ipad.locator(".tuile", { hasText: "Cappuccino" }).first().click();
await clicIpad("Encaisser");
await ipad.locator(".mode", { hasText: "Espèces" }).click();
await ipad.getByRole("button", { name: /^Valider l'encaissement/ }).click();
await clicIpad("Terminé");
w = await attendreEcriture(p, 1);
r.tiroir = w.map((x) => [...x].join(" "));

// ── La dalle n'imprime plus pour les autres : l'iPad montre l'aperçu et l'erreur ──
await bloc.getByLabel(/Imprimer aussi pour les iPad et iPhone/).click();
await bloc.locator(".succes", { hasText: "n'imprime plus que pour elle-même" }).waitFor();
await reglages(ipad);
await ipad.locator("fieldset", { hasText: "Imprimer sur une dalle" }).getByRole("button", { name: "Imprimer un essai sur la dalle" }).click();
await ipad.locator(".apercu-recu").first().waitFor({ timeout: 10000 });
r.erreur = await texte(ipad.getByRole("dialog").last());
await ipad.screenshot({ path: `${sortie}/ir03-ipad-erreur.png` });
await b.close();

console.log(JSON.stringify({ ...r, erreur: r.erreur.slice(0, 300), erreurs }, null, 2));
const ok =
  r.ipadSansDalle &&
  /Dalle bar · en ligne/.test(r.choix) &&
  r.essai.ecrit &&
  r.essai.test &&
  r.essai.coupe === "29 86 0" &&
  r.ipadSansApercu &&
  r.ipadBandeauParti &&
  r.tiroir.length === 1 &&
  r.tiroir[0] === "27 64 27 116 19 27 112 0 25 250" &&
  /n'imprime plus pour les autres appareils/.test(r.erreur) &&
  !erreurs.length;
if (!ok) process.exit(1);
