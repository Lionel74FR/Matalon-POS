import type { Ticket } from "@matalon/noyau-fiscal";

/**
 * Carte de fidélité (lot 7a) : règles d'un programme, reconnaissance par téléphone,
 * calcul des points d'un ticket. Commun au serveur, à la caisse et à l'administration ;
 * hors périmètre fiscal (les points ne sont jamais un moyen de paiement).
 */

/** Motif de remise d'une récompense, sur le ticket. */
export const MOTIF_FIDELITE = "Fidélité";
/** Récompenses au plus par programme. */
export const RECOMPENSES_MAX = 8;
/** Récompense réservée en caisse et jamais rattachée à un ticket : rendue d'office passé ce délai. */
export const DELAI_RESERVATION_MS = 48 * 3600_000;
/** Membre sans activité depuis trois ans : coordonnées effacées (référentiel CNIL, gestion commerciale). */
export const CONSERVATION_MEMBRE_JOURS = 3 * 365;

export type ModeFidelite = "POINTS" | "TAMPONS";
export type TypeRecompense = "ARTICLE" | "REMISE_EUROS" | "REMISE_POURCENT";

export interface RecompenseFidelite {
  id: string;
  /** « Une boisson chaude offerte », « 10 € offerts ». */
  libelle: string;
  /** Points (ou tampons) dépensés. */
  seuil: number;
  type: TypeRecompense;
  /** ARTICLE : articles de la carte parmi lesquels le client choisit (un offert). */
  articles?: string[];
  /** REMISE_EUROS : montant en centimes. */
  montant?: number;
  /** REMISE_POURCENT : 1 à 100, sur les lignes sans remise. */
  pourcentage?: number;
}

export type ReglesTampon = { par: "ARTICLE"; categories: string[] } | { par: "VISITE"; montantMin: number };

export interface ReglesFidelite {
  mode: ModeFidelite;
  /** POINTS : points gagnés par euro TTC (1 à 100). */
  pointsParEuro: number;
  /** TAMPONS : un tampon par article des catégories choisies, ou par visite au-delà d'un montant (centimes). */
  tampon: ReglesTampon;
  recompenses: RecompenseFidelite[];
  /** Offerts à l'inscription. */
  bienvenue: number;
  /** Moments de la journée (identifiants) où le cumul est doublé. */
  momentsDoubles: string[];
  /** Catégories de la carte qui ne rapportent rien. */
  categoriesExclues: string[];
  /** Points (ou tampons) au plus par ticket ; null : sans plafond. */
  plafondParTicket: number | null;
  /** Points perdus après N mois sans visite ; null : jamais. */
  moisValidite: number | null;
  /** Une seule récompense par ticket. */
  uneRecompenseParTicket: boolean;
}

/** Programme tel que la caisse le reçoit. */
export interface ProgrammeCaisse {
  id: string;
  nom: string;
  actif: boolean;
  regles: ReglesFidelite;
}

/** Programme dans l'administration : son établissement d'origine et ceux qui l'ont rejoint. */
export interface ProgrammeFidelite extends ProgrammeCaisse {
  version: number;
  proprietaire: string;
  etablissements: Array<{ id: string; enseigne: string }>;
  majLe: string;
  membres: number;
}

export interface MembreFidelite {
  id: string;
  telephone: string;
  prenom: string;
  nom: string;
  email: string;
  /** Accord pour recevoir des offres (case à part, décochée par défaut). */
  offres: boolean;
  inscritLe: string;
  derniereVisite: string | null;
  solde: number;
  supprime?: boolean;
}

export type NatureMouvement = "BIENVENUE" | "GAIN" | "UTILISATION" | "RENDU" | "ANNULATION" | "AJUSTEMENT" | "EXPIRATION";

export const LIBELLES_MOUVEMENT: Record<NatureMouvement, string> = {
  BIENVENUE: "Bienvenue",
  GAIN: "Vente",
  UTILISATION: "Récompense",
  RENDU: "Récompense rendue",
  ANNULATION: "Vente annulée",
  AJUSTEMENT: "Ajustement",
  EXPIRATION: "Points expirés",
};

