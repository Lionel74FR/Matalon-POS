// Mot de passe oublié (15 novembre 2026) : connecté (ici par session), menu du compte › « Mot de passe » :
// nouveau mot de passe, confirmation et code de l'application d'authentification, sans l'ancien. Les
// saisies différentes sont signalées ; ensuite l'ancien mot de passe ne connecte plus, le nouveau oui.
// Usage : serveur local vierge (apps/caisse : node scripts/serveur-local.mjs 4180), puis
//         URL=http://localhost:4180 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/mot-de-passe.mjs [dossier-captures]
import { chromium } from "playwright";
import { menuCompte, preparerServeur, totp } from "./preparer-caisse.mjs";

const URL = process.env.URL ?? "http://localhost:4180";
const sortie = process.argv[2] ?? "captures";
const { cookie, secret } = await preparerServeur(URL, "Comptoir");
const [nomCookie, valeurCookie] = cookie.split("=");
const b = await chromium.launch();
const erreurs = [];
const r = {};
const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
await ctx.addCookies([{ name: nomCookie, value: valeurCookie, url: `${URL}/api/admin` }]);
const a = await ctx.newPage();
a.on("pageerror", (e) => erreurs.push(e.message));
await a.goto(`${URL}/admin`);
await a.locator(".coque-etab").waitFor();
await menuCompte(a, "Mot de passe");
const f = a.getByRole("dialog", { name: "Mot de passe" });
await f.getByLabel(/^Nouveau mot de passe/).fill("un-nouveau-mot-de-passe");
await f.getByLabel("Confirmation").fill("un-autre-mot-de-passe");
r.differents = (await f.locator(".erreur").textContent())?.trim();
await f.getByLabel("Confirmation").fill("un-nouveau-mot-de-passe");
await f.getByLabel("Code de l'application d'authentification").fill(totp(secret));
await a.screenshot({ path: `${sortie}/mp01-fenetre.png` });
await f.getByRole("button", { name: "Changer le mot de passe" }).click();
await f.locator(".succes").waitFor();
r.succes = (await f.locator(".succes").textContent())?.trim();
const connexion = async (motDePasse) =>
  (
    await fetch(`${URL}/api/admin/connexion`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: URL },
      body: JSON.stringify({ identifiant: "lionel", motDePasse, code: totp(secret) }),
    })
  ).status;
r.ancien = await connexion("un-mot-de-passe-solide");
r.nouveau = await connexion("un-nouveau-mot-de-passe");
await b.close();
console.log(JSON.stringify({ ...r, erreurs }, null, 2));
const ok = r.differents === "Les deux saisies diffèrent." && /Mot de passe changé/.test(r.succes ?? "") && r.ancien === 401 && r.nouveau === 200 && !erreurs.length;
if (!ok) process.exit(1);
