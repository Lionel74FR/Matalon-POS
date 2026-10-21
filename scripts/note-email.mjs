// Note envoyée par e-mail (lot 1, option du cahier, finie le 21 octobre) : à la fin de l'encaissement, le client
// donne son adresse et reçoit le lien de sa note ; le lien ouvre la note dématérialisée. Depuis l'écran Tickets,
// un duplicata part par e-mail, numéroté. L'adresse n'est conservée nulle part (journal : le canal seulement).
// Usage : serveur local vierge (apps/caisse : node scripts/serveur-local.mjs 4180), puis
//         URL=http://localhost:4180 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/note-email.mjs [dossier-captures]
import { chromium } from "playwright";
import { preparerServeur } from "./preparer-caisse.mjs";

const URL = process.env.URL ?? "http://localhost:4180";
const sortie = process.argv[2] ?? "captures";
const { code } = await preparerServeur(URL, "Comptoir");
const erreurs = [];
const b = await chromium.launch();
const texte = async (loc) => ((await loc.textContent()) ?? "").replace(/[\s  ]+/g, " ").trim();
const courriels = async () => (await (await fetch(`${URL}/__courriels`)).json());
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
await p.locator(".puce-synchro.synchronise").waitFor({ timeout: 20000 });

// Fin d'encaissement : la note par e-mail.
await clic("Vente Directe");
await p.locator(".tuile", { hasText: "Cappuccino" }).first().click();
await clic("Encaisser");
await p.locator(".mode", { hasText: "Carte bancaire" }).click();
await p.getByRole("button", { name: /^Valider l'encaissement/ }).click();
const fin = p.getByRole("dialog", { name: /^Ticket n° 1 encaissé/ });
await fin.getByRole("button", { name: "Par e-mail" }).click();
r.boutonAvant = await fin.getByRole("button", { name: "Envoyer" }).isDisabled();
await fin.getByLabel("E-mail du client").fill("client@exemple.fr");
await p.screenshot({ path: `${sortie}/ne01-fin-encaissement.png` });
await fin.getByRole("button", { name: "Envoyer" }).click();
await fin.locator(".note-email-ok").waitFor({ timeout: 10000 });
r.confirmation = await texte(fin.locator(".note-email-ok"));
await clic("Terminé");
let liste = await courriels();
r.premier = liste.map((c) => `${c.a} · ${c.sujet}`);
const lien = /href="([^"]+\/n#[^"]+)"/.exec(liste[0]?.html ?? "")?.[1];

// Le lien ouvre la note dématérialisée.
const note = await ctx.newPage();
await note.goto(lien);
await note.locator("body", { hasText: "Cappuccino" }).waitFor();
r.note = await texte(note.locator("body"));
await note.screenshot({ path: `${sortie}/ne02-note.png` });
await note.close();

// Duplicata par e-mail depuis l'écran Tickets.
await p.getByRole("tab", { name: "Tickets" }).click();
await p.locator(".tableau-tickets tbody tr").first().click();
await p.getByRole("dialog", { name: /^Ticket n° 1/ }).getByRole("button", { name: "E-mail", exact: true }).click();
const dup = p.getByRole("dialog", { name: "Note n° 1 · duplicata par e-mail" });
await dup.getByLabel("E-mail du client").fill("autre@exemple.fr");
await dup.getByRole("button", { name: "Envoyer" }).click();
await dup.locator(".note-email-ok").waitFor({ timeout: 10000 });
liste = await courriels();
r.deuxieme = liste.slice(1).map((c) => `${c.a} · ${c.sujet}`);
const lienDup = /href="([^"]+\/n#[^"]+)"/.exec(liste[1]?.html ?? "")?.[1];
const note2 = await ctx.newPage();
await note2.goto(lienDup);
await note2.locator("body", { hasText: "Duplicata" }).waitFor();
r.duplicata = await texte(note2.locator(".mention").first());
await note2.close();

// Journal de l'iPad : le canal, jamais l'adresse.
r.journal = await p.evaluate(async () => {
  const db = await new Promise((ok, ko) => {
    const o = indexedDB.open("matalon-pos");
    o.onsuccess = () => ok(o.result);
    o.onerror = () => ko(o.error);
  });
  const evts = await new Promise((ok) => {
    const q = db.transaction("evenements").objectStore("evenements").getAll();
    q.onsuccess = () => ok(q.result);
  });
  return evts.filter((e) => /IMPRESSION_TICKET/.test(e.code)).map((e) => `${e.code} ${JSON.stringify(e.details)}`);
});
await b.close();

console.log(JSON.stringify({ ...r, erreurs }, null, 2));
const ok =
  r.boutonAvant === true &&
  r.confirmation === "Note envoyée à client@exemple.fr." &&
  r.premier.join() === "client@exemple.fr · Votre note Moka · n° 1" &&
  /Cappuccino/.test(r.note) &&
  /4,00/.test(r.note) &&
  r.deuxieme.join() === "autre@exemple.fr · Votre note Moka · n° 1" &&
  r.duplicata === "Duplicata n° 1" &&
  r.journal.some((x) => x === 'IMPRESSION_TICKET {"ticket":1,"canal":"email"}') &&
  r.journal.some((x) => x === 'REIMPRESSION_TICKET {"ticket":1,"duplicata":1,"canal":"email"}') &&
  !r.journal.some((x) => x.includes("@")) &&
  !erreurs.length;
if (!ok) process.exit(1);
