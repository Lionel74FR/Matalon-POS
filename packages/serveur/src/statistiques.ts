/**
 * Statistiques d'un établissement sur une période de journées comptables,
 * calculées à partir des tickets de toutes ses caisses (copie du serveur).
 * Les montants suivent les Z : CA net des annulations, TVA collectée,
 * encaissements par mode (règlements de comptes compris).
 */
import type { Catalogue } from "@matalon/catalogue";
import { totauxTickets, type Ticket } from "@matalon/noyau-fiscal";
import type { IndicateursPeriode, LigneStat, ReponseStatistiques, StatServeur, Table } from "./partage.js";

export const JOURS_MAX_STATISTIQUES = 366;
export const DATE_VALIDE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function ajouterJours(jour: string, n: number): string {
  const d = new Date(`${jour}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function joursEntre(du: string, au: string): number {
  return Math.round((Date.parse(`${au}T12:00:00Z`) - Date.parse(`${du}T12:00:00Z`)) / 86_400_000) + 1;
}

const heureParis = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "numeric", hourCycle: "h23" });
/** Heure de Paris (0 à 23) d'un horodatage. */
const heureDe = (iso: string) => Number(heureParis.formatToParts(new Date(iso)).find((p) => p.type === "hour")?.value ?? 0) % 24;
const ventes = (tickets: Ticket[]) => tickets.filter((t) => t.type === "VENTE");
const ventesEtAnnulations = (tickets: Ticket[]) => tickets.filter((t) => t.type === "VENTE" || t.type === "ANNULATION");
const estOffert = (l: Ticket["lignes"][number]) => l.remiseTTC !== 0 && Math.abs(l.remiseTTC) === Math.abs(l.quantite * l.prixUnitaireTTC);

/** Ventes de la période qui n'ont pas été annulées dans la période. */
function ventesConservees(tickets: Ticket[]): Ticket[] {
  const annulees = new Set(tickets.filter((t) => t.type === "ANNULATION" && t.ticketOrigine).map((t) => `${t.caisseId}#${t.ticketOrigine!.numero}`));
  return ventes(tickets).filter((t) => !annulees.has(`${t.caisseId}#${t.numero}`));
}

export function indicateurs(tickets: Ticket[]): IndicateursPeriode {
  const t = totauxTickets(tickets);
  const v = ventesConservees(tickets);
  const servies = v.filter((x) => (x.couverts ?? 0) > 0);
  const couverts = servies.reduce((s, x) => s + (x.couverts ?? 0), 0);
  const lignes = ventesEtAnnulations(tickets).flatMap((x) => x.lignes);
  return {
    caTTC: t.totalTTC,
    caHT: t.totalHT,
    tva: t.totalTVA,
    nbVentes: t.nbVentes,
    ventesConservees: v.length,
    nbAnnulations: t.nbAnnulations,
    montantAnnule: -tickets.filter((x) => x.type === "ANNULATION").reduce((s, x) => s + x.totalTTC, 0),
    ticketMoyen: v.length ? Math.round(v.reduce((s, x) => s + x.totalTTC, 0) / v.length) : 0,
    couverts,
    parCouvert: couverts ? Math.round(servies.reduce((s, x) => s + x.totalTTC, 0) / couverts) : 0,
    remises: lignes.filter((l) => !estOffert(l)).reduce((s, l) => s + l.remiseTTC, 0),
    offerts: lignes.filter(estOffert).reduce((s, l) => s + l.remiseTTC, 0),
    articles: lignes.reduce((s, l) => s + l.quantite, 0),
    nbCorrections: tickets.filter((x) => x.type === "CORRECTION").length,
    ventesEnCompte: t.comptesClients?.ventesEnCompteTTC ?? 0,
    reglementsComptes: t.comptesClients?.reglementsTTC ?? 0,
  };
}

/** Regroupe et trie par CA décroissant. */
function grouper<T>(elements: T[], cle: (x: T) => string, ajout: (acc: LigneStat, x: T) => void, libelle: (x: T) => string): LigneStat[] {
  const m = new Map<string, LigneStat>();
  for (const x of elements) {
    const k = cle(x);
    const acc = m.get(k) ?? { cle: k, libelle: libelle(x), ttc: 0 };
    ajout(acc, x);
    m.set(k, acc);
  }
  return [...m.values()].sort((a, b) => b.ttc - a.ttc || a.libelle.localeCompare(b.libelle));
}

const plus = (acc: LigneStat, champ: "tickets" | "quantite" | "couverts", n: number) => {
  acc[champ] = (acc[champ] ?? 0) + n;
};

export interface ContexteStatistiques {
  du: string;
  au: string;
  /** Tickets de la période et de la précédente (même durée, juste avant). */
  tickets: Ticket[];
  carte: Catalogue | null;
  utilisateurs: Array<{ id: string; nom: string }>;
  tables: Table[];
  appareils: Record<string, string>;
  synchros: Record<string, string | null>;
  maintenant: Date;
}

export function calculerStatistiques(c: ContexteStatistiques): Omit<ReponseStatistiques, "alertes"> {
  const jours = joursEntre(c.du, c.au);
  const precedente = { du: ajouterJours(c.du, -jours), au: ajouterJours(c.du, -1) };
  const tickets = c.tickets.filter((t) => t.dateComptable >= c.du && t.dateComptable <= c.au);
  const avant = c.tickets.filter((t) => t.dateComptable >= precedente.du && t.dateComptable <= precedente.au);
  const va = ventesEtAnnulations(tickets);

  // Heures et jours.
  const parHeure = Array.from({ length: 24 }, (_, heure) => ({ heure, ttc: 0, tickets: 0 }));
  for (const t of va) {
    const h = parHeure[heureDe(t.horodatage)]!;
    h.ttc += t.totalTTC;
    if (t.type === "VENTE") h.tickets++;
  }
  const parJour = Array.from({ length: jours }, (_, i) => ({ jour: ajouterJours(c.du, i), ttc: 0, tickets: 0, couverts: 0 }));
  const indexJour = new Map(parJour.map((j, i) => [j.jour, i]));
  for (const t of va) {
    const j = parJour[indexJour.get(t.dateComptable)!]!;
    j.ttc += t.totalTTC;
    j.couverts += t.couverts ?? 0;
    if (t.type === "VENTE") j.tickets++;
  }
  const jourSemaine = (jour: string) => (new Date(`${jour}T12:00:00Z`).getUTCDay() + 6) % 7;
  const parJourSemaine = Array.from({ length: 7 }, (_, jour) => {
    const lesJours = parJour.filter((j) => jourSemaine(j.jour) === jour);
    const ttc = lesJours.reduce((s, j) => s + j.ttc, 0);
    return { jour, ttc, tickets: lesJours.reduce((s, j) => s + j.tickets, 0), moyenne: lesJours.length ? Math.round(ttc / lesJours.length) : 0 };
  });

  // Encaissements.
  const totaux = totauxTickets(tickets);
  const paiements = totaux.paiements
    .map((p) => ({
      mode: p.mode,
      montant: p.montant,
      tickets: tickets.filter((t) => t.type !== "CORRECTION" && t.paiements.some((x) => x.mode === p.mode)).length,
    }))
    .sort((a, b) => b.montant - a.montant);

  // Articles et catégories (catégorie lue sur la carte actuelle).
  const categorieDe = new Map<string, { nom: string; rayon: string }>();
  for (const cat of c.carte?.categories ?? []) for (const a of cat.articles) categorieDe.set(a.id, { nom: cat.nom, rayon: cat.rayon });
  const lignes = va.flatMap((t) => t.lignes.map((l) => ({ l, base: l.articleId.split(/[:+]/)[0]! })));
  const articles = grouper(
    lignes,
    ({ l }) => l.articleId,
    (acc, { l }) => {
      acc.ttc += l.montantTTC;
      plus(acc, "quantite", l.quantite);
    },
    ({ l }) => l.libelle,
  ).map((a) => ({ ...a, detail: categorieDe.get(a.cle.split(/[:+]/)[0]!)?.nom ?? "Hors carte" }));
  const categories = grouper(
    lignes,
    ({ base }) => categorieDe.get(base)?.nom ?? "Hors carte",
    (acc, { l }) => {
      acc.ttc += l.montantTTC;
      plus(acc, "quantite", l.quantite);
    },
    ({ base }) => categorieDe.get(base)?.nom ?? "Hors carte",
  ).map((x) => ({ ...x, detail: [...categorieDe.values()].find((v) => v.nom === x.cle)?.rayon ?? "" }));

  // Serveurs.
  const nomDe = new Map(c.utilisateurs.map((u) => [u.id, u.nom]));
  const serveurs = new Map<string, StatServeur>();
  for (const t of va) {
    const s = serveurs.get(t.operateurId) ?? {
      id: t.operateurId,
      nom: nomDe.get(t.operateurId) ?? t.operateurId,
      ttc: 0,
      tickets: 0,
      ticketMoyen: 0,
      couverts: 0,
      remises: 0,
      offerts: 0,
      annulations: 0,
      montantAnnule: 0,
    };
    s.ttc += t.totalTTC;
    s.couverts += t.couverts ?? 0;
    if (t.type === "VENTE") s.tickets++;
    else {
      s.annulations++;
      s.montantAnnule -= t.totalTTC;
    }
    for (const l of t.lignes) {
      if (estOffert(l)) s.offerts += l.remiseTTC;
      else s.remises += l.remiseTTC;
    }
    serveurs.set(t.operateurId, s);
  }
  for (const s of serveurs.values()) {
    const brut = ventes(tickets).filter((t) => t.operateurId === s.id).reduce((x, t) => x + t.totalTTC, 0);
    s.ticketMoyen = s.tickets ? Math.round(brut / s.tickets) : 0;
  }

  // Appareils, zones, tables.
  const tableDe = new Map(c.tables.map((t) => [t.id, t]));
  const ajoutTicket = (acc: LigneStat, t: Ticket) => {
    acc.ttc += t.totalTTC;
    if (t.type === "VENTE") plus(acc, "tickets", 1);
    plus(acc, "couverts", t.couverts ?? 0);
  };
  const appareils = grouper(va, (t) => t.caisseId, ajoutTicket, (t) => c.appareils[t.caisseId] ?? t.caisseId);
  const zoneDe = (t: Ticket) => (t.tableId == null ? "Comptoir" : (tableDe.get(t.tableId)?.zone ?? "Hors plan"));
  const zones = grouper(va, zoneDe, ajoutTicket, zoneDe);
  const tables = grouper(
    va.filter((t) => t.tableId != null),
    (t) => t.tableId!,
    ajoutTicket,
    (t) => `Table ${tableDe.get(t.tableId!)?.nom ?? t.tableId}`,
  ).map((x) => ({ ...x, detail: tableDe.get(x.cle)?.zone ?? "Hors plan" }));

  // Remises et annulations par motif.
  const remisesParMotif = grouper(
    va.flatMap((t) => t.lignes.filter((l) => l.remiseTTC !== 0)),
    (l) => (estOffert(l) ? `Offert · ${l.motifRemise ?? "sans motif"}` : (l.motifRemise ?? "sans motif")),
    (acc, l) => {
      acc.ttc += l.remiseTTC;
      plus(acc, "quantite", l.quantite);
    },
    (l) => (estOffert(l) ? `Offert · ${l.motifRemise ?? "sans motif"}` : (l.motifRemise ?? "sans motif")),
  );
  const annulationsParMotif = grouper(
    tickets.filter((t) => t.type === "ANNULATION"),
    (t) => t.motif ?? "sans motif",
    (acc, t) => {
      acc.ttc -= t.totalTTC;
      plus(acc, "tickets", 1);
    },
    (t) => t.motif ?? "sans motif",
  );

  return {
    du: c.du,
    au: c.au,
    jours,
    precedente,
    calculeLe: c.maintenant.toISOString(),
    indicateurs: indicateurs(tickets),
    indicateursPrecedents: indicateurs(avant),
    parHeure,
    parJour,
    parJourSemaine,
    paiements,
    tva: totaux.ventilationTVA,
    categories,
    articles,
    serveurs: [...serveurs.values()].sort((a, b) => b.ttc - a.ttc),
    appareils,
    zones,
    tables,
    remisesParMotif,
    annulationsParMotif,
    synchros: c.synchros,
    nomsAppareils: c.appareils,
  };
}
