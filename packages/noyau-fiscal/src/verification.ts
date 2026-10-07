import { canonique, contenuScelle } from "./canonique.js";
import { HASH_GENESE, sha256Hex, verifierSignature, type ResolveurCle } from "./crypto.js";
import { listeMois } from "./dates.js";
import { cumulerVentilations, paiementsNets, TAUX_TVA_AUTORISES, ventiler, ventilerTranche } from "./montants.js";
import { cleRef, couvertureAncienne, ordonner, ticketCouvertPar, unir } from "./etablissement.js";
import { champsTotaux, montantEnCompte, TOTAUX_VIDES, totauxClotures, totauxTickets } from "./registre.js";
import type { StockageFiscal } from "./stockage.js";
import type { Chaine, Cloture, CouvertureCaisse, Enregistrement, Evenement, Ticket } from "./types.js";

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
    | "AGREGAT_INVALIDE"
    /** Clôtures d'établissement : la précédente désignée n'est pas la bonne (0.7.0). */
    | "CHAINAGE_CLOTURES";
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

/**
 * Comptes clients (0.5.0) : une vente en compte désigne son client, une vente
 * payée n'en a pas ; un règlement (ou son annulation, en négatif) n'a ni ligne
 * ni total, et son montant et sa TVA sont exactement ceux de ses imputations,
 * chacune étant la tranche de TVA attendue de la vente réglée.
 */
function comptesCoherents(t: Ticket): boolean {
  if (t.type === "CORRECTION") return correctionCoherente(t);
  const enCompte = montantEnCompte(t);
  if (!t.reglement) {
    if (t.type === "REGLEMENT") return false;
    return enCompte === 0 ? !t.client : !!t.client;
  }
  const r = t.reglement;
  const signe = t.type === "REGLEMENT" ? 1 : t.type === "ANNULATION" && t.ticketOrigine ? -1 : 0;
  if (!signe || !t.client || t.lignes.length > 0 || t.totalTTC !== 0 || enCompte !== 0 || r.imputations.length === 0) return false;
  // Cohérence interne de chaque imputation ; la tranche exacte est contrôlée par rapport à la vente
  // quand on la détient (verifierImputationsLocales ici, calculerComptes sur le serveur pour toutes les caisses).
  const imputationsOk = r.imputations.every((i) => {
    const part = signe * i.montantTTC;
    const debut = signe > 0 ? i.encaisseAvantTTC : i.encaisseAvantTTC - part;
    return (
      part > 0 &&
      i.venteTotalTTC > 0 &&
      debut >= 0 &&
      debut + part <= i.venteTotalTTC &&
      i.ventilationTVA.length > 0 &&
      i.ventilationTVA.every(
        (v) =>
          TAUX_TVA_AUTORISES.includes(v.tauxTVA) &&
          v.montantTTC === v.baseHT + v.montantTVA &&
          signe * v.montantTTC >= 0 &&
          signe * v.baseHT >= 0 &&
          signe * v.montantTVA >= 0,
      ) &&
      i.ventilationTVA.reduce((s, v) => s + v.montantTTC, 0) === i.montantTTC
    );
  });
  return (
    imputationsOk &&
    r.montantTTC === r.imputations.reduce((s, i) => s + i.montantTTC, 0) &&
    canonique(r.ventilationTVA) === canonique(cumulerVentilations(r.imputations.map((i) => i.ventilationTVA)))
  );
}

/**
 * Correction de paiements (0.6.0) : ni ligne ni total, une vente désignée, un
 * motif, un écart de somme nulle entre moyens de paiement réels (jamais EN_COMPTE).
 */
function correctionCoherente(t: Ticket): boolean {
  return (
    t.lignes.length === 0 &&
    t.totalTTC === 0 &&
    t.totalHT === 0 &&
    t.ventilationTVA.length === 0 &&
    t.renduMonnaie === 0 &&
    !!t.ticketOrigine &&
    !!t.motif?.trim() &&
    !t.client &&
    !t.reglement &&
    t.paiements.length > 0 &&
    t.paiements.every((p) => p.mode !== "EN_COMPTE" && Number.isSafeInteger(p.montant) && p.montant !== 0) &&
    t.paiements.reduce((s, p) => s + p.montant, 0) === 0
  );
}

/**
 * Corrections de paiements, contrôlées avec la vente qu'elles désignent :
 * vente de la même caisse, non annulée avant, dans la même journée (aucune Z
 * entre les deux), et moyens de paiement effectifs jamais négatifs. Une
 * correction et sa vente sont toujours dans la même archive de Z.
 */
