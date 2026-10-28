// Comptage au pavé (28 octobre 2026, écrans figés au Moka) : les billets et pièces se comptent au pavé
// de la fenêtre, sans clavier d'iOS (aucun champ de saisie natif pour les montants) ; « Suivant » passe
// au champ d'après ; un toucher à côté ne ferme plus la fenêtre ; la saisie survit à un redémarrage de
// l'app (rechargement de la page en plein comptage) et la Z se fait sur le comptage repris, puis le
// brouillon est effacé. Captures iPad et iPhone.
// Usage : serveur local vierge (apps/caisse : node scripts/serveur-local.mjs 4180), puis
//         URL=http://localhost:4180 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/comptage-pave.mjs [dossier-captures]
import { chromium } from "playwright";
import { preparerServeur, saisirPave } from "./preparer-caisse.mjs";

const URL = process.env.URL ?? "http://localhost:4180";
const sortie = process.argv[2] ?? "captures";
const { code } = await preparerServeur(URL, "Comptoir");
const erreurs = [];
const b = await chromium.launch();
const texte = async (loc) => ((await loc.textContent()) ?? "").replace(/[\s  ]+/g, " ").trim();
const r = {};

const ctx = await b.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true });
const p = await ctx.newPage();
p.on("pageerror", (e) => erreurs.push(`ipad : ${e.message}`));
const clic = (n) => p.getByRole("button", { name: n, exact: true }).first().click();
const connexion = async () => {
  await p.locator(".carte-personne", { hasText: "Lionel" }).click();
  for (const x of "1234") await p.locator(".pave .touche", { hasText: new RegExp(`^${x}$`) }).last().click();
};
await p.goto(URL);
await p.locator(".champ-code input").fill(code);
await clic("Rattacher l'iPad");
await clic("Configurer plus tard");
await connexion();
await p.getByRole("dialog", { name: "Fond de caisse" }).waitFor();
await p.locator(".modale label.champ", { hasText: "Fond de caisse" }).locator("input").fill("150");
await clic("Enregistrer le fond");
await clic("Vente Directe");
await p.locator(".tuile", { hasText: "Cappuccino" }).first().click();
await clic("Encaisser");
await p.locator(".mode", { hasText: "Espèces" }).click();
await p.getByRole("button", { name: /^Valider l'encaissement/ }).click();
await clic("Terminé");

const ouvrirZ = async () => {
  await p.getByRole("button", { name: /^Menu/ }).click().then(() => p.getByRole("menuitem", { name: "Clôtures" }).click());
  await clic("Clôturer la journée (Z)");
  await p.locator(".comptage-lignes").first().waitFor();
};
await ouvrirZ();
const modale = p.getByRole("dialog", { name: /^Comptage et clôture/ });
// Aucun champ natif pour les montants : seuls l'objet d'une dépense et le motif ouvrent le clavier.
r.champsNatifs = await modale.locator("input").count();
// 50 € × 3, puis « Suivant » vers 20 € : 2.
await modale.getByRole("button", { name: "50 € : nombre", exact: true }).click();
const pave = p.getByRole("group", { name: /^Pavé : / });
r.paveLibelle = await pave.getAttribute("aria-label");
await pave.getByRole("button", { name: "3", exact: true }).click();
await pave.getByRole("button", { name: "Suivant" }).click();
r.apresSuivant = await pave.getAttribute("aria-label");
await pave.getByRole("button", { name: "2", exact: true }).click();
r.virguleCoupure = await pave.getByRole("button", { name: "Virgule" }).isDisabled();
await p.screenshot({ path: `${sortie}/cp01-pave.png` });
await saisirPave(p, "Total CB du TPE", "0");
await saisirPave(p, "Titres-restaurant carte du TPE", "0");
r.compte = await texte(p.locator(".comptage-lignes div", { hasText: "Compté" }).locator("dd"));
// Un toucher sur le fond sombre ne ferme pas la fenêtre.
await p.mouse.click(8, 8);
r.resteOuverte = await modale.isVisible();

// L'app redémarre en plein comptage : la saisie est reprise.
await p.reload();
await connexion();
await ouvrirZ();
r.repris = await texte(p.locator(".comptage-repris"));
r.compteRepris = await texte(p.locator(".comptage-lignes div", { hasText: "Compté" }).locator("dd"));
r.cinquante = await texte(modale.getByRole("button", { name: "50 € : nombre", exact: true }));
await p.screenshot({ path: `${sortie}/cp02-repris.png` });
// L'espèce attendue est 150 € + le cappuccino : on complète en total direct pour tomber juste.
const attendu = (await texte(p.locator(".comptage-lignes div", { hasText: "Attendu dans le tiroir" }).locator("dd"))).replace(/[^\d,]/g, "");
await clic("Saisir le total directement");
await saisirPave(p, "Espèces comptées", attendu);
await pave.getByRole("button", { name: "Terminé" }).click();
r.paveFerme = (await pave.count()) === 0;
await p.getByRole("button", { name: /^Valider.*clôturer/ }).click();
await p.getByText(/clôturée/).first().waitFor();
r.brouillonEfface = await p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("matalon-comptage:")).length === 0);

// ── Format iPhone : le pavé tient dans l'écran, sans débordement ──
await p.setViewportSize({ width: 390, height: 844 });
await ouvrirZ();
await modale.getByRole("button", { name: "50 € : nombre", exact: true }).click();
await pave.waitFor();
const boite = await pave.boundingBox();
r.paveDansEcran = !!boite && boite.y + boite.height <= 844 + 1 && boite.x >= 0 && boite.x + boite.width <= 390 + 1;
r.debordementIphone = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
await p.screenshot({ path: `${sortie}/cp03-iphone.png` });
await b.close();

console.log(JSON.stringify({ ...r, erreurs }, null, 2));
const ok =
  r.champsNatifs === 0 &&
  r.paveLibelle === "Pavé : 50 €" &&
  r.apresSuivant === "Pavé : 20 €" &&
  r.virguleCoupure &&
  r.compte === "190,00 €" &&
  r.resteOuverte &&
  /Comptage repris/.test(r.repris) &&
  r.compteRepris === "190,00 €" &&
  r.cinquante.startsWith("3") &&
  r.paveFerme &&
  r.brouillonEfface &&
  r.paveDansEcran &&
  r.debordementIphone <= 0 &&
  !erreurs.length;
if (!ok) process.exit(1);
