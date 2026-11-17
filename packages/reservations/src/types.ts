/**
 * Réservations de tables. Hors périmètre fiscal : une réservation n'est ni un
 * ticket ni un événement du registre ; elle se modifie (statut, table, heure).
 * Heures en heure de Paris, « HH:MM » ; jours « AAAA-MM-JJ ».
 */

export type Jour = string;
export type Heure = string;

/** Un service ouvert à la réservation (« Déjeuner », « Dîner »). */
export interface ServiceReservation {
  id: string;
  nom: string;
  /** Jours de la semaine, 1 = lundi … 7 = dimanche. */
  jours: number[];
  /** Première et dernière heure d'arrivée proposées. */
  debut: Heure;
  fin: Heure;
  /** Couverts au plus sur tout le service. */
  couvertsMax: number;
  /** Personnes à table en même temps au plus (null : pas de plafond). */
  simultanesMax: number | null;
  /** Couverts qui arrivent au plus sur un même créneau (null : pas de plafond). */
  arriveesMax: number | null;
  /** Durée propre au service, sinon la durée par défaut. */
  dureeMinutes?: number;
}

export interface ReglagesReservation {
  /** Réservation en ligne ouverte (le module du site et les routes publiques). */
  actif: boolean;
  services: ServiceReservation[];
  /** Durée par défaut d'une réservation (minutes) : sert à la présence simultanée et au plan de table. */
  dureeMinutes: number;
  /** Écart entre deux créneaux proposés. */
  pasMinutes: 15 | 30;
  /** Réservation en ligne au plus tard tant de minutes avant l'arrivée. */
  delaiMinutes: number;
  /** Réservation en ligne au plus tant de jours à l'avance. */
  horizonJours: number;
  /** Au-delà, le module invite à appeler ou écrire. */
  groupeMax: number;
  /** Jours fermés exceptionnellement. */
  fermetures: Jour[];
  /** Message d'accueil en tête du module. */
  accueil: string;
  telephone?: string;
  /** E-mail de l'établissement : reçoit chaque réservation et les réponses des clients. */
  email?: string;
  /** Adresse d'expédition des e-mails aux clients, sur un domaine vérifié chez Resend (ex. reservations@moka-annecy.com). */
  expediteur?: string;
  /** Lien vers les conditions d'utilisation et la politique de confidentialité du site. */
  conditions?: string;
  confidentialite?: string;
}

/**
 * « option » (sous option) et « attente » (liste d'attente), 17 novembre 2026 : statuts temporaires
 * posés par l'équipe ; ils ne prennent ni place ni table tant que la réservation n'est pas confirmée.
 */
export type StatutReservation = "confirmee" | "arrivee" | "absente" | "annulee" | "option" | "attente";
/** Canal par lequel la réservation est arrivée : le site, ou l'équipe (téléphone, sur place, e-mail, messagerie). */
export type SourceReservation = "en_ligne" | "telephone" | "sur_place" | "email" | "messagerie";
export type Civilite = "Mme" | "M." | "Mx";

/** Couleur posée par l'équipe sur une réservation (repère dans la liste). */
export const COULEURS_RESERVATION = ["rose", "violet", "bleu", "vert", "jaune", "orange", "rouge", "gris"] as const;
export type CouleurReservation = (typeof COULEURS_RESERVATION)[number];

/** Étiquettes d'une réservation, choisies par l'équipe. */
export const TAGS_RESERVATION = [
  "Anniversaire",
  "Client habitué",
  "VIP",
  "Première visite",
  "Professionnel",
  "Chaise haute",
  "Poussette",
  "Mobilité réduite",
  "Animal",
  "Au calme",
  "Terrasse souhaitée",
] as const;

export interface Reservation {
  id: string;
  etablissementId: string;
  date: Jour;
  heure: Heure;
  couverts: number;
  dureeMinutes: number;
  serviceId: string;
  civilite?: Civilite;
  prenom: string;
  nom: string;
  telephone: string;
  email?: string;
  commentaire?: string;
  statut: StatutReservation;
  source: SourceReservation;
  /** Tables attribuées (plusieurs : tables assemblées). Vide : à placer. */
  tables: string[];
  zoneSouhaitee?: string;
  offresEmail?: boolean;
  offresSms?: boolean;
  /** Membre de l'équipe qui a pris la réservation (nom). */
  prisePar?: string;
  /** Allergies et régimes signalés. */
  allergies?: string;
  /** Mémo pour l'équipe, distinct du message du client (`commentaire`). */
  memo?: string;
  couleur?: CouleurReservation;
  tags?: string[];
  creeLe: string;
  majLe: string;
  historique: Array<{ le: string; par: string; action: string }>;
}

/** Table du plan, telle que l'attribution la lit. */
export interface TableResa {
  id: string;
  nom: string;
  zone: string;
  chaises?: number;
  masquee?: boolean;
}

export const REGLAGES_DEFAUT: ReglagesReservation = {
  actif: false,
  services: [],
  dureeMinutes: 90,
  pasMinutes: 15,
  delaiMinutes: 60,
  horizonJours: 60,
  groupeMax: 8,
  fermetures: [],
  accueil: "",
};
