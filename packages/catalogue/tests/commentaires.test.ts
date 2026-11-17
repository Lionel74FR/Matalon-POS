import { describe, expect, it } from "vitest";
import { groupesCommentaires, lireCatalogue, validerCatalogue } from "../src/index.js";

// Groupes de commentaires (17 novembre 2026, Lionel : cuissons des viandes), liés aux articles depuis la carte.
const brute = () => ({
  id: "essai",
  nom: "Essai",
  source: "test",
  etablissementId: "chardon",
  commentaires: [
    { id: "cuisson", nom: "Cuisson", commentaires: ["Bleu", "Saignant", "À point", "Bien cuit"], obligatoire: true },
    { id: "sauce", nom: "Sauce", commentaires: ["Poivre", "Béarnaise"], plusieurs: true },
  ],
  categories: [
    {
      id: "plats",
      nom: "Plats",
      rayon: "Cuisine",
      poste: "Cuisine",
      articles: [
        { id: "entrecote", nom: "Entrecôte", prixTTC: 2400, tauxTVA: 1000, commentaires: ["cuisson", "sauce"] },
        { id: "salade", nom: "Salade", prixTTC: 1200, tauxTVA: 1000 },
      ],
    },
  ],
});

describe("groupes de commentaires", () => {
  it("se lisent, se valident et se retrouvent dans l'ordre de l'article", () => {
    const r = lireCatalogue(brute());
    expect(r.erreurs).toEqual([]);
    const c = r.catalogue!;
    expect(validerCatalogue(c)).toEqual([]);
    expect(c.commentaires![0]).toEqual({ id: "cuisson", nom: "Cuisson", commentaires: ["Bleu", "Saignant", "À point", "Bien cuit"], obligatoire: true });
    expect(groupesCommentaires(c, c.categories[0]!.articles[0]).map((g) => g.nom)).toEqual(["Cuisson", "Sauce"]);
    expect(groupesCommentaires(c, c.categories[0]!.articles[1])).toEqual([]);
  });

  it("refuse un groupe vide, un commentaire trop long ou sur deux lignes", () => {
    const b = brute();
    b.commentaires[1]!.commentaires = [];
    b.commentaires[0]!.commentaires.push("x".repeat(41), "Bleu\nfoncé");
    const r = lireCatalogue(b);
    expect(r.catalogue).toBeNull();
    expect(r.erreurs).toContain("groupe de commentaires « Sauce » : au moins un commentaire");
    expect(r.erreurs).toContain("groupe de commentaires « Cuisson » : commentaire : 40 caractères au plus");
    expect(r.erreurs).toContain("groupe de commentaires « Cuisson » : commentaire : caractère non imprimable");
  });

  it("refuse un groupe inconnu, en double, ou un commentaire répété", () => {
    const c = lireCatalogue(brute()).catalogue!;
    c.categories[0]!.articles[1]!.commentaires = ["garniture", "sauce", "sauce"];
    c.commentaires!.push({ id: "sauce", nom: "Sauce bis", commentaires: ["Roquefort", "Roquefort"] });
    const erreurs = validerCatalogue(c);
    expect(erreurs).toContain("salade : groupe de commentaires inconnu garniture");
    expect(erreurs).toContain("salade : groupe de commentaires sauce en double");
    expect(erreurs).toContain("groupe de commentaires en double : sauce");
    expect(erreurs).toContain("groupe de commentaires Sauce bis : commentaire en double");
  });
});
