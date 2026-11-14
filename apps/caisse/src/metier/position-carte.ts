/**
 * Rayon et catégorie de la carte affichés à l'écran de commande (14 novembre 2026, demande de
 * Lionel) : la commande suivante, même sur une autre table ou une nouvelle commande, rouvre la carte
 * là où on l'a laissée (« Cuisine » avant l'encaissement, « Cuisine » à la table suivante). Gardé sur
 * l'appareil, aussi après un redémarrage de l'app ; un rayon ou une catégorie disparus de la carte
 * ramènent au premier.
 */
export interface PositionCarte {
  rayon: string;
  categorieId: string | null;
}

const CLE = "matalon-carte-position";

export function lirePositionCarte(): PositionCarte | null {
  try {
    const p = JSON.parse(localStorage.getItem(CLE) ?? "null") as PositionCarte | null;
    return p && typeof p.rayon === "string" && (p.categorieId === null || typeof p.categorieId === "string") ? p : null;
  } catch {
    return null;
  }
}

export function enregistrerPositionCarte(p: PositionCarte): void {
  try {
    localStorage.setItem(CLE, JSON.stringify(p));
  } catch {
    /* stockage indisponible : la carte rouvrira sur le premier rayon */
  }
}

/** Position de départ : celle gardée si son rayon existe encore, sinon le premier rayon. */
export function positionInitiale(rayons: readonly string[], gardee: PositionCarte | null): PositionCarte {
  return gardee && rayons.includes(gardee.rayon) ? gardee : { rayon: rayons[0]!, categorieId: null };
}