export interface MouvementFidelite {
  nature: NatureMouvement;
  points: number;
  horodatage: string;
  etablissementId: string;
  ticket: { caisseId: string; numero: number } | null;
  motif: string;
  auteur: string;
}

/** Ticket rattaché à un membre : voyage à côté du ticket, jamais dans l'enregistrement scellé. */
export interface LienFidelite {
  caisseId: string;
  numero: number;
  /** Membre reconnu en ligne ; à défaut (hors ligne), son téléphone, rapproché par le serveur. */
  membreId?: string;
  telephone?: string;
  /** Récompenses réservées et appliquées sur ce ticket. */
  utilisations: string[];
}

/** Récompense réservée en caisse pour une commande. */
export interface UtilisationFidelite {
  id: string;
  recompenseId: string;
  libelle: string;
  points: number;
}

export interface ReponseMembreCaisse {
  programme: ProgrammeCaisse;
  membre: MembreFidelite | null;
}

/** Statistiques de la période (cartes des statistiques). */
export interface StatFidelite {
  membres: number;
  inscriptions: number;
  /** Membres venus sur la période (au moins un ticket rattaché). */
  membresVenus: number;
  /** Tickets rattachés et leur CA, face au CA de la période. */
  tickets: number;
  ttc: number;
  /** Récompenses données (remises « Fidélité ») et leur valeur TTC. */
  recompenses: number;
  valeurRecompenses: number;
  points: number;
}

/**
 * Téléphone ramené à une forme unique (+33612345678) : espaces, points et tirets ôtés,
 * 06… et 0033… en +33. Null s'il n'a pas de 8 à 15 chiffres.
 */
export function normaliserTelephone(saisie: string): string | null {
  let s = saisie.replace(/[\s.\-()/]/g, "");
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  if (/^0\d{9}$/.test(s)) s = `+33${s.slice(1)}`;
  if (!s.startsWith("+")) s = `+${s}`;
  return /^\+\d{8,15}$/.test(s) ? s : null;
}

