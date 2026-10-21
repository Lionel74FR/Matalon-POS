// Logo de l'établissement (remarque de Lionel du 21 octobre : absent du module de réservation et des e-mails) :
// l'administration dépose une image (réduite en PNG), l'aperçu montre les deux fonds ; le module de réservation
// l'affiche en tête sans attribut data-logo ; l'e-mail d'essai des réservations le porte ; on le retire.
// Usage : serveur local vierge (apps/caisse : node scripts/serveur-local.mjs 4180), puis
//         URL=http://localhost:4180 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/logo.mjs [dossier-captures]
import { chromium } from "playwright";
import { preparerServeur } from "./preparer-caisse.mjs";

const URL = process.env.URL ?? "http://localhost:4180";
const sortie = process.argv[2] ?? "captures";
const { cookie, appel } = await preparerServeur(URL, "Comptoir");
const [nomCookie, valeurCookie] = cookie.split("=");
const erreurs = [];
const r = {};
const b = await chromium.launch();

// Réservations ouvertes, avec l'e-mail et l'expéditeur de l'établissement.
await appel("PUT", "/etablissements/moka/reservations/reglages", {
  version: 0,
  reglages: {
    actif: true,
    dureeMinutes: 90,
    pasMinutes: 30,
    delaiMinutes: 60,
    horizonJours: 30,
    groupeMax: 6,
    fermetures: [],
    accueil: "Bienvenue au Moka",
    email: "bonjour@moka.test",
    expediteur: "reservations@moka.test",
    services: [{ id: "din", nom: "Dîner", jours: [1, 2, 3, 4, 5, 6, 7], debut: "19:00", fin: "23:00", couvertsMax: 30, simultanesMax: null, arriveesMax: null }],
  },
});

const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addCookies([{ name: nomCookie, value: valeurCookie, url: `${URL}/api/admin` }]);
const a = await ctx.newPage();
a.on("pageerror", (e) => erreurs.push(`admin : ${e.message}`));

// Une image de 1200 × 400 (plus grande que la limite) dessinée dans le navigateur.
await a.goto(`${URL}/admin#/moka/identite`);
const section = a.locator(".logo-etablissement");
await section.waitFor({ timeout: 15000 });
r.avant = await section.locator(".explication").last().textContent();
const png = await a.evaluate(() => {
  const c = document.createElement("canvas");
  c.width = 1200;
  c.height = 400;
  const g = c.getContext("2d");
  g.fillStyle = "#c8643c";
  g.beginPath();
  g.arc(200, 200, 160, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#f4f1ec";
  g.font = "bold 180px sans-serif";
  g.fillText("MOKA", 420, 265);
  return c.toDataURL("image/png").split(",")[1];
});
await section.getByLabel("Fichier du logo").setInputFiles({ name: "logo-moka.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
await section.locator(".admin-ok").waitFor({ timeout: 15000 });
r.ok = await section.locator(".admin-ok").textContent();
await section.locator(".logo-apercu.sombre img").waitFor();
r.taille = await section.locator(".logo-apercu.sombre img").evaluate((i) => [i.naturalWidth, i.naturalHeight]);
await section.screenshot({ path: `${sortie}/lg01-admin.png` });
const { etablissements } = await appel("GET", "/etablissements");
const version = etablissements.find((e) => e.id === "moka").logo;

// Module de réservation, sans data-logo : le logo de l'établissement en tête.
const site = await ctx.newPage();
site.on("pageerror", (e) => erreurs.push(`module : ${e.message}`));
await site.goto(`${URL}/reserver/moka`);
const entete = site.locator(".entete img.logo");
await entete.waitFor({ timeout: 15000 });
r.module = await entete.getAttribute("src");
r.moduleCharge = await entete.evaluate((i) => i.complete && i.naturalWidth > 0);
await site.screenshot({ path: `${sortie}/lg02-module.png` });

// E-mail d'essai des réservations : le logo en tête.
await appel("POST", "/etablissements/moka/reservations/essai-email", {});
const courriels = await (await fetch(`${URL}/__courriels`)).json();
r.email = /<img src="([^"]+)"/.exec(courriels.at(-1)?.html ?? "")?.[1] ?? null;
const image = await fetch(r.email);
r.image = [image.status, image.headers.get("content-type")];

// Retrait : le nom revient.
await a.getByRole("button", { name: "Retirer" }).click();
await section.locator(".admin-ok", { hasText: "retiré" }).waitFor();
await site.reload();
await site.locator(".entete .nom-etab").waitFor();
r.apresRetrait = await site.locator(".entete .nom-etab").textContent();

// iPhone : rubrique sans débordement.
const m = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
await m.addCookies([{ name: nomCookie, value: valeurCookie, url: `${URL}/api/admin` }]);
const mp = await m.newPage();
await mp.goto(`${URL}/admin#/moka/identite`);
await mp.locator(".logo-etablissement").waitFor({ timeout: 15000 });
r.debordementIphone = await mp.evaluate(() => document.documentElement.scrollWidth - innerWidth);
await b.close();

console.log(JSON.stringify({ ...r, version, erreurs }, null, 2));
const ok =
  r.avant === "Aucun logo pour l'instant." &&
  /^Logo enregistré/.test(r.ok) &&
  r.taille[0] === 600 &&
  r.taille[1] === 200 &&
  r.module === `${URL}/logo/moka?v=${version}` &&
  r.moduleCharge &&
  r.email === `${URL}/logo/moka?v=${version}` &&
  r.image[0] === 200 &&
  r.image[1] === "image/png" &&
  r.apresRetrait === "Moka" &&
  r.debordementIphone <= 0 &&
  !erreurs.length;
if (!ok) process.exit(1);
