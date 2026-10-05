import { canonique, contenuScelle } from "./canonique.js";
import { HASH_GENESE, sha256Hex, verifierSignature, type ResolveurCle } from "./crypto.js";
import { listeMois } from "./dates.js";
import { ventiler } from "./montants.js";
import { champsTotaux, TOTAUX_VIDES, totauxClotures, totauxTickets } from "./registre.js";
import type { StockageFiscal } from "./stockage.js";
import type { Chaine, Cloture, Enregistrement, Ticket } from "./types.js";

export interface Anomalie {
  chaine: Chaine;
  numero: number;
  code:
    | "NUMERO_DISCONTINU"
    | "CHAINAGE_ROMPU"
    | "EMPREINTE_INVALIDE"
    | "SIGNATURE_INVALIDE"
    | "CLE_INCONNUE"
    | "TOTAUX_INCOHERENTS"
    | "GRAND_TOTAL_INCOHERENT"
    | "CLOTURE_DETACHEE"
    | "COUVERTURE_Z"
    | "TOTAUX_CLOTURE"
    | "AGREGAT_INVALIDE";
  detail: string;
}

export interface RapportVerification {
  integre: boolean;
  verifieLe: string;
  compteurs: Record<Chaine, number>;
  anomalies: Anomalie[];
}

const memesTotaux = (a: Parameters<typeof champsTotaux>[0], b: Parameters<typeof champsTotaux>[0]) =>
  canonique(champsTotaux(a)) === canonique(champsTotaux(b));

/** Vérifie l'empreinte et la signature d'un enregistrement isolé. */
export async function verifierScellement(
  chaine: Chaine,
  e: Enregistrement,
  resoudreCle: ResolveurCle,
  cles = new Map<string, JsonWebKey | null>(),
): Promise<Anomalie[]> {
  const anomalies: Anomalie[] = [];
  if ((await sha256Hex(canonique(contenuScelle(e)))) !== e.hash) {
    anomalies.push({ chaine, numero: e.numero, code: "EMPREINTE_INVALIDE", detail: "contenu modifié après scellement" });
  }
  if (!cles.has(e.cleId)) cles.set(e.cleId, (await resoudreCle(e.cleId)) ?? null);
  const cle = cles.get(e.cleId);
  if (!cle) {
    anomalies.push({ chaine, numero: e.numero, code: "CLE_INCONNUE", detail: `clé ${e.cleId} inconnue` });
  } else if (!(await verifierSignature(cle, e.hash, e.signature))) {
    anomalies.push({ chaine, numero: e.numero, code: "SIGNATURE_INVALIDE", detail: "signature non valide" });
  }
  return anomalies;
}

/** Vérifie le chaînage, les empreintes et les signatures d'une suite d'enregistrements. */
export async function verifierChaine(
  chaine: Chaine,
  enregistrements: Enregistrement[],
  resoudreCle: ResolveurCle,
  precedent: { numero: number; hash: string } = { numero: 0, hash: HASH_GENESE },
): Promise<Anomalie[]> {
  const anomalies: Anomalie[] = [];
  let attenduNumero = precedent.numero + 1;
  let attenduHash = precedent.hash;
  const cles = new Map<string, JsonWebKey | null>();

  for (const e of enregistrements) {
    if (e.numero !== attenduNumero) {
      anomalies.push({ chaine, numero: e.numero, code: "NUMERO_DISCONTINU", detail: `attendu ${attenduNumero}` });
    }
    if (e.hashPrecedent !== attenduHash) {
      anomalies.push({ chaine, numero: e.numero, code: "CHAINAGE_ROMPU", detail: "hashPrecedent ne correspond pas" });
    }
    anomalies.push(...(await verifierScellement(chaine, e, resoudreCle, cles)));
    attenduNumero = e.numero + 1;
    attenduHash = e.hash;
  }
  return anomalies;
}

