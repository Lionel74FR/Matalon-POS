import { CARTES } from "@matalon/catalogue";
import type { RecompenseFidelite, UtilisationFidelite } from "@matalon/serveur/fidelite";
import { describe, expect, it } from "vitest";
import { lignesDues, totauxCommande, type Commande, type LigneCommande } from "../src/metier/commande";
import { appliquerRecompense, lienDuTicket, retirerRecompense, utilisationsOrphelines, valeurSurCommande } from "../src/metier/fidelite";
import { fusionnerCommande } from "../src/metier/fusion";

const carte = CARTES["carte-automne-2026"]!;
const ligne = (uid: string, prix: number, quantite = 1, extra: Partial<LigneCommande> = {}): LigneCommande => ({
  uid,
  articleId: uid,
  libelle: uid,
  details: [],
  quantite,
  prixUnitaireTTC: prix,
  tauxTVA: 1000,
  ajouteePar: "u1",
  ajouteeLe: "2026-10-21T09:00:00Z",
  ...extra,
});
const commande = (lignes: LigneCommande[]): Commande => ({
  tableId: "t1",
  couverts: 2,
  ouverteLe: "2026-10-21T09:00:00Z",
  ouvertePar: "u1",
  lignes,
  additionsImprimees: 0,
  fidelite: { membreId: "mbr-000000000001", telephone: "+33612345678", prenom: "Marie", solde: 40, utilisations: [] },
});
const u = (id: string, r: RecompenseFidelite): UtilisationFidelite => ({ id, recompenseId: r.id, libelle: r.libelle, points: r.seuil });
const CAFE: RecompenseFidelite = { id: "r-cafe", libelle: "Un cappuccino offert", seuil: 10, type: "ARTICLE", articles: ["cappuccino"] };
const DIX: RecompenseFidelite = { id: "r-10", libelle: "10 € offerts", seuil: 30, type: "REMISE_EUROS", montant: 1000 };
const VINGT_POURCENT: RecompenseFidelite = { id: "r-20", libelle: "20 %", seuil: 20, type: "REMISE_POURCENT", pourcentage: 20 };

describe("fidélité sur la commande", () => {
  it("ajoute l'article offert (remise 100 %, motif Fidélité) sans le regrouper avec le même article payé", () => {
    const c = commande([ligne("cappuccino", 400, 2)]);
    const avec = appliquerRecompense(c, CAFE, u("u-aaaaaaaaaaaa", CAFE), "u1", carte, "cappuccino");
    expect(avec.lignes).toHaveLength(2);
    expect(avec.lignes[1]).toMatchObject({ articleId: "cappuccino", quantite: 1, remise: { pourcentage: 100, montantTTC: 400, motif: "Fidélité" }, fidelite: "u-aaaaaaaaaaaa" });
    expect(totauxCommande(avec).totalTTC).toBe(800);
    expect(avec.fidelite!.utilisations.map((x) => x.id)).toEqual(["u-aaaaaaaaaaaa"]);
  });

  it("répartit une remise en euros sur les lignes sans remise, des plus chères aux moins chères, sans dépasser le total", () => {
    const c = commande([ligne("cafe", 250), ligne("spritz", 1100), ligne("offert", 400, 1, { remise: { pourcentage: 100, montantTTC: 400, motif: "Offert maison", accordeePar: "u1" } }), ligne("tarte", 650)]);
    expect(valeurSurCommande(c, DIX)).toBe(1000);
    const avec = appliquerRecompense(c, DIX, u("u-bbbbbbbbbbbb", DIX), "u1", carte);
    expect(avec.lignes.map((l) => l.remise?.montantTTC ?? 0)).toEqual([0, 1000, 400, 0]);
    expect(totauxCommande(avec).totalTTC).toBe(250 + 100 + 650);
    const petite = commande([ligne("cafe", 250), ligne("eau", 300)]);
    expect(valeurSurCommande(petite, DIX)).toBe(550);
    const toute = appliquerRecompense(petite, DIX, u("u-cccccccccccc", DIX), "u1", carte);
    expect(totauxCommande(toute).totalTTC).toBe(0);
  });

  it("applique un pourcentage à chaque ligne sans remise ; refuse une commande sans rien à remiser", () => {
    const c = commande([ligne("cafe", 250, 2), ligne("tarte", 650)]);
    const avec = appliquerRecompense(c, VINGT_POURCENT, u("u-dddddddddddd", VINGT_POURCENT), "u1", carte);
    expect(avec.lignes.map((l) => l.remise?.montantTTC)).toEqual([100, 130]);
    expect(() => appliquerRecompense(commande([]), DIX, u("u-eeeeeeeeeeee", DIX), "u1", carte)).toThrow(/Rien à remiser/);
  });

  it("retire une récompense, repère les réservations qui ne sont plus sur aucune ligne, et fait le lien du ticket", () => {
    const c = commande([ligne("spritz", 1100)]);
    const a = appliquerRecompense(c, DIX, u("u-bbbbbbbbbbbb", DIX), "u1", carte);
    const b = appliquerRecompense(a, CAFE, u("u-aaaaaaaaaaaa", CAFE), "u1", carte, "cappuccino");
    expect(utilisationsOrphelines(b)).toEqual([]);
    const sansRemise = retirerRecompense(b, "u-bbbbbbbbbbbb");
    expect(sansRemise.lignes[0]!.remise).toBeUndefined();
    expect(sansRemise.fidelite!.utilisations.map((x) => x.id)).toEqual(["u-aaaaaaaaaaaa"]);
    // L'article offert supprimé à la main : sa réservation devient orpheline (rendue à l'encaissement).
    const supprime = { ...b, lignes: b.lignes.filter((l) => l.articleId !== "cappuccino") };
    expect(utilisationsOrphelines(supprime).map((x) => x.id)).toEqual(["u-aaaaaaaaaaaa"]);
    expect(lienDuTicket(b.fidelite!, "ipad-0a1b2c3d", 12, lignesDues(b))).toEqual({
      caisseId: "ipad-0a1b2c3d",
      numero: 12,
      membreId: "mbr-000000000001",
      utilisations: ["u-bbbbbbbbbbbb", "u-aaaaaaaaaaaa"],
    });
    expect(lienDuTicket({ ...b.fidelite!, membreId: null }, "ipad-0a1b2c3d", 12, [])).toEqual({ caisseId: "ipad-0a1b2c3d", numero: 12, telephone: "+33612345678", utilisations: [] });
  });

  it("garde la carte rattachée sur un autre appareil quand deux versions de la table se rejoignent", () => {
    const base = commande([ligne("cafe", 250)]);
    const { fidelite: _, ...sansCarte } = base;
    const locale = { ...sansCarte, lignes: [...base.lignes, ligne("tarte", 650)] };
    const distante = base;
    expect(fusionnerCommande(sansCarte, locale, distante)?.fidelite?.prenom).toBe("Marie");
  });
});
