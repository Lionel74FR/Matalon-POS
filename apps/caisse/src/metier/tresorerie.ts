import { totauxTickets, type Cloture, type Evenement, type ModePaiement, type StockageFiscal, type TotauxPeriode } from "@matalon/noyau-fiscal";

/** Billets et pièces en euros, en centimes, du plus grand au plus petit. */
export const COUPURES = [50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5, 2, 1] as const;

/** Dernière clôture journalière, ou null. */
export async function derniereZ(stockage: StockageFiscal): Promise<Cloture | null> {
  const dernier = await stockage.dernier("clotures");
  if (!dernier) return null;
  // Les clôtures mensuelles et annuelles suivent toujours leurs Z : on remonte au plus quelques enregistrements.
  for (let n = dernier.numero; n >= 1 && n > dernier.numero - 30; n--) {
    const c = await stockage.trouver("clotures", n);
    if (c?.periode === "JOUR") return c;
  }
  return (await stockage.lister("clotures")).filter((c) => c.periode === "JOUR").at(-1) ?? null;
}

/** Événements écrits depuis la dernière Z, c'est-à-dire de la journée en cours. */
export async function evenementsDeLaJournee(stockage: StockageFiscal, z?: Cloture | null): Promise<Evenement[]> {
  const derniere = z === undefined ? await derniereZ(stockage) : z;
  return stockage.lister("evenements", (derniere?.dernierEvenement ?? 0) + 1);
}

export interface EtatJournee {
  derniereZ: Cloture | null;
  /** Fond déclaré pour la journée en cours, en centimes, ou null s'il ne l'a pas été. */
  fondDeclare: number | null;
  /** Fond proposé pour l'ouverture : celui conservé au dernier comptage. */
  fondPropose: number | null;
  /** Totaux des tickets non encore clôturés. */
  totaux: TotauxPeriode;
  dateComptable: string | null;
  /** Journées comptables couvertes par les tickets non clôturés (plusieurs si une Z a été oubliée). */
  journees: string[];
}

export async function etatJournee(stockage: StockageFiscal): Promise<EtatJournee> {
  const z = await derniereZ(stockage);
  const evenements = await evenementsDeLaJournee(stockage, z);
  const fond = evenements.filter((e) => e.code === "FOND_DE_CAISSE").at(-1);
  let fondPropose: number | null = null;
  if (z) {
    const comptage = await comptageDeLaZ(stockage, z);
    if (typeof comptage?.details.fondConserve === "number") fondPropose = comptage.details.fondConserve;
  }
  const tickets = await stockage.lister("tickets", (z?.dernierTicketCouvert ?? 0) + 1);
  const journees = [...new Set(tickets.map((t) => t.dateComptable))];
  return {
    journees,
    derniereZ: z,
    fondDeclare: typeof fond?.details.montant === "number" ? fond.details.montant : null,
    fondPropose,
    totaux: totauxTickets(tickets),
    dateComptable: tickets.at(-1)?.dateComptable ?? null,
  };
}

export const encaisse = (t: TotauxPeriode, mode: ModePaiement) =>
  t.paiements.filter((p) => p.mode === mode).reduce((s, p) => s + p.montant, 0);

export interface SaisieComptage {
  fondInitial: number;
  especesComptees: number;
  /** Détail par coupure (nombre de billets ou pièces), facultatif. */
  detail: Partial<Record<(typeof COUPURES)[number], number>>;
  cbTpe: number;
  trCarteTpe: number;
  trPapierComptes: number;
  fondConserve: number;
  motif: string;
}

export interface Rapprochement {
  especesAttendues: number;
  ecartEspeces: number;
  cbCaisse: number;
  ecartCb: number;
  trCarteCaisse: number;
  ecartTrCarte: number;
  trPapierCaisse: number;
  ecartTrPapier: number;
  remiseEnBanque: number;
  avecEcart: boolean;
}

/** Écarts entre ce que la caisse a enregistré et ce qui a été compté (positif : excédent). */
export function rapprocher(t: TotauxPeriode, s: SaisieComptage): Rapprochement {
  const especesAttendues = s.fondInitial + encaisse(t, "ESPECES");
  const cbCaisse = encaisse(t, "CB");
  const trCarteCaisse = encaisse(t, "TITRE_RESTAURANT_CARTE");
  const trPapierCaisse = encaisse(t, "TITRE_RESTAURANT_PAPIER");
  const r = {
    especesAttendues,
    ecartEspeces: s.especesComptees - especesAttendues,
    cbCaisse,
    ecartCb: s.cbTpe - cbCaisse,
    trCarteCaisse,
    ecartTrCarte: s.trCarteTpe - trCarteCaisse,
    trPapierCaisse,
    ecartTrPapier: s.trPapierComptes - trPapierCaisse,
    remiseEnBanque: s.especesComptees - s.fondConserve,
  };
  return { ...r, avecEcart: [r.ecartEspeces, r.ecartCb, r.ecartTrCarte, r.ecartTrPapier].some((x) => x !== 0) };
}

export function totalCoupures(detail: SaisieComptage["detail"]): number {
  return COUPURES.reduce((s, c) => s + c * (detail[c] ?? 0), 0);
}

/** Contenu de l'événement COMPTAGE_CAISSE : valeurs simples, en centimes. */
export function detailsComptage(t: TotauxPeriode, s: SaisieComptage, journee: string): Evenement["details"] {
  const r = rapprocher(t, s);
  const coupures = COUPURES.filter((c) => (s.detail[c] ?? 0) > 0)
    .map((c) => `${c}x${s.detail[c]}`)
    .join(" ");
  return {
    journee,
    fondInitial: s.fondInitial,
    especesEncaissees: encaisse(t, "ESPECES"),
    especesAttendues: r.especesAttendues,
    especesComptees: s.especesComptees,
    ecartEspeces: r.ecartEspeces,
    coupures: coupures || null,
    cbCaisse: r.cbCaisse,
    cbTpe: s.cbTpe,
    ecartCb: r.ecartCb,
    trCarteCaisse: r.trCarteCaisse,
    trCarteTpe: s.trCarteTpe,
    ecartTrCarte: r.ecartTrCarte,
    trPapierCaisse: r.trPapierCaisse,
    trPapierComptes: s.trPapierComptes,
    ecartTrPapier: r.ecartTrPapier,
    fondConserve: s.fondConserve,
    remiseEnBanque: r.remiseEnBanque,
    motif: s.motif.trim() || null,
  };
}

/**
 * Comptage d'une Z. Quand une Z oubliée est rattrapée, une seule saisie produit
 * plusieurs Z d'un coup : le comptage déclare la journée de la dernière, et
 * c'est à celle-ci qu'il appartient. On remonte le journal depuis la Z jusqu'au
 * comptage le plus proche ; s'il déclare une autre journée, la Z n'en a pas.
 */
export async function comptageDeLaZ(stockage: StockageFiscal, z: Cloture): Promise<Evenement | null> {
  if (z.periode !== "JOUR" || z.dernierEvenement == null) return null;
  const PAS = 200;
  for (let fin = z.dernierEvenement; fin >= 1 && fin > z.dernierEvenement - 10 * PAS; fin -= PAS) {
    const evts = await stockage.lister("evenements", Math.max(1, fin - PAS + 1), fin);
    const comptage = evts.filter((e) => e.code === "COMPTAGE_CAISSE").at(-1);
    if (comptage) return comptage.details.journee === z.identifiantPeriode ? comptage : null;
  }
  return null;
}
