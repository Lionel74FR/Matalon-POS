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
  /** Précision libre pour le service (« sans sucre », « allergie fruits à coque ») : ni prix ni ticket. */
  note?: string;
  ajouteePar: string;
  ajouteeLe: string;
  /**
   * Ligne retirée après envoi : elle reste affichée barrée à l'écran pour le
   * service, mais ne compte plus (ni total, ni addition, ni ticket). Le retrait
   * est tracé au journal des événements. Avant envoi, une ligne retirée
   * disparaît simplement : la commande n'est qu'un brouillon.
   */
  retiree?: { le: string; par: string };
  /** Formule : catégorie de chaque choix, pour envoyer chacun à son poste de production. */
  composants?: Array<{ libelle: string; categorieId: string }>;
  /** Commande validée (« Envoyer », ou d'office à l'encaissement) ; bons de production imprimés s'il y a des imprimantes. */
  envoyee?: { le: string; par: string };
  /** Ligne retirée après envoi : bon d'annulation imprimé. */
  annulationEnvoyee?: boolean;
  /** Suite (« course ») : absente pour « En direct », 1 à 3 pour « À suivre » ; préparée quand elle est réclamée. */
  suite?: SuiteAttente;
}

/** « À suivre 1 » à « À suivre 3 » ; « En direct » est l'absence de suite. */
export type SuiteAttente = 1 | 2 | 3;
/** 0 : En direct. */
export type Suite = 0 | SuiteAttente;
export const SUITES: readonly Suite[] = [0, 1, 2, 3];

export const suiteDe = (l: Pick<LigneCommande, "suite">): Suite => l.suite ?? 0;

/** « En direct », « À suivre 1 »… */
export const nomSuite = (s: Suite): string => (s === 0 ? "En direct" : `À suivre ${s}`);
/** « Direct », « AS1 »… pour les boutons et le plan. */
export const nomCourtSuite = (s: Suite): string => (s === 0 ? "Direct" : `AS${s}`);

/** Une suite réclamée : la cuisine lance sa préparation. */
export interface Reclame {
  suite: SuiteAttente;
  le: string;
  par: string;
}

export interface Commande {
  tableId: string;
  couverts: number | null;
  ouverteLe: string;
  ouvertePar: string;
  lignes: LigneCommande[];
  additionsImprimees: number;
  /** Note libre sur la commande (« anniversaire, servir le dessert avec une bougie »). */
  note?: string;
  /** Tables assemblées à celle de la commande pour un groupe : occupées avec elle, libérées avec elle. */
  jointes?: string[];
  /** Suites réclamées, dans l'ordre. */
  reclames?: Reclame[];
}

