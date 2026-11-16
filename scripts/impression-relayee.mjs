// Impression relayée par une dalle (backlog n° 5, 16 novembre 2026) : l'Oxhoo série de la dalle est dans la
// liste de l'établissement ; l'iPad, qui ne joint pas son port, la choisit pour ses tickets : son essai et
// le tiroir d'une vente en espèces sortent sur le port série de la dalle, qui relaie d'office. Une
// imprimante de la dalle dont le port n'est pas choisi : l'iPad montre l'aperçu et l'erreur de la dalle.
// Usage : serveur local vierge (apps/caisse : node scripts/serveur-local.mjs 4180), puis
//         URL=http://localhost:4180 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/impression-relayee.mjs [dossier-captures]
import { chromium } from "playwright";
import { choisirImprimantes, declarerImprimantes, ongletReglages } from "./imprimantes-e2e.mjs";
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

// ── iPad, avant toute imprimante : rien à choisir ──
const ci = await b.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true });
await ci.addInitScript(() => delete Navigator.prototype.serial);
const ipad = await ci.newPage();
ipad.on("pageerror", (e) => erreurs.push(`ipad : ${e.message}`));
const clicIpad = await connexion(ipad, codeIpad, "Rattacher l'iPad");
r.ipadSansImprimante = (await ipad.locator(".bandeau-info", { hasText: "Caisse sans imprimante" }).count()) === 1;

// ── Dalle : l'Oxhoo de son port COM dans la liste, et une seconde sans port ──
const cd = await b.newContext({ viewport: { width: 1366, height: 768 } });
await cd.addInitScript(simulerPorts);
const p = await cd.newPage();
p.on("pageerror", (e) => erreurs.push(`dalle : ${e.message}`));
await connexion(p, code, "Rattacher l'iPad");
await reglages(p);
await declarerImprimantes(p, [
  { nom: "Oxhoo bar", type: "serie", dalle: "Dalle bar" },
  { nom: "Oxhoo cave", type: "serie", dalle: "Dalle bar" },
]);
await ongletReglages(p, "Cet appareil");
const bloc = p.locator("fieldset", { has: p.locator("legend", { hasText: /^Imprimantes portées par/ }) });
await bloc.getByRole("button", { name: "Choisir le port" }).first().click();
await bloc.locator(".succes", { hasText: "Port choisi" }).waitFor();
await choisirImprimantes(p, "Oxhoo bar");
await p.screenshot({ path: `${sortie}/ir01-dalle-relais.png` });

// ── iPad : choisit l'Oxhoo de la dalle, essai ──
await ipad.reload();
await ipad.locator(".carte-personne", { hasText: "Lionel" }).click();
for (const x of "1234") await ipad.locator(".pave .touche", { hasText: new RegExp(`^${x}$`) }).last().click();
const plusTard = ipad.getByRole("button", { name: "Plus tard", exact: true });
await plusTard.waitFor({ timeout: 3000 }).then(() => plusTard.click()).catch(() => undefined);
await reglages(ipad);
await ongletReglages(ipad, "Cet appareil");
const choix = ipad.getByLabel("Imprimante des tickets", { exact: true }).locator("option", { hasText: /^Oxhoo bar/ });
await choix.waitFor({ state: "attached" });
r.choix = await texte(choix);
await choisirImprimantes(ipad, "Oxhoo bar", "Oxhoo cave");
await ipad.getByRole("button", { name: "Imprimer un essai", exact: true }).first().click();
await ipad.screenshot({ path: `${sortie}/ir02-ipad-dalle.png` });
let w = await attendreEcriture(p, 1);
r.essai = { ecrit: w.length === 1, test: w[0]?.toString("latin1").includes("Test") ?? false, coupe: [...(w[0] ?? [])].slice(-3).join(" ") };
r.ipadSansApercu = (await ipad.locator(".apercu-recu").count()) === 0;
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

// ── Addition sur l'Oxhoo cave, dont la dalle n'a pas choisi le port : aperçu et erreur sur l'iPad ──
await reglages(ipad);
await ongletReglages(ipad, "Cet appareil");
await ipad.getByRole("button", { name: "Imprimer une addition d'essai" }).click();
await ipad.locator(".apercu-recu").first().waitFor({ timeout: 15000 });
r.erreur = await texte(ipad.getByRole("dialog").last());
await ipad.screenshot({ path: `${sortie}/ir03-ipad-erreur.png` });
await b.close();

console.log(JSON.stringify({ ...r, erreur: r.erreur.slice(0, 300), erreurs }, null, 2));
const ok =
  r.ipadSansImprimante &&
  /^Oxhoo bar \(série\)$/.test(r.choix) &&
  r.essai.ecrit &&
  r.essai.test &&
  r.essai.coupe === "29 86 0" &&
  r.ipadSansApercu &&
  r.ipadBandeauParti &&
  r.tiroir.length === 1 &&
  r.tiroir[0] === "27 64 27 116 19 27 112 0 25 250" &&
  /Dalle bar : Port COM de « Oxhoo cave » pas encore choisi/.test(r.erreur) &&
  !erreurs.length;
if (!ok) process.exit(1);
