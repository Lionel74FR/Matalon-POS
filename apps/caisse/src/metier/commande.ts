import { calculerLigne, ventiler, type SaisieLigne, type VentilationTVA } from "@matalon/noyau-fiscal";

/**
 * Commande ouverte (table ou comptoir). Données de travail, hors périmètre
 * fiscal : elles ne deviennent un ticket qu'à l'encaissement. Les retraits
 * de lignes sont tout de même tracés au journal des événements.
 */
export interface LigneCommande {
  uid: string;
  articleId: string;
  libelle: string;
  /** Choix d'une formule ou précision (affichés sous la ligne). */
  details: string[];
  quantite: number;
  prixUnitaireTTC: number;
  tauxTVA: number;
  /** Remise en pourcentage du montant de la ligne (100 = offert), recalculée si la quantité change. */
  remise?: { pourcentage: number; montantTTC: number; motif: string; accordeePar: string };
  ajouteePar: string;
  ajouteeLe: string;
}

export interface Commande {
  tableId: string;
  couverts: number | null;
  ouverteLe: string;
  ouvertePar: string;
  lignes: LigneCommande[];
  additionsImprimees: number;
}

export function nouvelleCommande(tableId: string, operateurId: string, couverts: number | null = null): Commande {
  return {
    tableId,
    couverts,
    ouverteLe: new Date().toISOString(),
    ouvertePar: operateurId,
    lignes: [],
    additionsImprimees: 0,
  };
}

export function uid(): string {
  return crypto.randomUUID();
}

/** Ligne prête pour le noyau fiscal. Les choix de formule sont repris dans le libellé. */
export function versSaisie(l: LigneCommande): SaisieLigne {
  return {
    articleId: l.articleId,
    libelle: l.details.length ? `${l.libelle} (${l.details.join(", ")})` : l.libelle,
    quantite: l.quantite,
    prixUnitaireTTC: l.prixUnitaireTTC,
    tauxTVA: l.tauxTVA,
    ...(l.remise ? { remise: { montantTTC: l.remise.montantTTC, motif: l.remise.motif } } : {}),
  };
}

export function montantLigne(l: LigneCommande): number {
  return calculerLigne(versSaisie(l)).montantTTC;
}

export interface TotauxCommande {
  totalTTC: number;
  totalRemises: number;
  nbArticles: number;
  ventilation: VentilationTVA[];
}

/** Totaux calculés exactement comme le noyau fiscal les calculera. */
export function totauxCommande(c: Commande): TotauxCommande {
  const lignes = c.lignes.map((l) => calculerLigne(versSaisie(l)));
  return {
    totalTTC: lignes.reduce((s, l) => s + l.montantTTC, 0),
    totalRemises: lignes.reduce((s, l) => s + l.remiseTTC, 0),
    nbArticles: c.lignes.reduce((s, l) => s + l.quantite, 0),
    ventilation: ventiler(lignes),
  };
}

/** Change la quantité d'une ligne en recalculant sa remise. */
export function avecQuantite(l: LigneCommande, quantite: number): LigneCommande {
  const suite = { ...l, quantite };
  if (l.remise) suite.remise = { ...l.remise, montantTTC: montantRemise(quantite * l.prixUnitaireTTC, l.remise.pourcentage) };
  return suite;
}

export function montantRemise(brutTTC: number, pourcentage: number): number {
  return pourcentage >= 100 ? brutTTC : Math.round((brutTTC * pourcentage) / 100);
}

/**
 * Ajoute une ligne ; regroupe avec une ligne identique sans remise ni
 * détail pour garder un ticket lisible (2 × Cappuccino).
 */
export function ajouterLigne(c: Commande, l: Omit<LigneCommande, "uid" | "ajouteeLe">): Commande {
  const identique = c.lignes.find(
    (x) =>
      x.articleId === l.articleId &&
      x.prixUnitaireTTC === l.prixUnitaireTTC &&
      !x.remise &&
      !l.remise &&
      x.details.length === 0 &&
      l.details.length === 0,
  );
  if (identique) {
    return {
      ...c,
      lignes: c.lignes.map((x) => (x === identique ? { ...x, quantite: x.quantite + l.quantite } : x)),
    };
  }
  return { ...c, lignes: [...c.lignes, { ...l, uid: uid(), ajouteeLe: new Date().toISOString() }] };
}
