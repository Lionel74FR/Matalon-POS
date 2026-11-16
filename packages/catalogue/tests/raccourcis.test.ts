import { describe, expect, it } from "vitest";
import { fusionnerCategories, lireCatalogue, nettoyerRaccourcis, tuilesDeCategorie, validerCatalogue, type Catalogue } from "../src/index.js";

const carte = (): Catalogue => {
  const r = lireCatalogue({
    id: "essai",
    nom: "Essai",
    source: "test",
    etablissementId: "chardon",
    categories: [
      { id: "bieres", nom: "Bières", rayon: "Bières", poste: "Bar", articles: [{ id: "corona", nom: "Corona", prixTTC: 900, tauxTVA: 2000 }] },
      { id: "softs", nom: "Softs", rayon: "Softs", articles: [{ id: "coca", nom: "Coca-Cola", prixTTC: 450, tauxTVA: 1000 }] },
      { id: "nuit", nom: "Nuit", rayon: "Nuit", articles: [{ id: "anderson", nom: "Anderson", prixTTC: 1200, tauxTVA: 1000 }], raccourcis: ["coca", "corona"] },
    ],
  });
  expect(r.erreurs).toEqual([]);
  return r.catalogue!;
};

describe("un article dans plusieurs catégories", () => {
  it("se lit, se valide, et donne les tuiles de la catégorie dans l'ordre, avec la catégorie d'origine", () => {
    const c = carte();
    expect(validerCatalogue(c)).toEqual([]);
    expect(tuilesDeCategorie(c, "nuit").map((a) => [a.id, a.categorieId, a.raccourci])).toEqual([
      ["anderson", "nuit", false],
      ["coca", "softs", true],
      ["corona", "bieres", true],
    ]);
    expect(tuilesDeCategorie(c, "softs").map((a) => a.id)).toEqual(["coca"]);
  });

  it("refuse un article inconnu, déjà dans la catégorie ou repris deux fois", () => {
    const c = carte();
    c.categories[2]!.raccourcis = ["coca", "coca", "anderson", "fantome"];
    const erreurs = validerCatalogue(c);
    expect(erreurs).toContain("catégorie Nuit : coca en double");
    expect(erreurs).toContain("catégorie Nuit : anderson y est déjà");
    expect(erreurs).toContain("catégorie Nuit : article fantome introuvable");
    expect(nettoyerRaccourcis(c).categories[2]!.raccourcis).toEqual(["coca"]);
  });

  it("suit les fusions et les suppressions", () => {
    const fusion = fusionnerCategories(carte(), "nuit", "softs");
    // Le Coca, désormais dans la catégorie, n'y est plus repris ; la Corona l'est toujours.
    expect(fusion.categories.find((x) => x.id === "softs")!.raccourcis).toEqual(["corona"]);
    const c = carte();
    c.categories[1]!.articles = [];
    expect(nettoyerRaccourcis(c).categories[2]!.raccourcis).toEqual(["corona"]);
    c.categories[0]!.articles = [];
    expect("raccourcis" in nettoyerRaccourcis(c).categories[2]!).toBe(false);
  });
});
