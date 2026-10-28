/**
 * Brouillon du comptage de fin de journée (28 octobre 2026) : la saisie est gardée sur l'appareil à
 * chaque touche, pour la journée comptée. Si l'écran se fige, si l'iPad se verrouille ou si la PWA
 * redémarre en plein comptage, « Clôturer la journée » reprend là où on en était. Hors fiscal : seul
 * l'événement COMPTAGE_CAISSE, journalisé à la validation, fait foi. Effacé une fois la Z faite.
 */

export interface BrouillonComptage {
  /** Journée comptable comptée ; un brouillon d'une autre journée est ignoré. */
  journee: string;
  enregistreLe: string;
  fond: string;
  detail: Record<string, number>;
  totalDirect: string | null;
  cbTpe: string;
  trCarteTpe: string;
  trPapier: string;
  fondConserve: string | null;
  motif: string;
  depenses: Array<{ cle: number; libelle: string; montant: string }>;
}

const cle = (caisseId: string) => `matalon-comptage:${caisseId}`;

export function lireBrouillonComptage(caisseId: string, journee: string): BrouillonComptage | null {
  try {
    const b = JSON.parse(localStorage.getItem(cle(caisseId)) ?? "null") as BrouillonComptage | null;
    return b && b.journee === journee ? b : null;
  } catch {
    return null;
  }
}

export function enregistrerBrouillonComptage(caisseId: string, b: BrouillonComptage): void {
  try {
    localStorage.setItem(cle(caisseId), JSON.stringify(b));
  } catch {
    /* stockage plein ou indisponible : le comptage continue, sans reprise possible */
  }
}

export function oublierBrouillonComptage(caisseId: string): void {
  try {
    localStorage.removeItem(cle(caisseId));
  } catch {
    /* rien à faire */
  }
}

/**
 * Touche du pavé appliquée à un montant saisi en texte (« 152,30 ») ou à un nombre entier (coupures).
 * `neuf` : première touche après le choix du champ, qui remplace la valeur affichée.
 */
export function appliquerTouche(valeur: string, touche: string, o: { entier: boolean; neuf: boolean }): string {
  if (touche === "effacer") return o.neuf ? "" : valeur.slice(0, -1);
  const base = o.neuf ? "" : valeur;
  if (touche === ",") {
    if (o.entier || base.includes(",")) return base;
    return `${base || "0"},`;
  }
  if (!/^\d$/.test(touche)) return base;
  if (o.entier) return base.length >= 4 ? base : String(Number(base + touche));
  const [ent = "", dec] = base.split(",");
  if (dec !== undefined) return dec.length >= 2 ? base : `${base}${touche}`;
  if (ent.length >= 6) return base;
  return ent === "0" ? touche : `${base}${touche}`;
}