/** Téléphone lisible : +33 6 12 34 56 78. */
export function telephoneLisible(t: string): string {
  const m = /^\+33(\d)(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(t);
  return m ? `0${m[1]} ${m[2]} ${m[3]} ${m[4]} ${m[5]}` : t;
}

/** Proposition de départ, à ajuster dans l'administration. */
export function reglesParDefaut(): ReglesFidelite {
  return {
    mode: "POINTS",
    pointsParEuro: 1,
    tampon: { par: "VISITE", montantMin: 0 },
    recompenses: [{ id: "r-1", libelle: "10 € offerts", seuil: 150, type: "REMISE_EUROS", montant: 1000 }],
    bienvenue: 10,
    momentsDoubles: [],
    categoriesExclues: [],
    plafondParTicket: null,
    moisValidite: 12,
    uneRecompenseParTicket: true,
  };
}

const entier = (n: unknown, min: number, max: number) => typeof n === "number" && Number.isSafeInteger(n) && n >= min && n <= max;

/** Contrôle des règles : null si tout va bien, sinon le problème en clair. Commun à l'éditeur et au serveur. */
export function problemeRegles(r: ReglesFidelite): string | null {
  if (r.mode !== "POINTS" && r.mode !== "TAMPONS") return "Mode de cumul inconnu.";
  if (r.mode === "POINTS" && !entier(r.pointsParEuro, 1, 100)) return "Points par euro : un entier de 1 à 100.";
  if (r.mode === "TAMPONS") {
    if (r.tampon?.par === "ARTICLE" && !r.tampon.categories?.length) return "Choisissez au moins une catégorie qui donne un tampon.";
    if (r.tampon?.par === "VISITE" && !entier(r.tampon.montantMin, 0, 100_000)) return "Montant minimum d'une visite invalide.";
    if (r.tampon?.par !== "ARTICLE" && r.tampon?.par !== "VISITE") return "Règle des tampons inconnue.";
  }
  if (!Array.isArray(r.recompenses) || !r.recompenses.length) return "Ajoutez au moins une récompense.";
  if (r.recompenses.length > RECOMPENSES_MAX) return `${RECOMPENSES_MAX} récompenses au plus.`;
  const ids = new Set<string>();
  for (const x of r.recompenses) {
    const nom = x.libelle?.trim() || "Une récompense";
    if (!x.libelle?.trim() || x.libelle.length > 60) return "Chaque récompense a un libellé (60 caractères au plus).";
    if (!x.id || ids.has(x.id)) return "Identifiants de récompense en double.";
    ids.add(x.id);
    if (!entier(x.seuil, 1, 100_000)) return `« ${nom} » : seuil invalide.`;
    if (x.type === "ARTICLE" && !x.articles?.length) return `« ${nom} » : choisissez au moins un article offert.`;
    else if (x.type === "REMISE_EUROS" && !entier(x.montant, 1, 100_000)) return `« ${nom} » : montant invalide.`;
    else if (x.type === "REMISE_POURCENT" && !entier(x.pourcentage, 1, 100)) return `« ${nom} » : pourcentage de 1 à 100.`;
    else if (!["ARTICLE", "REMISE_EUROS", "REMISE_POURCENT"].includes(x.type)) return `« ${nom} » : type inconnu.`;
  }
  if (!entier(r.bienvenue, 0, 10_000)) return "Bonus de bienvenue invalide.";
  if (r.plafondParTicket !== null && !entier(r.plafondParTicket, 1, 100_000)) return "Plafond par ticket invalide.";
  if (r.moisValidite !== null && !entier(r.moisValidite, 1, 60)) return "Validité : de 1 à 60 mois.";
  if (!Array.isArray(r.momentsDoubles) || !Array.isArray(r.categoriesExclues)) return "Règles incomplètes.";
  return null;
}

/** Unité affichée : « points » ou « tampons ». */
export const unite = (r: Pick<ReglesFidelite, "mode">, n: number) => `${n.toLocaleString("fr-FR")} ${r.mode === "TAMPONS" ? "tampon" : "point"}${Math.abs(n) > 1 ? "s" : ""}`;

/** Récompenses du programme du plus petit seuil au plus grand. */
export const recompensesTriees = (r: ReglesFidelite) => [...r.recompenses].sort((a, b) => a.seuil - b.seuil);

/** Prochaine récompense à atteindre, et ce qu'il manque ; null si toutes sont atteintes. */
export function prochaineRecompense(r: ReglesFidelite, solde: number): { recompense: RecompenseFidelite; manque: number } | null {
  const x = recompensesTriees(r).find((y) => y.seuil > solde);
  return x ? { recompense: x, manque: x.seuil - solde } : null;
}

/**
 * Points (ou tampons) d'une vente : lignes vendues hors catégories exclues et hors
 * récompenses ; doublés sur un moment choisi ; plafonnés. Une annulation se traite
 * en retirant le gain de la vente, jamais en recalculant.
 */
export function pointsDuTicket(r: ReglesFidelite, t: Pick<Ticket, "type" | "lignes">, categorieDe: (articleId: string) => string | null, momentId: string | null): number {
  if (t.type !== "VENTE") return 0;
  const exclues = new Set(r.categoriesExclues);
  const lignes = t.lignes.filter((l) => l.quantite > 0 && l.motifRemise !== MOTIF_FIDELITE && !exclues.has(categorieDe(l.articleId) ?? ""));
  let n = 0;
  if (r.mode === "POINTS") n = Math.floor((lignes.reduce((s, l) => s + l.montantTTC, 0) * r.pointsParEuro) / 100);
  else if (r.tampon.par === "ARTICLE") {
    const cats = new Set(r.tampon.categories);
    n = lignes.filter((l) => cats.has(categorieDe(l.articleId) ?? "")).reduce((s, l) => s + l.quantite, 0);
  } else n = lignes.reduce((s, l) => s + l.montantTTC, 0) >= Math.max(1, r.tampon.montantMin) ? 1 : 0;
  if (momentId && r.momentsDoubles.includes(momentId)) n *= 2;
  return r.plafondParTicket ? Math.min(n, r.plafondParTicket) : n;
}

/** Article de base d'une ligne de ticket (variantes et suppléments : « art:var », « art+sup »). */
export const articleDeBase = (articleId: string) => articleId.split(/[:+]/)[0]!;
