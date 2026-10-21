import { canonique } from "@matalon/noyau-fiscal";
import type { Acompte, Commande, LigneCommande } from "./commande";

const egales = (a: unknown, b: unknown) => canonique(a ?? null) === canonique(b ?? null);

/**
 * Fusion à trois de deux versions d'une commande modifiées en même temps sur deux appareils :
 * `base` est la dernière version commune, `locale` celle de cet appareil, `distante` celle du
 * serveur. Les lignes se rapprochent par leur identifiant : chaque ajout est gardé, chaque
 * modification l'emporte sur l'absence de modification ; pour un même champ modifié des deux
 * côtés, cet appareil l'emporte (c'est lui qui écrit). Rien de ce qu'un appareil a ajouté ne se perd.
 *
 * Table fermée d'un côté (encaissée, libérée, déplacée) : seules survivent les lignes ajoutées
 * de l'autre côté depuis la base ; s'il n'y en a pas, la table reste fermée.
 *
 * Ce qui a été payé ne se perd jamais : une ligne réglée à part l'emporte sur toute autre
 * version d'elle-même, et les acomptes des deux côtés sont réunis (un acompte annulé l'emporte
 * sur sa version active). Un acompte reçu après la base survit à la fermeture de l'autre côté.
 */
export function fusionnerCommande(base: Commande | null, locale: Commande | null, distante: Commande | null): Commande | null {
  if (egales(locale, base)) return distante;
  if (egales(distante, base) || egales(distante, locale)) return locale;
  const dansBase = new Set((base?.lignes ?? []).map((l) => l.uid));
  if (!distante || !locale) {
    const restante = (distante ?? locale)!;
    const ajoutees = restante.lignes.filter((l) => !dansBase.has(l.uid));
    const acomptesBase = new Set((base?.acomptes ?? []).map((a) => a.id));
    const recus = (restante.acomptes ?? []).filter((a) => !acomptesBase.has(a.id));
    if (!ajoutees.length && !recus.some((a) => !a.annule)) return null;
    const { acomptes: _, ...sans } = restante;
    return { ...sans, lignes: ajoutees, additionsImprimees: 0, ...(recus.length ? { acomptes: recus } : {}) };
  }

  const parUid = (c: Commande | null) => new Map((c?.lignes ?? []).map((l) => [l.uid, l]));
  const b = parUid(base);
  const l = parUid(locale);
  const d = parUid(distante);
  const lignes: LigneCommande[] = [];
  // Ordre : celui du serveur, puis les ajouts de cet appareil.
  const ordre = [...distante.lignes.map((x) => x.uid), ...locale.lignes.map((x) => x.uid).filter((u) => !d.has(u))];
  for (const u of ordre) {
    const lb = b.get(u);
    const ll = l.get(u);
    const ld = d.get(u);
    if (!lb) {
      // Ajoutée d'un côté (ou des deux, même identifiant) : gardée.
      const x = ll ?? ld;
      if (x) lignes.push(x);
    } else if (ll && ld) {
      if (ld.reglee && !ll.reglee) lignes.push(ld);
      else if (ll.reglee && !ld.reglee) lignes.push(ll);
      else lignes.push(egales(ll, lb) ? ld : ll);
    } else if (ll && !ld) {
      // Retirée sur le serveur : gardée seulement si cet appareil l'a modifiée entre-temps.
      if (!egales(ll, lb)) lignes.push(ll);
    } else if (ld && !ll) {
      // Retirée ici : gardée seulement si l'autre appareil l'a modifiée entre-temps.
      if (!egales(ld, lb)) lignes.push(ld);
    }
  }

  const champ = <K extends keyof Commande>(k: K): Commande[K] =>
    egales(locale[k], base?.[k]) ? distante[k] : locale[k];
  const resultat: Commande = {
    ...distante,
    couverts: champ("couverts"),
    ouverteLe: champ("ouverteLe"),
    ouvertePar: champ("ouvertePar"),
    lignes,
    additionsImprimees: Math.max(locale.additionsImprimees, distante.additionsImprimees),
  };
  for (const k of ["note", "jointes", "reclames", "parts", "fidelite"] as const) {
    const v = champ(k);
    if (v === undefined) delete resultat[k];
    else (resultat as unknown as Record<string, unknown>)[k] = v;
  }
  const acomptes = reunirAcomptes(distante.acomptes ?? [], locale.acomptes ?? []);
  if (acomptes.length) resultat.acomptes = acomptes;
  else delete resultat.acomptes;
  return resultat;
}

/** Union par identifiant, dans l'ordre du serveur puis de cet appareil ; l'annulation l'emporte. */
function reunirAcomptes(distants: Acompte[], locaux: Acompte[]): Acompte[] {
  const parId = new Map<string, Acompte>();
  for (const a of [...distants, ...locaux]) {
    const deja = parId.get(a.id);
    if (!deja || (!deja.annule && a.annule)) parId.set(a.id, a);
  }
  return [...parId.values()];
}
