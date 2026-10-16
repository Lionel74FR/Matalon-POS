import { describe, expect, it } from "vitest";
import {
  acomptesActifs,
  ajouterAcompte,
  annulerAcompte,
  commandeAGarder,
  diviserParArticles,
  fusionnerCommandes,
  lignesDues,
  montantLigne,
  montantPart,
  paiementsAcomptes,
  resteAPayer,
  totauxCommande,
  type Commande,
  type LigneCommande,
} from "../src/metier/commande";
import { fusionnerCommande } from "../src/metier/fusion";

const ligne = (uid: string, quantite = 1, extra: Partial<LigneCommande> = {}): LigneCommande => ({
  uid,
  articleId: uid,
  libelle: uid,
  details: [],
  quantite,
  prixUnitaireTTC: 400,
  tauxTVA: 1000,
  ajouteePar: "u1",
  ajouteeLe: "2026-10-16T19:00:00Z",
  ...extra,
});
const commande = (lignes: LigneCommande[], extra: Partial<Commande> = {}): Commande => ({
  tableId: "t1",
  couverts: 4,
  ouverteLe: "2026-10-16T19:00:00Z",
  ouvertePar: "u1",
  lignes,
  additionsImprimees: 0,
  ...extra,
});
const reglee = { le: "2026-10-16T21:00:00Z", par: "u1", caisseId: "ipad-1" };
const acompte = (mode: "CB" | "ESPECES", montant: number) => ({ mode, montant, le: "2026-10-16T21:00:00Z", par: "u1", caisseId: "ipad-1" });

describe("division de la note par articles", () => {
  it("une ligne prise en entier est marquée réglée, une ligne prise en partie est coupée", () => {
    const c = commande([ligne("biere", 3), ligne("burger"), ligne("eau", 1, { retiree: { le: "x", par: "u1" } })]);
    const d = diviserParArticles(c, new Map([["biere", 2], ["burger", 1]]), reglee);
    expect(d.tout).toBe(false);
    expect(d.payees.map((l) => `${l.libelle}×${l.quantite}`)).toEqual(["biere×2", "burger×1"]);
    expect(d.payees.every((l) => l.reglee)).toBe(true);
    // La bière restante garde son identifiant ; les deux payées en prennent un neuf.
    expect(d.restante.lignes.map((l) => `${l.uid === "biere" ? "biere" : l.libelle}×${l.quantite}${l.reglee ? " réglé" : ""}`)).toEqual([
      "biere×1",
      "biere×2 réglé",
      "burger×1 réglé",
      "eau×1",
    ]);
    expect(lignesDues(d.restante).map((l) => l.uid)).toEqual(["biere"]);
    expect(totauxCommande(d.restante).totalTTC).toBe(400);
    expect(commandeAGarder(d.restante)).toBe(true);
  });

  it("la remise suit au prorata ; tout choisir revient à encaisser la table entière", () => {
    const c = commande([ligne("vin", 3, { remise: { pourcentage: 10, montantTTC: 120, motif: "fidélité", accordeePar: "u2" } })]);
    const d = diviserParArticles(c, new Map([["vin", 1]]), reglee);
    expect(d.payees[0]!.remise!.montantTTC).toBe(40);
    expect(montantLigne(d.payees[0]!) + totauxCommande(d.restante).totalTTC).toBe(1080);
    expect(diviserParArticles(c, new Map([["vin", 3]]), reglee).tout).toBe(true);
    // Avec des acomptes, le ticket final doit les reprendre : jamais « tout ».
    expect(diviserParArticles(ajouterAcompte(c, acompte("CB", 500)), new Map([["vin", 3]]), reglee).tout).toBe(false);
  });

  it("une quantité hors limites est ramenée à la ligne, une ligne déjà réglée n'est pas reprise", () => {
    const c = commande([ligne("cafe", 2), ligne("the", 1, { reglee })]);
    const d = diviserParArticles(c, new Map([["cafe", 9], ["the", 1]]), reglee);
    expect(d.payees.map((l) => `${l.uid}×${l.quantite}`)).toEqual(["cafe×2"]);
    expect(d.tout).toBe(true);
  });
});

