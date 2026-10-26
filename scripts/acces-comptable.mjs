// Accès comptable (26 octobre 2026) : Lionel invite une comptable depuis le menu du compte, le lien
// s'affiche une fois ; elle l'ouvre, crée sa clé d'accès (authentificateur virtuel de Chromium) et
// n'a que Statistiques et Clôtures (ni recherche, ni alertes, ni réglages ; une autre rubrique tapée
// dans l'adresse ramène aux statistiques ; le serveur refuse les tickets). Sur iPhone, deux onglets.
// Lionel voit sa connexion, puis révoque l'accès : la session de la comptable se ferme.
// Usage : serveur local vierge (apps/caisse : node scripts/serveur-local.mjs 4180), puis
//         URL=http://localhost:4180 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/acces-comptable.mjs [dossier-captures]
import { chromium } from "playwright";
import { accepterConfirmations, menuCompte, preparerServeur, rubriqueAdmin } from "./preparer-caisse.mjs";

const URL = process.env.URL ?? "http://localhost:4180";
const sortie = process.argv[2] ?? "captures";
const { cookie } = await preparerServeur(URL, "Comptoir");
const [nomCookie, valeurCookie] = cookie.split("=");
const b = await chromium.launch();
const erreurs = [];
const r = {};

// ── Lionel invite la comptable ──
const ctxL = await b.newContext({ viewport: { width: 1440, height: 900 } });
await ctxL.addCookies([{ name: nomCookie, value: valeurCookie, url: `${URL}/api/admin` }]);
const l = await ctxL.newPage();
l.on("pageerror", (e) => erreurs.push(`lionel : ${e.message}`));
await accepterConfirmations(l);
await l.goto(`${URL}/admin#/moka/accueil`);
await l.locator(".accueil").waitFor({ timeout: 15000 });
await menuCompte(l, "Accès à l'administration");
const fenetre = l.getByRole("dialog", { name: "Accès à l'administration" });
await fenetre.getByRole("button", { name: "Inviter une comptable" }).click();
await fenetre.getByLabel("Nom").fill("Caroline Petrod");
await fenetre.getByLabel("E-mail").fill("caroline@audrex.fr");
r.mokaCoche = await fenetre.getByRole("checkbox", { name: "Moka" }).isChecked();
await fenetre.getByRole("button", { name: "Créer le lien d'invitation" }).click();
const champLien = fenetre.getByLabel("Lien d'invitation de Caroline Petrod");
await champLien.waitFor();
const lien = await champLien.inputValue();
r.lien = /\/admin#\/invitation\/[A-Za-z0-9_-]{20,}$/.test(lien);
r.enAttente = (await fenetre.locator(".acces-fiche .acces-etat").last().textContent())?.trim();
await l.screenshot({ path: `${sortie}/ac01-invitation.png` });
await fenetre.getByRole("button", { name: "C'est envoyé" }).click();
await fenetre.getByRole("button", { name: "Fermer", exact: true }).click();

