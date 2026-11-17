import {
  active,
  minutes,
  temporaire,
  type CouleurReservation,
  type Reservation,
  type ServiceReservation,
  type SourceReservation,
  type StatutReservation,
  type TableResa,
} from "@matalon/reservations";
import type { Table, ZonePlan } from "@matalon/serveur/partage";
import type { EtatTable } from "../PlanSalle";

/**
 * Réservations façon Zenchef (17 novembre 2026, demande de Lionel) : la liste du jour à gauche,
 * le plan de salle au centre, la saisie dans un panneau à droite. Commun à la caisse et à
 * l'administration ; chacune fournit ses appels (`AccesReservations`) et son contexte.
 */

/** Appels au serveur, avec la personne qui agit déjà jointe (caisse) ou la session (administration). */
export interface AccesReservations {
  lister(du: string, au: string): Promise<Reservation[]>;
  creer(corps: Record<string, unknown>): Promise<{ reservation: Reservation }>;
  modifier(id: string, corps: Record<string, unknown>): Promise<{ reservation: Reservation }>;
}

/** Réglages utiles à l'affichage : services (regroupement, plafonds), écart entre créneaux, fermetures. */
export interface ReglagesAffichage {
  actif: boolean;
  services: ServiceReservation[];
  pasMinutes: 15 | 30;
  dureeMinutes: number;
  fermetures: string[];
  horizonJours: number;
}

export interface ContexteReservations {
  aujourdhui: string;
  reglages: ReglagesAffichage;
  tables: Table[];
  zones: ZonePlan[];
  /** Noms de l'équipe, pour « Prise par ». */
  equipe: string[];
  /** Personne connectée (caisse) : proposée dans « Prise par ». */
  priseParDefaut?: string;
  /** Pas de réseau : la liste du jour seulement, rien ne s'enregistre. */
  horsLigne?: boolean;
}

export const LIBELLES_STATUT: Record<StatutReservation, string> = {
  confirmee: "Confirmée",
  arrivee: "Installée",
  absente: "Absente",
  annulee: "Annulée",
  option: "Sous option",
  attente: "Liste d'attente",
};

export const LIBELLES_CANAL: Record<SourceReservation, string> = {
  en_ligne: "En ligne",
  telephone: "Téléphone",
  sur_place: "Sur place",
  email: "E-mail",
  messagerie: "Messagerie",
};

/** Teintes des couleurs de réservation (repère, jamais seule porteuse de sens : le nom de la couleur est dans le libellé). */
export const TEINTES: Record<CouleurReservation, string> = {
  rose: "#d77fa1",
  violet: "#9b86d6",
  bleu: "#7f9fd9",
  vert: "#86c08a",
  jaune: "#e2c45e",
  orange: "#e39a58",
  rouge: "#de7a72",
  gris: "#a9a39c",
};

export const pl = (n: number, mot: string) => `${n} ${mot}${n > 1 ? "s" : ""}`;

export const sansAccents = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

export const decaler = (jour: string, n: number) => {
  const d = new Date(`${jour}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const enDate = (jour: string) => new Date(`${jour}T12:00:00Z`);
/** « sam. 21 nov. » */
export const dateCourte = (jour: string) => enDate(jour).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
/** « 21 nov. 2026 » */
export const dateRecap = (jour: string) => enDate(jour).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
/** « samedi 21 novembre 2026 » */
export const dateLongue = (jour: string) => enDate(jour).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
/** « mer. » */
export const jourAbrege = (jour: string) => enDate(jour).toLocaleDateString("fr-FR", { weekday: "short", timeZone: "UTC" });

export const jourSemaine = (jour: string) => {
  const j = enDate(jour).getUTCDay();
  return j === 0 ? 7 : j;
};

/** Services ouverts ce jour-là (jour de la semaine), dans l'ordre de la journée. */
export const servicesDuJour = (reglages: ReglagesAffichage, jour: string) =>
  reglages.services.filter((s) => s.jours.includes(jourSemaine(jour))).sort((a, b) => minutes(a.debut) - minutes(b.debut));

/** « DEGAND Annabelle » : le nom en capitales d'abord, comme sur le plan. */
export const nomListe = (r: Pick<Reservation, "prenom" | "nom">) => [r.nom.toLocaleUpperCase("fr-FR"), r.prenom].filter(Boolean).join(" ");
export const nomClient = (r: Pick<Reservation, "prenom" | "nom">) => `${r.prenom} ${r.nom}`.trim();

/** Conflit de capacité (409) : l'équipe peut passer outre, en connaissance de cause. */
export const estConflit = (e: unknown) => typeof e === "object" && e !== null && (e as { statut?: unknown }).statut === 409;
export const messageErreur = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Compte dans « Total » : confirmée ou installée. */
export const compte = active;
export { temporaire };

/** Raccourci d'un nom sur le plateau d'une table (étroit). */
const court = (nom: string) => (nom.length > 8 ? `${nom.slice(0, 7)}…` : nom);

/**
 * Tables d'un jour d'après ses réservations (administration, ou un autre jour que celui du
 * service en caisse) : une table avec une réservation montre son heure et le nom, avec plusieurs leurs heures.
 * Une table dont la réservation est installée paraît occupée ; deux réservations ou plus : leurs heures.
 */
export function etatsDuJour(tables: TableResa[], reservations: Reservation[], filtreService: string | null): Map<string, EtatTable> {
  const m = new Map<string, EtatTable>();
  const liste = reservations
    .filter((r) => (active(r) || temporaire(r)) && (!filtreService || r.serviceId === filtreService))
    .sort((a, b) => minutes(a.heure) - minutes(b.heure));
  for (const t of tables) {
    const siennes = liste.filter((r) => r.tables.includes(t.id));
    if (siennes.length === 0) {
      m.set(t.id, { statut: "libre", lignes: [], description: `Table ${t.nom}, aucune réservation` });
      continue;
    }
    const installee = siennes.some((r) => r.statut === "arrivee");
    m.set(t.id, {
      statut: installee ? "occupee" : "reservee",
      // Une réservation : son heure et son nom ; plusieurs : leurs heures (le détail est dans la liste et le libellé).
      lignes: siennes.length === 1 ? [siennes[0]!.heure, court(siennes[0]!.nom)] : [siennes.slice(0, 2).map((r) => r.heure).join(" · ") + (siennes.length > 2 ? " …" : "")],
      description: `Table ${t.nom}, ${siennes.map((r) => `${r.heure} ${nomClient(r)} (${r.couverts})${temporaire(r) ? ` ${LIBELLES_STATUT[r.statut].toLowerCase()}` : ""}`).join(", ")}`,
    });
  }
  return m;
}