export function verifierCorrections(tickets: Ticket[], clotures: Cloture[] = []): Anomalie[] {
  const anomalies: Anomalie[] = [];
  const parNumero = new Map(tickets.map((t) => [t.numero, t]));
  const effectifs = new Map<number, Map<string, number>>();
  for (const t of tickets) {
    if (t.type !== "CORRECTION" || !t.ticketOrigine) continue;
    const v = parNumero.get(t.ticketOrigine.numero);
    const annuleeAvant = tickets.some((x) => x.type === "ANNULATION" && x.ticketOrigine?.numero === v?.numero && x.numero < t.numero);
    const zEntre = clotures.some((c) => {
      const couvert = ticketCouvertPar(c, t.caisseId);
      return couvert != null && !!v && couvert >= v.numero && couvert < t.numero;
    });
    let ok = !!v && v.type === "VENTE" && v.hash === t.ticketOrigine.hash && v.numero < t.numero && !annuleeAvant && !zEntre;
    if (ok) {
      const parMode = effectifs.get(v!.numero) ?? new Map(paiementsNets(v!.paiements, v!.renduMonnaie).map((p) => [p.mode, p.montant]));
      if (parMode.has("EN_COMPTE")) ok = false;
      for (const p of t.paiements) parMode.set(p.mode, (parMode.get(p.mode) ?? 0) + p.montant);
      if ([...parMode.values()].some((m) => m < 0)) ok = false;
      effectifs.set(v!.numero, parMode);
    }
    if (!ok) anomalies.push({ chaine: "tickets", numero: t.numero, code: "TOTAUX_INCOHERENTS", detail: `correction incohérente avec la vente n°${t.ticketOrigine.numero}` });
  }
  return anomalies;
}

