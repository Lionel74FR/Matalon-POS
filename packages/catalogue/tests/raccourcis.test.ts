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
    // Toujours par ordre alphabétique en caisse, articles repris mêlés, accents ignorés.
    c.categories[2]!.articles.unshift({ id: "zubrowka", nom: "Zubrowka", prixTTC: 800, tauxTVA: 2000 }, { id: "eau", nom: "Évian", prixTTC: 450, tauxTVA: 1000 });
    expect(tuilesDeCategorie(c, "nuit").map((a) => a.nom)).toEqual(["Anderson", "Coca-Cola", "Corona", "Évian", "Zubrowka"]);
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

describe("liens vers d'autres catégories et recherche", () => {
  it("lit, valide et nettoie les liens ; la fusion les redirige", async () => {
    const { liensDeCategorie } = await import("../src/index.js");
    const c = carte();
    c.categories[2]!.liens = ["bieres", "softs"];
    expect(validerCatalogue(c)).toEqual([]);
    expect(liensDeCategorie(c, "nuit").map((x) => x.id)).toEqual(["bieres", "softs"]);
    c.categories[2]!.liens = ["bieres", "bieres", "nuit", "fantome"];
    const erreurs = validerCatalogue(c);
    expect(erreurs).toContain("catégorie Nuit : lien bieres en double");
    expect(erreurs).toContain("catégorie Nuit : lien vers elle-même");
    expect(erreurs).toContain("catégorie Nuit : catégorie fantome introuvable");
    expect(nettoyerRaccourcis(c).categories[2]!.liens).toEqual(["bieres"]);
    const relu = lireCatalogue({ ...carte(), categories: carte().categories.map((x) => (x.id === "nuit" ? { ...x, liens: ["softs"] } : x)) });
    expect(relu.catalogue!.categories[2]!.liens).toEqual(["softs"]);
    const avecLien = carte();
    avecLien.categories[0]!.liens = ["softs"];
    avecLien.categories[2]!.liens = ["softs"];
    avecLien.categories[2]!.articles[0]!.tauxTVA = 1000;
    // Softs fusionnée dans Nuit : le lien de Bières vers Softs pointe vers Nuit, celui de Nuit vers elle-même disparaît.
    const f = fusionnerCategories(avecLien, "softs", "nuit");
    expect(f.categories.find((x) => x.id === "bieres")!.liens).toEqual(["nuit"]);
    expect("liens" in f.categories.find((x) => x.id === "nuit")!).toBe(false);
  });

  it("cherche un article par son nom, sans accents ni majuscules, le début du nom d'abord", async () => {
    const { rechercherArticles } = await import("../src/index.js");
    const c = carte();
    c.categories[1]!.articles.push({ id: "coca-zero", nom: "Coca zéro", prixTTC: 450, tauxTVA: 1000 }, { id: "rhum-coca", nom: "Rhum coca", prixTTC: 900, tauxTVA: 2000 });
    const trouves = rechercherArticles(c, "COCA").map((a) => a.id);
    expect(trouves.slice(0, 2).sort()).toEqual(["coca", "coca-zero"]);
    expect(trouves[2]).toBe("rhum-coca");
    expect(rechercherArticles(c, "zero coca").map((a) => a.id)).toEqual(["coca-zero"]);
    expect(rechercherArticles(c, "c")).toEqual([]);
  });
});