/** Tables qu'occupe une commande : la sienne, puis celles qui lui sont assemblées. */
export function tablesDeCommande(c: Commande): string[] {
  return [c.tableId, ...(c.jointes ?? [])];
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

/** Lignes qui comptent : celles qui n'ont pas été retirées. */
export function lignesActives(c: Commande): LigneCommande[] {
  return c.lignes.filter((l) => !l.retiree);
}

/**
 * Une commande se garde tant qu'elle porte quelque chose : un article (même
 * retiré, pour qu'il reste visible barré), des couverts (table installée avant
 * de commander) ou une note. « Libérer la table » la ferme explicitement.
 */
export function commandeAGarder(c: Commande | null): c is Commande {
  return !!c && (c.lignes.length > 0 || c.couverts != null || !!c.note);
}

/**
 * Modifie une ligne. Avant envoi, un retrait efface simplement (brouillon).
 * Après envoi, un retrait (ligne entière, ou une partie de sa quantité) laisse
 * une ligne barrée à sa place, tracée, qui donnera un bon d'annulation.
 */
export function modifierLigne(
  c: Commande,
  ligneUid: string,
  nouvelle: LigneCommande | null,
  unitesRetirees: number,
  par: string,
): Commande {
  const retiree = { le: new Date().toISOString(), par };
  const lignes: LigneCommande[] = [];
  for (const x of c.lignes) {
    if (x.uid !== ligneUid) {
      lignes.push(x);
    } else if (!nouvelle) {
      if (x.envoyee) lignes.push({ ...x, retiree });
    } else if (x.envoyee && nouvelle.quantite > x.quantite) {
      // Ligne déjà partie en production : le supplément devient une ligne à envoyer.
      const { envoyee: _, ...reste } = nouvelle;
      lignes.push(avecQuantite(nouvelle, x.quantite));
      lignes.push({ ...avecQuantite(reste, nouvelle.quantite - x.quantite), uid: uid(), ajouteeLe: retiree.le, ajouteePar: par });
    } else {
      lignes.push(nouvelle);
      if (unitesRetirees > 0 && x.envoyee) lignes.push({ ...avecQuantite(x, unitesRetirees), uid: uid(), retiree });
    }
  }
  return { ...c, lignes };
}

/** Totaux calculés exactement comme le noyau fiscal les calculera. */
export function totauxCommande(c: Commande): TotauxCommande {
  const actives = lignesActives(c);
  const lignes = actives.map((l) => calculerLigne(versSaisie(l)));
  return {
    totalTTC: lignes.reduce((s, l) => s + l.montantTTC, 0),
    totalRemises: lignes.reduce((s, l) => s + l.remiseTTC, 0),
    nbArticles: actives.reduce((s, l) => s + l.quantite, 0),
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
      !x.retiree &&
      !x.envoyee &&
      x.articleId === l.articleId &&
      x.prixUnitaireTTC === l.prixUnitaireTTC &&
      !x.remise &&
      !l.remise &&
      !x.note &&
      x.details.length === 0 &&
      l.details.length === 0 &&
      suiteDe(x) === suiteDe(l),
  );
  if (identique) {
    return {
      ...c,
      lignes: c.lignes.map((x) => (x === identique ? { ...x, quantite: x.quantite + l.quantite } : x)),
    };
  }
  return { ...c, lignes: [...c.lignes, { ...l, uid: uid(), ajouteeLe: new Date().toISOString() }] };
}

/** Commande déplacée sur une autre table (libre). */
export function transfererCommande(c: Commande, versTableId: string): Commande {
  // Le groupe change de place : les tables assemblées restent où elles sont, libres.
  const { jointes: _, ...reste } = c;
  return { ...reste, tableId: versTableId };
}

/**
 * Regroupe la commande d'une table sur celle d'une autre table déjà ouverte :
 * lignes et couverts additionnés, notes conservées, ouverture la plus ancienne.
 */
export function fusionnerCommandes(cible: Commande, source: Commande): Commande {
  const notes = [cible.note, source.note].filter(Boolean);
  const { reclames: _, ...base } = cible;
  return {
    ...base,
    couverts: cible.couverts == null && source.couverts == null ? null : (cible.couverts ?? 0) + (source.couverts ?? 0),
    ouverteLe: cible.ouverteLe < source.ouverteLe ? cible.ouverteLe : source.ouverteLe,
    lignes: [...cible.lignes, ...source.lignes],
    additionsImprimees: Math.max(cible.additionsImprimees, source.additionsImprimees),
    ...(notes.length ? { note: notes.join(" · ") } : {}),
    ...(jointesFusion(cible, source).length ? { jointes: jointesFusion(cible, source) } : {}),
    ...(reclamesFusion(cible, source).length ? { reclames: reclamesFusion(cible, source) } : {}),
  };
}

/**
 * Une suite reste réclamée après regroupement si elle l'était sur chaque
 * table qui en avait : sinon, des articles de l'autre table attendent encore.
 */
function reclamesFusion(cible: Commande, source: Commande): Reclame[] {
  const reclames: Reclame[] = [];
  for (const s of [1, 2, 3] as const) {
    const cotes = [cible, source].filter((c) => lignesActives(c).some((l) => suiteDe(l) === s));
    const r = cotes.map((c) => reclameDe(c, s));
    if (cotes.length && r.every(Boolean)) reclames.push(r.reduce((a, b) => (a!.le > b!.le ? a : b))!);
  }
  return reclames.sort((a, b) => a.le.localeCompare(b.le));
}

const jointesFusion = (cible: Commande, source: Commande) =>
  [...new Set([...(cible.jointes ?? []), ...(source.jointes ?? [])])].filter((id) => id !== cible.tableId);

// ───────── Suites (« courses ») ─────────

export function reclameDe(c: Commande, s: Suite): Reclame | null {
  return s === 0 ? null : (c.reclames?.find((r) => r.suite === s) ?? null);
}

/** Suites présentes dans la commande (articles non retirés), dans l'ordre de service. */
export function suitesDe(c: Commande): Suite[] {
  const presentes = new Set(lignesActives(c).map(suiteDe));
  return SUITES.filter((s) => presentes.has(s));
}

/** Suites qui attendent d'être réclamées, dans l'ordre. */
export function suitesAReclamer(c: Commande): SuiteAttente[] {
  return suitesDe(c).filter((s): s is SuiteAttente => s !== 0 && !reclameDe(c, s));
}

/** Réclame une suite (sans effet si elle l'est déjà). */
export function reclamer(c: Commande, suite: SuiteAttente, par: string, le = new Date().toISOString()): Commande {
  if (reclameDe(c, suite)) return c;
  return { ...c, reclames: [...(c.reclames ?? []), { suite, le, par }] };
}

/** Lignes regroupées par suite, dans l'ordre de service ; l'ordre de saisie est gardé dans chaque suite. */
export function lignesParSuite(c: Commande): Array<{ suite: Suite; lignes: LigneCommande[] }> {
  return SUITES.map((suite) => ({ suite, lignes: c.lignes.filter((l) => suiteDe(l) === suite) })).filter((g) => g.lignes.length > 0);
}

/**
 * Suivi de la table pour la salle : prochaine suite à réclamer et dernier
 * mouvement vers la production (envoi ou réclame), d'où l'on compte le temps.
 */
export function suiviSuites(c: Commande): { prochaine: SuiteAttente | null; derniereReclame: Reclame | null; dernierMouvement: string | null } {
  const dates = [...c.lignes.flatMap((l) => (l.envoyee ? [l.envoyee.le] : [])), ...(c.reclames ?? []).map((r) => r.le)];
  const reclames = [...(c.reclames ?? [])].sort((a, b) => a.le.localeCompare(b.le));
  return {
    prochaine: suitesAReclamer(c)[0] ?? null,
    derniereReclame: reclames.at(-1) ?? null,
    dernierMouvement: dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null,
  };
}
