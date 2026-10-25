// Panneau latéral et confirmations de l'administration (refonte du 25 octobre 2026) : une personne
// s'ajoute et se modifie dans un panneau (nouveau code PIN sans fenêtre du navigateur), fermer avec
// des changements demande de les abandonner ; un client s'ajoute de même ; un appareil se rattache
// depuis le panneau (code affiché) ; révoquer demande une confirmation dans la page, qu'on peut
// refuser. Captures ordinateur et iPhone (le panneau prend tout l'écran).
// Usage : serveur local vierge (apps/caisse : node scripts/serveur-local.mjs 4180), puis
//         URL=http://localhost:4180 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/admin-panneaux.mjs [dossier-captures]
import { chromium } from "playwright";
import { preparerServeur } from "./preparer-caisse.mjs";

const URL = process.env.URL ?? "http://localhost:4180";
const sortie = process.argv[2] ?? "captures";
const { cookie, appel } = await preparerServeur(URL, "Comptoir");
const [nomCookie, valeurCookie] = cookie.split("=");
const b = await chromium.launch();
const erreurs = [];
const r = {};
let fenetresNavigateur = 0;

const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addCookies([{ name: nomCookie, value: valeurCookie, url: `${URL}/api/admin` }]);
const a = await ctx.newPage();
a.on("pageerror", (e) => erreurs.push(e.message));
// Plus aucune fenêtre du navigateur (prompt, confirm, alert) : on les compte, on les refuse.
a.on("dialog", (d) => {
  fenetresNavigateur++;
  void d.dismiss();
});

// ── Équipe : ajout ──
await a.goto(`${URL}/admin#/moka/equipe`);
await a.getByRole("button", { name: "Ajouter une personne" }).click();
let panneau = a.getByRole("dialog", { name: "Nouvelle personne" });
await panneau.waitFor();
r.focusInitial = await a.evaluate(() => document.activeElement?.closest(".champ")?.textContent?.trim());
await panneau.getByLabel("Prénom").fill("Léa");
r.etatModifie = await panneau.locator(".a-panneau-etat").textContent();
await panneau.getByLabel("Code PIN").fill("12");
await panneau.getByRole("button", { name: "Ajouter", exact: true }).click();
r.pinCourt = await panneau.locator(".a-panneau-etat.erreur").textContent();
await panneau.getByLabel("Code PIN").fill("4321");
await a.screenshot({ path: `${sortie}/pa01-equipe-ajout.png` });
await panneau.getByRole("button", { name: "Ajouter", exact: true }).click();
await panneau.waitFor({ state: "detached" });
await a.locator(".admin-tableau td", { hasText: "Léa" }).waitFor();
r.equipe = (await appel("GET", "/etablissements")).etablissements.find((e) => e.id === "moka").utilisateurs.map((u) => `${u.nom}:${u.role}:${u.actif}`);

// ── Équipe : modification, fermeture avec changements, puis nouveau code PIN ──
await a.getByRole("button", { name: "Modifier Léa" }).click();
panneau = a.getByRole("dialog", { name: "Léa" });
await panneau.getByRole("radio", { name: /^Responsable/ }).check();
await a.keyboard.press("Escape");
r.abandon = await panneau.getByRole("alertdialog").textContent();
await panneau.getByRole("button", { name: "Continuer" }).click();
await panneau.getByLabel("Nouveau code PIN").fill("9876");
await panneau.getByRole("button", { name: "Enregistrer", exact: true }).click();
await panneau.waitFor({ state: "detached" });
const lea = (await appel("GET", "/etablissements")).etablissements.find((e) => e.id === "moka").utilisateurs.find((u) => u.nom === "Léa");
r.leaApres = `${lea.role}:${lea.actif}`;
// Annuler sans rien changer ferme tout de suite.
await a.getByRole("button", { name: "Modifier Léa" }).click();
await a.getByRole("dialog", { name: "Léa" }).getByRole("button", { name: "Fermer", exact: true }).click();
r.fermeSansQuestion = (await a.getByRole("dialog").count()) === 0;

// ── Comptes clients : nouveau client ──
await a.goto(`${URL}/admin#/moka/comptes`);
await a.getByRole("button", { name: "Nouveau client" }).click();
panneau = a.getByRole("dialog", { name: "Nouveau client" });
await panneau.getByLabel("Nom du client").fill("Camby");
await panneau.getByLabel("Téléphone").fill("04 50 00 00 00");
await panneau.getByRole("button", { name: "Enregistrer", exact: true }).click();
await panneau.waitFor({ state: "detached" });
await a.locator(".admin-tableau td", { hasText: "Camby" }).waitFor();
r.client = await a.locator(".admin-tableau td", { hasText: "Camby" }).textContent();

