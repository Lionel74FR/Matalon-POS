import { describe, expect, it } from "vitest";
import { ajouterLigne, fusionnerCommandes, nouvelleCommande, totauxCommande, transfererArticles, transfererCommande } from "../src/metier/commande";

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

  it("transfère une partie des articles : lignes coupées, remise au prorata, envoi et suite gardés", () => {
    const spritz = { articleId: "spritz", libelle: "Spritz", details: [], quantite: 4, prixUnitaireTTC: 900, tauxTVA: 2000, ajouteePar: "u-1" };
    let t4 = ajouterLigne(ajouterLigne(nouvelleCommande("t4", "u-1", 4), spritz), cafe);
    const envoyee = { le: "2026-10-29T18:00:00Z", par: "u-1" };
    t4 = {
      ...t4,
      note: "Anniversaire",
      reclames: [{ suite: 1, le: "2026-10-29T18:10:00Z", par: "u-1" }],
      lignes: t4.lignes.map((l) =>
        l.articleId === "spritz" ? { ...l, envoyee, suite: 1, remise: { pourcentage: 50, montantTTC: 1800, motif: "Geste commercial", accordeePar: "u-1" } } : l,
      ),
    };
    const [spritzUid, cafeUid] = t4.lignes.map((l) => l.uid);
    // 3 spritz sur 4 et le café partent vers la table 9, libre.
    const { depart, arrivee, partis } = transfererArticles(t4, null, "t9", new Map([[spritzUid!, 3], [cafeUid!, 1]]), "u-2");
    expect(partis.map((l) => [l.libelle, l.quantite])).toEqual([["Spritz", 3], ["Café", 1]]);
    expect(depart.lignes.map((l) => [l.uid, l.quantite, l.remise?.montantTTC ?? 0])).toEqual([[spritzUid, 1, 450]]);
    expect(depart).toMatchObject({ tableId: "t4", couverts: 4, note: "Anniversaire" });
    expect(arrivee).toMatchObject({ tableId: "t9", couverts: null, ouvertePar: "u-2", reclames: [{ suite: 1 }] });
    expect(arrivee.lignes[0]).toMatchObject({ quantite: 3, envoyee, suite: 1, remise: { montantTTC: 1350, motif: "Geste commercial" } });
    expect(arrivee.lignes[1]!.uid).toBe(cafeUid);
    // Rien ne se perd : le total des deux tables égale celui de départ.
    expect(totauxCommande(depart).totalTTC + totauxCommande(arrivee).totalTTC).toBe(totauxCommande(t4).totalTTC);
  });

  it("regroupe les articles transférés sur une table ouverte ; les lignes réglées ou retirées ne partent pas", () => {
    let t2 = ajouterLigne(nouvelleCommande("t2", "u-1", 2), cafe);
    t2 = { ...t2, lignes: [...t2.lignes, { ...t2.lignes[0]!, uid: "regle", reglee: { le: "x", par: "u-1", caisseId: "ipad-1" } }, { ...t2.lignes[0]!, uid: "retire", retiree: { le: "x", par: "u-1" } }] };
    const t7 = ajouterLigne(nouvelleCommande("t7", "u-1", 3), cafe);
    const tout = new Map(t2.lignes.map((l) => [l.uid, 1]));
    const { depart, arrivee } = transfererArticles(t2, t7, "t7", tout, "u-1");
    expect(depart.lignes.map((l) => l.uid)).toEqual(["regle", "retire"]);
    expect(arrivee).toMatchObject({ tableId: "t7", couverts: 3, ouverteLe: t7.ouverteLe });
    expect(totauxCommande(arrivee).totalTTC).toBe(500);
  });
});