/** Contrôles arithmétiques propres aux tickets : totaux, TVA, paiements, grand total perpétuel. */
export function verifierTotauxTickets(tickets: Ticket[], grandTotalInitial = 0, cumulInitial = 0): Anomalie[] {
  const anomalies: Anomalie[] = [];
  let gt = grandTotalInitial;
  let cumul = cumulInitial;
  for (const t of tickets) {
    const somme = t.lignes.reduce((s, l) => s + l.montantTTC, 0);
    const lignesOk = t.lignes.every((l) => l.quantite * l.prixUnitaireTTC - l.remiseTTC === l.montantTTC);
    const ventilation = ventiler(t.lignes);
    const ventilationOk = canonique(ventilation) === canonique(t.ventilationTVA);
    const htOk = t.totalHT === ventilation.reduce((s, v) => s + v.baseHT, 0) && t.totalTVA === t.totalTTC - t.totalHT;
    const paiementsOk = t.paiements.reduce((s, p) => s + p.montant, 0) - t.renduMonnaie === t.totalTTC;
    if (!lignesOk || somme !== t.totalTTC || !ventilationOk || !htOk || !paiementsOk) {
      anomalies.push({
        chaine: "tickets",
        numero: t.numero,
        code: "TOTAUX_INCOHERENTS",
        detail: "lignes, TVA, paiements ou totaux incohérents",
      });
    }
    gt += t.totalTTC;
    cumul += Math.abs(t.totalTTC);
    if (t.grandTotalPerpetuel !== gt || t.cumulPerpetuelAbsolu !== cumul) {
      anomalies.push({ chaine: "tickets", numero: t.numero, code: "GRAND_TOTAL_INCOHERENT", detail: `attendu ${gt} / ${cumul}` });
      gt = t.grandTotalPerpetuel;
      cumul = t.cumulPerpetuelAbsolu;
    }
  }
  return anomalies;
}

/** Vérifie qu'une clôture pointe bien sur le ticket qu'elle déclare couvrir. */
export function verifierLiensClotures(clotures: Cloture[], tickets: Map<number, Ticket>): Anomalie[] {
  const anomalies: Anomalie[] = [];
  for (const c of clotures) {
    if (c.dernierTicket == null) continue;
    const t = tickets.get(c.dernierTicket);
    if (!t || t.hash !== c.hashDernierTicket) {
      anomalies.push({
        chaine: "clotures",
        numero: c.numero,
        code: "CLOTURE_DETACHEE",
        detail: `le ticket ${c.dernierTicket} ne correspond pas à la clôture`,
      });
    }
  }
  return anomalies;
}

/**
 * Contrôle de fond des clôtures : les Z couvrent les tickets sans trou ni
 * recouvrement et leurs totaux sont exacts ; chaque clôture mensuelle ou
 * d'exercice agrège exactement ses sources, une seule fois.
 */