// ── Appareils : rattacher depuis le panneau, puis révoquer (refus, puis confirmation) ──
await a.goto(`${URL}/admin#/moka/appareils`);
await a.getByRole("button", { name: "Rattacher un appareil" }).click();
panneau = a.getByRole("dialog", { name: "Rattacher un iPad ou un iPhone" });
await panneau.getByRole("radio", { name: "iPhone" }).click();
await panneau.getByLabel("Nom de l'iPhone").fill("Salle");
await panneau.getByRole("button", { name: "Générer un code" }).click();
r.code = (await panneau.locator(".admin-code span").textContent()).trim();
await a.screenshot({ path: `${sortie}/pa02-rattacher.png` });
await panneau.getByRole("button", { name: "Fermer", exact: true }).click();
r.codesEnAttente = await a.locator(".a-codes li").count();
// Un appareil rattaché par l'API, pour la révocation.
const { code } = await appel("POST", "/etablissements/moka/codes", { nomCaisse: "Terrasse" });
const cle = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const jwk = await crypto.subtle.exportKey("jwk", cle.publicKey);
const rattachement = await fetch(`${URL}/api/caisse/rattacher`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: URL },
  body: JSON.stringify({ code, caisseId: "ipad-7e7a5e01", cleId: "ipad-7e7a5e01-k1", clePubliqueJwk: jwk, appareil: "iPad" }),
});
r.rattache = rattachement.status;
await a.reload();
const carte = a.locator(".admin-caisse", { hasText: "Terrasse" });
await carte.waitFor({ timeout: 15000 });
await carte.getByRole("button", { name: "Révoquer" }).click();
let confirmation = a.getByRole("alertdialog", { name: "Révoquer « Terrasse » ?" });
await confirmation.waitFor();
await a.screenshot({ path: `${sortie}/pa03-confirmation.png` });
await confirmation.getByRole("button", { name: "Annuler" }).click();
r.apresRefus = await carte.locator("header .etat").textContent();
await carte.getByRole("button", { name: "Révoquer" }).click();
confirmation = a.getByRole("alertdialog", { name: "Révoquer « Terrasse » ?" });
await confirmation.getByRole("button", { name: "Révoquer l'appareil" }).click();
await carte.locator("header", { hasText: /Révoqué le/ }).waitFor();
r.apresConfirmation = (await carte.locator("header").textContent()).includes("Révoqué le");

// ── iPhone : le panneau prend toute la largeur, sans débordement ──
const m = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
await m.addCookies([{ name: nomCookie, value: valeurCookie, url: `${URL}/api/admin` }]);
const mp = await m.newPage();
mp.on("pageerror", (e) => erreurs.push(`iphone : ${e.message}`));
await mp.goto(`${URL}/admin#/moka/equipe`);
await mp.getByRole("button", { name: "Ajouter une personne" }).click();
const p2 = mp.getByRole("dialog", { name: "Nouvelle personne" });
await p2.waitFor();
r.largeurIphone = await p2.evaluate((x) => Math.round(x.getBoundingClientRect().width));
r.debordementIphone = await mp.evaluate(() => document.documentElement.scrollWidth - innerWidth);
await mp.waitForTimeout(400);
await mp.screenshot({ path: `${sortie}/pa04-iphone.png` });
await b.close();

console.log(JSON.stringify({ ...r, fenetresNavigateur, erreurs }, null, 2));
const ok =
  r.focusInitial?.startsWith("Prénom") &&
  r.etatModifie === "Modifié, non enregistré" &&
  r.pinCourt === "Le code PIN compte 4 chiffres." &&
  r.equipe.includes("Léa:serveur:true") &&
  r.abandon.includes("Abandonner les modifications ?") &&
  r.leaApres === "responsable:true" &&
  r.fermeSansQuestion &&
  r.client.includes("04 50 00 00 00") &&
  /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(r.code) &&
  r.codesEnAttente >= 1 &&
  r.rattache === 201 &&
  r.apresRefus === "En service" &&
  r.apresConfirmation &&
  r.largeurIphone === 390 &&
  r.debordementIphone <= 0 &&
  fenetresNavigateur === 0 &&
  !erreurs.length;
if (!ok) process.exit(1);
