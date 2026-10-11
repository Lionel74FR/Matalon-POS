// Clés d'accès de l'administration avec un authentificateur virtuel de Chromium (comme Face ID) :
// invitation après connexion, création avec le code de vérification, connexion sans mot de passe ni
// code, retrait de la clé (elle n'ouvre plus rien), écrans sur iPhone sans débordement.
// Usage : serveur local vierge (apps/caisse : node scripts/serveur-local.mjs 4180), puis
//         URL=http://localhost:4180 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/cles-acces.mjs [dossier-captures]
import { chromium } from "playwright";
import { preparerServeur, totp } from "./preparer-caisse.mjs";

const URL = process.env.URL ?? "http://localhost:4180";
const sortie = process.argv[2] ?? "captures";
const { cookie, secret } = await preparerServeur(URL, "Comptoir");
const [nomCookie, valeurCookie] = cookie.split("=");
const b = await chromium.launch();
const erreurs = [];
const resultats = {};

async function contexte(viewport) {
  const ctx = await b.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => erreurs.push(e.message));
  page.on("dialog", (d) => void d.accept());
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  return { ctx, page, cdp, authenticatorId };
}

// ── Ordinateur : création de la clé depuis l'invitation ──
const { ctx, page: a, cdp, authenticatorId } = await contexte({ width: 1280, height: 860 });
await ctx.addCookies([{ name: nomCookie, value: valeurCookie, url: `${URL}/api/admin` }]);
await a.goto(`${URL}/admin`);
await a.locator(".admin-suggestion").waitFor();
await a.screenshot({ path: `${sortie}/p01-invitation.png` });
await a.getByRole("button", { name: "Créer une clé d'accès" }).click();
await a.getByLabel("Code de l'application d'authentification").fill("000000");
await a.getByRole("button", { name: "Créer la clé d'accès" }).click();
await a.locator(".cles-creation .erreur", { hasText: /\S/ }).waitFor();
resultats.codeFaux = (await a.locator(".cles-creation .erreur").textContent())?.trim();
await a.getByLabel("Code de l'application d'authentification").fill(totp(secret));
await a.getByRole("button", { name: "Créer la clé d'accès" }).click();
await a.locator(".cles-creation .succes").waitFor();
resultats.liste = (await a.locator(".cles-liste li").allTextContents()).map((t) => t.replace(/\s+/g, " ").trim());
await a.screenshot({ path: `${sortie}/p02-cle-creee.png` });
const { credentials } = await cdp.send("WebAuthn.getCredentials", { authenticatorId });
resultats.cleDecouvrable = credentials.length === 1 && credentials[0].isResidentCredential;
await a.getByRole("button", { name: "Fermer" }).click();
resultats.invitationApres = await a.locator(".admin-suggestion").count();

// ── Déconnexion, puis connexion par la clé seule ──
await a.getByRole("button", { name: /Se déconnecter/ }).click();
await a.getByRole("button", { name: "Se connecter avec une clé d'accès" }).waitFor();
await a.screenshot({ path: `${sortie}/p03-connexion.png` });
await a.getByRole("button", { name: "Se connecter avec une clé d'accès" }).click();
await a.locator(".admin-etab select").waitFor();
resultats.connecteParCle = true;
await a.getByRole("button", { name: "Clés d'accès" }).click();
resultats.derniereConnexion = (await a.locator(".cles-liste small").first().textContent()).includes("dernière connexion : jamais") ? "jamais" : "renseignée";

// ── Retrait : la clé reste dans l'appareil mais n'ouvre plus rien ──
await a.getByRole("button", { name: /Retirer la clé/ }).click();
await a.locator(".cles-liste").waitFor({ state: "detached" });
await a.getByRole("button", { name: "Fermer" }).click();
await a.getByRole("button", { name: /Se déconnecter/ }).click();
await a.getByRole("button", { name: "Se connecter avec une clé d'accès" }).click();
resultats.apresRetrait = (await a.locator(".admin-acces .erreur").filter({ hasText: /\S/ }).textContent({ timeout: 10000 })).trim();
await ctx.close();

// ── iPhone : écran de connexion et fenêtre des clés ──
const tel = await contexte({ width: 390, height: 844 });
await tel.page.goto(`${URL}/admin`);
await tel.page.getByRole("button", { name: "Se connecter avec une clé d'accès" }).waitFor();
await tel.page.screenshot({ path: `${sortie}/p04-connexion-iphone.png` });
resultats.debordementConnexion = await tel.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
// La première session a été fermée par la déconnexion : nouvelle connexion par mot de passe et code.
const connexion = await fetch(`${URL}/api/admin/connexion`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: URL },
  body: JSON.stringify({ identifiant: "lionel", motDePasse: "un-mot-de-passe-solide", code: totp(secret) }),
});
const [nom2, valeur2] = connexion.headers.get("set-cookie").split(";")[0].split("=");
await tel.ctx.addCookies([{ name: nom2, value: valeur2, url: `${URL}/api/admin` }]);
await tel.page.reload();
await tel.page.locator(".admin-suggestion").waitFor();
resultats.debordementAdmin = await tel.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
await tel.page.getByRole("button", { name: "Créer une clé d'accès" }).click();
await tel.page.locator(".cles-creation").waitFor();
await tel.page.screenshot({ path: `${sortie}/p05-cles-iphone.png` });
resultats.debordementFenetre = await tel.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
await b.close();

console.log(JSON.stringify({ ...resultats, erreurs }, null, 2));
const ok =
  /incorrect/.test(resultats.codeFaux ?? "") &&
  resultats.liste.length === 1 &&
  resultats.cleDecouvrable &&
  resultats.invitationApres === 0 &&
  resultats.derniereConnexion === "renseignée" &&
  /non reconnue/.test(resultats.apresRetrait) &&
  !resultats.debordementConnexion &&
  !resultats.debordementAdmin &&
  !resultats.debordementFenetre &&
  !erreurs.length;
if (!ok) process.exit(1);