// ── La comptable ouvre le lien et crée sa clé ──
async function contexteComptable(viewport) {
  const ctx = await b.newContext({ viewport, hasTouch: viewport.width < 500 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => erreurs.push(`comptable : ${e.message}`));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  return { ctx, page };
}
const { ctx: ctxC, page: c } = await contexteComptable({ width: 1440, height: 900 });
await c.goto(lien);
await c.getByRole("heading", { name: "Bienvenue, Caroline Petrod" }).waitFor({ timeout: 15000 });
r.invitationTexte = (await c.locator(".admin-carte p").first().textContent())?.includes("Moka");
await c.screenshot({ path: `${sortie}/ac02-page-invitation.png` });
await c.getByRole("button", { name: "Créer ma clé d'accès" }).click();
await c.locator(".coque-etab").waitFor({ timeout: 15000 });
await c.locator(".stats, .statistiques, .stat-carte").first().waitFor({ timeout: 15000 });
r.adresse = await c.evaluate(() => location.hash);
const menu = c.getByRole("navigation", { name: /^Rubriques de / });
r.rubriques = await menu.getByRole("link").allTextContents();
r.recherche = await c.getByRole("button", { name: /^Rechercher/ }).count();
r.cloche = await c.getByRole("button", { name: /^Alertes/ }).count();
r.moments = await c.getByRole("button", { name: /moments/i }).count();
await c.getByRole("button", { name: /^Compte / }).click();
r.menuCompte = await c.getByRole("menuitem").allTextContents();
r.sousTitre = (await c.locator(".coque-menu-titre small").textContent())?.trim();
await c.keyboard.press("Escape");
await c.screenshot({ path: `${sortie}/ac03-comptable-stats.png` });

await rubriqueAdmin(c, "Clôtures");
await c.getByRole("link", { name: /Export comptable/ }).waitFor();
r.exports = await c.getByRole("link", { name: /Export comptable|Comptages de caisse/ }).count();
await c.screenshot({ path: `${sortie}/ac04-comptable-clotures.png` });
// Une rubrique fermée, tapée dans l'adresse, ramène aux statistiques ; le serveur refuse les tickets.
await c.goto(`${URL}/admin#/moka/equipe`);
await c.locator(".coque-etab").waitFor();
await c.waitForFunction(() => location.hash === "#/moka/statistiques");
r.redirige = true;
r.ticketsServeur = await c.evaluate(async () => (await fetch("/api/admin/etablissements/moka/tickets?du=2026-10-25&au=2026-10-25")).status);
r.ecritureServeur = await c.evaluate(
  async () => (await fetch("/api/admin/etablissements/moka/codes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nomCaisse: "x" }) })).status,
);

// ── iPhone : deux onglets, sans « Plus » ni débordement ──
const cookiesC = await ctxC.cookies();
const m = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
await m.addCookies(cookiesC);
const mp = await m.newPage();
mp.on("pageerror", (e) => erreurs.push(`iphone : ${e.message}`));
await mp.goto(`${URL}/admin#/moka/statistiques`);
await mp.locator(".coque-etab").waitFor({ timeout: 15000 });
const barre = mp.getByRole("navigation", { name: "Navigation principale" });
r.ongletsIphone = (await barre.getByRole("link").allTextContents()).map((t) => t.trim());
r.plusIphone = await barre.getByRole("button", { name: "Plus" }).count();
r.debordementIphone = await mp.evaluate(() => document.documentElement.scrollWidth - innerWidth);
await mp.screenshot({ path: `${sortie}/ac05-iphone.png` });

// ── Lionel voit la connexion, puis révoque ──
await menuCompte(l, "Accès à l'administration");
const fiche = fenetre.locator(".acces-fiche", { hasText: "Caroline Petrod" });
await fiche.locator(".acces-etat", { hasText: "Dernière connexion" }).waitFor();
r.connexionVue = true;
await fiche.locator("summary", { hasText: "Dernières actions" }).click();
r.journal = (await fiche.locator(".acces-journal li").allTextContents()).join(" | ");
await l.screenshot({ path: `${sortie}/ac06-acces-actif.png` });
await fiche.getByRole("button", { name: "Révoquer" }).click();
await fiche.locator(".acces-etat", { hasText: "Révoqué le" }).waitFor();
r.revoque = true;
await c.reload();
await c.getByRole("button", { name: "Se connecter avec une clé d'accès" }).waitFor({ timeout: 15000 });
r.deconnectee = true;
await b.close();

console.log(JSON.stringify({ ...r, erreurs }, null, 2));
const ok =
  r.mokaCoche &&
  r.lien &&
  /Invitation en attente/.test(r.enAttente ?? "") &&
  r.invitationTexte &&
  r.adresse === "#/moka/statistiques" &&
  JSON.stringify(r.rubriques.map((t) => t.trim())) === JSON.stringify(["Statistiques", "Clôtures"]) &&
  r.recherche === 0 &&
  r.cloche === 0 &&
  r.moments === 0 &&
  JSON.stringify(r.menuCompte.map((t) => t.trim())) === JSON.stringify(["Se déconnecter"]) &&
  r.sousTitre === "Comptable · Caroline Petrod" &&
  r.exports === 2 &&
  r.redirige &&
  r.ticketsServeur === 403 &&
  r.ecritureServeur === 403 &&
  JSON.stringify(r.ongletsIphone) === JSON.stringify(["Stats", "Clôtures"]) &&
  r.plusIphone === 0 &&
  r.debordementIphone <= 0 &&
  r.connexionVue &&
  r.journal.includes("Connexion") &&
  r.revoque &&
  r.deconnectee &&
  !erreurs.length;
if (!ok) process.exit(1);
