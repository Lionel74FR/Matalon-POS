import { describe, expect, it } from "vitest";
import {
  baseHT,
  calculerLigne,
  canonique,
  controlerPaiements,
  dateComptable,
  ErreurFiscale,
  formaterEuros,
  ligneInverse,
  paiementsNets,
  ventiler,
} from "../src/index.js";
import { CAPPUCCINO, SPRITZ } from "./aide.js";

describe("montants et TVA", () => {
  it("calcule la base HT au centime", () => {
    expect(baseHT(400, 1000)).toBe(364); // 4,00 TTC à 10 % → 3,64 HT
    expect(baseHT(1100, 2000)).toBe(917); // 11,00 TTC à 20 % → 9,17 HT
  });

  it("arrondit symétriquement : une annulation reflète exactement la vente", () => {
    for (const ttc of [1, 5, 15, 105, 999, 12345]) {
      for (const taux of [550, 1000, 2000]) {
        expect(baseHT(-ttc, taux)).toBe(-baseHT(ttc, taux));
      }
    }
  });

  it("ventile par taux et retombe sur le TTC", () => {
    const lignes = [calculerLigne({ ...CAPPUCCINO, quantite: 2 }), calculerLigne(SPRITZ)];
    const v = ventiler(lignes);
    expect(v).toEqual([
      { tauxTVA: 1000, baseHT: 727, montantTVA: 73, montantTTC: 800 },
      { tauxTVA: 2000, baseHT: 917, montantTVA: 183, montantTTC: 1100 },
    ]);
    const inverse = ventiler(lignes.map(ligneInverse));
    expect(inverse.map((x) => x.baseHT)).toEqual([-727, -917]);
  });

  it("refuse les montants non entiers, quantités nulles et remises sans motif", () => {
    expect(() => calculerLigne({ ...CAPPUCCINO, prixUnitaireTTC: 4.5 })).toThrow(ErreurFiscale);
    expect(() => calculerLigne({ ...CAPPUCCINO, quantite: 0 })).toThrow(ErreurFiscale);
    expect(() => calculerLigne({ ...CAPPUCCINO, remise: { montantTTC: 100, motif: " " } })).toThrow(/motif/);
    expect(() => calculerLigne({ ...CAPPUCCINO, remise: { montantTTC: 500, motif: "geste" } })).toThrow(/remise/);
  });

  it("calcule une ligne offerte à zéro", () => {
    const l = calculerLigne({ ...CAPPUCCINO, remise: { montantTTC: 400, motif: "Offert maison" } });
    expect(l.montantTTC).toBe(0);
    expect(l.motifRemise).toBe("Offert maison");
  });

  it("rend la monnaie sur les espèces, et depuis 1.1.0 sur un excédent de carte, jamais sur un titre-restaurant", () => {
    expect(controlerPaiements(1250, [{ mode: "ESPECES", montant: 2000 }]).renduMonnaie).toBe(750);
    // Pourboire : la carte passe 27 € pour une note de 25 €, 2 € sortent du tiroir.
    expect(controlerPaiements(2500, [{ mode: "CB", montant: 2700 }]).renduMonnaie).toBe(200);
    expect(() => controlerPaiements(1250, [{ mode: "TITRE_RESTAURANT_CARTE", montant: 2000 }])).toThrow(/rendu/);
    expect(() => controlerPaiements(1250, [{ mode: "TITRE_RESTAURANT_PAPIER", montant: 2000 }])).toThrow(/rendu/);
    expect(() => controlerPaiements(1250, [{ mode: "AUTRE", montant: 2000 }])).toThrow(/rendu/);
    // Titre-restaurant et carte : l'excédent ne dépasse jamais la part payée par carte.
    expect(controlerPaiements(2500, [{ mode: "TITRE_RESTAURANT_PAPIER", montant: 1900 }, { mode: "CB", montant: 800 }]).renduMonnaie).toBe(200);
    expect(() => controlerPaiements(2500, [{ mode: "TITRE_RESTAURANT_PAPIER", montant: 2900 }, { mode: "CB", montant: 100 }])).toThrow(/rendu/);
    // Une part portée en compte : pas de rendu au-delà des espèces reçues.
    expect(() => controlerPaiements(2500, [{ mode: "EN_COMPTE", montant: 2000 }, { mode: "CB", montant: 700 }])).toThrow(/rendu/);
    expect(controlerPaiements(2500, [{ mode: "EN_COMPTE", montant: 2000 }, { mode: "ESPECES", montant: 1000 }]).renduMonnaie).toBe(500);
    expect(() => controlerPaiements(1250, [{ mode: "CB", montant: 1000 }])).toThrow(/reste à payer/);
    expect(
      controlerPaiements(1250, [
        { mode: "TITRE_RESTAURANT_PAPIER", montant: 900 },
        { mode: "ESPECES", montant: 500 },
      ]).renduMonnaie,
    ).toBe(150);
    expect(paiementsNets([{ mode: "ESPECES", montant: 2000 }], 750)).toEqual([{ mode: "ESPECES", montant: 1250 }]);
    // Non-régression 1.0.0 : rendu égal aux espèces, espèces et carte.
    expect(paiementsNets([{ mode: "CB", montant: 1000 }, { mode: "ESPECES", montant: 500 }], 500)).toEqual([{ mode: "CB", montant: 1000 }]);
    expect(paiementsNets([{ mode: "ESPECES", montant: 500 }, { mode: "CB", montant: 1000 }, { mode: "ESPECES", montant: 500 }], 200)).toEqual([
      { mode: "CB", montant: 1000 },
      { mode: "ESPECES", montant: 800 },
    ]);
    // 1.1.0 : rendu sur carte, les espèces nettes sont négatives (sorties du tiroir).
    expect(paiementsNets([{ mode: "CB", montant: 2700 }], 200)).toEqual([
      { mode: "CB", montant: 2700 },
      { mode: "ESPECES", montant: -200 },
    ]);
    expect(paiementsNets([{ mode: "ESPECES", montant: 100 }, { mode: "CB", montant: 2700 }], 300)).toEqual([
      { mode: "CB", montant: 2700 },
      { mode: "ESPECES", montant: -200 },
    ]);
  });

  it("formate les euros à la française", () => {
    expect(formaterEuros(1250)).toBe("12,50");
    expect(formaterEuros(-5)).toBe("-0,05");
  });

  it("sérialise de façon canonique, quel que soit l'ordre des clés", () => {
    expect(canonique({ b: 1, a: [2, { d: null, c: "x" }] })).toBe(canonique({ a: [2, { c: "x", d: null }], b: 1 }));
  });

  it("rattache une vente après minuit à la journée de la veille", () => {
    // Samedi 17 octobre 2026, 0 h 40 à Paris (UTC+2) → journée du vendredi 16.
    expect(dateComptable(new Date("2026-10-16T22:40:00Z"))).toBe("2026-10-16");
    expect(dateComptable(new Date("2026-10-17T07:00:00Z"))).toBe("2026-10-17");
  });

  it("bascule correctement aux changements d'heure", () => {
    // 25 octobre 2026 : retour à l'heure d'hiver. 4 h 30 heure de Paris (UTC+1) → journée du 24.
    expect(dateComptable(new Date("2026-10-25T03:30:00Z"))).toBe("2026-10-24");
    // 29 mars 2026 : passage à l'heure d'été. 5 h 30 heure de Paris (UTC+2) → journée du 29.
    expect(dateComptable(new Date("2026-03-29T03:30:00Z"))).toBe("2026-03-29");
  });

  it("refuse un taux de TVA non applicable", () => {
    expect(() => calculerLigne({ ...CAPPUCCINO, tauxTVA: 1500 })).toThrow(/TVA/);
  });
});
