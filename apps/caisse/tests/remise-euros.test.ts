import { calculerLigne } from "@matalon/noyau-fiscal";
import { describe, expect, it } from "vitest";
import {
  avecQuantite,
  couperLigne,
  diviserParArticles,
  modifierLigne,
  montantLigne,
  totauxCommande,
  transfererArticles,
  versSaisie,
  type Commande,
  type LigneCommande,
} from "../src/metier/commande";

// Remise en euros sur un article (demande de Lionel du 29 octobre 2026), à côté de la remise en %.
const ligne = (uid: string, quantite: number, remise?: LigneCommande["remise"], extra: Partial<LigneCommande> = {}): LigneCommande => ({
  uid,
  articleId: uid,
  libelle: uid,
  details: [],
  quantite,
  prixUnitaireTTC: 350,
  tauxTVA: 1000,
  ajouteePar: "u1",
  ajouteeLe: "2026-10-29T19:00:00Z",
  ...(remise ? { remise } : {}),
  ...extra,
});
const euros = (montantTTC: number): LigneCommande["remise"] => ({ pourcentage: 0, enEuros: true, montantTTC, motif: "Geste commercial", accordeePar: "r1" });
const commande = (lignes: LigneCommande[]): Commande => ({
  tableId: "t4",
  couverts: 2,
  ouverteLe: "2026-10-29T19:00:00Z",
  ouvertePar: "u1",
  lignes,
  additionsImprimees: 0,
});
const reglee = { le: "2026-10-29T21:00:00Z", par: "u1", caisseId: "ipad-1" };

describe("remise en euros sur une ligne", () => {
  it("passe au noyau fiscal comme un montant de remise, motif compris", () => {
    const l = ligne("cappuccino", 3, euros(200));
    expect(versSaisie(l).remise).toEqual({ montantTTC: 200, motif: "Geste commercial" });
    const calcul = calculerLigne(versSaisie(l));
    expect(calcul.remiseTTC).toBe(200);
    expect(calcul.montantTTC).toBe(850);
    expect(montantLigne(l)).toBe(850);
  });

  it("suit au prorata des unités quand la quantité change, sans dépasser le montant de la ligne", () => {
    const l = ligne("cappuccino", 3, euros(300));
    expect(avecQuantite(l, 1).remise?.montantTTC).toBe(100);
    expect(avecQuantite(l, 6).remise?.montantTTC).toBe(600);
    // Une remise égale au montant (offert en euros) reste égale au montant.
    const offert = ligne("cortado", 2, euros(700));
    expect(avecQuantite(offert, 1).remise?.montantTTC).toBe(350);
    expect(avecQuantite(offert, 1).remise?.enEuros).toBe(true);
  });

  it("se partage sans perdre ni ajouter un centime quand la ligne est coupée", () => {
    for (const [remise, q] of [
      [3, 1],
      [500, 1],
      [500, 2],
      [101, 2],
      [1050, 1],
    ] as const) {
      const l = ligne("biere", 3, euros(remise));
      const { reste, partie } = couperLigne(l, q);
      expect(reste.remise!.montantTTC + partie.remise!.montantTTC).toBe(remise);
      expect(reste.quantite + partie.quantite).toBe(3);
      for (const x of [reste, partie]) expect(x.remise!.montantTTC).toBeLessThanOrEqual(x.quantite * x.prixUnitaireTTC);
    }
  });

  it("la remise en pourcentage se recalcule sur chaque morceau, comme avant", () => {
    const l = ligne("biere", 3, { pourcentage: 10, montantTTC: 105, motif: "Client habitué", accordeePar: "r1" });
    const { reste, partie } = couperLigne(l, 1);
    expect(partie.remise?.montantTTC).toBe(35);
    expect(reste.remise?.montantTTC).toBe(70);
  });

  it("division par articles : le total de la table reste le même, remise comprise", () => {
    const c = commande([ligne("biere", 3, euros(500)), ligne("burger", 1)]);
    const avant = totauxCommande(c).totalTTC;
    const d = diviserParArticles(c, new Map([["biere", 1]]), reglee);
    const paye = d.payees.reduce((s, l) => s + montantLigne(l), 0);
    expect(paye + totauxCommande(d.restante).totalTTC).toBe(avant);
    expect(d.payees[0]!.remise).toMatchObject({ enEuros: true, montantTTC: 167, motif: "Geste commercial" });
  });

  it("transfert d'une partie des articles : la remise en euros se partage entre les deux tables", () => {
    const c = commande([ligne("biere", 3, euros(500))]);
    const t = transfererArticles(c, null, "t9", new Map([["biere", 2]]), "u1");
    expect(t.partis[0]!.remise?.montantTTC).toBe(333);
    expect(t.depart.lignes[0]!.remise?.montantTTC).toBe(167);
  });

  it("article déjà envoyé dont on augmente la quantité : la remise saisie se répartit, entière", () => {
    const envoyee = { le: "2026-10-29T19:05:00Z", par: "u1" };
    const avant = ligne("biere", 1, undefined, { envoyee });
    const nouvelle = ligne("biere", 3, euros(200), { envoyee });
    const c = modifierLigne(commande([avant]), "biere", nouvelle, 0, "u1");
    expect(c.lignes.map((l) => `${l.quantite}${l.envoyee ? " envoyé" : ""}`)).toEqual(["1 envoyé", "2"]);
    expect(c.lignes.reduce((s, l) => s + (l.remise?.montantTTC ?? 0), 0)).toBe(200);
  });
});
