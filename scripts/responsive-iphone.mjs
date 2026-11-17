// Caisse sur petit iPhone (17 novembre 2026, Lionel : masquer le nom de l'établissement en haut et tout
// rendre lisible). Chaque écran à 375 puis 320 points de large : rien ne déborde de l'écran (hors zones
// qui défilent d'elles-mêmes, comme les onglets ou le plan), une capture par écran.
// Usage : serveur local vierge (apps/caisse : node scripts/serveur-local.mjs 4180), puis
//         URL=http://localhost:4180 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/responsive-iphone.mjs [dossier-captures]
import { chromium } from "playwright";
import { preparerServeur } from "./preparer-caisse.mjs";

const URL = process.env.URL ?? "http://localhost:4180";
const sortie = process.argv[2] ?? "captures";
const { appel } = await preparerServeur(URL, "iPad");
const b = await chromium.launch();
const erreurs = [];
const resultats = {};

/** Éléments visibles qui sortent de l'écran, hors conteneurs qui défilent. */
const debordements = (p) =>
  p.evaluate(() => {
    const largeur = document.documentElement.clientWidth;
    const defile = (el) => {
      for (let e = el.parentElement; e; e = e.parentElement) {
        const s = getComputedStyle(e);
        if (/(auto|scroll|hidden)/.test(s.overflowX) && e.scrollWidth > e.clientWidth + 1) return true;
      }
      return false;
    };
    const fautifs = [];
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (r.right > largeur + 1 || r.left < -1) {
        if (defile(el)) continue;
        const s = getComputedStyle(el);
        if (s.visibility === "hidden" || s.position === "fixed" && r.left >= largeur) continue;
        fautifs.push(`${el.tagName.toLowerCase()}.${[...el.classList].join(".")} [${Math.round(r.left)}→${Math.round(r.right)}] ${(el.textContent ?? "").trim().slice(0, 30)}`);
      }
    }
    return { page: document.documentElement.scrollWidth - largeur, fautifs: fautifs.slice(0, 6) };
  });

for (const largeur of [375, 320]) {
  const { code } = await appel("POST", "/etablissements/moka/codes", { nomCaisse: `iPhone ${largeur}` });
  const ctx = await b.newContext({
    viewport: { width: largeur, height: largeur === 320 ? 568 : 667 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => erreurs.push(`${largeur} : ${e.message}`));
  const clic = (n) => p.getByRole("button", { name: n, exact: true }).first().click();
  await p.goto(URL);
  await p.locator(".champ-code input").fill(code);
  await clic("Rattacher l'iPhone");
  await clic("Configurer plus tard");
  await p.locator(".carte-personne", { hasText: "Lionel" }).click();
  for (const x of "1234") await p.locator(".pave .touche", { hasText: new RegExp(`^${x}$`) }).last().click();
  await clic("Plus tard");
  await p.locator(".puce-synchro.synchronise").waitFor({ timeout: 15000 });
  const r = {};
  const mesurer = async (nom) => {
    await p.waitForTimeout(400);
    r[nom] = await debordements(p);
    await p.screenshot({ path: `${sortie}/ri-${largeur}-${nom}.png` });
  };
  r.nomEtablissement = await p.locator(".barre-marque span").isVisible();
  await mesurer("salle");
  // Commande d'une table, encaissement.
  await p.getByRole("button", { name: /^Table 3,/ }).click();
  await p.locator(".tuile", { hasText: "Cappuccino" }).first().click();
  await mesurer("commande-carte");
  await p.locator(".resume-mobile").click().catch(() => undefined);
  await mesurer("commande-ticket");
  await p.getByRole("button", { name: "Encaisser" }).first().click();
  await p.getByRole("dialog").last().waitFor();
  await mesurer("encaissement");
  await p.keyboard.press("Escape");
  await p.getByRole("dialog").last().getByRole("button", { name: /Fermer|Annuler/ }).first().click().catch(() => undefined);
  await p.getByRole("button", { name: "Retour à la salle" }).first().click().catch(() => undefined);
  for (const onglet of ["Tickets", "Comptes"]) {
    await p.getByRole("tab", { name: onglet }).click();
    await mesurer(onglet.toLowerCase());
  }
  for (const entree of ["Clôtures", "Stats", "Stock", "Carte et fiches", "Réglages"]) {
    await p.getByRole("button", { name: /^Menu/ }).click();
    await p.getByRole("menuitem", { name: entree }).click();
    await mesurer(entree.toLowerCase().replace(/\W+/g, "-"));
    // La barre du haut reste sur une ligne : le bouton de sortie à côté du menu.
    const [menu, sortie] = await Promise.all([p.locator(".menu-onglets-bouton").boundingBox(), p.locator(".barre-etat > .bouton").last().boundingBox()]);
    r[`barre-${entree}`] = Math.abs(menu.y - sortie.y) < 4 ? "une ligne" : "deux lignes";
  }
  for (const rubrique of ["Cet appareil", "Imprimantes", "Établissement", "Équipe"]) {
    await p.locator(".retour-reglages").click().catch(() => undefined);
    await p.getByRole("navigation", { name: "Réglages" }).getByRole("button", { name: new RegExp(`^${rubrique}`) }).click();
    await mesurer(`reglages-${rubrique.toLowerCase().replace(/\W+/g, "-")}`);
  }
  resultats[largeur] = r;
  await ctx.close();
}
await b.close();

const fautes = Object.entries(resultats).flatMap(([l, r]) =>
  Object.entries(r)
    .filter(([, v]) => typeof v === "object" && (v.page > 0 || v.fautifs.length))
    .map(([nom, v]) => `${l} ${nom} : page +${v.page}px ; ${v.fautifs.join(" | ")}`),
);
console.log(JSON.stringify({ nomEtablissement: Object.fromEntries(Object.entries(resultats).map(([l, r]) => [l, r.nomEtablissement])), fautes, erreurs }, null, 2));
const barres = Object.entries(resultats).flatMap(([l, r]) => Object.entries(r).filter(([k, v]) => k.startsWith("barre-") && v !== "une ligne").map(([k]) => `${l} ${k}`));
console.log(JSON.stringify({ barresSurDeuxLignes: barres }));
if (fautes.length || barres.length || erreurs.length || Object.values(resultats).some((r) => r.nomEtablissement)) process.exit(1);