/** Contrôle complet d'un règlement d'une vente de cette caisse : la tranche de TVA est celle de la vente. */
export function verifierImputationsLocales(tickets: Ticket[]): Anomalie[] {
  const anomalies: Anomalie[] = [];
  const ventes = new Map(tickets.filter((t) => t.type === "VENTE").map((t) => [t.numero, t]));
  for (const t of tickets) {
    for (const i of t.reglement?.imputations ?? []) {
      if (i.caisseId !== t.caisseId) continue;
      const v = ventes.get(i.numero);
      const signe = i.montantTTC < 0 ? -1 : 1;
      const debut = signe > 0 ? i.encaisseAvantTTC : i.encaisseAvantTTC + i.montantTTC;
      let ok = !!v && v.hash === i.hash && v.client?.id === t.client?.id && i.venteTotalTTC === v.totalTTC;
      if (ok) {
        try {
          const attendue = ventilerTranche(v!.ventilationTVA, debut, signe * i.montantTTC, v!.totalTTC);
          const obtenue = signe > 0 ? i.ventilationTVA : i.ventilationTVA.map((x) => ({ ...x, montantTTC: -x.montantTTC, baseHT: -x.baseHT, montantTVA: -x.montantTVA }));
          ok = canonique(attendue) === canonique(obtenue);
        } catch {
          ok = false;
        }
      }
      if (!ok) {
        anomalies.push({ chaine: "tickets", numero: t.numero, code: "TOTAUX_INCOHERENTS", detail: `règlement incohérent avec la vente n°${i.numero}` });
      }
    }
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
    const encaisse = t.paiements.reduce((s, p) => s + p.montant, 0) - t.renduMonnaie;
    const paiementsOk = encaisse === (t.reglement ? t.reglement.montantTTC : t.type === "REGLEMENT" ? NaN : t.totalTTC);
    if (!lignesOk || somme !== t.totalTTC || !ventilationOk || !htOk || !paiementsOk || !comptesCoherents(t)) {
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
export function verifierClotures(clotures: Cloture[], tickets: Ticket[], evenements?: Evenement[]): Anomalie[] {
  const caisseId = clotures[0]?.caisseId ?? tickets[0]?.caisseId;
  return [
    ...verifierCloturesCaisse(clotures.filter((c) => !c.etablissement), tickets),
    ...(caisseId ? verifierEtablissement([{ caisseId, tickets, clotures, ...(evenements ? { evenements } : {}) }]) : []),
  ];
}

/** Clôtures propres à une caisse (avant 0.7.0). */
function verifierCloturesCaisse(clotures: Cloture[], tickets: Ticket[]): Anomalie[] {
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
    ...verifierImputationsLocales(tickets),
    ...verifierCorrections(tickets, clotures),
    ...verifierLiensClotures(clotures, new Map(tickets.map((t) => [t.numero, t]))),
    ...verifierClotures(clotures, tickets, evenements),
  ];
  return {
    integre: anomalies.length === 0,
    verifieLe: new Date().toISOString(),
    compteurs: { tickets: tickets.length, evenements: evenements.length, clotures: clotures.length },
    anomalies,
  };
}

/** Chaîne d'une caisse, telle que connue de qui vérifie (les tickets et le journal peuvent manquer). */
export interface ChaineCaisse {
  caisseId: string;
  clotures: Cloture[];
  tickets?: Ticket[];
  evenements?: Evenement[];
}

/**
 * Clôtures d'établissement (0.7.0), sur les chaînes fournies : chaque Z suit
 * la précédente, couvre chaque caisse à la suite de la Z d'avant, sans trou
 * ni recouvrement, pointe sur les bons tickets et le bon journal, et ses
 * totaux sont exacts ; les clôtures mensuelles et d'exercice agrègent
 * exactement leurs sources. Ce qui dépend d'une caisse absente est laissé de
 * côté : sur le serveur, toutes les caisses sont fournies et tout est contrôlé.
 */
export function verifierEtablissement(chaines: ChaineCaisse[]): Anomalie[] {
  const anomalies: Anomalie[] = [];
  const ajouter = (c: Cloture, code: Anomalie["code"], detail: string) =>
    anomalies.push({ chaine: "clotures", numero: c.numero, code, detail: `${c.caisseId} : ${detail}` });
  const toutes = unir(...chaines.map((c) => c.clotures));
  if (!toutes.some((c) => c.etablissement)) return anomalies;
  const index = new Map(toutes.map((c) => [cleRef(c), c]));
  const connues = new Set(chaines.map((c) => c.caisseId));
  const tickets = new Map(chaines.filter((c) => c.tickets).map((c) => [c.caisseId, new Map(c.tickets!.map((t) => [t.numero, t]))]));
  const journaux = new Map(chaines.filter((c) => c.evenements).map((c) => [c.caisseId, new Map(c.evenements!.map((e) => [e.numero, e]))]));
  // Toutes les caisses en jeu sont-elles fournies, tickets compris ? Alors on contrôle aussi qu'aucun ticket n'échappe aux Z.
  const enJeu = new Set(toutes.flatMap((c) => [c.caisseId, ...(c.etablissement?.caisses.map((x) => x.caisseId) ?? [])]));
  const complet = [...enJeu].every((id) => tickets.has(id));

  // Chaînage : chaque clôture désigne celle qui la précède, une seule fois.
  for (const periode of ["JOUR", "MOIS", "EXERCICE"] as const) {
    const liste = ordonner(toutes, periode);
    const suivies = new Map<string, Cloture>();
    let premiere: Cloture | null = null;
    for (const [i, c] of liste.entries()) {
      const p = c.etablissement!.precedente;
      if (!p) {
        if (premiere) ajouter(c, "CHAINAGE_CLOTURES", `deuxième première clôture (après ${cleRef(premiere)})`);
        premiere ??= c;
        continue;
      }
      const deja = suivies.get(cleRef(p));
      if (deja) ajouter(c, "CHAINAGE_CLOTURES", `${cleRef(p)} est déjà suivie par ${cleRef(deja)}`);
      suivies.set(cleRef(p), c);
      const cible = index.get(cleRef(p));
      if (!cible) {
        if (connues.has(p.caisseId)) ajouter(c, "CHAINAGE_CLOTURES", `clôture précédente ${cleRef(p)} introuvable`);
      } else if (cible.hash !== p.hash || cible.periode !== periode || !cible.etablissement || liste.indexOf(cible) !== i - 1) {
        ajouter(c, "CHAINAGE_CLOTURES", `${cleRef(p)} n'est pas la clôture qui la précède`);
      }
    }
  }

  // Z : couverture de chaque caisse, rattachement aux tickets et au journal, totaux.
  const plages = new Map<string, Array<{ premier: number; dernier: number; z: string }>>();
  const plage = (id: string, premier: number, dernier: number, z: string) => plages.set(id, [...(plages.get(id) ?? []), { premier, dernier, z }]);
  for (const c of toutes) if (!c.etablissement && c.periode === "JOUR" && c.premierTicket != null && c.dernierTicket != null) plage(c.caisseId, c.premierTicket, c.dernierTicket, cleRef(c));
  const moisClos = ordonner(toutes, "MOIS");
  let cov: Map<string, CouvertureCaisse> | null = null;
  let precedente: Cloture | null = null;
  let jourPrecedent = "";
  for (const z of ordonner(toutes, "JOUR")) {
    const e = z.etablissement!;
    const p = e.precedente;
    // À la suite de la Z examinée juste avant (sinon une Z d'une caisse absente s'intercale : on repart de celle-ci).
    const suite = p === null ? precedente === null : precedente !== null && cleRef(p) === cleRef(precedente);
    const avant = suite ? (cov ?? new Map<string, CouvertureCaisse>()) : null;
    if (z.identifiantPeriode < jourPrecedent) ajouter(z, "COUVERTURE_Z", `Z du ${z.identifiantPeriode} après celle du ${jourPrecedent}`);
    jourPrecedent = z.identifiantPeriode;
    const close = moisClos.find((m) => m.horodatage < z.horodatage && z.identifiantPeriode.startsWith(`${m.identifiantPeriode}-`));
    if (close) ajouter(z, "COUVERTURE_Z", `Z dans le mois ${close.identifiantPeriode} déjà clôturé`);

    const ids = e.caisses.map((x) => x.caisseId);
    if (new Set(ids).size !== ids.length) ajouter(z, "COUVERTURE_Z", "une caisse figure deux fois");
    if (avant) for (const id of avant.keys()) if (!ids.includes(id)) ajouter(z, "COUVERTURE_Z", `la caisse ${id} n'est plus couverte`);
    let totauxConnus = true;
    const contenu: Ticket[] = [];
    for (const x of e.caisses) {
      const prec = avant ? (avant.get(x.caisseId) ?? couvertureAncienne(toutes, x.caisseId)) : null;
      if (prec) {
        const ticketsOk = x.premierTicket != null ? x.premierTicket === prec.dernierTicketCouvert + 1 && x.dernierTicketCouvert >= x.premierTicket : x.dernierTicketCouvert === prec.dernierTicketCouvert;
        if (!ticketsOk) ajouter(z, "COUVERTURE_Z", `${x.caisseId} : tickets attendus à partir du n°${prec.dernierTicketCouvert + 1}`);
        const journalOk = x.premierEvenement != null ? x.premierEvenement === prec.dernierEvenement + 1 && x.dernierEvenement >= x.premierEvenement : x.dernierEvenement === prec.dernierEvenement;
        if (!journalOk) ajouter(z, "COUVERTURE_Z", `${x.caisseId} : journal attendu à partir du n°${prec.dernierEvenement + 1}`);
      }
      if (x.premierTicket != null) plage(x.caisseId, x.premierTicket, x.dernierTicketCouvert, cleRef(z));
      const ts = tickets.get(x.caisseId);
      if (ts) {
        if (x.dernierTicketCouvert > 0) {
          const t = ts.get(x.dernierTicketCouvert);
          if (!t || t.hash !== x.hashDernierTicketCouvert || t.grandTotalPerpetuel !== x.grandTotalPerpetuel || t.cumulPerpetuelAbsolu !== x.cumulPerpetuelAbsolu) {
            ajouter(z, "CLOTURE_DETACHEE", `${x.caisseId} : le ticket ${x.dernierTicketCouvert} ne correspond pas à la Z`);
          }
        }
        if (x.premierTicket != null) {
          for (let n = x.premierTicket; n <= x.dernierTicketCouvert; n++) {
            const t = ts.get(n);
            if (t) contenu.push(t);
            else totauxConnus = false;
          }
        }
      } else if (x.premierTicket != null) totauxConnus = false;
      const evs = journaux.get(x.caisseId);
      if (evs && x.dernierEvenement > 0 && evs.get(x.dernierEvenement)?.hash !== x.hashDernierEvenement) {
        ajouter(z, "CLOTURE_DETACHEE", `${x.caisseId} : l'événement ${x.dernierEvenement} ne correspond pas à la Z`);
      }
    }
    if (totauxConnus && !memesTotaux(z, totauxTickets(contenu))) ajouter(z, "TOTAUX_CLOTURE", "totaux différents de ceux des tickets des caisses");
    if (z.grandTotalPerpetuel !== e.caisses.reduce((s, x) => s + x.grandTotalPerpetuel, 0) || z.cumulPerpetuelAbsolu !== e.caisses.reduce((s, x) => s + x.cumulPerpetuelAbsolu, 0)) {
      ajouter(z, "TOTAUX_CLOTURE", "grand total différent de la somme des caisses");
    }
    const propre = e.caisses.find((x) => x.caisseId === z.caisseId);
    if (
      !propre ||
      propre.premierTicket !== z.premierTicket ||
      propre.dernierTicketCouvert !== z.dernierTicketCouvert ||
      (propre.premierTicket != null && (z.dernierTicket !== propre.dernierTicketCouvert || z.hashDernierTicket !== propre.hashDernierTicketCouvert))
    ) {
      ajouter(z, "COUVERTURE_Z", "la plage de la caisse qui clôture est incohérente");
    }
    cov = new Map(e.caisses.map((x) => [x.caisseId, x]));
    precedente = z;
  }

  // Aucun ticket compté deux fois ; si toutes les caisses sont là, aucun ticket oublié avant le dernier couvert.
  for (const [id, liste] of plages) {
    const triees = [...liste].sort((a, b) => a.premier - b.premier);
    let fin = 0;
    for (const r of triees) {
      const z = index.get(r.z)!;
      if (r.premier <= fin) ajouter(z, "COUVERTURE_Z", `${id} : tickets ${r.premier} à ${Math.min(fin, r.dernier)} déjà couverts`);
      else if (complet && r.premier !== fin + 1) ajouter(z, "COUVERTURE_Z", `${id} : tickets ${fin + 1} à ${r.premier - 1} jamais clôturés`);
      fin = Math.max(fin, r.dernier);
    }
  }

  // Clôtures mensuelles et d'exercice.
  const agregeesPar = new Map<string, string>();
  for (const periode of ["MOIS", "EXERCICE"] as const) {
    const identifiants = new Set<string>();
    for (const c of ordonner(toutes, periode)) {
      if (identifiants.has(c.identifiantPeriode)) ajouter(c, "AGREGAT_INVALIDE", `${c.identifiantPeriode} clôturé deux fois`);
      identifiants.add(c.identifiantPeriode);
      const refs = c.etablissement!.agregees;
      const sources: Cloture[] = [];
      let toutesConnues = true;
      for (const r of refs) {
        const s = index.get(cleRef(r));
        if (!s) {
          toutesConnues = false;
          if (connues.has(r.caisseId)) ajouter(c, "AGREGAT_INVALIDE", `source ${cleRef(r)} introuvable`);
          continue;
        }
        const niveau = periode === "MOIS" ? "JOUR" : "MOIS";
        if (s.hash !== r.hash || s.periode !== niveau) ajouter(c, "AGREGAT_INVALIDE", `source ${cleRef(r)} invalide`);
        const deja = agregeesPar.get(cleRef(r));
        if (deja) ajouter(c, "AGREGAT_INVALIDE", `${cleRef(r)} déjà agrégée par ${deja}`);
        agregeesPar.set(cleRef(r), cleRef(c));
        sources.push(s);
      }
      if (periode === "MOIS") {
        const moisPropres = new Set(toutes.filter((m) => !m.etablissement && m.periode === "MOIS").map((m) => `${m.caisseId}#${m.identifiantPeriode}`));
        const attendues = toutes
          .filter((z) => z.periode === "JOUR" && z.identifiantPeriode.startsWith(`${c.identifiantPeriode}-`))
          .filter((z) => z.etablissement || !moisPropres.has(`${z.caisseId}#${c.identifiantPeriode}`))
          .map(cleRef)
          .sort();
        const obtenues = refs.map(cleRef).filter((k) => index.has(k)).sort();
        if (canonique(attendues) !== canonique(obtenues)) ajouter(c, "AGREGAT_INVALIDE", "la clôture mensuelle n'agrège pas exactement les Z du mois");
      } else {
        const mois = sources.map((s) => s.identifiantPeriode);
        if (toutesConnues && !(mois.length > 0 && canonique(listeMois(mois[0]!, mois.at(-1)!)) === canonique(mois))) {
          ajouter(c, "AGREGAT_INVALIDE", "les mois de l'exercice ne sont pas continus");
        }
      }
      if (toutesConnues && !memesTotaux(c, totauxClotures(sources))) ajouter(c, "TOTAUX_CLOTURE", "totaux différents de ceux des clôtures agrégées");
    }
  }
  return anomalies;
}
