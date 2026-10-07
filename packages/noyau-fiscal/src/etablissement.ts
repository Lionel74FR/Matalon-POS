/**
 * Clôtures d'établissement (0.7.0) : une Z, une clôture mensuelle ou
 * d'exercice vaut pour toutes les caisses de l'établissement, quel que soit
 * l'appareil qui la scelle. Chaque caisse garde sa chaîne et sa signature ;
 * la clôture désigne, pour chacune, la plage de tickets et d'événements
 * qu'elle couvre, et la clôture précédente de l'établissement (où qu'elle soit).
 */
import type { Cloture, CouvertureCaisse, PeriodeCloture, RefCloture } from "./types.js";

export const cleRef = (r: { caisseId: string; numero: number }) => `${r.caisseId}#${r.numero}`;
export const refDe = (c: Cloture): RefCloture => ({ caisseId: c.caisseId, numero: c.numero, hash: c.hash });

/**
 * Clôtures d'établissement d'une période, dans l'ordre de leur chaînage
 * (chacune après celle qu'elle désigne comme précédente), indépendamment des
 * horloges ; à défaut de lien connu, dans l'ordre de leur horodatage.
 */
export function ordonner(clotures: Cloture[], periode: PeriodeCloture): Cloture[] {
  const liste = clotures
    .filter((c) => c.etablissement && c.periode === periode)
    .sort((a, b) => a.horodatage.localeCompare(b.horodatage) || a.caisseId.localeCompare(b.caisseId) || a.numero - b.numero);
  const presentes = new Set(liste.map(cleRef));
  const suivantes = new Map<string, Cloture[]>();
  const racines: Cloture[] = [];
  for (const c of liste) {
    const p = c.etablissement!.precedente;
    if (p && presentes.has(cleRef(p))) suivantes.set(cleRef(p), [...(suivantes.get(cleRef(p)) ?? []), c]);
    else racines.push(c);
  }
  const resultat: Cloture[] = [];
  const vues = new Set<string>();
  const parcourir = (c: Cloture) => {
    const pile = [c];
    while (pile.length) {
      const x = pile.pop()!;
      if (vues.has(cleRef(x))) continue;
      vues.add(cleRef(x));
      resultat.push(x);
      pile.push(...[...(suivantes.get(cleRef(x)) ?? [])].reverse());
    }
  };
  for (const r of racines) parcourir(r);
  // Un cycle (enregistrements falsifiés) laisse des clôtures hors parcours : elles suivent, sans ordre garanti.
  for (const c of liste) if (!vues.has(cleRef(c))) parcourir(c);
  return resultat;
}

/** Sans doublon (même caisse, même numéro). */
export function unir(...listes: Cloture[][]): Cloture[] {
  const vues = new Map<string, Cloture>();
  for (const l of listes) for (const c of l) if (!vues.has(cleRef(c))) vues.set(cleRef(c), c);
  return [...vues.values()];
}

/**
 * Dernière clôture d'établissement d'une période : celle qu'aucune autre ne
 * désigne comme précédente. S'il y en a plusieurs (deux appareils ont clôturé
 * en même temps, ce que le verrou du serveur empêche), la plus récente.
 */
export function tete(clotures: Cloture[], periode: PeriodeCloture): Cloture | null {
  const liste = ordonner(clotures, periode);
  const designees = new Set(liste.flatMap((c) => (c.etablissement!.precedente ? [cleRef(c.etablissement!.precedente)] : [])));
  return liste.filter((c) => !designees.has(cleRef(c))).at(-1) ?? null;
}

export const COUVERTURE_VIDE = (caisseId: string): CouvertureCaisse => ({
  caisseId,
  premierTicket: null,
  dernierTicketCouvert: 0,
  hashDernierTicketCouvert: null,
  premierEvenement: null,
  dernierEvenement: 0,
  hashDernierEvenement: null,
  grandTotalPerpetuel: 0,
  cumulPerpetuelAbsolu: 0,
});

/** Couverture d'une caisse par ses propres Z (avant 0.7.0). */
export function couvertureAncienne(clotures: Cloture[], caisseId: string): CouvertureCaisse {
  const z = clotures.filter((c) => !c.etablissement && c.periode === "JOUR" && c.caisseId === caisseId).sort((a, b) => a.numero - b.numero);
  const derniere = z.at(-1);
  if (!derniere) return COUVERTURE_VIDE(caisseId);
  const avecEvenements = z.filter((c) => c.dernierEvenement != null).at(-1);
  return {
    caisseId,
    premierTicket: null,
    dernierTicketCouvert: derniere.dernierTicketCouvert,
    hashDernierTicketCouvert: derniere.dernierTicket === derniere.dernierTicketCouvert ? derniere.hashDernierTicket : null,
    premierEvenement: null,
    dernierEvenement: avecEvenements?.dernierEvenement ?? 0,
    hashDernierEvenement: avecEvenements?.hashDernierEvenement ?? null,
    grandTotalPerpetuel: derniere.grandTotalPerpetuel,
    cumulPerpetuelAbsolu: derniere.cumulPerpetuelAbsolu,
  };
}

/** Couverture de chaque caisse par la dernière Z de l'établissement, à défaut par ses propres Z. */
export function couvertures(clotures: Cloture[], caisses: Iterable<string>): Map<string, CouvertureCaisse> {
  const z = tete(clotures, "JOUR");
  const m = new Map<string, CouvertureCaisse>();
  for (const c of z?.etablissement?.caisses ?? []) m.set(c.caisseId, { ...c, premierTicket: null, premierEvenement: null });
  for (const id of caisses) if (!m.has(id)) m.set(id, couvertureAncienne(clotures, id));
  return m;
}

/**
 * Dernier ticket d'une caisse couvert par une clôture journalière (null si
 * elle ne la concerne pas) : sert au contrôle des corrections de paiement.
 */
export function ticketCouvertPar(c: Cloture, caisseId: string): number | null {
  if (c.periode !== "JOUR") return null;
  if (c.etablissement) return c.etablissement.caisses.find((x) => x.caisseId === caisseId)?.dernierTicketCouvert ?? null;
  return c.caisseId === caisseId ? c.dernierTicketCouvert : null;
}
