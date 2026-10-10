import type { Heure, Jour, ReglagesReservation, Reservation, ServiceReservation, TableResa } from "./types.js";

// ───────── Heures et jours ─────────

export const HEURE_VALIDE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const JOUR_VALIDE = /^\d{4}-\d{2}-\d{2}$/;

export const minutes = (h: Heure): number => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
export const heureDe = (m: number): Heure => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export function decalerJour(jour: Jour, n: number): Jour {
  const d = new Date(`${jour}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 1 = lundi … 7 = dimanche. */
export function jourSemaine(jour: Jour): number {
  const j = new Date(`${jour}T12:00:00Z`).getUTCDay();
  return j === 0 ? 7 : j;
}

/** Jour et minute à Paris d'un instant. */
export function maintenantParis(instant: Date): { jour: Jour; minute: number } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(instant)
      .map((x) => [x.type, x.value]),
  );
  return { jour: `${p.year}-${p.month}-${p.day}`, minute: Number(p.hour) * 60 + Number(p.minute) };
}

// ───────── Occupation ─────────

/** Une réservation compte (capacité, tables) tant qu'elle n'est ni annulée ni absente. */
export const active = (r: Pick<Reservation, "statut">) => r.statut === "confirmee" || r.statut === "arrivee";

export const dureeDe = (reglages: ReglagesReservation, service: ServiceReservation | undefined) => service?.dureeMinutes ?? reglages.dureeMinutes;

const intervalle = (r: Pick<Reservation, "heure" | "dureeMinutes">) => [minutes(r.heure), minutes(r.heure) + r.dureeMinutes] as const;
const chevauche = (a: readonly [number, number], b: readonly [number, number]) => a[0] < b[1] && b[0] < a[1];

/** Personnes à table au plus, à un moment de [debut, fin), d'après ces réservations. */
export function presenceMax(reservations: Array<Pick<Reservation, "heure" | "dureeMinutes" | "couverts">>, debut: number, fin: number): number {
  const points = new Set([debut, ...reservations.map((r) => minutes(r.heure)).filter((m) => m > debut && m < fin)]);
  let max = 0;
  for (const p of points) {
    const n = reservations.filter((r) => {
      const [d, f] = intervalle(r);
      return d <= p && p < f;
    }).reduce((s, r) => s + r.couverts, 0);
    max = Math.max(max, n);
  }
  return max;
}

// ───────── Contrôle d'une demande ─────────

export interface Demande {
  date: Jour;
  heure: Heure;
  couverts: number;
}

export type Refus =
  | "FERME"
  | "HORS_SERVICE"
  | "TROP_TARD"
  | "TROP_TOT"
  | "GROUPE"
  | "SERVICE_COMPLET"
  | "SALLE_PLEINE"
  | "CRENEAU_COMPLET";

export const MESSAGES_REFUS: Record<Refus, string> = {
  FERME: "L'établissement est fermé ce jour-là.",
  HORS_SERVICE: "Aucun service n'est ouvert à la réservation à cette heure.",
  TROP_TARD: "Ce créneau est trop proche pour réserver en ligne.",
  TROP_TOT: "Les réservations ne sont pas encore ouvertes pour cette date.",
  GROUPE: "Pour un groupe de cette taille, contactez directement l'établissement.",
  SERVICE_COMPLET: "Ce service est complet.",
  SALLE_PLEINE: "La salle est complète à cette heure.",
  CRENEAU_COMPLET: "Ce créneau est complet.",
};

/** Service qui propose cette heure ce jour-là. */
export function serviceDe(reglages: ReglagesReservation, date: Jour, heure: Heure): ServiceReservation | undefined {
  const j = jourSemaine(date);
  const m = minutes(heure);
  return reglages.services.find(
    (s) => s.jours.includes(j) && m >= minutes(s.debut) && m <= minutes(s.fin) && (m - minutes(s.debut)) % reglages.pasMinutes === 0,
  );
}

/**
 * Refus éventuel d'une demande, sinon null. `enLigne` : délai, horizon et taille
 * de groupe s'appliquent (une saisie de l'équipe ne les subit pas). `ignorer` :
 * la réservation modifiée, qui ne se compte pas contre elle-même.
 */
export function controler(
  reglages: ReglagesReservation,
  reservations: Reservation[],
  d: Demande,
  options: { maintenant: Date; enLigne: boolean; ignorer?: string },
): Refus | null {
  if (reglages.fermetures.includes(d.date)) return "FERME";
  const service = serviceDe(reglages, d.date, d.heure);
  if (!service) return "HORS_SERVICE";
  if (options.enLigne) {
    if (d.couverts > reglages.groupeMax) return "GROUPE";
    const ici = maintenantParis(options.maintenant);
    if (d.date > decalerJour(ici.jour, reglages.horizonJours)) return "TROP_TOT";
    const ecart = (Date.parse(`${d.date}T00:00:00Z`) - Date.parse(`${ici.jour}T00:00:00Z`)) / 60_000 + minutes(d.heure) - ici.minute;
    if (ecart < reglages.delaiMinutes) return "TROP_TARD";
  }
  const duree = dureeDe(reglages, service);
  const du = reservations.filter((r) => r.date === d.date && active(r) && r.id !== options.ignorer);
  const memeService = du.filter((r) => r.serviceId === service.id);
  if (memeService.reduce((s, r) => s + r.couverts, 0) + d.couverts > service.couvertsMax) return "SERVICE_COMPLET";
  if (service.arriveesMax !== null && memeService.filter((r) => r.heure === d.heure).reduce((s, r) => s + r.couverts, 0) + d.couverts > service.arriveesMax) {
    return "CRENEAU_COMPLET";
  }
  if (service.simultanesMax !== null) {
    const debut = minutes(d.heure);
    if (presenceMax(du, debut, debut + duree) + d.couverts > service.simultanesMax) return "SALLE_PLEINE";
  }
  return null;
}

// ───────── Créneaux proposés ─────────

export interface Creneau {
  heure: Heure;
  libre: boolean;
}

export interface CreneauxService {
  serviceId: string;
  nom: string;
  creneaux: Creneau[];
}

/**
 * Créneaux d'un jour pour un nombre de couverts, par service. Les heures trop
 * proches (délai) ne sont pas proposées ; les autres sont libres ou complètes.
 */
export function creneauxDuJour(reglages: ReglagesReservation, reservations: Reservation[], date: Jour, couverts: number, maintenant: Date): CreneauxService[] {
  if (reglages.fermetures.includes(date)) return [];
  const j = jourSemaine(date);
  return reglages.services
    .filter((s) => s.jours.includes(j))
    .sort((a, b) => minutes(a.debut) - minutes(b.debut))
    .map((s) => {
      const creneaux: Creneau[] = [];
      for (let m = minutes(s.debut); m <= minutes(s.fin); m += reglages.pasMinutes) {
        const heure = heureDe(m);
        const refus = controler(reglages, reservations, { date, heure, couverts }, { maintenant, enLigne: true });
        if (refus === "TROP_TARD" || refus === "TROP_TOT" || refus === "HORS_SERVICE") continue;
        creneaux.push({ heure, libre: refus === null });
      }
      return { serviceId: s.id, nom: s.nom, creneaux };
    })
    .filter((s) => s.creneaux.length > 0);
}

/** Jours de la période qui ont au moins un créneau libre pour ce nombre de couverts. */
export function joursLibres(reglages: ReglagesReservation, reservations: Reservation[], du: Jour, au: Jour, couverts: number, maintenant: Date): Jour[] {
  const libres: Jour[] = [];
  for (let j = du; j <= au; j = decalerJour(j, 1)) {
    if (creneauxDuJour(reglages, reservations, j, couverts, maintenant).some((s) => s.creneaux.some((c) => c.libre))) libres.push(j);
  }
  return libres;
}

// ───────── Tables ─────────

export const chaisesDe = (t: TableResa) => t.chaises ?? 4;

/**
 * Plus petite table libre qui accueille le groupe sur toute la durée, de
 * préférence dans la zone souhaitée ; [] si aucune ne convient (à placer par
 * l'équipe, en assemblant des tables par exemple).
 */
export function attribuerTable(
  tables: TableResa[],
  reservations: Reservation[],
  r: Pick<Reservation, "id" | "date" | "heure" | "dureeMinutes" | "couverts" | "zoneSouhaitee">,
): string[] {
  const occupees = new Set(
    reservations
      .filter((x) => x.id !== r.id && x.date === r.date && active(x) && chevauche(intervalle(x), intervalle(r)))
      .flatMap((x) => x.tables),
  );
  const candidates = tables
    .filter((t) => !t.masquee && !occupees.has(t.id) && chaisesDe(t) >= r.couverts)
    .sort(
      (a, b) =>
        Number(b.zone === r.zoneSouhaitee) - Number(a.zone === r.zoneSouhaitee) ||
        chaisesDe(a) - chaisesDe(b) ||
        a.nom.localeCompare(b.nom, "fr", { numeric: true }),
    );
  return candidates[0] ? [candidates[0].id] : [];
}

/** Réservations d'une table qui se chevauchent avec celle-ci (conflit à signaler). */
export function conflitsTable(reservations: Reservation[], r: Reservation): Reservation[] {
  return reservations.filter(
    (x) => x.id !== r.id && x.date === r.date && active(x) && x.tables.some((t) => r.tables.includes(t)) && chevauche(intervalle(x), intervalle(r)),
  );
}

/**
 * Prochaine réservation active de chaque table ce jour-là, à partir de cette
 * minute (une réservation en cours compte jusqu'à sa fin) : ce que montre le plan.
 */
export function prochainesParTable(reservations: Reservation[], date: Jour, minute: number): Map<string, Reservation> {
  const parTable = new Map<string, Reservation>();
  const triees = reservations
    .filter((r) => r.date === date && active(r) && intervalle(r)[1] > minute)
    .sort((a, b) => minutes(a.heure) - minutes(b.heure));
  for (const r of triees) for (const t of r.tables) if (!parTable.has(t)) parTable.set(t, r);
  return parTable;
}
