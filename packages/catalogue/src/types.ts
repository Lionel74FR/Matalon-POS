import type { Fiche } from "@matalon/stock";

/** Taux de TVA en points de base, sur place (pas de vente à emporter au Moka). */
export const TVA = {
  /** Restauration sur place : plats, boissons sans alcool. */
  RESTAURATION: 1000,
  /** Boissons alcoolisées, prestations. */
  NORMAL: 2000,
} as const;

/** Une déclinaison au choix, éventuellement à un autre prix (ex. 25 cl / 50 cl). */
export interface Variante {
  id: string;
  nom: string;
  /** Libellé complet sur le ticket ; à défaut « <article> <variante> ». */
  libelle?: string;
  /** Prix TTC en centimes ; à défaut, celui de l'article. */
  prixTTC?: number;
  /** Ce que consomme la variante (remplace la fiche de l'article : 25 cl, 50 cl). */
  fiche?: Fiche;
}

/** Supplément facturé en plus de l'article, sur une ligne distincte du ticket. */
export interface Supplement {
  id: string;
  nom: string;
  prixTTC: number;
  /** Ce que consomme le supplément, en plus de l'article. */
  fiche?: Fiche;
}

/** Un choix à faire dans une formule (« une boisson chaude au choix »). */
export interface ChoixFormule {
  id: string;
  nom: string;
  /** Catégories ou articles proposés. */
  categories?: string[];
  articles?: string[];
  /**
   * Cours du choix (17 novembre 2026, Lionel : les menus respectent les cours) : absent pour « En direct »,
   * 1 à 3 pour « À suivre 1 » à « À suivre 3 ». Une formule entrée, plat, dessert part ainsi en Direct,
   * AS1, AS2 : chaque choix est envoyé et réclamé avec son cours.
   */
  suite?: 1 | 2 | 3;
}

export interface Article {
  id: string;
  nom: string;
  description?: string;
  /** Prix TTC en centimes ; null tant qu'il n'est pas fixé (voir `aCompleter`) ou pour un prix libre. */
  prixTTC: number | null;
  /**
   * Prix saisi en caisse à chaque vente (divers, plat de l'ardoise, prix variable) :
   * l'article n'a pas de prix de carte (`prixTTC` null), ni variante, ni supplément, ni formule.
   */
  prixLibre?: boolean;
  tauxTVA: number;
  variantes?: Variante[];
  supplements?: Supplement[];
  formule?: ChoixFormule[];
  /** Plage de prix de la carte quand le détail n'est pas encore fourni. */
  fourchette?: { min: number; max: number };
  /** Information manquante avant mise en caisse. */
  aCompleter?: string;
  /** Article retiré temporairement (rupture, hors saison) : grisé en caisse, non vendable. */
  indisponible?: boolean;
  /** Fiche technique : la recette ou le produit vendu tel quel, et la quantité (module stock). */
  fiche?: Fiche;
}

export interface Categorie {
  id: string;
  nom: string;
  /** Regroupement d'écran : Boissons, Bar, Cuisine, Goûter, À partager, Formules. */
  rayon: string;
  /** Poste de production (« Bar », « Cuisine ») : imprimante où partent ses bons. Absent : aucun bon. */
  poste?: string;
  articles: Article[];
  /**
   * Articles d'autres catégories proposés aussi dans celle-ci (16 novembre 2026 : écran « Nuit » du Chardon),
   * à la suite des siens, dans cet ordre. L'article reste défini une seule fois (prix, TVA, fiche, poste de
   * sa catégorie) : ce ne sont que des tuiles de plus.
   */
  raccourcis?: string[];
  /** Tuiles qui ouvrent d'autres catégories (dossiers de Domino : « Vin au verre », « Mojito »…), avant les articles. */
  liens?: string[];
}

export interface Catalogue {
  id: string;
  nom: string;
  /** Origine de la carte (document fourni, édition dans l'administration). */
  source: string;
  /** Établissement à qui la carte appartient (une carte n'est jamais partagée, 16 novembre 2026). */
  etablissementId: string;
  categories: Categorie[];
}

/** Taux de TVA acceptés en caisse, en points de base. */
export const TAUX_TVA_AUTORISES = [550, 1000, 2000] as const;
