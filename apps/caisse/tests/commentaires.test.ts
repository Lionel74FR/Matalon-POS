import type { Catalogue, GroupeCommentaires } from "@matalon/catalogue";
import { describe, expect, it } from "vitest";
import { ajouterLigne, detailsLigne, nouvelleCommande, versSaisie } from "../src/metier/commande";
import { basculer, commentairesChoisis, groupeManquant, selectionDepuis } from "../src/metier/commentaires";
import { bonsAEnvoyer } from "../src/metier/production";

// Commentaires d'articles (17 novembre 2026, Lionel : cuissons des viandes).
const cuisson: GroupeCommentaires = { id: "cuisson", nom: "Cuisson", commentaires: ["Bleu", "Saignant", "À point", "Bien cuit"], obligatoire: true };
const sauce: GroupeCommentaires = { id: "sauce", nom: "Sauce", commentaires: ["Poivre", "Béarnaise", "Roquefort"], plusieurs: true };

const carte: Catalogue = {
  id: "c",
  nom: "Carte",
  source: "test",
  etablissementId: "chardon",
  commentaires: [cuisson, sauce],
  categories: [
    { id: "plats", nom: "Plats", rayon: "Cuisine", poste: "Cuisine", articles: [{ id: "entrecote", nom: "Entrecôte", prixTTC: 2400, tauxTVA: 1000, commentaires: ["cuisson", "sauce"] }] },
    { id: "desserts", nom: "Desserts", rayon: "Cuisine", poste: "Cuisine", articles: [{ id: "tarte", nom: "Tarte", prixTTC: 800, tauxTVA: 1000 }] },
  ],
};

const entrecote = (commentaires?: string[]) => ({
  articleId: "entrecote",
  libelle: "Entrecôte",
  details: [],
  quantite: 1,
  prixUnitaireTTC: 2400,
  tauxTVA: 1000,
  ajouteePar: "u1",
  ...(commentaires ? { commentaires } : {}),
});

describe("choix des commentaires", () => {
  it("un seul par groupe simple, plusieurs dans l'ordre du groupe, obligatoire exigé", () => {
    let s = selectionDepuis([cuisson, sauce], undefined);
    expect(groupeManquant([cuisson, sauce], s)?.nom).toBe("Cuisson");
    s = basculer(s, cuisson, "Bleu");
    s = basculer(s, cuisson, "Saignant");
    s = basculer(s, sauce, "Roquefort");
    s = basculer(s, sauce, "Poivre");
    expect(groupeManquant([cuisson, sauce], s)).toBeNull();
    expect(commentairesChoisis([cuisson, sauce], s)).toEqual(["Saignant", "Poivre", "Roquefort"]);
    s = basculer(s, sauce, "Poivre");
    expect(commentairesChoisis([cuisson, sauce], s)).toEqual(["Saignant", "Roquefort"]);
    expect(commentairesChoisis([sauce], {})).toBeUndefined();
    // Relu depuis une ligne : un commentaire retiré de la carte depuis est oublié.
    expect(selectionDepuis([cuisson, sauce], ["À point", "Moutarde"])).toEqual({ cuisson: ["À point"], sauce: [] });
  });
});

describe("commentaires sur la commande", () => {
  it("regroupe les mêmes cuissons, sépare les autres, et ne touche jamais au libellé du ticket", () => {
    let c = nouvelleCommande("t1", "u1");
    c = ajouterLigne(c, entrecote(["Saignant"]));
    c = ajouterLigne(c, entrecote(["Saignant"]));
    c = ajouterLigne(c, entrecote(["À point"]));
    c = ajouterLigne(c, entrecote());
    expect(c.lignes.map((l) => [l.quantite, l.commentaires])).toEqual([
      [2, ["Saignant"]],
      [1, ["À point"]],
      [1, undefined],
    ]);
    expect(versSaisie(c.lignes[0]!).libelle).toBe("Entrecôte");
    expect(detailsLigne(c.lignes[0]!)).toEqual(["Saignant"]);
  });

  it("part sur le bon de cuisine, sous l'article et sous le choix de formule", () => {
    let c = nouvelleCommande("t1", "u1");
    c = ajouterLigne(c, entrecote(["Bleu", "Poivre"]));
    c = ajouterLigne(c, {
      articleId: "menu",
      libelle: "Menu",
      details: ["Entrecôte", "Tarte"],
      composants: [
        { libelle: "Entrecôte", categorieId: "plats", commentaires: ["Bien cuit"] },
        { libelle: "Tarte", categorieId: "desserts" },
      ],
      quantite: 1,
      prixUnitaireTTC: 3200,
      tauxTVA: 1000,
      ajouteePar: "u1",
    });
    const [bon] = bonsAEnvoyer(c, carte);
    expect(bon!.articles.map((a) => [a.libelle, a.details])).toEqual([
      ["Entrecôte", ["Bleu", "Poivre"]],
      ["Menu", ["Entrecôte (Bien cuit)", "Tarte"]],
    ]);
    // Le ticket garde le libellé de la formule que relit le stock (« Menu (Entrecôte, Tarte) »).
    expect(versSaisie(c.lignes[1]!).libelle).toBe("Menu (Entrecôte, Tarte)");
  });
});
