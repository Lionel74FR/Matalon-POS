import { describe, expect, it } from "vitest";
import {
  ajouterLigne,
  commandeAGarder,
  lignesActives,
  modifierLigne,
  nouvelleCommande,
  totauxCommande,
  versSaisie,
  avecQuantite,
} from "../src/metier/commande";

// Lignes déjà envoyées : leurs retraits restent barrés (avant envoi, un retrait efface, voir production.test.ts).
const envoyee = { le: "2026-10-15T10:00:00Z", par: "u1" };
const cafe = { articleId: "cafe", libelle: "Espresso", details: [], quantite: 1, prixUnitaireTTC: 270, tauxTVA: 1000, ajouteePar: "u1", envoyee };
const the = { articleId: "the", libelle: "Thé", details: [], quantite: 1, prixUnitaireTTC: 400, tauxTVA: 1000, ajouteePar: "u1", envoyee };

describe("lignes retirées", () => {
  it("une ligne retirée reste dans la commande, barrée, sans compter", () => {
    let c = ajouterLigne(ajouterLigne(nouvelleCommande("t1", "u1"), cafe), the);
    const uidThe = c.lignes[1]!.uid;
    c = modifierLigne(c, uidThe, null, 1, "u2");
    expect(c.lignes).toHaveLength(2);
    expect(c.lignes[1]!.retiree?.par).toBe("u2");
    expect(lignesActives(c).map((l) => l.articleId)).toEqual(["cafe"]);
    expect(totauxCommande(c).totalTTC).toBe(270);
    expect(totauxCommande(c).nbArticles).toBe(1);
    expect(lignesActives(c).map(versSaisie)).toHaveLength(1);
  });

  it("une baisse de quantité laisse la part retirée barrée juste après la ligne", () => {
    let c = ajouterLigne(nouvelleCommande("t1", "u1"), { ...cafe, quantite: 3 });
    const l = c.lignes[0]!;
    c = modifierLigne(c, l.uid, avecQuantite(l, 1), 2, "u1");
    expect(c.lignes.map((x) => [x.quantite, !!x.retiree])).toEqual([
      [1, false],
      [2, true],
    ]);
    expect(totauxCommande(c).totalTTC).toBe(270);
  });

  it("un nouvel article identique ne se regroupe pas avec une ligne retirée", () => {
    let c = ajouterLigne(nouvelleCommande("t1", "u1"), cafe);
    c = modifierLigne(c, c.lignes[0]!.uid, null, 1, "u1");
    c = ajouterLigne(c, cafe);
    expect(c.lignes.map((x) => [x.quantite, !!x.retiree])).toEqual([
      [1, true],
      [1, false],
    ]);
  });
});

describe("commande à garder", () => {
  it("garde une table installée sans article (couverts ou note), pas une table vide", () => {
    const vide = nouvelleCommande("t1", "u1");
    expect(commandeAGarder(vide)).toBe(false);
    expect(commandeAGarder({ ...vide, couverts: 2 })).toBe(true);
    expect(commandeAGarder({ ...vide, note: "Anniversaire" })).toBe(true);
    const avecCafe = ajouterLigne(vide, cafe);
    // Seulement des lignes retirées : elles restent visibles jusqu'à « Libérer la table ».
    expect(commandeAGarder(modifierLigne(avecCafe, avecCafe.lignes[0]!.uid, null, 1, "u1"))).toBe(true);
    expect(commandeAGarder(null)).toBe(false);
  });
});
