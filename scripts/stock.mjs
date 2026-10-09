// Stock et fiches techniques (lot 4a), dans l'administration : import des premiers produits (CSV puis
// classeur Excel), fournisseur ajouté et doublon refusé, recette avec sous-recette et perte, fiche
// technique reliée à un article de la carte avec son food cost, part des articles couverts.
// Usage : serveur local vierge (apps/caisse : node scripts/serveur-local.mjs 4180), puis
//         URL=http://localhost:4180 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/stock.mjs [dossier-captures]
import { mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { preparerServeur } from "./preparer-caisse.mjs";

const require = createRequire(new globalThis.URL("../apps/caisse/package.json", import.meta.url));
const { zipSync, strToU8 } = require("fflate");

const URL = process.env.URL ?? "http://localhost:4180";
const sortie = process.argv[2] ?? "captures";
const { cookie, appel } = await preparerServeur(URL, "Comptoir");
const [nomCookie, valeurCookie] = cookie.split("=");
const dossier = mkdtempSync(join(tmpdir(), "stock-"));

// Tableur CSV « à la française », tel qu'Excel l'enregistre : point-virgule, virgule décimale.
const csv = join(dossier, "produits-moka.csv");
writeFileSync(
  csv,
  [
    "Produit;Unité;Famille;Zone;Fournisseur;Référence;Conditionnement;Quantité;Prix HT;Poids unitaire (g)",
    "Lait entier;L;Crèmerie;Chambre froide;Metro;42;Pack 6 x 1 L;6;7,20;",
    "Café en grains;kg;Épicerie;Réserve;Torréfacteur du lac;;Sac 1 kg;1;24,00;",
    "Crème liquide 35 %;L;Crèmerie;Chambre froide;Metro;123456;Carton 6 x 1 L;6;21,90;",
    "Sucre;kg;Épicerie;Réserve;Metro;;Sac 5 kg;5;6,50;",
    "Œufs plein air;pièce;Crèmerie;Chambre froide;Metro;;Plateau de 30;30;7,50;60",
    "Farine;sac;;;;;;;;",
  ].join("\r\n"),
);

// Classeur Excel minimal (.xlsx) : un produit de plus et un doublon du CSV (non recréé).
const xlsx = join(dossier, "complement.xlsx");
const chaines = ["produit", "unite", "fournisseur", "quantite", "prix_ht", "Beurre doux", "kg", "Metro", "LAIT ENTIER", "L"];
const s = (i) => `<c t="s"><v>${i}</v></c>`;
const n = (v) => `<c><v>${v}</v></c>`;
const ligne = (r, cellules) => `<row r="${r}">${cellules.map((c, i) => c.replace("<c", `<c r="${String.fromCharCode(65 + i)}${r}"`)).join("")}</row>`;
writeFileSync(
  xlsx,
  zipSync({
    "[Content_Types].xml": strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
    "xl/workbook.xml": strToU8('<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Produits" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    "xl/_rels/workbook.xml.rels": strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
    "xl/sharedStrings.xml": strToU8(`<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${chaines.map((c) => `<si><t>${c}</t></si>`).join("")}</sst>`),
    "xl/worksheets/sheet1.xml": strToU8(
      `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${[
        ligne(1, [s(0), s(1), s(2), s(3), s(4)]),
        ligne(2, [s(5), s(6), s(7), n(2.5), n(19.899999999999999)]),
        ligne(3, [s(8), s(9), s(7), n(6), n(7.2)]),
      ].join("")}</sheetData></worksheet>`,
    ),
  }),
);

const b = await chromium.launch();
const erreurs = [];
const bureau = await b.newContext({ viewport: { width: 1280, height: 900 } });
await bureau.addCookies([{ name: nomCookie, value: valeurCookie, url: `${URL}/api/admin` }]);
const a = await bureau.newPage();
a.on("pageerror", (e) => erreurs.push(e.message));
a.on("dialog", (d) => void d.accept());
const clic = (nom) => a.getByRole("button", { name: nom, exact: true }).first().click();
await a.goto(`${URL}/admin`);
await a.getByRole("button", { name: /Stock et recettes/ }).click();
await a.getByText("Aucun produit pour l'instant").waitFor();

// ── Import CSV : aperçu, vérification sans écriture, puis import ──
await a.getByRole("tab", { name: "Importer", exact: true }).click();
await a.locator("input[type=file]").setInputFiles(csv);
await a.getByText("5 lignes lisibles, 1 à corriger").waitFor();
const apercuErreur = await a.locator(".stock ul.erreur li").first().textContent();
await clic("Vérifier");
await a.getByText("Vérification (rien n'est encore enregistré)").waitFor();
const avantImport = (await appel("GET", "/stock")).referentiel.produits.length;
await a.screenshot({ path: `${sortie}/k01-import-verifie.png`, fullPage: true });
await clic("Importer");
await a.getByText("Import terminé").waitFor();
const rapportCsv = (await a.locator(".stock-rapport").textContent()).replace(/\s+/g, " ");

// ── Import Excel : un produit nouveau, le doublon (casse différente) n'est pas recréé ──
await a.locator("input[type=file]").setInputFiles(xlsx);
await a.getByText("2 lignes lisibles").waitFor();
await clic("Vérifier");
await a.getByText("Vérification (rien").waitFor();
await clic("Importer");
await a.getByText("Import terminé").waitFor();
const rapportXlsx = (await a.locator(".stock-rapport").textContent()).replace(/\s+/g, " ");

// ── Produits : prix par unité, second fournisseur, doublon refusé ──
await clic("Voir les produits");
await a.locator(".stock-table tr", { hasText: "Lait entier" }).waitFor();
const prixLait = (await a.locator(".stock-table tr", { hasText: "Lait entier" }).locator("td").nth(2).textContent()).replace(/\s+/g, " ");
await a.getByRole("button", { name: "Lait entier", exact: true }).click();
await a.getByLabel("Fournisseur", { exact: true }).fill("Promocash");
await a.getByLabel("Conditionnement", { exact: true }).fill("Brique 1 L");
await a.getByLabel("Quantité en L").fill("1");
await a.getByLabel("Prix HT du conditionnement").fill("1,35");
await clic("Fournisseur");
await a.locator(".modale .stock-table tr", { hasText: "Promocash" }).waitFor();
await a.screenshot({ path: `${sortie}/k02-produit.png` });
await a.getByRole("button", { name: "Fermer" }).click();
await clic("Nouveau produit");
await a.locator(".modale label.champ", { hasText: "Nom" }).locator("input").fill("Lait Entier");
const avertissementDoublon = await a.getByText("Déjà dans la liste").count();
await clic("Créer le produit");
await a.locator(".modale .erreur").waitFor();
const refusDoublon = await a.locator(".modale .erreur").textContent();
await a.getByRole("button", { name: "Fermer" }).click();

// ── Recettes : sauce caramel (lot de 1 kg), puis latte caramel qui l'utilise ──
await a.getByRole("tab", { name: /^Recettes/ }).click();
const ligneRecette = async (i, composant, quantite, perte) => {
  await clic("Ligne");
  await a.getByLabel(`Ligne ${i} : produit ou recette`).fill(composant);
  await a.getByLabel(`Ligne ${i} : quantité`).fill(quantite);
  if (perte) await a.getByLabel(`Ligne ${i} : perte en %`).fill(perte);
};
await clic("Nouvelle recette");
await a.locator(".modale label.champ", { hasText: "Nom" }).locator("input").fill("Sauce caramel");
await a.locator(".modale label.champ", { hasText: "Produite en" }).locator("select").selectOption("kg");
await ligneRecette(1, "Sucre (produit, kg)", "600 g");
await ligneRecette(2, "Crème liquide 35 % (produit, L)", "40 cl");
await a.getByText("Coût du lot (1 kg)").waitFor();
const coutSauce = (await a.locator(".stock-total p").textContent()).replace(/\s+/g, " ");
await clic("Créer la recette");
await a.getByRole("button", { name: "Enregistrer", exact: true }).waitFor();
await a.getByRole("button", { name: "Fermer" }).click();
await clic("Nouvelle recette");
await a.locator(".modale label.champ", { hasText: "Nom" }).locator("input").fill("Latte caramel");
await ligneRecette(1, "Café en grains (produit, kg)", "18 g");
await ligneRecette(2, "Lait entier (produit, L)", "200 ml", "10");
await ligneRecette(3, "Sauce caramel (recette, kg)", "20 g");
// Ligne en pièce pour un produit compté au kilo, sans poids par pièce : refusée tant qu'elle n'est pas corrigée.
await ligneRecette(4, "Sucre (produit, kg)", "1 pièce");
const alerteUnite = await a.getByText("Indiquez le poids d'une pièce de « Sucre »").count();
await a.getByRole("button", { name: "Retirer la ligne 4" }).click();
await a.getByText("Coût du lot (1 pièce)").waitFor();
const coutLatte = (await a.locator(".stock-total p").textContent()).replace(/\s+/g, " ");
await a.screenshot({ path: `${sortie}/k03-recette.png` });
await clic("Créer la recette");
await a.getByRole("button", { name: "Enregistrer", exact: true }).waitFor();
await a.getByRole("button", { name: "Fermer" }).click();
await a.locator(".stock-table tr", { hasText: "Latte caramel" }).waitFor();
await a.screenshot({ path: `${sortie}/k04-recettes.png`, fullPage: true });

// ── Carte : le latte pointe vers sa fiche, food cost affiché ──
await a.getByRole("button", { name: /Cartes et prix/ }).click();
await clic("Modifier");
await a.locator(".editeur-fiches").waitFor();
const avantFiches = (await a.locator(".editeur-fiches").textContent()).replace(/\s+/g, " ");
await a.locator(".editeur-cat-nom", { hasText: "Cafés" }).click();
await a.getByRole("button", { name: "Latte", exact: true }).click();
await a.getByLabel("Fiche technique de Latte").fill("Latte caramel (recette, pièce)");
await a.locator(".fiche-resultat", { hasText: "food cost" }).waitFor();
const ficheLatte = (await a.locator(".fiche-resultat").first().textContent()).replace(/\s+/g, " ");
await a.screenshot({ path: `${sortie}/k05-fiche-article.png` });
await clic("Valider");
const colonneFc = (await a.locator("tr", { hasText: "Latte" }).first().locator("td").nth(3).textContent()).trim();
await clic("Enregistrer");
await a.getByText("Enregistrée").waitFor();
const apresFiches = (await a.locator(".editeur-fiches").textContent()).replace(/\s+/g, " ");
await a.screenshot({ path: `${sortie}/k06-carte.png`, fullPage: true });
await b.close();

const carte = (await appel("GET", "/cartes/carte-automne-2026")).carte;
const fiche = carte.categories.flatMap((c) => c.articles).find((x) => x.id === "latte").fiche;
const stock = await appel("GET", "/stock");
const resultat = {
  apercuErreur,
  avantImport,
  rapportCsv,
  rapportXlsx,
  prixLait,
  avertissementDoublon,
  refusDoublon,
  coutSauce,
  alerteUnite,
  coutLatte,
  avantFiches,
  ficheLatte,
  colonneFc,
  apresFiches,
  fiche,
  produits: stock.referentiel.produits.map((p) => p.nom),
  articles: stock.referentiel.articles.length,
  erreurs,
};
console.log(JSON.stringify(resultat, null, 2));
// Coûts attendus au Moka. Lait : dernier prix payé = 1,35 € la brique (Promocash, saisi après le pack Metro).
// Sauce caramel, 1 kg : 600 g de sucre à 1,30 €/kg (0,78 €) + 40 cl de crème à 3,65 €/L (1,46 €) = 2,24 €.
// Latte caramel : 18 g de café (0,432 €) + 200 ml de lait, 10 % de perte → 222 ml à 1,35 €/L (0,2997 €) + 20 g de sauce (0,0448 €) = 0,7765 €.
// Prix 5,00 € TTC à 10 % → 4,55 € HT → food cost 17,1 %.
const ok =
  /Farine/.test(apercuErreur) &&
  avantImport === 0 &&
  /5 produits créés/.test(rapportCsv) && /5 fournisseurs ajoutés, 5 prix enregistrés/.test(rapportCsv) &&
  /1 produit créé : Beurre doux/.test(rapportXlsx) &&
  /Déjà connus, non recréés : Lait entier/.test(rapportXlsx) &&
  /1,20 € \/ L/.test(prixLait) &&
  avertissementDoublon === 1 &&
  /existe déjà/.test(refusDoublon) &&
  /2,24 € HT/.test(coutSauce) &&
  alerteUnite === 1 &&
  /0,78 € HT/.test(coutLatte) &&
  /Fiches techniques : 0 \//.test(avantFiches) &&
  /food cost 17,1 %/.test(ficheLatte) &&
  colonneFc === "17,1 %" &&
  /Fiches techniques : 1 \//.test(apresFiches) &&
  fiche?.type === "recette" &&
  stock.referentiel.produits.length === 6 &&
  stock.referentiel.articles.length === 7 &&
  erreurs.length === 0;
if (!ok) process.exit(1);
