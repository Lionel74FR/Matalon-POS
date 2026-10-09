// Stock en service (lots 4b à 4d) : les ventes de l'iPad décomptent le stock ; sur l'iPad, un responsable
// fait un inventaire, une réception et une perte ; sur iPhone, même écran. Dans l'administration : stock
// théorique et mouvements, transfert vers un autre établissement, food cost théorique et réel, clé de
// l'agent de factures, facture reçue et ligne rapprochée.
// Usage : serveur local vierge (apps/caisse : node scripts/serveur-local.mjs 4180), puis
//         URL=http://localhost:4180 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/stock-operations.mjs [dossier-captures]
import { chromium } from "playwright";
import { preparerServeur } from "./preparer-caisse.mjs";

const URL = process.env.URL ?? "http://localhost:4180";
const sortie = process.argv[2] ?? "captures";
const { code, cookie, appel } = await preparerServeur(URL, "Comptoir");
const [nomCookie, valeurCookie] = cookie.split("=");

// ── Référentiel par l'API (le parcours stock.mjs couvre déjà l'écran d'import) ──
await appel("POST", "/stock/import", {
  etablissementId: "moka",
  tableau: [
    ["produit", "unite", "famille", "zone", "fournisseur", "reference", "conditionnement", "quantite", "prix_ht"],
    ["Lait entier", "L", "Crèmerie", "Chambre froide", "Metro", "42", "Pack 6 x 1 L", "6", "7,20"],
    ["Café en grains", "kg", "Épicerie", "Réserve", "Torréfacteur du lac", "C1", "Sac 1 kg", "1", "24,00"],
    ["Sucre", "kg", "Épicerie", "Réserve", "Metro", "S5", "Sac 5 kg", "5", "6,50"],
  ],
});
await appel("PUT", "/stock/recettes/cappuccino", {
  recette: { id: "cappuccino", nom: "Cappuccino", unite: "piece", rendement: 1000, lignes: [{ type: "produit", id: "cafe-en-grains", quantite: { valeur: 18, unite: "g" } }, { type: "produit", id: "lait-entier", quantite: { valeur: 150, unite: "mL" } }] },
});
const lue = await appel("GET", "/cartes/carte-automne-2026");
lue.carte.categories.flatMap((c) => c.articles).find((a) => a.id === "cappuccino").fiche = { type: "recette", id: "cappuccino", quantite: { valeur: 1000, unite: "piece" } };
await appel("PUT", "/cartes/carte-automne-2026", { carte: lue.carte, version: lue.version });
await appel("POST", "/etablissements", { id: "chardon", identite: { enseigne: "Chardon" }, carteId: "carte-automne-2026", tables: [], seuilNote: 2500 });

const b = await chromium.launch();
const erreurs = [];
const ctx = await b.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true });
const p = await ctx.newPage();
p.on("pageerror", (e) => erreurs.push(`caisse : ${e.message}`));
const clic = (nom) => p.getByRole("button", { name: nom, exact: true }).first().click();
await p.goto(URL);
await p.locator(".champ-code input").fill(code);
await clic("Rattacher l'iPad");
await clic("Configurer plus tard");
await p.locator(".carte-personne", { hasText: "Lionel" }).click();
for (const x of "1234") await p.locator(".pave .touche", { hasText: new RegExp(`^${x}$`) }).last().click();
await clic("Plus tard");
await p.locator(".puce-synchro.synchronise").waitFor({ timeout: 15000 });