describe("parts égales et acomptes", () => {
  it("la dernière part prend les centimes restants", () => {
    expect([montantPart(1000, 3, 1000), montantPart(1000, 3, 667), montantPart(1000, 3, 334)]).toEqual([333, 333, 334]);
    expect(montantPart(1000, 3, 0)).toBe(0);
    expect(montantPart(2, 3, 2)).toBe(2);
  });

  it("les acomptes réduisent le reste à payer et deviennent les paiements du ticket", () => {
    let c = commande([ligne("menu", 3)]); // 12,00 €
    c = ajouterAcompte(c, acompte("CB", 400));
    c = ajouterAcompte(c, acompte("ESPECES", 400));
    expect(resteAPayer(c)).toBe(400);
    expect(paiementsAcomptes(c)).toEqual([
      { mode: "CB", montant: 400 },
      { mode: "ESPECES", montant: 400 },
    ]);
    const cb = c.acomptes![0]!.id;
    c = annulerAcompte(c, cb, { le: "x", par: "resp", motif: "Rendu au client" });
    expect(acomptesActifs(c).map((a) => a.mode)).toEqual(["ESPECES"]);
    expect(c.acomptes).toHaveLength(2);
    expect(resteAPayer(c)).toBe(800);
  });

  it("une table qui porte un acompte se garde, même sans article à payer", () => {
    const c = ajouterAcompte(commande([], { couverts: null }), acompte("CB", 100));
    expect(commandeAGarder(c)).toBe(true);
    expect(resteAPayer(c)).toBe(-100);
  });

  it("deux tables regroupées gardent les acomptes des deux", () => {
    const a = ajouterAcompte(commande([ligne("cafe")]), acompte("CB", 200));
    const b = ajouterAcompte(commande([ligne("the")], { tableId: "t2" }), acompte("ESPECES", 100));
    expect(acomptesActifs(fusionnerCommandes(a, b)).map((x) => x.montant)).toEqual([200, 100]);
  });
});

describe("fusion entre appareils : ce qui est payé ne se perd pas", () => {
  const base = commande([ligne("biere", 2), ligne("burger")]);

  it("une ligne réglée l'emporte sur une modification faite ailleurs, de quelque côté qu'on écrive", () => {
    const payee = commande([ligne("biere", 2), ligne("burger", 1, { reglee })]);
    const modifieeAilleurs = commande([ligne("biere", 2), ligne("burger", 1, { note: "sans oignon" })]);
    expect(fusionnerCommande(base, payee, modifieeAilleurs)!.lignes.find((l) => l.uid === "burger")!.reglee).toEqual(reglee);
    expect(fusionnerCommande(base, modifieeAilleurs, payee)!.lignes.find((l) => l.uid === "burger")!.reglee).toEqual(reglee);
  });

  it("les acomptes des deux côtés sont réunis ; une annulation l'emporte", () => {
    const ici = ajouterAcompte(base, acompte("CB", 500));
    const ailleurs = ajouterAcompte(base, acompte("ESPECES", 300));
    const f = fusionnerCommande(base, ici, ailleurs)!;
    expect(f.acomptes!.map((a) => a.montant).sort()).toEqual([300, 500]);
    const id = ici.acomptes![0]!.id;
    const annule = annulerAcompte(ici, id, { le: "x", par: "resp", motif: "Rendu au client" });
    const g = fusionnerCommande(ici, ici, annule)!;
    expect(acomptesActifs(g)).toHaveLength(0);
    expect(acomptesActifs(fusionnerCommande(ici, annule, { ...ici, note: "ailleurs" })!)).toHaveLength(0);
  });

  it("table fermée d'un côté : un acompte reçu de l'autre côté depuis la base survit", () => {
    const avecAcompte = ajouterAcompte(base, acompte("CB", 500));
    const f = fusionnerCommande(base, avecAcompte, null)!;
    expect(f.lignes).toEqual([]);
    expect(acomptesActifs(f).map((a) => a.montant)).toEqual([500]);
    // Un acompte déjà connu à la base a été repris par le ticket de clôture : il ne revient pas.
    expect(fusionnerCommande(avecAcompte, avecAcompte, null)).toBeNull();
  });
});
