/** Type d'appareil qui fait tourner la caisse. */
export type TypeAppareil = "iPad" | "iPhone" | "Autre";

/**
 * Type de cet appareil. iPadOS se présente comme un Mac dans Safari : on le
 * reconnaît à son écran tactile.
 */
export function typeDeCetAppareil(nav: Pick<Navigator, "userAgent" | "maxTouchPoints"> = navigator): TypeAppareil {
  if (/iPhone|iPod/.test(nav.userAgent)) return "iPhone";
  if (/iPad/.test(nav.userAgent) || (/Macintosh/.test(nav.userAgent) && nav.maxTouchPoints > 1)) return "iPad";
  return "Autre";
}

/** Description envoyée au serveur au rattachement : « iPad · <user agent> ». */
export function descriptionAppareil(nav: Pick<Navigator, "userAgent" | "maxTouchPoints"> = navigator): string {
  return `${typeDeCetAppareil(nav)} · ${nav.userAgent}`.slice(0, 200);
}

/** Type d'un appareil rattaché, d'après la description reçue (ou l'ancien user agent brut). */
export function typeDepuisDescription(appareil: string): TypeAppareil {
  const prefixe = /^(iPad|iPhone|Autre) · /.exec(appareil);
  if (prefixe) return prefixe[1] as TypeAppareil;
  if (/iPhone|iPod/.test(appareil)) return "iPhone";
  // Avant cette description, un iPad envoyait le user agent d'un Mac : seul un rattachement à l'iPad était prévu.
  if (/iPad|Macintosh/.test(appareil)) return "iPad";
  return "Autre";
}

/** Nom de cet appareil dans les messages (« l'iPad », « l'iPhone »). */
export const NOM_APPAREIL: "iPad" | "iPhone" =
  typeof navigator !== "undefined" && typeDeCetAppareil() === "iPhone" ? "iPhone" : "iPad";
