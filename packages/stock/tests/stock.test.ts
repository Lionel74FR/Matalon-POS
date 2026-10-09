import { describe, expect, it } from "vitest";
import {
  centimes,
  Couts,
  foodCost,
  formaterQuantite,
  lireLignesImport,
  lireQuantite,
  lireRecette,
  lireTableau,
  planifierImport,
  prixHT,
  validerReferentiel,
  versBase,
  type PrixAchat,
  type Referentiel,
} from "../src/index.js";

/** Burger : steak 180 g, pain à la pièce, cheddar en tranches, sauce maison par lot de 1,2 kg. */
const ref: Referentiel = {
  produits: [
    { id: "steak", nom: "Steak haché 15 %", unite: "kg", actif: true },
    { id: "pain", nom: "Pain burger", unite: "piece", contenance: { valeur: 85, unite: "g" }, actif: true },
    { id: "cheddar", nom: "Cheddar en tranches", unite: "piece", actif: true },
    { id: "mayo", nom: "Mayonnaise", unite: "kg", actif: true },
    { id: "cornichon", nom: "Cornichons", unite: "kg", actif: true },
    { id: "frites", nom: "Frites crues", unite: "kg", actif: true },
  ],
  articles: [
    { id: "steak-metro", produitId: "steak", fournisseur: "Metro", conditionnement: "Carton 5 kg", quantite: 5000, actif: true },
    { id: "pain-boulanger", produitId: "pain", fournisseur: "Boulangerie", conditionnement: "Sachet de 30", quantite: 30_000, actif: true },
    { id: "cheddar-metro", produitId: "cheddar", fournisseur: "Metro", conditionnement: "Paquet de 88 tranches", quantite: 88_000, actif: true },
    { id: "mayo-metro", produitId: "mayo", fournisseur: "Metro", conditionnement: "Seau 5 kg", quantite: 5000, actif: true },
    { id: "cornichon-metro", produitId: "cornichon", fournisseur: "Metro", conditionnement: "Bocal 2 kg", quantite: 2000, actif: true },
  ],
  recettes: [
    {
      id: "sauce",
      nom: "Sauce burger",
      unite: "kg",
      rendement: 1200,
      lignes: [
        { type: "produit", id: "mayo", quantite: { valeur: 1000, unite: "g" } },
        { type: "produit", id: "cornichon", quantite: { valeur: 200, unite: "g" } },
      ],
      actif: true,
    },
    {
      id: "burger",
      nom: "Burger",
      unite: "piece",
      rendement: 1000,
      lignes: [
        { type: "produit", id: "steak", quantite: { valeur: 180, unite: "g" } },
        { type: "produit", id: "pain", quantite: { valeur: 1000, unite: "piece" } },
        { type: "produit", id: "cheddar", quantite: { valeur: 2000, unite: "piece" } },
        { type: "recette", id: "sauce", quantite: { valeur: 30, unite: "g" } },
        // Frites épluchées : 200 g nets, 20 % de perte → 250 g bruts. Aucun prix encore.
        { type: "produit", id: "frites", quantite: { valeur: 200, unite: "g" }, perte: 2000 },
      ],
      actif: true,
    },
  ],
};

const prix: PrixAchat[] = [
  { articleId: "steak-metro", etablissementId: "moka", prixHT: 8175, le: "2026-10-01T08:00:00Z", source: "import" },
  { articleId: "steak-metro", etablissementId: "moka", prixHT: 8500, le: "2026-10-08T08:00:00Z", source: "import" },
  { articleId: "pain-boulanger", etablissementId: "moka", prixHT: 2850, le: "2026-10-01T08:00:00Z", source: "import" },
  { articleId: "cheddar-metro", etablissementId: "chardon", prixHT: 998, le: "2026-10-01T08:00:00Z", source: "import" },
  { articleId: "mayo-metro", etablissementId: "moka", prixHT: 2400, le: "2026-10-01T08:00:00Z", source: "import" },
  { articleId: "cornichon-metro", etablissementId: "moka", prixHT: 1300, le: "2026-10-01T08:00:00Z", source: "import" },
];

