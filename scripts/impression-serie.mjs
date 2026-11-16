// Impression série des caisses du Chardon (backlog n° 4, 15 novembre 2026) : sur une dalle Windows sous
// Chrome (port série simulé : COM1 tireuse, COM2 imprimante Oxhoo), Réglages › Imprimantes de l'établissement (« Oxhoo bar », série sur la dalle), port choisi
// COM2 ; l'essai part en ESC/POS (ESC @, PC858, €, coupe GS V 0) après DTR et RTS baissés ; une vente
// en espèces ouvre le tiroir sur ce port ; un duplicata s'y imprime. Sur l'iPad (pas de port série), le
// réglage n'apparaît pas et rien ne change.
// Usage : serveur local vierge (apps/caisse : node scripts/serveur-local.mjs 4180), puis
//         URL=http://localhost:4180 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/impression-serie.mjs [dossier-captures]
import { chromium } from "playwright";
import { choisirImprimantes, declarerImprimantes, ongletReglages } from "./imprimantes-e2e.mjs";
import { preparerServeur } from "./preparer-caisse.mjs";

const URL = process.env.URL ?? "http://localhost:4180";
const sortie = process.argv[2] ?? "captures";
const { code, appel } = await preparerServeur(URL, "Dalle 1");
const { code: codeIpad } = await appel("POST", "/etablissements/moka/codes", { nomCaisse: "iPad" });
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

// ── iPad : pas de port série, pas de réglage ──
const ci = await b.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true });
await ci.addInitScript(() => delete Navigator.prototype.serial);
const ipad = await ci.newPage();
ipad.on("pageerror", (e) => erreurs.push(`ipad : ${e.message}`));
await connexion(ipad, codeIpad, "Rattacher l'iPad");
await reglages(ipad);
r.ipadSansReglage = (await ipad.getByText(/^Imprimantes portées par/).count()) === 0;
r.ipadBandeau = (await ipad.locator(".bandeau-info", { hasText: "Caisse sans imprimante" }).count()) === 1;

// ── Dalle Windows sous Chrome ──
const cd = await b.newContext({ viewport: { width: 1366, height: 768 } });
await cd.addInitScript(simulerPorts);
const p = await cd.newPage();
p.on("pageerror", (e) => erreurs.push(`dalle : ${e.message}`));
const clic = await connexion(p, code, "Rattacher l'iPad");
await reglages(p);
await declarerImprimantes(p, [{ nom: "Oxhoo bar", type: "serie", dalle: "Dalle 1" }]);
await ongletReglages(p, "Cet appareil");
const bloc = p.locator("fieldset", { has: p.locator("legend", { hasText: /^Imprimantes portées par/ }) });
await bloc.getByRole("button", { name: "Choisir le port" }).click();
await bloc.locator(".succes", { hasText: "Port choisi" }).waitFor();
r.etat = await texte(bloc.locator(".sous-titre-reglages").first());
await choisirImprimantes(p, "Oxhoo bar");
r.bandeauParti = await p.locator(".bandeau-info", { hasText: "Caisse sans imprimante" }).waitFor({ state: "detached", timeout: 3000 }).then(() => true, () => false);
await bloc.getByRole("button", { name: "Imprimer un essai" }).click();
await bloc.locator(".succes", { hasText: "Essai envoyé" }).waitFor();
await p.screenshot({ path: `${sortie}/is01-reglages.png` });
const journal = async () => await p.evaluate(() => window.__serie);
let j = await journal();
const essai = j.filter((x) => x.quoi === "write").flatMap((x) => x.octets);
r.essai = {
  port: [...new Set(j.map((x) => x.nom))],
  ordre: j.map((x) => x.quoi).join(","),
  ouverture: j[0]?.o,
  signaux: j[1]?.s,
  entete: essai.slice(0, 5),
  euro: essai.includes(0xd5),
  eAigu: essai.includes(0x82),
  coupe: essai.slice(-3),
};

// ── Vente en espèces : tiroir sur le port série ──
await p.evaluate(() => (window.__serie.length = 0));
await p.getByRole("tab", { name: "Salle" }).click();
await clic("Vente Directe");
await p.locator(".tuile", { hasText: "Cappuccino" }).first().click();
await clic("Encaisser");
await p.locator(".mode", { hasText: "Espèces" }).click();
await p.getByRole("button", { name: /^Valider l'encaissement/ }).click();
await clic("Terminé");
await p.waitForTimeout(300);
j = await journal();
r.tiroir = j.filter((x) => x.quoi === "write").map((x) => x.octets.join(" "));

// ── Duplicata sur le port série ──
await p.evaluate(() => (window.__serie.length = 0));
await p.getByRole("tab", { name: "Tickets" }).click();
await p.locator(".tableau-tickets tbody tr").first().click();
await p.getByRole("dialog", { name: /^Ticket n° 1/ }).getByRole("button", { name: "Imprimer un duplicata" }).click();
await p.waitForTimeout(300);
j = await journal();
const dup = Buffer.from(j.filter((x) => x.quoi === "write").flatMap((x) => x.octets)).toString("latin1");
r.duplicata = { cappuccino: dup.includes("Cappuccino"), mention: /Duplicata/i.test(dup), apercu: (await p.locator(".apercu-recu").count()) === 0 };
await b.close();

console.log(JSON.stringify({ ...r, erreurs }, null, 2));
const ok =
  r.ipadSansReglage &&
  r.ipadBandeau &&
  /Oxhoo bar · série · 9600 bauds/.test(r.etat) &&
  r.bandeauParti &&
  JSON.stringify(r.essai.port) === JSON.stringify(["COM2"]) &&
  r.essai.ordre === "open,signals,write,close" &&
  JSON.stringify(r.essai.ouverture) === JSON.stringify({ baudRate: 9600, dataBits: 8, stopBits: 1, parity: "none", flowControl: "none" }) &&
  JSON.stringify(r.essai.signaux) === JSON.stringify({ dataTerminalReady: false, requestToSend: false }) &&
  JSON.stringify(r.essai.entete) === JSON.stringify([27, 64, 27, 116, 19]) &&
  r.essai.euro &&
  r.essai.eAigu &&
  JSON.stringify(r.essai.coupe) === JSON.stringify([29, 86, 0]) &&
  r.tiroir.length === 1 &&
  r.tiroir[0] === "27 64 27 116 19 27 112 0 25 250" &&
  r.duplicata.cappuccino &&
  r.duplicata.mention &&
  r.duplicata.apercu &&
  !erreurs.length;
if (!ok) process.exit(1);
