import type { Catalogue } from "@matalon/catalogue";
import { lireCatalogue } from "@matalon/catalogue";
import { describe, expect, it } from "vitest";
import { ajouterLigne, lignesParSuite, nouvelleCommande, reclamer, suitesAReclamer, suitesDe, type Commande } from "../src/metier/commande";
import { aEnvoyerDans, bonsAEnvoyer, bonsReclame, validerEnvoi } from "../src/metier/production";

/** Formules découpées entre les cours (17 novembre 2026, Lionel : les menus respectent Direct, AS1, AS2). */
const carte: Catalogue = {
  id: "c",
  nom: "Carte",
  source: "test",
  etablissementId: "chardon",
  categories: [
    { id: "entrees", nom: "Entrées", rayon: "Cuisine", poste: "Cuisine", articles: [{ id: "soupe", nom: "Soupe", prixTTC: 900, tauxTVA: 1000 }] },
    { id: "plats", nom: "Plats", rayon: "Cuisine", poste: "Cuisine", articles: [{ id: "burger", nom: "Burger", prixTTC: 1800, tauxTVA: 1000 }] },
    { id: "desserts", nom: "Desserts", rayon: "Cuisine", poste: "Cuisine", articles: [{ id: "tarte", nom: "Tarte", prixTTC: 800, tauxTVA: 1000 }] },
    { id: "vins", nom: "Vins", rayon: "Bar", poste: "Bar", articles: [{ id: "verre", nom: "Verre de rouge", prixTTC: 600, tauxTVA: 2000 }] },
  ],
};

const menu = (c: Commande) =>
  ajouterLigne(c, {
    articleId: "menu",
    libelle: "Menu du jour",
    details: ["Soupe", "Verre de rouge", "Burger", "Tarte"],
    composants: [
      { libelle: "Soupe", categorieId: "entrees", suite: 0 },
      { libelle: "Verre de rouge", categorieId: "vins", suite: 0 },
      { libelle: "Burger", categorieId: "plats", suite: 1 },
      { libelle: "Tarte", categorieId: "desserts", suite: 2 },
    ],
    quantite: 2,
    prixUnitaireTTC: 2900,
    tauxTVA: 1000,
    ajouteePar: "u1",
  });

describe("formule découpée entre les cours", () => {
  it("la carte garde le cours de chaque choix, et refuse un cours inconnu", () => {
    const base = { id: "c", nom: "C", source: "t", etablissementId: "e", categories: [{ id: "f", nom: "F", rayon: "Formules", articles: [{ id: "m", nom: "Menu", prixTTC: 2900, tauxTVA: 1000 }] }] };
    const avec = (suite: unknown) => {
      const c = structuredClone(base) as any;
      c.categories[0].articles[0].formule = [{ id: "plat", nom: "Plat", categories: ["f"], suite }];
      return lireCatalogue(c);
    };
    expect(avec(1).catalogue?.categories[0]!.articles[0]!.formule![0]!.suite).toBe(1);
    expect(avec(undefined).catalogue?.categories[0]!.articles[0]!.formule![0]!.suite).toBeUndefined();
    expect(avec(4).erreurs.join(" ")).toContain("cours inconnu");
  });

  it("la ligne se montre sous chaque cours ; la commande a trois cours, deux à réclamer", () => {
    const c = menu(nouvelleCommande("t1", "u1"));
    expect(suitesDe(c)).toEqual([0, 1, 2]);
    expect(lignesParSuite(c).map((g) => [g.suite, g.lignes.length])).toEqual([
      [0, 1],
      [1, 1],
      [2, 1],
    ]);
    expect(suitesAReclamer(c)).toEqual([1, 2]);
  });

  it("« Envoyer » range chaque choix sous son cours, par poste ; la réclame d'un cours ne rappelle que ses choix", () => {
    let c = menu(nouvelleCommande("t1", "u1"));
    const bons = bonsAEnvoyer(c, carte);
    expect(bons.map((b) => [b.poste, b.articles.map((a) => [a.suite, a.quantite, a.details.join(", ")])])).toEqual([
      [
        "Cuisine",
        [
          [0, 2, "Soupe"],
          [1, 2, "Burger"],
          [2, 2, "Tarte"],
        ],
      ],
      ["Bar", [[0, 2, "Verre de rouge"]]],
    ]);
    c = validerEnvoi(c, aEnvoyerDans(c, true), new Set(), "u1");
    expect(bonsReclame(c, carte, 1).map((b) => [b.poste, b.articles.map((a) => a.details.join(", "))])).toEqual([["Cuisine", ["Burger"]]]);
    c = reclamer(c, 1, "u1");
    expect(suitesAReclamer(c)).toEqual([2]);
    expect(bonsReclame(c, carte, 2).map((b) => b.articles.map((a) => a.details.join(", ")))).toEqual([["Tarte"]]);
  });
});