export function verifierClotures(clotures: Cloture[], tickets: Ticket[]): Anomalie[] {
  const anomalies: Anomalie[] = [];
  const parNumero = new Map(clotures.map((c) => [c.numero, c]));
  const ajouter = (c: Cloture, code: Anomalie["code"], detail: string) =>
    anomalies.push({ chaine: "clotures", numero: c.numero, code, detail });

  let couvert = 0;
  let jourPrecedent = "";
  for (const z of clotures.filter((c) => c.periode === "JOUR")) {
    if (z.identifiantPeriode < jourPrecedent) {
      ajouter(z, "COUVERTURE_Z", `Z du ${z.identifiantPeriode} après celle du ${jourPrecedent}`);
    }
    jourPrecedent = z.identifiantPeriode;
    const moisDejaClos = clotures.find(
      (m) => m.periode === "MOIS" && m.numero < z.numero && z.identifiantPeriode.startsWith(`${m.identifiantPeriode}-`),
    );
    if (moisDejaClos) ajouter(z, "COUVERTURE_Z", `Z dans le mois ${moisDejaClos.identifiantPeriode} déjà clôturé`);
    if (z.premierTicket == null) {
      if (z.dernierTicketCouvert !== couvert) ajouter(z, "COUVERTURE_Z", `couverture attendue ${couvert}`);
      if (!memesTotaux(z, TOTAUX_VIDES)) ajouter(z, "TOTAUX_CLOTURE", "une Z sans ticket doit être à zéro");
    } else {
      if (z.premierTicket !== couvert + 1 || z.dernierTicket == null || z.dernierTicket < z.premierTicket) {
        ajouter(z, "COUVERTURE_Z", `la Z doit commencer au ticket ${couvert + 1}`);
      }
      if (z.dernierTicketCouvert !== z.dernierTicket) ajouter(z, "COUVERTURE_Z", "dernier ticket couvert incohérent");
      const plage = tickets.filter((t) => t.numero >= z.premierTicket! && t.numero <= (z.dernierTicket ?? 0));
      if (!memesTotaux(z, totauxTickets(plage))) ajouter(z, "TOTAUX_CLOTURE", "totaux différents de ceux des tickets");
    }
    couvert = z.dernierTicketCouvert;
  }

  for (const periode of ["MOIS", "EXERCICE"] as const) {
    const niveauSource = periode === "MOIS" ? "JOUR" : "MOIS";
    const vus = new Set<number>();
    const identifiants = new Set<string>();
    for (const c of clotures.filter((x) => x.periode === periode)) {
      if (identifiants.has(c.identifiantPeriode)) ajouter(c, "AGREGAT_INVALIDE", `${c.identifiantPeriode} clôturé deux fois`);
      identifiants.add(c.identifiantPeriode);
      const sources = c.cloturesAgregees.map((n) => parNumero.get(n));
      if (sources.some((s) => !s || s.periode !== niveauSource || s.numero >= c.numero)) {
        ajouter(c, "AGREGAT_INVALIDE", `sources attendues : clôtures ${niveauSource} antérieures`);
        continue;
      }
      if (periode === "MOIS") {
        // Exactement toutes les Z du mois existant avant la clôture mensuelle.
        const attendues = clotures
          .filter((z) => z.periode === "JOUR" && z.numero < c.numero && z.identifiantPeriode.startsWith(`${c.identifiantPeriode}-`))
          .map((z) => z.numero);
        if (canonique(attendues) !== canonique(c.cloturesAgregees)) {
          ajouter(c, "AGREGAT_INVALIDE", "la clôture mensuelle n'agrège pas exactement les Z du mois");
        }
      } else {
        const mois = (sources as Cloture[]).map((s) => s.identifiantPeriode);
        const continus = mois.length > 0 && canonique(listeMois(mois[0]!, mois.at(-1)!)) === canonique(mois);
        if (!continus) ajouter(c, "AGREGAT_INVALIDE", "les mois de l'exercice ne sont pas continus");
      }
      for (const n of c.cloturesAgregees) {
        if (vus.has(n)) ajouter(c, "AGREGAT_INVALIDE", `clôture ${n} agrégée deux fois`);
        vus.add(n);
      }
      if (!memesTotaux(c, totauxClotures(sources as Cloture[]))) {
        ajouter(c, "TOTAUX_CLOTURE", "totaux différents de ceux des clôtures agrégées");
      }
    }
  }
  return anomalies;
}

/** Vérification complète d'un registre : à exposer dans le back-office pour un contrôle. */
export async function verifierRegistre(
  stockage: StockageFiscal,
  resoudreCle: ResolveurCle,
): Promise<RapportVerification> {
  const tickets = await stockage.lister("tickets");
  const evenements = await stockage.lister("evenements");
  const clotures = await stockage.lister("clotures");
  const anomalies = [
    ...(await verifierChaine("tickets", tickets, resoudreCle)),
    ...(await verifierChaine("evenements", evenements, resoudreCle)),
    ...(await verifierChaine("clotures", clotures, resoudreCle)),
    ...verifierTotauxTickets(tickets),
    ...verifierLiensClotures(clotures, new Map(tickets.map((t) => [t.numero, t]))),
    ...verifierClotures(clotures, tickets),
  ];
  return {
    integre: anomalies.length === 0,
    verifieLe: new Date().toISOString(),
    compteurs: { tickets: tickets.length, evenements: evenements.length, clotures: clotures.length },
    anomalies,
  };
}
