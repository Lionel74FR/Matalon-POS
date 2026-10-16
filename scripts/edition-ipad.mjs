// Carte et fiches techniques sur l'iPad (responsables) : le responsable change un prix dans l'éditeur
// de carte de l'iPad, la caisse le reçoit et l'encaisse ; il crée une fiche technique ; un serveur n'a pas l'écran.
// Usage : serveur local vierge (apps/caisse : node scripts/serveur-local.mjs 4180), puis
//         URL=http://localhost:4180 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/edition-ipad.mjs [dossier-captures]
import { chromium } from "playwright";
import { preparerServeur } from "./preparer-caisse.mjs";

const URL = process.env.URL ?? "http://localhost:4180";
const sortie = process.argv[2] ?? "captures";
const { code, appel } = await preparerServeur(URL, "Comptoir");
await appel("POST", "/etablissements/moka/utilisateurs", { nom: "Tom", role: "serveur", pin: "5678", actif: true });
await appel("POST", "/stock/import", {
  etablissementId: "moka",
  tableau: [
    ["produit", "unite", "famille", "zone", "fournisseur", "reference", "conditionnement", "quantite", "prix_ht"],
    ["Café en grains", "kg", "Épicerie", "Réserve", "Torréfacteur du lac", "C1", "Sac 1 kg", "1", "24,00"],
  ],
});

const b = await chromium.launch();
const erreurs = [];
const ctx = await b.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true });
const p = await ctx.newPage();
p.on("pageerror", (e) => erreurs.push(`caisse : ${e.message}`));
p.on("dialog", (d) => void d.accept());
const clic = (nom) => p.getByRole("button", { name: nom, exact: true }).first().click();
const connexion = async (nom, pin) => {
  await p.locator(".carte-personne", { hasText: nom }).click();
  for (const x of pin) await p.locator(".pave .touche", { hasText: new RegExp(`^${x}$`) }).last().click();
};
await p.goto(URL);
await p.locator(".champ-code input").fill(code);
await clic("Rattacher l'iPad");
await clic("Configurer plus tard");
await connexion("Lionel", "1234");
await clic("Plus tard");
await p.locator(".puce-synchro.synchronise").waitFor({ timeout: 15000 });

// ── Carte : Espresso de 2,00 à 2,30 € dans l'éditeur de l'iPad ──
await p.getByRole("button", { name: /^Menu/ }).click();
await p.getByRole("menuitem", { name: "Carte et fiches" }).click();
await p.locator(".editeur-cat-nom", { hasText: "Cafés" }).click();
await p.getByRole("button", { name: "Espresso", exact: true }).click();
await p.locator(".fiche-article label.champ", { hasText: "Prix TTC" }).locator("input").fill("2,30");
await p.getByRole("button", { name: "Valider" }).click();
await p.screenshot({ path: `${sortie}/e01-carte-ipad.png` });
await p.getByRole("button", { name: "Enregistrer", exact: true }).click();
await p.locator(".admin-ok", { hasText: "Enregistrée" }).waitFor();
const debordement = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const carte = (await appel("GET", "/cartes/carte-automne-2026")).carte;
const prixServeur = carte.categories.flatMap((c) => c.articles).find((a) => a.id === "espresso").prixTTC;

// ── Fiche technique : « Espresso » créée sur l'iPad ──
await p.getByRole("tab", { name: "Fiches techniques" }).click();
await clic("Nouvelle recette");
await p.locator(".modale label.champ", { hasText: "Nom" }).locator("input").fill("Espresso maison");
await clic("Ligne");
await p.getByLabel("Ligne 1 : produit ou recette").fill("Café en grains (produit, kg)");
await p.getByLabel("Ligne 1 : quantité").fill("11 g");
await p.getByText("Coût du lot (1 pièce)").waitFor();
await p.screenshot({ path: `${sortie}/e02-fiche-ipad.png` });
await clic("Créer la recette");
await p.getByRole("button", { name: "Enregistrer", exact: true }).waitFor();
await p.getByRole("button", { name: "Fermer" }).click();
const recettes = (await appel("GET", "/stock")).referentiel.recettes.map((r) => r.nom);

// ── La caisse vend l'Espresso au nouveau prix après synchronisation ──
await p.locator(".puce-synchro").click();
await p.locator(".puce-synchro.synchronise").waitFor({ timeout: 20000 });
await clic("Vente comptoir");
const tuileEspresso = (await p.locator(".tuile", { hasText: "Espresso" }).first().textContent()).replace(/\s+/g, " ");

// ── Un serveur n'a pas l'écran Carte et fiches ──
await p.getByRole("button", { name: /^Quitter/ }).click();
await connexion("Tom", "5678");
await clic("Plus tard");
await p.getByRole("button", { name: /^Menu/ }).click();
const menuServeur = await p.getByRole("menuitem", { name: "Carte et fiches" }).count();
await b.close();

const resultat = { prixServeur, recettes, tuileEspresso, menuServeur, debordement, erreurs };
console.log(JSON.stringify(resultat, null, 2));
const ok = prixServeur === 230 && recettes.includes("Espresso maison") && /2,30/.test(tuileEspresso) && menuServeur === 0 && debordement <= 0 && !erreurs.length;
if (!ok) process.exit(1);
