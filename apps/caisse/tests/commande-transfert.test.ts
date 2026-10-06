import { describe, expect, it } from "vitest";
import { ajouterLigne, fusionnerCommandes, nouvelleCommande, totauxCommande, transfererCommande } from "../src/metier/commande";

const cafe = { articleId: "cafe", libelle: "Café", details: [], quantite: 1, prixUnitaireTTC: 250, tauxTVA: 1000, ajouteePar: "u-1" };

describe("notes et transfert de table", () => {
  it("transfère vers une table libre et regroupe sur une table ouverte", () => {
    const t4 = { ...ajouterLigne(nouvelleCommande("t4", "u-1", 2), cafe), note: "Anniversaire", ouverteLe: "2026-10-15T10:00:00Z" };
    const t7 = { ...ajouterLigne(nouvelleCommande("t7", "u-1", 3), cafe), ouverteLe: "2026-10-15T09:30:00Z" };
    expect(transfererCommande(t4, "t9")).toMatchObject({ tableId: "t9", couverts: 2, note: "Anniversaire" });
    const f = fusionnerCommandes(t7, t4);
    expect(f).toMatchObject({ tableId: "t7", couverts: 5, note: "Anniversaire", ouverteLe: "2026-10-15T09:30:00Z" });
    expect(totauxCommande(f).totalTTC).toBe(500);
  });

  it("ne regroupe pas une ligne annotée avec un nouvel article identique", () => {
    let c = ajouterLigne(nouvelleCommande("t1", "u-1"), cafe);
    c = { ...c, lignes: c.lignes.map((l) => ({ ...l, note: "Sans sucre" })) };
    c = ajouterLigne(c, cafe);
    expect(c.lignes.map((l) => [l.quantite, l.note ?? null])).toEqual([
      [1, "Sans sucre"],
      [1, null],
    ]);
  });
});
