// Mise en service : la configuration de la caisse de test (équipe, plan, carte, stock, commandes,
// réservations à venir) s'exporte depuis l'administration, puis s'importe dans une installation
// neuve (second serveur local, base vierge) ; aucune vente ne suit. Un second import est refusé.
// Usage : serveur local vierge (apps/caisse : node scripts/serveur-local.mjs 4180), puis
//         URL=http://localhost:4180 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/mise-en-service.mjs [dossier-captures]
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { preparerServeur, totp } from "./preparer-caisse.mjs";

const URL = process.env.URL ?? "http://localhost:4180";
const PROD = "http://localhost:4181";
const sortie = process.argv[2] ?? "captures";
const ici = dirname(fileURLToPath(import.meta.url));
const erreurs = [];

// ── Caisse de test : stock, inventaire d'ouverture, commande reçue ──
const { cookie, appel } = await preparerServeur(URL, "Comptoir");
await appel("POST", "/stock/import", {
  etablissementId: "moka",
  tableau: [
    ["produit", "unite", "famille", "zone", "fournisseur", "reference", "conditionnement", "quantite", "prix_ht"],
    ["Bombay Sapphire", "L", "Spiritueux", "Bar", "Caves du Mont", "25522", "Bouteille 70 cl", "0,7", "20,49"],
  ],
});
const hier = new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris" }).format(new Date(Date.now() - 86_400_000));
await appel("POST", "/stock/inventaires", { etablissementId: "moka", zone: "Bar", date: hier, lignes: [{ produitId: "bombay-sapphire", compte: 490 }] });
const stockTest = await appel("GET", "/stock");
const gin = stockTest.referentiel.articles[0].id;
const cmd = (await appel("POST", "/stock/commandes?etab=moka", { fournisseur: "Caves du Mont", lignes: [{ articleId: gin, nombre: 2000 }] })).commande;
await appel("POST", `/stock/commandes/${cmd.id}/envoyer?etab=moka`, { mode: "manuel", version: cmd.version });
await appel("POST", "/stock/receptions", { etablissementId: "moka", commandeId: cmd.id, lignes: [{ articleId: gin, nombre: 2000, prixHT: 2049 }] });

// ── Installation neuve : second serveur, administrateur seul ──
const serveur = spawn("node", [resolve(ici, "../apps/caisse/scripts/serveur-local.mjs"), "4181"], { cwd: resolve(ici, "../apps/caisse"), stdio: "ignore" });
let cookieProd = "";
const appelProd = async (methode, chemin, corps) => {
  const r = await fetch(`${PROD}/api/admin${chemin}`, { method: methode, headers: { "Content-Type": "application/json", Origin: PROD, Cookie: cookieProd }, body: corps ? JSON.stringify(corps) : undefined });
  cookieProd = r.headers.get("set-cookie")?.split(";")[0] ?? cookieProd;
  const json = await r.json();
  if (!r.ok) throw new Error(`${chemin} : ${json.message}`);
  return json;
};
for (let i = 0; ; i++) {
  try {
    await fetch(`${PROD}/api/admin/statut`);
    break;
  } catch {
    if (i > 60) throw new Error("Second serveur injoignable.");
    await new Promise((r) => setTimeout(r, 500));
  }
}
const acces = { identifiant: "lionel", motDePasse: "un-mot-de-passe-solide" };
const { secret } = await appelProd("POST", "/initialiser", acces);
await appelProd("POST", "/confirmer", { ...acces, code: totp(secret) });

const b = await chromium.launch();
try {
  const [n1, v1] = cookie.split("=");
  const ctxTest = await b.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  await ctxTest.addCookies([{ name: n1, value: v1, url: `${URL}/api/admin` }]);
  const t = await ctxTest.newPage();
  t.on("pageerror", (e) => erreurs.push(`test : ${e.message}`));
  await t.goto(`${URL}/admin#/moka/appareils`);
  await t.getByRole("button", { name: "Configuration de l'installation" }).click();
  const [telechargement] = await Promise.all([t.waitForEvent("download"), t.getByRole("button", { name: "Exporter la configuration" }).click()]);
  const fichier = `${sortie}/configuration.json`;
  await telechargement.saveAs(fichier);
  const exporte = (await t.locator(".modale .succes").textContent()).trim();
  await t.screenshot({ path: `${sortie}/m01-export.png` });

  const [n2, v2] = cookieProd.split("=");
  const ctxProd = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await ctxProd.addCookies([{ name: n2, value: v2, url: `${PROD}/api/admin` }]);
  const p = await ctxProd.newPage();
  p.on("pageerror", (e) => erreurs.push(`production : ${e.message}`));
  await p.goto(`${PROD}/admin`);
  await p.getByRole("button", { name: "Configuration de l'installation" }).click();
  await p.getByLabel("Fichier de configuration").setInputFiles(fichier);
  await p.getByRole("button", { name: "Importer", exact: true }).click();
  await p.locator(".modale .succes").waitFor();
  const importe = (await p.locator(".modale .succes").textContent()).trim();
  await p.screenshot({ path: `${sortie}/m02-import.png` });
  // Second import : refusé, la base a désormais servi.
  await p.getByRole("button", { name: "Importer", exact: true }).click();
  await p.locator(".modale .erreur").waitFor();
  const refus = (await p.locator(".modale .erreur").textContent()).trim();

  const etabs = (await appelProd("GET", "/etablissements")).etablissements;
  const etatProd = await appelProd("GET", "/stock/etat?etab=moka");
  const commandes = (await appelProd("GET", "/stock/commandes?etab=moka")).commandes;
  const resultat = {
    exporte,
    importe,
    refus,
    etablissement: etabs.map((e) => `${e.id}:${e.identite.raisonSociale}:${e.utilisateurs.map((u) => u.nom).join("+")}:${e.caisses.length}`),
    gin: etatProd.produits.find((x) => x.produitId === "bombay-sapphire")?.quantite,
    commandes: commandes.map((c) => c.numero),
    erreurs,
  };
  console.log(JSON.stringify(resultat, null, 2));
  const ok =
    /Configuration enregistrée/.test(exporte) &&
    /Configuration importée : 1 établissements · 1 personnes/.test(importe) &&
    /Import refusé/.test(refus) &&
    resultat.etablissement.join() === "moka:SAS Moka Annecy:Lionel:0" &&
    resultat.gin === 490 + 1400 &&
    resultat.commandes.join() === "1" &&
    erreurs.length === 0;
  if (!ok) process.exitCode = 1;
} finally {
  await b.close();
  serveur.kill();
}
