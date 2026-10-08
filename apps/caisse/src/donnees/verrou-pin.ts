/**
 * Blocage du code PIN : 5 codes faux de suite bloquent la personne 5 minutes
 * sur cet appareil (connexion comme validation responsable). L'état survit à
 * un rechargement de la page. Le serveur applique la même règle aux actions
 * qu'il contrôle lui-même (modification de l'équipe).
 */
export const ESSAIS_PIN = 5;
export const BLOCAGE_PIN_MS = 5 * 60_000;

export interface EtatPin {
  echecs: number;
  /** Fin du blocage (ms depuis l'époque), ou null. */
  bloqueJusqua: number | null;
}

type Rangement = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const cle = (utilisateurId: string) => `matalon.pin.${utilisateurId}`;

function rangement(): Rangement | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function lireEtatPin(utilisateurId: string, maintenant = Date.now(), r: Rangement | null = rangement()): EtatPin {
  try {
    const e = JSON.parse(r?.getItem(cle(utilisateurId)) ?? "null") as EtatPin | null;
    if (!e) return { echecs: 0, bloqueJusqua: null };
    // Blocage écoulé : la personne repart avec ses 5 essais.
    if (e.bloqueJusqua != null && e.bloqueJusqua <= maintenant) return { echecs: 0, bloqueJusqua: null };
    return { echecs: Number(e.echecs) || 0, bloqueJusqua: e.bloqueJusqua ?? null };
  } catch {
    return { echecs: 0, bloqueJusqua: null };
  }
}

/** Code faux : renvoie le nouvel état ; `bloque` vaut vrai quand cet échec déclenche le blocage. */
export function noterEchecPin(utilisateurId: string, maintenant = Date.now(), r: Rangement | null = rangement()): EtatPin & { bloque: boolean } {
  const avant = lireEtatPin(utilisateurId, maintenant, r);
  const echecs = avant.echecs + 1;
  const etat: EtatPin = echecs >= ESSAIS_PIN ? { echecs, bloqueJusqua: maintenant + BLOCAGE_PIN_MS } : { echecs, bloqueJusqua: null };
  try {
    r?.setItem(cle(utilisateurId), JSON.stringify(etat));
  } catch {
    /* stockage indisponible : le blocage vaut jusqu'au rechargement */
  }
  return { ...etat, bloque: etat.bloqueJusqua != null };
}

export function effacerEchecsPin(utilisateurId: string, r: Rangement | null = rangement()): void {
  try {
    r?.removeItem(cle(utilisateurId));
  } catch {
    /* rien à effacer */
  }
}
