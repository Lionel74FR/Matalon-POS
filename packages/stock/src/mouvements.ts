import { Couts, quantiteBrute } from "./couts.js";
import type { Fiche, Quantite, Recette, Referentiel, TypeComposant } from "./types.js";
import { versBase } from "./unites.js";

/**
 * Mouvements de stock d'un établissement (sous-lots 4b à 4d) : quantités
 * signées dans l'unité de base du produit (entrée positive, sortie
 * négative), valorisées au coût du moment. Le stock théorique est la somme
 * des mouvements ; un inventaire ajoute l'écart qui le ramène au compté.
 */
export type TypeMouvement = "vente" | "annulation" | "perte" | "reception" | "inventaire" | "transfert";

export const LIBELLES_MOUVEMENT: Record<TypeMouvement, string> = {
  vente: "Vente",
  annulation: "Annulation de vente",
  perte: "Perte",
  reception: "Réception",
  inventaire: "Écart d'inventaire",
  transfert: "Transfert",
};

export interface Mouvement {
  produitId: string;
  /** Signée : g, mL ou millièmes de pièce. */
  quantite: number;
  /** Micro-euros HT, signée comme la quantité ; null si le produit n'a encore aucun prix. */
  valeurMicro: number | null;
  type: TypeMouvement;
  le: string;
  /** Journée comptable (AAAA-MM-JJ) : celle du ticket, ou celle de l'opération à Paris. */
  dateComptable: string;
  origine: Record<string, unknown>;
  /** Clé d'unicité : un même ticket, une même opération ne se comptent qu'une fois. */
  cle?: string;
}

export const MOTIFS_PERTE = ["Casse", "Péremption", "Erreur de préparation", "Repas du personnel", "Dégustation", "Vol ou disparition", "Autre"] as const;

/**
 * Décompose une quantité (unité de base du composant) d'un produit ou d'une
 * recette en produits consommés. Les quantités restent fractionnaires
 * jusqu'au bout, puis s'arrondissent à l'entier par produit.
 */
export function decomposer(ref: Referentiel, type: TypeComposant, id: string, quantite: number): { produits: Map<string, number>; erreurs: string[] } {
  const produits = new Map(ref.produits.map((p) => [p.id, p]));
  const recettes = new Map(ref.recettes.map((r) => [r.id, r]));
  const brut = new Map<string, number>();
  const erreurs: string[] = [];
  const parcourir = (t: TypeComposant, cid: string, q: number, pile: string[]) => {
    if (t === "produit") {
      if (!produits.has(cid)) return void erreurs.push(`produit inconnu (${cid})`);
      brut.set(cid, (brut.get(cid) ?? 0) + q);
      return;
    }
    const r: Recette | undefined = recettes.get(cid);
    if (!r) return void erreurs.push(`recette inconnue (${cid})`);
    if (pile.includes(cid)) return void erreurs.push(`« ${r.nom} » se contient elle-même`);
    for (const l of r.lignes) {
      const comp = l.type === "produit" ? produits.get(l.id) : recettes.get(l.id);
      if (!comp) {
        erreurs.push(`${r.nom} : composant inconnu (${l.id})`);
        continue;
      }
      const nette = versBase(l.quantite, comp);
      if (nette == null) {
        erreurs.push(`${r.nom} : « ${comp.nom} » ne se convertit pas`);
        continue;
      }
      parcourir(l.type, l.id, (quantiteBrute(nette, l.perte) * q) / r.rendement, [...pile, cid]);
    }
  };
  parcourir(type, id, quantite, []);
  const resultat = new Map<string, number>();
  for (const [pid, q] of brut) {
    const n = Math.round(q);
    if (n !== 0) resultat.set(pid, n);
  }
  return { produits: resultat, erreurs };
}

/** Produits consommés par `nombre` fois une fiche (nombre négatif : retour en stock). */
export function consommationFiche(ref: Referentiel, fiche: Fiche, nombre: number): { produits: Map<string, number>; erreurs: string[] } {
  const comp = fiche.type === "produit" ? ref.produits.find((p) => p.id === fiche.id) : ref.recettes.find((r) => r.id === fiche.id);
  if (!comp) return { produits: new Map(), erreurs: [`${fiche.type} inconnu(e) (${fiche.id})`] };
  const q = versBase(fiche.quantite, comp);
  if (q == null) return { produits: new Map(), erreurs: [`« ${comp.nom} » ne se convertit pas`] };
  return decomposer(ref, fiche.type, fiche.id, q * nombre);
}

/** Produits d'une quantité saisie (perte d'un produit ou d'une préparation). */
export function consommationQuantite(ref: Referentiel, type: TypeComposant, id: string, quantite: Quantite) {
  return consommationFiche(ref, { type, id, quantite }, 1);
}

/** Valeur signée d'une quantité de produit au coût de l'établissement ; null sans aucun prix. */
export function valoriser(couts: Couts, produitId: string, quantite: number): number | null {
  if (!couts.prixProduit(produitId)) return null;
  const v = couts.cout("produit", produitId, Math.abs(quantite)).micro;
  return quantite < 0 ? -v : v;
}

/** Ajoute des mouvements de consommation (sorties) pour des produits décomposés. */
export function mouvementsDeSortie(
  couts: Couts,
  produits: Map<string, number>,
  base: Omit<Mouvement, "produitId" | "quantite" | "valeurMicro">,
  prefixeCle?: string,
): Mouvement[] {
  return [...produits].map(([produitId, q]) => ({
    ...base,
    produitId,
    quantite: -q,
    valeurMicro: valoriser(couts, produitId, -q),
    ...(prefixeCle ? { cle: `${prefixeCle}:${produitId}` } : {}),
  }));
}

/** Stock théorique par produit : somme des quantités des mouvements. */
export function stockTheorique(mouvements: Array<Pick<Mouvement, "produitId" | "quantite">>): Map<string, number> {
  const m = new Map<string, number>();
  for (const x of mouvements) m.set(x.produitId, (m.get(x.produitId) ?? 0) + x.quantite);
  return m;
}

/** Écart d'inventaire par produit compté : compté − théorique (positif : on avait plus que prévu). */
export function ecartsInventaire(comptes: Map<string, number>, theorique: Map<string, number>): Map<string, number> {
  const ecarts = new Map<string, number>();
  for (const [pid, compte] of comptes) {
    const e = compte - (theorique.get(pid) ?? 0);
    if (e !== 0) ecarts.set(pid, e);
  }
  return ecarts;
}

/** Journée comptable à Paris d'un instant (bascule à 5 h, comme les tickets). */
export function journeeParis(iso: string): string {
  const d = new Date(Date.parse(iso) - 5 * 3600_000);
  return new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
