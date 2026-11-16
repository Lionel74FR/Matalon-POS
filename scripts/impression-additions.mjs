// Additions sur l'imprimante réseau de la salle (backlog n° 5, 16 novembre 2026 : Oxhoo 192.168.1.248 du
// Chardon). Chrome ne joint pas le port 9100 : le script de la dalle (simulé ici, même protocole que
// public/outils/matalon-imprimante-reseau.ps1 sur 127.0.0.1:9181) transmet le ticket ESC/POS. « Oxhoo
// salle » (réseau par la dalle) est dans la liste de l'établissement : la dalle et l'iPad la choisissent
// pour leurs additions ; l'iPad passe par la dalle ; les tickets restent sur l'imprimante série.
// Usage : serveur local vierge (apps/caisse : node scripts/serveur-local.mjs 4180), puis
//         URL=http://localhost:4180 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/impression-additions.mjs [dossier-captures]
import { createServer } from "node:http";
import { chromium } from "playwright";
import { choisirImprimantes, declarerImprimantes, ongletReglages } from "./imprimantes-e2e.mjs";
import { preparerServeur } from "./preparer-caisse.mjs";

const URL = process.env.URL ?? "http://localhost:4180";
const sortie = process.argv[2] ?? "captures";
const { code, appel } = await preparerServeur(URL, "Dalle bar");
const { code: codeIpad } = await appel("POST", "/etablissements/moka/codes", { nomCaisse: "iPad salle" });
const erreurs = [];
const r = {};

// ── Script de la dalle simulé : 127.0.0.1:9181, même réponses que le script PowerShell ──
const envois = [];
const script = createServer((req, res) => {
  const origine = req.headers.origin;
  const entetes = { "Content-Type": "application/json", ...(origine ? { "Access-Control-Allow-Origin": origine, "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Private-Network": "true" } : {}) };
  const [chemin, requete] = req.url.split("?");
  if (req.method === "OPTIONS") return res.writeHead(204, entetes).end();
  if (req.method === "GET" && chemin === "/etat") return res.writeHead(200, entetes).end('{"ok":true,"version":1}');
  const morceaux = [];
  req.on("data", (c) => morceaux.push(c));
  req.on("end", () => {
    const p = new URLSearchParams(requete);
    envois.push({ ip: p.get("ip"), port: p.get("port"), octets: Buffer.concat(morceaux) });
    res.writeHead(200, entetes).end('{"ok":true}');
  });
});
await new Promise((ok) => script.listen(9181, "127.0.0.1", ok));
const attendreEnvois = async (n) => {
  for (let i = 0; i < 100 && envois.length < n; i++) await new Promise((ok) => setTimeout(ok, 100));
  return envois.length;
};

const b = await chromium.launch();
const texte = async (loc) => ((await loc.textContent()) ?? "").replace(/[\s  ]+/g, " ").trim();
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

const table = (p, n) => p.getByRole("button", { name: new RegExp(`^Table ${n},`) });
const ajouter = (p, article) => p.locator(".tuile", { has: p.locator(".tuile-nom", { hasText: new RegExp(`^${article}$`) }) }).first().click();
const addition = async (p, n) => {
  await p.getByRole("tab", { name: "Salle" }).click();
  await table(p, n).click();
  await ajouter(p, "Cappuccino");
  await p.getByRole("button", { name: "Addition", exact: true }).click();
};

// ── iPad, avant toute imprimante : rien à choisir ──
const ci = await b.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true });
await ci.addInitScript(() => delete Navigator.prototype.serial);
const ipad = await ci.newPage();
ipad.on("pageerror", (e) => erreurs.push(`ipad : ${e.message}`));
await connexion(ipad, codeIpad, "Rattacher l'iPad");
r.ipadSansReglage = (await ipad.locator(".bandeau-info", { hasText: "Caisse sans imprimante" }).count()) === 1;

