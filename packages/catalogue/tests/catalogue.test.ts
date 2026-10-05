import { describe, expect, it } from "vitest";
import {
  articlesACompleter,
  CARTE_AUTOMNE_2026,
  ligneDepuisArticle,
  ligneSupplement,
  tousLesArticles,
  trouverArticle,
  validerCatalogue,
} from "../src/index.js";

describe("carte automne 2026", () => {
  it("est cohérente", () => {
    expect(validerCatalogue(CARTE_AUTOMNE_2026)).toEqual([]);
  });

  it("reprend les prix de la carte", () => {
    const prix = (id: string) => trouverArticle(CARTE_AUTOMNE_2026, id)?.prixTTC;
    expect(prix("espresso")).toBe(250);
    expect(prix("pain-au-chocolat")).toBe(220);
    expect(prix("egg-muffin-charles")).toBe(950);
    expect(prix("moscow-mule")).toBe(1300);
    expect(prix("planche-mer")).toBe(2400);
    expect(prix("dejeuner-charles")).toBe(1900);
  });

  it("applique 20 % aux boissons alcoolisées et 10 % au reste", () => {
    const tva = (id: string) => trouverArticle(CARTE_AUTOMNE_2026, id)?.tauxTVA;
    expect(tva("spritz-aperol")).toBe(2000);
    expect(tva("funambules-ipa")).toBe(2000);
    expect(tva("virgin-martini-spritz")).toBe(1000);
    expect(tva("sundown")).toBe(1000);
    expect(tva("bubble-tea")).toBe(1000);
  });

  it("liste ce qui manque avant la mise en caisse", () => {
    expect(articlesACompleter(CARTE_AUTOMNE_2026).map((a) => a.id)).toEqual([
      "vin-verre",
      "vin-bouteille",
      "biere-artisanale",
    ]);
  });

  it("produit des lignes de ticket avec variante et supplément", () => {
    const bubble = trouverArticle(CARTE_AUTOMNE_2026, "bubble-tea")!;
    expect(() => ligneDepuisArticle(bubble)).toThrow(/variante/);
    expect(ligneDepuisArticle(bubble, { varianteId: "taro" })).toEqual({
      articleId: "bubble-tea:taro",
      libelle: "Bubble tea Taro",
      quantite: 1,
      prixUnitaireTTC: 650,
      tauxTVA: 1000,
    });
    expect(ligneSupplement(bubble, bubble.supplements![1]!)).toMatchObject({ libelle: "Suppl. Perles popping", prixUnitaireTTC: 50 });
    const eau = trouverArticle(CARTE_AUTOMNE_2026, "eau-minerale")!;
    expect(ligneDepuisArticle(eau, { varianteId: "100cl" })).toMatchObject({ libelle: "Eau minérale 100 cl", prixUnitaireTTC: 550 });
    const coca = trouverArticle(CARTE_AUTOMNE_2026, "coca")!;
    expect(ligneDepuisArticle(coca, { varianteId: "zero" }).libelle).toBe("Coca zero");
  });

  it("compte les articles de la carte (variantes regroupées)", () => {
    expect(tousLesArticles(CARTE_AUTOMNE_2026).length).toBe(93);
  });
});