describe("unités", () => {
  it("lit les quantités saisies et les formate", () => {
    expect(lireQuantite("30 g")).toEqual({ valeur: 30, unite: "g" });
    expect(lireQuantite("0,03 kg")).toEqual({ valeur: 30, unite: "g" });
    expect(lireQuantite("12 cl")).toEqual({ valeur: 120, unite: "mL" });
    expect(lireQuantite("2 pièces")).toEqual({ valeur: 2000, unite: "piece" });
    expect(lireQuantite("0,5", "piece")).toEqual({ valeur: 500, unite: "piece" });
    expect(lireQuantite("trois")).toBeNull();
    expect(lireQuantite("0 g")).toBeNull();
    expect(formaterQuantite({ valeur: 1200, unite: "mL" })).toBe("1,2 L");
    expect(formaterQuantite({ valeur: 120, unite: "mL" })).toBe("12 cL");
    expect(formaterQuantite({ valeur: 2000, unite: "piece" })).toBe("2 pièces");
  });

  it("convertit pièce et poids par le poids d'une pièce, jamais poids et volume", () => {
    const pain = ref.produits[1]!;
    expect(versBase({ valeur: 170, unite: "g" }, pain)).toBe(2000);
    expect(versBase({ valeur: 1000, unite: "piece" }, { unite: "kg", contenance: { valeur: 60, unite: "g" } })).toBe(60);
    expect(versBase({ valeur: 100, unite: "mL" }, { unite: "kg" })).toBeNull();
    expect(versBase({ valeur: 30, unite: "g" }, ref.produits[2]!)).toBeNull();
  });
});

describe("coûts", () => {
  it("chiffre une recette avec sous-recette et perte, prix de l'établissement d'abord", () => {
    const c = new Couts(ref, prix, "moka");
    // Steak : dernier prix du Moka, 85,00 € les 5 kg → 180 g = 3,06 €.
    expect(centimes(c.cout("produit", "steak", 180).micro)).toBe(306);
    // Sauce : (1 kg × 24 €/5 kg + 0,2 kg × 13 €/2 kg) / 1,2 kg → 30 g = 0,1525 €.
    const burger = c.cout("recette", "burger", 1000);
    // Steak 3,06 + pain 0,95 + cheddar 2 × 9,98/88 (emprunté au Chardon) + sauce 0,1525.
    expect(burger.micro).toBe(3_060_000 + 950_000 + 226_818 + 152_500);
    expect(burger.emprunts).toEqual(["Cheddar en tranches"]);
    expect(burger.manquants).toEqual(["Frites crues"]);
    expect(burger.erreurs).toEqual([]);
  });

  it("au Chardon, les prix du Moka sont empruntés et le cheddar est local", () => {
    const c = new Couts(ref, prix, "chardon");
    expect(c.prixProduit("cheddar")?.source).toBe("etablissement");
    expect(c.prixProduit("steak")?.source).toBe("emprunte");
    expect(c.prixProduit("frites")).toBeNull();
  });

  it("food cost : coût HT sur prix de vente HT, en points de base", () => {
    expect(prixHT(1650, 1000)).toBe(1500);
    // 4,40 € de coût pour un burger à 16,50 € TTC (15,00 € HT) → 29,33 %.
    expect(foodCost(4_400_000, 1650, 1000)).toBe(2933);
    expect(foodCost(4_400_000, null, 1000)).toBeNull();
  });
});

describe("validation", () => {
  it("refuse doublons, références inconnues, unités inconvertibles et cycles", () => {
    expect(validerReferentiel(ref)).toEqual([]);
    const casse: Referentiel = {
      ...ref,
      produits: [...ref.produits, { id: "steak-2", nom: "steak hache 15%", unite: "kg", actif: true }],
      recettes: [
        { ...ref.recettes[0]!, lignes: [...ref.recettes[0]!.lignes, { type: "recette", id: "burger", quantite: { valeur: 1000, unite: "piece" } }] },
        { ...ref.recettes[1]!, lignes: [...ref.recettes[1]!.lignes, { type: "produit", id: "cheddar", quantite: { valeur: 20, unite: "g" } }, { type: "produit", id: "inconnu", quantite: { valeur: 1, unite: "g" } }] },
      ],
    };
    const e = validerReferentiel(casse);
    expect(e.some((x) => /Steak haché 15 %/.test(x) && /existe déjà/.test(x))).toBe(true);
    expect(e.some((x) => /se contient elle-même/.test(x))).toBe(true);
    expect(e.some((x) => /Cheddar en tranches/.test(x) && /poids ou volume/.test(x))).toBe(true);
    expect(e.some((x) => /inconnu/.test(x))).toBe(true);
  });

  it("lecture stricte d'une recette", () => {
    expect(lireRecette({ id: "x", nom: "X", unite: "kg", rendement: 0, lignes: [] }).erreurs[0]).toMatch(/rendement/);
    expect(lireRecette({ id: "x", nom: "X", unite: "kg", rendement: 1000, lignes: [{ type: "produit", id: "mayo", quantite: { valeur: 10.5, unite: "g" } }] }).recette).toBeNull();
    const ok = lireRecette({ id: "x", nom: " X ", unite: "kg", rendement: 1000, lignes: [{ type: "produit", id: "mayo", quantite: { valeur: 10, unite: "g" }, perte: 0 }], inconnu: 1 });
    expect(ok.recette).toEqual({ id: "x", nom: "X", unite: "kg", rendement: 1000, lignes: [{ type: "produit", id: "mayo", quantite: { valeur: 10, unite: "g" } }], actif: true });
  });
});

