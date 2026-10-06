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
}

/** Supplément facturé en plus de l'article, sur une ligne distincte du ticket. */
export interface Supplement {
  id: string;
  nom: string;
  prixTTC: number;
}

/** Un choix à faire dans une formule (« une boisson chaude au choix »). */
export interface ChoixFormule {
  id: string;
  nom: string;
  /** Catégories ou articles proposés. */
  categories?: string[];
  articles?: string[];
}

export interface Article {
  id: string;
  nom: string;
  description?: string;
  /** Prix TTC en centimes ; null tant qu'il n'est pas fixé (voir `aCompleter`). */
  prixTTC: number | null;
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
}

export interface Categorie {
  id: string;
  nom: string;
  /** Regroupement d'écran : Boissons, Bar, Cuisine, Goûter, À partager, Formules. */
  rayon: string;
  /** Poste de production (« Bar », « Cuisine ») : imprimante où partent ses bons. Absent : aucun bon. */
  poste?: string;
  articles: Article[];
}

export interface Catalogue {
  id: string;
  nom: string;
  /** Origine de la carte (document fourni, édition dans l'administration). */
  source: string;
  /** Établissement pour lequel la carte a été créée (indicatif : plusieurs peuvent la partager). */
  etablissementId: string;
  categories: Categorie[];
}

/** Taux de TVA acceptés en caisse, en points de base. */
export const TAUX_TVA_AUTORISES = [550, 1000, 2000] as const;
