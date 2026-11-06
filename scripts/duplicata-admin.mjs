// Duplicata de la note depuis l'administration (demande de Lionel du 6 novembre 2026) : l'iPad encaisse un
// cappuccino et envoie un duplicata par e-mail (n° 1) ; dans l'administration › Tickets, le détail du ticket
// ouvre la note en PDF (n° 2, fenêtre d'impression ouverte d'elle-même) puis l'envoie par e-mail (n° 3) ;
// l'iPad reprend la suite (n° 4). L'adresse n'est gardée nulle part. Captures ordinateur et iPhone.
// Usage : serveur local vierge (apps/caisse : node scripts/serveur-local.mjs 4180), puis
//         URL=http://localhost:4180 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/duplicata-admin.mjs [dossier-captures]
import { chromium } from "playwright";
import { preparerServeur, rubriqueAdmin } from "./preparer-caisse.mjs";

const URL = process.env.URL ?? "http://localhost:4180";
const sortie = process.argv[2] ?? "captures";
const { code, cookie } = await preparerServeur(URL, "Comptoir");
const [nomCookie, valeurCookie] = cookie.split("=");
const erreurs = [];
const b = await chromium.launch();
const texte = async (loc) => ((await loc.textContent()) ?? "").replace(/[\s  ]+/g, " ").trim();
const courriels = async () => await (await fetch(`${URL}/__courriels`)).json();
const lienDe = (c) => /href="([^"]+\/n#[^"]+)"/.exec(c?.html ?? "")?.[1];
const r = {};

