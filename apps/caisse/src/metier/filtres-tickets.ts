import { paiementsEffectifs, paiementsNets, type ModePaiement, type Paiement, type Ticket } from "@matalon/noyau-fiscal";

/**
 * Filtres de l'écran Tickets. Lecture seule : rien n'est écrit, aucun
 * enregistrement fiscal n'est touché. Montants en centimes.
 */

/** Nature d'un ticket telle que l'écran la propose au filtrage. */
export type NatureTicket = "VENTE" | "VENTE_ANNULEE" | "ANNULATION" | "REGLEMENT" | "CORRECTION";

export const NATURES: Array<[NatureTicket, string]> = [
  ["VENTE", "Ventes"],
  ["VENTE_ANNULEE", "Ventes annulées"],
  ["ANNULATION", "Annulations"],
  ["REGLEMENT", "Règlements de compte"],
  ["CORRECTION", "Corrections"],
];

export interface FiltresTickets {
  /** N° de ticket, montant (« 12,50 »), table, client, personne ou motif. */
  recherche: string;
  /** Bornes sur le montant du ticket, en valeur absolue (une annulation de 12 € compte pour 12 €). */
  montantMin: number | null;
  montantMax: number | null;
  /** Au moins un de ces moyens de paiement (après correction éventuelle). Vide : tous. */
  modes: ModePaiement[];
  natures: NatureTicket[];
  operateurs: string[];
  appareils: string[];
  lieu: "tous" | "comptoir" | "table";
}

export const FILTRES_VIDES: FiltresTickets = {
  recherche: "",
  montantMin: null,
  montantMax: null,
  modes: [],
  natures: [],
  operateurs: [],
  appareils: [],
  lieu: "tous",
};

/** Nombre de filtres actifs (hors recherche et période), pour le bouton « Filtres ». */
export function nombreFiltres(f: FiltresTickets): number {
  return (
    (f.montantMin !== null || f.montantMax !== null ? 1 : 0) +
    (f.modes.length ? 1 : 0) +
    (f.natures.length ? 1 : 0) +
    (f.operateurs.length ? 1 : 0) +
    (f.appareils.length ? 1 : 0) +
    (f.lieu !== "tous" ? 1 : 0)
  );
}

const cle = (caisseId: string, numero: number) => `${caisseId}#${numero}`;

/** Ventes annulées, d'après les tickets d'annulation connus (y compris ceux faits après la période). */
export function ventesAnnulees(tickets: Ticket[]): Set<string> {
  return new Set(tickets.filter((t) => t.type === "ANNULATION" && t.ticketOrigine).map((t) => cle(t.caisseId, t.ticketOrigine!.numero)));
}

export function natureDe(t: Ticket, annulees: Set<string>): NatureTicket {
  if (t.type === "VENTE") return annulees.has(cle(t.caisseId, t.numero)) ? "VENTE_ANNULEE" : "VENTE";
  return t.type;
}

/** Montant affiché d'un ticket : le reçu d'un règlement, sinon le total TTC (négatif pour une annulation). */
export function montantTicket(t: Ticket): number {
  return t.reglement ? t.reglement.montantTTC : t.totalTTC;
}

/**
 * Paiements à retenir pour un ticket : ceux d'une vente après correction,
 * nets du rendu monnaie ; pour une correction, ses deux sens (−erroné, +juste).
 */
export function paiementsDe(t: Ticket, tous: Ticket[]): Paiement[] {
  return t.type === "VENTE" ? paiementsEffectifs(t, tous) : paiementsNets(t.paiements, t.renduMonnaie);
}

/** « 12,50 », « 12.5 », « 12 € » → centimes ; null si ce n'est pas un montant. */
export function lireMontant(texte: string): number | null {
  const m = /^\s*(\d{1,6})(?:[.,](\d{1,2}))?\s*(?:€|eur)?\s*$/i.exec(texte);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
}

const normaliser = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

export interface ContexteFiltre {
  /** Tous les tickets connus (période et contexte), pour les corrections et les annulations. */
  tous: Ticket[];
  /** Texte cherchable d'un ticket : table, client, personne, appareil… */
  texte: (t: Ticket) => string;
}

export function filtrerTickets(liste: Ticket[], f: FiltresTickets, ctx: ContexteFiltre): Ticket[] {
  const annulees = ventesAnnulees(ctx.tous);
  const q = normaliser(f.recherche);
  const numero = /^\d+$/.test(q) ? Number(q) : null;
  const montantCherche = q && !/^\d+$/.test(q) ? lireMontant(q) : null;
  return liste.filter((t) => {
    const montant = Math.abs(montantTicket(t));
    if (f.montantMin !== null && montant < f.montantMin) return false;
    if (f.montantMax !== null && montant > f.montantMax) return false;
    if (f.natures.length && !f.natures.includes(natureDe(t, annulees))) return false;
    if (f.modes.length && !paiementsDe(t, ctx.tous).some((p) => f.modes.includes(p.mode))) return false;
    if (f.operateurs.length && !f.operateurs.includes(t.operateurId ?? "")) return false;
    if (f.appareils.length && !f.appareils.includes(t.caisseId)) return false;
    if (f.lieu !== "tous") {
      // Règlements et corrections ne se rattachent à aucune table.
      if (t.type === "REGLEMENT" || t.type === "CORRECTION" || t.reglement) return false;
      const comptoir = !t.tableId || t.tableId === "comptoir";
      if (comptoir !== (f.lieu === "comptoir")) return false;
    }
    if (q) {
      // Un nombre seul : n° de ticket ou montant en euros ronds (« 12 » trouve le n° 12 et les tickets de 12,00 €).
      if (numero !== null) return t.numero === numero || montant === numero * 100;
      if (montantCherche !== null) return montant === montantCherche;
      return normaliser(`${ctx.texte(t)} ${t.client?.nom ?? ""} ${t.motif ?? ""}`).includes(q);
    }
    return true;
  });
}

export interface TotauxTickets {
  nombre: number;
  /** Ventes moins annulations de ventes (règlements de compte exclus : déjà comptés à la vente). */
  ventesTTC: number;
  /** Encaissé par moyen de paiement : ventes (après correction), règlements, remboursements. */
  parMode: Partial<Record<ModePaiement, number>>;
}

export function totaliser(liste: Ticket[], tous: Ticket[]): TotauxTickets {
  const parMode: Partial<Record<ModePaiement, number>> = {};
  let ventesTTC = 0;
  for (const t of liste) {
    if (!t.reglement && (t.type === "VENTE" || t.type === "ANNULATION")) ventesTTC += t.totalTTC;
    // Une correction est déjà dans les paiements effectifs de sa vente.
    if (t.type === "CORRECTION") continue;
    for (const p of paiementsDe(t, tous)) parMode[p.mode] = (parMode[p.mode] ?? 0) + p.montant;
  }
  return { nombre: liste.length, ventesTTC, parMode };
}