// ── Dalle : Oxhoo série et Oxhoo réseau de la salle, envoyée par son script ──
const cd = await b.newContext({ viewport: { width: 1366, height: 768 } });
await cd.addInitScript(simulerPorts);
const p = await cd.newPage();
p.on("pageerror", (e) => erreurs.push(`dalle : ${e.message}`));
await connexion(p, code, "Rattacher l'iPad");
await reglages(p);
await declarerImprimantes(p, [
  { nom: "Oxhoo bar", type: "serie", dalle: "Dalle bar" },
  { nom: "Oxhoo salle", type: "reseau", adresse: "192.168.1.248", dalle: "Dalle bar" },
]);
await p.screenshot({ path: `${sortie}/ia00-onglet-imprimantes.png` });
await ongletReglages(p, "Cet appareil");
const bloc = p.locator("fieldset", { has: p.locator("legend", { hasText: /^Imprimantes portées par/ }) });
await bloc.getByRole("button", { name: "Choisir le port" }).click();
await bloc.locator(".succes", { hasText: "Port choisi" }).waitFor();
await choisirImprimantes(p, "Oxhoo bar", "Oxhoo salle");
const salle = bloc.locator(".imprimante-portee", { hasText: "Oxhoo salle" });
await salle.getByRole("button", { name: "Vérifier le script" }).click();
r.verification = await texte(bloc.locator(".succes"));
await salle.getByRole("button", { name: "Imprimer un essai" }).click();
await attendreEnvois(1);
await p.screenshot({ path: `${sortie}/ia01-dalle-additions.png` });
r.essai = { ip: envois[0]?.ip, port: envois[0]?.port, debut: [...(envois[0]?.octets ?? [])].slice(0, 2).join(" "), test: envois[0]?.octets.toString("latin1").includes("Test") ?? false, coupe: [...(envois[0]?.octets ?? [])].slice(-3).join(" ") };

// ── Addition d'une table sur la dalle : par le script, rien sur l'imprimante série ──
await p.evaluate(() => (window.__serie.length = 0));
await p.keyboard.press("Escape");
await addition(p, 3);
await attendreEnvois(2);
r.additionDalle = { ip: envois[1]?.ip, cappuccino: envois[1]?.octets.toString("latin1").includes("Cappuccino") ?? false, serie: (await p.evaluate(() => window.__serie.filter((x) => x.quoi === "write").length)) };
r.dalleSansApercu = (await p.locator(".apercu-recu").count()) === 0;

// ── iPad : additions sur l'Oxhoo de la salle, par la dalle ──
await ipad.reload();
await ipad.locator(".carte-personne", { hasText: "Lionel" }).click();
for (const x of "1234") await ipad.locator(".pave .touche", { hasText: new RegExp(`^${x}$`) }).last().click();
const plusTard = ipad.getByRole("button", { name: "Plus tard", exact: true });
await plusTard.waitFor({ timeout: 3000 }).then(() => plusTard.click()).catch(() => undefined);
await reglages(ipad);
await choisirImprimantes(ipad, "Oxhoo bar", "Oxhoo salle");
r.ipadScriptCache = (await ipad.getByRole("button", { name: "Vérifier le script" }).count()) === 0;
await ipad.screenshot({ path: `${sortie}/ia02-ipad-additions.png` });
await ipad.keyboard.press("Escape");
await addition(ipad, 5);
await attendreEnvois(3);
r.additionIpad = { ip: envois[2]?.ip, cappuccino: envois[2]?.octets.toString("latin1").includes("Cappuccino") ?? false };
r.ipadSansApercu = (await ipad.locator(".apercu-recu").count()) === 0;
await b.close();
script.close();

console.log(JSON.stringify({ ...r, erreurs }, null, 2));
const ok =
  r.ipadSansReglage &&
  /Script lancé sur cet ordinateur/.test(r.verification) &&
  r.essai.ip === "192.168.1.248" &&
  r.essai.port === "9100" &&
  r.essai.debut === "27 64" &&
  r.essai.test &&
  r.essai.coupe === "29 86 0" &&
  r.additionDalle.ip === "192.168.1.248" &&
  r.additionDalle.cappuccino &&
  r.additionDalle.serie === 0 &&
  r.dalleSansApercu &&
  r.ipadScriptCache &&
  r.additionIpad.ip === "192.168.1.248" &&
  r.additionIpad.cappuccino &&
  r.ipadSansApercu &&
  !erreurs.length;
if (!ok) process.exit(1);