// ── iPad : un cappuccino, puis un duplicata par e-mail (n° 1) ──
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
await clic("Vente Directe");
await p.locator(".tuile", { hasText: "Cappuccino" }).first().click();
await clic("Encaisser");
await p.locator(".mode", { hasText: "Carte bancaire" }).click();
await p.getByRole("button", { name: /^Valider l'encaissement/ }).click();
await clic("Terminé");
const duplicataIpad = async (email) => {
  await p.getByRole("tab", { name: "Tickets" }).click();
  await p.locator(".tableau-tickets tbody tr").first().click();
  await p.getByRole("dialog", { name: /^Ticket n° 1/ }).getByRole("button", { name: "E-mail", exact: true }).click();
  const dup = p.getByRole("dialog", { name: "Note n° 1 · duplicata par e-mail" });
  await dup.getByLabel("E-mail du client").fill(email);
  await dup.getByRole("button", { name: "Envoyer" }).click();
  await dup.locator(".note-email-ok").waitFor({ timeout: 10000 });
  await p.keyboard.press("Escape");
  await p.keyboard.press("Escape");
};
await duplicataIpad("ipad@exemple.fr");
await p.locator(".puce-synchro").click();
await p.locator(".puce-synchro.synchronise").waitFor({ timeout: 20000 });
await p.waitForTimeout(1000);

// ── Administration › Tickets › n° 1 ──
const ca = await b.newContext({ viewport: { width: 1440, height: 900 } });
await ca.addCookies([{ name: nomCookie, value: valeurCookie, url: `${URL}/api/admin` }]);
// La fenêtre d'impression du navigateur est remplacée par un témoin.
await ca.addInitScript(() => {
  window.print = () => void (window.__imprime = true);
});
const a = await ca.newPage();
a.on("pageerror", (e) => erreurs.push(`admin : ${e.message}`));
await a.goto(`${URL}/admin#/moka/accueil`);
await rubriqueAdmin(a, "Tickets");
await a.locator(".ticket-admin").first().click();
const detail = a.getByRole("dialog", { name: "Ticket n° 1" });
await detail.getByRole("button", { name: "Note en PDF" }).waitFor();

// Note en PDF : nouvel onglet, duplicata n° 2, impression lancée.
const [onglet] = await Promise.all([ca.waitForEvent("page"), detail.getByRole("button", { name: "Note en PDF" }).click()]);
await onglet.waitForURL(/\/n\?pdf=1#/);
await onglet.locator(".mention", { hasText: "Duplicata" }).waitFor();
r.pdf = { mention: await texte(onglet.locator(".mention").first()), lignes: (await texte(onglet.locator("body"))).includes("Cappuccino") };
await onglet.waitForFunction(() => window.__imprime === true, null, { timeout: 5000 });
r.pdf.impression = true;
await onglet.screenshot({ path: `${sortie}/da02-pdf.png` });
await onglet.close();
r.messagePdf = await texte(detail.locator(".note-admin [role=status]"));

// Par e-mail : n° 3.
await detail.getByRole("button", { name: "Envoyer par e-mail" }).click();
r.boutonAvant = await detail.getByRole("button", { name: "Envoyer", exact: true }).isDisabled();
await detail.getByLabel("E-mail du client").fill("client@exemple.fr");
await a.screenshot({ path: `${sortie}/da01-admin.png` });
await detail.getByRole("button", { name: "Envoyer", exact: true }).click();
await detail.locator(".note-admin .succes", { hasText: "envoyé" }).waitFor({ timeout: 10000 });
r.messageEmail = await texte(detail.locator(".note-admin [role=status]"));
let liste = await courriels();
r.courriel = liste.at(-1) ? `${liste.at(-1).a} · ${liste.at(-1).sujet}` : null;
const note = await ca.newPage();
await note.goto(lienDe(liste.at(-1)));
await note.locator(".mention", { hasText: "Duplicata" }).waitFor();
r.noteEmail = await texte(note.locator(".mention").first());
r.sansImpression = await note.evaluate(() => window.__imprime !== true);
await note.close();

// ── Format iPhone : les deux boutons dans l'écran ──
const m = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
await m.addCookies([{ name: nomCookie, value: valeurCookie, url: `${URL}/api/admin` }]);
const mp = await m.newPage();
mp.on("pageerror", (e) => erreurs.push(`iphone : ${e.message}`));
await mp.goto(`${URL}/admin#/moka/tickets`);
await mp.locator(".ticket-admin").first().click();
const boutons = mp.locator(".note-admin-actions");
await boutons.scrollIntoViewIfNeeded();
const boite = await boutons.boundingBox();
r.iphone = !!boite && boite.x >= 0 && boite.x + boite.width <= 391;
r.debordementIphone = await mp.evaluate(() => document.documentElement.scrollWidth - innerWidth);
await mp.screenshot({ path: `${sortie}/da03-iphone.png` });

// ── L'iPad reprend la suite : n° 4 ──
await duplicataIpad("ipad2@exemple.fr");
liste = await courriels();
const note4 = await ctx.newPage();
await note4.goto(lienDe(liste.at(-1)));
await note4.locator(".mention", { hasText: "Duplicata" }).waitFor();
r.ipadEnsuite = await texte(note4.locator(".mention").first());
await note4.close();

// Adresse gardée nulle part : ni dans les réponses de l'administration, ni au journal de l'iPad.
r.journalIpad = await p.evaluate(async () => {
  const db = await new Promise((ok, ko) => {
    const o = indexedDB.open("matalon-pos");
    o.onsuccess = () => ok(o.result);
    o.onerror = () => ko(o.error);
  });
  const evts = await new Promise((ok) => {
    const t = db.transaction("evenements").objectStore("evenements").getAll();
    t.onsuccess = () => ok(t.result);
  });
  return evts.filter((e) => e.code === "REIMPRESSION_TICKET").map((e) => `${e.details.duplicata}:${e.details.canal}`);
});
await b.close();

console.log(JSON.stringify({ ...r, erreurs }, null, 2));
const ok =
  r.pdf.mention === "Duplicata n° 2" &&
  r.pdf.lignes &&
  r.pdf.impression &&
  /Duplicata n° 2 ouvert/.test(r.messagePdf) &&
  r.boutonAvant &&
  r.messageEmail === "Duplicata n° 3 envoyé à client@exemple.fr." &&
  r.courriel === "client@exemple.fr · Votre note Moka · n° 1" &&
  r.noteEmail === "Duplicata n° 3" &&
  r.sansImpression &&
  r.iphone &&
  r.debordementIphone <= 0 &&
  r.ipadEnsuite === "Duplicata n° 4" &&
  JSON.stringify(r.journalIpad) === JSON.stringify(["1:email", "4:email"]) &&
  !erreurs.length;
if (!ok) process.exit(1);