// ── 4b : deux cappuccinos vendus au comptoir ──
await clic("Vente comptoir");
await p.locator(".tuile", { hasText: "Cappuccino" }).first().click();
await p.locator(".tuile", { hasText: "Cappuccino" }).first().click();
await clic("Encaisser");
await p.locator(".mode", { hasText: "Carte bancaire" }).click();
await p.getByRole("button", { name: /^Valider l'encaissement/ }).click();
await clic("Terminé");
await p.locator(".puce-synchro").click();
await p.locator(".puce-synchro.synchronise").waitFor({ timeout: 20000 });
const apresVente = await appel("GET", "/stock/etat?etab=moka");
const q = (etat, id) => etat.produits.find((x) => x.produitId === id)?.quantite;

// ── 4c sur l'iPad : inventaire de la réserve (1 sac + 0,5 kg de café, 4 kg de sucre) ──
await p.getByRole("tab", { name: "Stock" }).click();
await p.getByRole("tab", { name: "Réserve" }).click();
const theoriqueAffiche = (await p.locator(".inventaire-liste li", { hasText: "Café en grains" }).locator("small").first().textContent()).trim();
await p.getByLabel("Café en grains : nombre de Sac 1 kg").fill("1");
await p.getByLabel("Café en grains : kg au détail").fill("0,5");
await p.getByLabel("Sucre : kg au détail").fill("4");
await p.screenshot({ path: `${sortie}/o01-inventaire-ipad.png` });
await clic("Valider l'inventaire (2 produits)");
await p.getByText("Inventaire enregistré : 2 produits.").waitFor();

// Réception Metro : 2 packs de lait au dernier prix (7,20 €), 1 sac de sucre payé 6,90 €.
await p.getByRole("tab", { name: "Réception" }).click();
await p.locator(".operation-entete select").selectOption("Metro");
await p.getByLabel("Lait entier : nombre reçu").fill("2");
await p.getByLabel("Sucre : nombre reçu").fill("1");
await p.getByLabel("Sucre : prix HT du conditionnement").fill("6,90");
const boutonReception = (await p.getByRole("button", { name: /^Réceptionner/ }).textContent()).replace(/\s+/g, " ").trim();
await p.getByRole("button", { name: /^Réceptionner/ }).click();
await p.getByText(/Réception enregistrée : 2 articles/).waitFor();

// Perte : 1 L de lait renversé.
await p.getByRole("tab", { name: "Perte" }).click();
await p.getByRole("radio", { name: "Casse" }).click();
await p.getByLabel("Perte 1 : produit ou recette").fill("Lait entier (produit, L)");
await p.getByLabel("Perte 1 : quantité").fill("1 l");
const boutonPerte = (await p.getByRole("button", { name: /^Enregistrer la perte/ }).textContent()).replace(/\s+/g, " ").trim();
await p.getByRole("button", { name: /^Enregistrer la perte/ }).click();
await p.getByText(/Perte enregistrée \(casse\)/).waitFor();

await p.getByRole("tab", { name: "Stock et pièces" }).click();
await p.locator(".tableau-stock").waitFor();
const tableauStock = (await p.locator(".tableau-stock").textContent()).replace(/\s+/g, " ");
const pieces = await p.locator(".pieces-liste li").count();
await p.screenshot({ path: `${sortie}/o02-stock-ipad.png`, fullPage: true });

// iPhone : même écran, une colonne.
await p.setViewportSize({ width: 390, height: 844 });
await p.getByRole("tab", { name: "Inventaire" }).click();
await p.waitForTimeout(300);
const debordement = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
await p.screenshot({ path: `${sortie}/o03-inventaire-iphone.png` });

// ── Administration : stock, transfert, food cost, factures ──
const bureau = await b.newContext({ viewport: { width: 1280, height: 900 } });
await bureau.addCookies([{ name: nomCookie, value: valeurCookie, url: `${URL}/api/admin` }]);
const a = await bureau.newPage();
a.on("pageerror", (e) => erreurs.push(`admin : ${e.message}`));
a.on("dialog", (d) => void d.accept());
const aclic = (nom) => a.getByRole("button", { name: nom, exact: true }).first().click();
await a.goto(`${URL}/admin`);
await a.getByRole("button", { name: /Stock et recettes/ }).click();
await a.getByRole("tab", { name: "Stock et pièces" }).click();
await a.locator(".tableau-stock").waitFor();
await a.locator(".tableau-stock tr", { hasText: "Lait entier" }).click();
await a.locator(".modale tbody tr").first().waitFor();
const mouvementsLait = (await a.locator(".modale tbody").textContent()).replace(/\s+/g, " ");
await a.screenshot({ path: `${sortie}/o04-mouvements.png` });
await a.getByRole("button", { name: "Fermer" }).click();

// Transfert de 1 kg de sucre au Chardon.
await a.getByRole("tab", { name: "Transfert" }).click();
await a.getByLabel("Transfert 1 : produit").selectOption({ label: "Sucre" });
await a.getByLabel("Transfert 1 : quantité").fill("1");
await aclic("Transférer");
await a.getByText(/Transfert enregistré/).waitFor();

// Food cost du jour.
await a.getByRole("tab", { name: "Food cost" }).click();
await a.locator(".foodcost-tuiles").waitFor();
const tuiles = (await a.locator(".foodcost-tuiles").textContent()).replace(/\s+/g, " ");
const parArticle = (await a.locator(".foodcost-cartes").textContent()).replace(/\s+/g, " ");
await a.screenshot({ path: `${sortie}/o05-food-cost.png`, fullPage: true });

// Agent de factures : clé créée dans l'administration, facture déposée, une ligne à rapprocher.
await a.getByRole("tab", { name: "Factures" }).click();
await aclic("Créer une clé");
const cle = (await a.locator("code.cle-api").textContent()).trim();
const deposer = (numero, lignes) =>
  fetch(`${URL}/api/stock/factures`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cle}` },
    body: JSON.stringify({ etablissementId: "moka", fournisseur: "Metro", numero, date: new Date().toISOString().slice(0, 10), lignes }),
  }).then((r) => r.json());
const depot = await deposer("F-1", [
  { reference: "42", designation: "LAIT ENTIER UHT PACK 6X1L", prixUnitaireHT: 744 },
  { designation: "SUCRE SEMOULE 5KG", prixUnitaireHT: 675 },
]);
await a.getByRole("tab", { name: "Food cost" }).click();
await a.getByRole("tab", { name: "Factures" }).click();
await a.locator("tr", { hasText: "SUCRE SEMOULE 5KG" }).waitFor();
await a.getByLabel("Article pour SUCRE SEMOULE 5KG").selectOption({ label: "Sucre · Metro · Sac 5 kg" });
const articleChoisi = await a.getByLabel("Article pour SUCRE SEMOULE 5KG").locator("option:checked").textContent();
await a.screenshot({ path: `${sortie}/o06-factures.png`, fullPage: true });
await aclic("Rapprocher");
await a.getByText("Rien à rapprocher.").waitFor();
const second = await deposer("F-2", [{ designation: "SUCRE SEMOULE 5KG", prixUnitaireHT: 680 }]);
await b.close();

const stock = await appel("GET", "/stock");
const prixDe = (produitId) => {
  const ids = stock.referentiel.articles.filter((x) => x.produitId === produitId).map((x) => x.id);
  return stock.prix.filter((x) => ids.includes(x.articleId) && x.etablissementId === "moka").sort((x, y) => y.le.localeCompare(x.le))[0];
};
const final = await appel("GET", "/stock/etat?etab=moka");
const chardon = await appel("GET", "/stock/etat?etab=chardon");
const resultat = {
  apresVente: { cafe: q(apresVente, "cafe-en-grains"), lait: q(apresVente, "lait-entier") },
  theoriqueAffiche,
  boutonReception,
  boutonPerte,
  tableauStock: tableauStock.slice(0, 300),
  pieces,
  debordement,
  mouvementsLait,
  tuiles,
  parArticle: parArticle.slice(0, 200),
  depot,
  articleChoisi,
  second,
  prixLait: prixDe("lait-entier"),
  prixSucre: prixDe("sucre"),
  final: { cafe: q(final, "cafe-en-grains"), lait: q(final, "lait-entier"), sucre: q(final, "sucre") },
  sucreChardon: q(chardon, "sucre"),
  erreurs,
};
console.log(JSON.stringify(resultat, null, 2));
const ok =
  resultat.apresVente.cafe === -36 &&
  resultat.apresVente.lait === -300 &&
  /Théorique : -0,036 kg/.test(theoriqueAffiche) &&
  /Réceptionner · 21,30 € HT/.test(boutonReception) &&
  /1,20 € HT/.test(boutonPerte) &&
  pieces === 3 &&
  debordement <= 0 &&
  /Vente/.test(mouvementsLait) &&
  /Réception/.test(mouvementsLait) &&
  /Perte/.test(mouvementsLait) &&
  /Food cost théorique/.test(tuiles) && /Food cost réel\d/.test(tuiles) && /stock d.ouverture/.test(tuiles) &&
  /Cappuccino/.test(parArticle) &&
  depot.rapprochees === 1 &&
  depot.aRapprocher === 1 &&
  second.rapprochees === 1 &&
  resultat.prixLait?.prixHT === 744 &&
  resultat.prixSucre?.prixHT === 680 &&
  resultat.final.cafe === 1500 &&
  resultat.final.lait === -300 + 12000 - 1000 &&
  resultat.final.sucre === 4000 + 5000 - 1000 &&
  resultat.sucreChardon === 1000 &&
  erreurs.length === 0;
if (!ok) process.exit(1);