describe("import", () => {
  const csv = [
    "Produit;Unité;Famille;Zone;Fournisseur;Référence;Conditionnement;Quantité;Prix HT;Poids unitaire (g)",
    "Crème liquide 35 %;L;Crèmerie;Chambre froide;Metro;123456;Carton 6 x 1 L;6;21,90;",
    "Crème liquide 35 %;L;;;Promocash;;Brique 1 L;1;3,95 €;",
    '"Œufs plein air";pièce;Crèmerie;Chambre froide;Metro;;Plateau de 30;30;7,50;60',
    "Sel fin;kg;Épicerie sèche;Réserve;;;;;;",
    "Beurre;litre;;;Metro;;Plaque;1;;",
    "Farine;sac;;;;;;;;",
  ].join("\n");

  it("lit un CSV français, signale les lignes fautives", () => {
    const { lignes, erreurs } = lireLignesImport(lireTableau(csv));
    expect(lignes.map((l) => [l.produit, l.unite, l.quantite, l.prixHT])).toEqual([
      ["Crème liquide 35 %", "L", 6000, 2190],
      ["Crème liquide 35 %", "L", 1000, 395],
      ["Œufs plein air", "piece", 30_000, 750],
      ["Sel fin", "kg", undefined, undefined],
    ]);
    expect(lignes[2]!.poidsUnitaire).toBe(60);
    expect(erreurs).toEqual([
      { ligne: 6, message: "« Beurre » : prix HT manquant pour Metro" },
      { ligne: 7, message: "« Farine » : unité « sac » inconnue (kg, L ou pièce)" },
    ]);
  });

  it("lit un collage Excel (tabulations)", () => {
    const { lignes } = lireLignesImport(lireTableau("produit\tunite\tfournisseur\tquantite\tprix_ht\nCitron\tpièce\tPrimeur\t1\t0,35"));
    expect(lignes).toEqual([{ ligne: 2, produit: "Citron", unite: "piece", fournisseur: "Primeur", quantite: 1000, prixHT: 35 }]);
  });

  it("ne recrée jamais un produit, n'ajoute un prix que s'il change", () => {
    const { lignes } = lireLignesImport(lireTableau(csv));
    const a = planifierImport({ produits: [], articles: [], recettes: [] }, [], lignes, "moka", "2026-10-09T10:00:00Z");
    expect(a.rapport.produitsCrees).toEqual(["Crème liquide 35 %", "Œufs plein air", "Sel fin"]);
    expect(a.rapport.articlesCrees).toBe(3);
    expect(a.prix).toHaveLength(3);
    expect(a.referentiel.produits.find((p) => p.nom === "Œufs plein air")).toMatchObject({ id: "oeufs-plein-air", unite: "piece", contenance: { valeur: 60, unite: "g" } });
    expect(validerReferentiel(a.referentiel)).toEqual([]);
    // Même tableur une deuxième fois, un prix changé : rien de recréé, un seul prix nouveau.
    const encore = lireLignesImport(lireTableau(csv.replace("21,90", "22,40"))).lignes;
    const b = planifierImport(a.referentiel, a.prix, encore, "moka", "2026-10-10T10:00:00Z");
    expect(b.rapport.produitsCrees).toEqual([]);
    expect(b.rapport.produitsExistants).toEqual(["Crème liquide 35 %", "Œufs plein air", "Sel fin"]);
    expect(b.rapport.articlesCrees).toBe(0);
    expect(b.prix).toEqual([{ articleId: a.prix[0]!.articleId, etablissementId: "moka", prixHT: 2240, le: "2026-10-10T10:00:00Z", source: "import" }]);
    // Même nom, autre unité : refusé, jamais un second produit.
    const c = planifierImport(a.referentiel, a.prix, [{ ligne: 2, produit: "creme liquide 35%", unite: "kg" }], "moka", "2026-10-10T10:00:00Z");
    expect(c.referentiel.produits).toHaveLength(3);
    expect(c.rapport.erreurs[0]!.message).toMatch(/existe déjà, compté en L/);
  });
});
