import { describe, expect, it } from "vitest";
import { articlesACompleter, ligneDepuisArticle, lireCatalogue, prixCarte, PRIX_LIBRE_MAX, validerCatalogue, type Catalogue } from "../src/index.js";

const carte = (articles: unknown[]): unknown => ({
  id: "essai",
  nom: "Essai",
  source: "test",
  etablissementId: "chardon",
  categories: [{ id: "divers", nom: "Divers", rayon: "Divers", articles }],
});

const lire = (articles: unknown[]): Catalogue => {
  const r = lireCatalogue(carte(articles));
  expect(r.erreurs).toEqual([]);
  return r.catalogue!;
};

describe("article à prix libre", () => {
  it("se lit, passe la validation sans prix et n'est pas « à compléter »", () => {
    const c = lire([{ id: "divers-soft", nom: "Divers soft", prixTTC: null, tauxTVA: 1000, prixLibre: true }]);
    expect(c.categories[0]!.articles[0]!.prixLibre).toBe(true);
    expect(validerCatalogue(c)).toEqual([]);
    expect(articlesACompleter(c)).toEqual([]);
  });

  it("ignore prixLibre s'il n'est pas vrai", () => {
    const c = lire([{ id: "a", nom: "A", prixTTC: 500, tauxTVA: 1000, prixLibre: "oui" }]);
    expect(c.categories[0]!.articles[0]!.prixLibre).toBeUndefined();
  });

  it("refuse un prix de carte, des variantes, des suppléments ou une formule", () => {
    const c = lire([
      { id: "a", nom: "A", prixTTC: 500, tauxTVA: 1000, prixLibre: true },
      { id: "b", nom: "B", prixTTC: null, tauxTVA: 1000, prixLibre: true, variantes: [{ id: "x", nom: "X", prixTTC: 100 }] },
      { id: "c", nom: "C", prixTTC: null, tauxTVA: 1000, prixLibre: true, supplements: [{ id: "s", nom: "S", prixTTC: 100 }] },
    ]);
    const erreurs = validerCatalogue(c);
    expect(erreurs).toContain("a : un article à prix libre n'a pas de prix de carte");
    expect(erreurs).toContain("b : un article à prix libre n'a ni variante, ni supplément, ni formule");
    expect(erreurs).toContain("c : un article à prix libre n'a ni variante, ni supplément, ni formule");
  });

  it("donne une ligne au prix saisi, refusée sans prix, à zéro, en décimales ou au-delà du plafond", () => {
    const a = lire([{ id: "dj", nom: "DJ", prixTTC: null, tauxTVA: 2000, prixLibre: true }]).categories[0]!.articles[0]!;
    expect(ligneDepuisArticle(a, { prixSaisi: 35000, quantite: 1 })).toEqual({ articleId: "dj", libelle: "DJ", quantite: 1, prixUnitaireTTC: 35000, tauxTVA: 2000 });
    for (const prixSaisi of [undefined, 0, -100, 12.5, PRIX_LIBRE_MAX + 1]) {
      expect(() => ligneDepuisArticle(a, prixSaisi === undefined ? {} : { prixSaisi })).toThrow("saisir le prix de DJ");
    }
  });

  it("est reconnu par le contrôle des prix vendus : seul le taux compte", () => {
    const c = lire([{ id: "dj", nom: "DJ", prixTTC: null, tauxTVA: 2000, prixLibre: true }]);
    expect(prixCarte(c, "dj")).toEqual({ prixTTC: 0, tauxTVA: 2000, nom: "DJ", libre: true });
  });
});
