/**
 * Référentiel du stock, commun au groupe : produits (ingrédients achetés),
 * articles fournisseurs, recettes. Les prix d'achat, eux, sont propres à
 * chaque établissement (voir `PrixAchat`).
 *
 * Quantités : entiers dans l'unité de base de leur dimension — grammes,
 * millilitres, ou millièmes de pièce (une pièce = 1 000). Jamais de flottant.
 */

/** Unité dans laquelle un produit est compté (et une recette produite). */
export type UniteStock = "kg" | "L" | "piece";

/** Unité de base des quantités entières : g, mL, ou millième de pièce. */
export type UniteBase = "g" | "mL" | "piece";

export interface Quantite {
  /** Entier : grammes, millilitres ou millièmes de pièce. */
  valeur: number;
  unite: UniteBase;
}

export interface Produit {
  id: string;
  nom: string;
  unite: UniteStock;
  /** Famille (crèmerie, viandes, boissons…) : tag de rangement et de filtre. */
  famille?: string;
  /** Zone de stockage (chambre froide, réserve sèche, bar) : sert aux inventaires. */
  zone?: string;
  /**
   * Poids ou volume d'une pièce : convertit une ligne de recette en grammes
   * vers un produit compté à la pièce, ou une ligne « 1 pièce » vers un
   * produit compté au kilo (un œuf de 60 g).
   */
  contenance?: Quantite;
  /** Archivé : plus proposé, jamais supprimé (recettes et historiques le citent). */
  actif: boolean;
}

export interface ArticleFournisseur {
  id: string;
  produitId: string;
  fournisseur: string;
  reference?: string;
  /** Libellé du conditionnement d'achat (« Carton 6 x 1 L »). */
  conditionnement: string;
  /** Quantité du conditionnement, dans l'unité de base du produit (6 L = 6 000 mL). */
  quantite: number;
  /** Libellés de facture déjà rapprochés de cet article (agent de factures), pour les reconnaître la fois suivante. */
  designations?: string[];
  actif: boolean;
}

/** Prix d'achat HT d'un article fournisseur dans un établissement. Historique en ajout seul. */
export interface PrixAchat {
  articleId: string;
  etablissementId: string;
  /** Centimes HT, pour un conditionnement. */
  prixHT: number;
  le: string;
  source: "saisie" | "import" | "reception" | "facture";
}

export type TypeComposant = "produit" | "recette";

export interface LigneRecette {
  type: TypeComposant;
  id: string;
  /** Quantité utilisée (nette), dans l'unité saisie. */
  quantite: Quantite;
  /** Perte matière à la préparation, en points de base (1 000 = 10 %) : on consomme net / (1 − perte). */
  perte?: number;
}

export interface Recette {
  id: string;
  nom: string;
  unite: UniteStock;
  /** Quantité produite par la recette, dans l'unité de base de `unite` (1,2 L = 1 200 ; 1 pièce = 1 000). */
  rendement: number;
  contenance?: Quantite;
  famille?: string;
  lignes: LigneRecette[];
  note?: string;
  actif: boolean;
}

/** Ce qu'un article de la carte consomme : une recette ou un produit vendu tel quel. */
export interface Fiche {
  type: TypeComposant;
  id: string;
  quantite: Quantite;
}

export interface Referentiel {
  produits: Produit[];
  articles: ArticleFournisseur[];
  recettes: Recette[];
}

export const REFERENTIEL_VIDE: Referentiel = { produits: [], articles: [], recettes: [] };
