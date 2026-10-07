import { canonique } from "./canonique.js";
import { HASH_GENESE, sha256Hex, type Signataire } from "./crypto.js";
import { dateComptable as calculerDateComptable, listeMois, premierJourMoisSuivant } from "./dates.js";
import { cleRef, couvertures, ordonner, refDe, tete, unir } from "./etablissement.js";
import {
  calculerLigne,
  controlerPaiements,
  cumulerPaiements,
  cumulerVentilations,
  ligneInverse,
  paiementsNets,
  ventiler,
  ventilationValide,
  ventilerProrata,
  ventilerTranche,
} from "./montants.js";
import type { EntreeLot, StockageFiscal, TypesChaines } from "./stockage.js";
import {
  ErreurFiscale,
  type Chaine,
  type ClientCompte,
  type Cloture,
  type CodeEvenement,
  type ContexteCaisse,
  type ContexteEtablissement,
  type CouvertureCaisse,
  type RefCloture,
  type Evenement,
  type ImputationReglement,
  type Paiement,
  type SaisieLigne,
  type Ticket,
  type TotauxPeriode,
} from "./types.js";
import { verifierChaine, verifierScellement, verifierTotauxTickets } from "./verification.js";
import { VERSION_NOYAU_FISCAL } from "./version.js";

/** Ce que l'établissement a clôturé et ce qui reste à clôturer, toutes caisses. */
interface EtatEtablissement {
  /** Clôtures connues : celles de cette caisse et celles reçues du serveur, vérifiées. */
  clotures: Cloture[];
  tetes: Record<"JOUR" | "MOIS" | "EXERCICE", Cloture | null>;
  /** Couverture de chaque caisse par la dernière Z. */
  couvertures: Map<string, CouvertureCaisse>;
  /** Tickets non couverts de chaque caisse (celle-ci comprise), dans l'ordre de leur chaîne. */
  restants: Map<string, Ticket[]>;
  /** Dernier événement reçu de chaque autre caisse. */
  evenements: Map<string, { numero: number; hash: string }>;
}

export interface OptionsRegistre {
  stockage: StockageFiscal;
  signataire: Signataire;
  contexte: ContexteCaisse;
  /** Horloge injectable (tests). */
  horloge?: () => Date;
  /** Heure de Paris à laquelle bascule la journée comptable (0 à 12, défaut 5 h). */
  heureBascule?: number;
}

export interface SaisieVente {
  lignes: SaisieLigne[];
  paiements: Paiement[];
  operateurId: string;
  tableId?: string | null;
  couverts?: number | null;
  /** Obligatoire si une partie est portée en compte (mode EN_COMPTE). */
  client?: ClientCompte;
}

/** Vente en compte à solder (en tout ou partie) par un règlement. */
export interface SaisieImputation {
  caisseId: string;
  numero: number;
  hash: string;
  montantTTC: number;
  /** Vente : total, part portée en compte, déjà réglé (toutes caisses), ventilation — pour la TVA exigible. */
  venteTotalTTC: number;
  venteEnCompteTTC: number;
  dejaRegleTTC: number;
  venteVentilationTVA: Ticket["ventilationTVA"];
}

export interface SaisieReglement {
  client: ClientCompte;
  /** Moyens de paiement réels (jamais EN_COMPTE) ; les espèces peuvent donner lieu à un rendu. */
  paiements: Paiement[];
  imputations: SaisieImputation[];
  operateurId: string;
}

export interface SaisieCorrection {
  numeroTicket: number;
  /** Moyens de paiement réellement reçus, nets (sans rendu), pour le total de la vente ; jamais EN_COMPTE. */
  paiements: Paiement[];
  motif: string;
  operateurId: string;
}

export interface SaisieAnnulation {
  numeroTicket: number;
  motif: string;
  operateurId: string;
}

type Corps<C extends Chaine> = Omit<
  TypesChaines[C],
  | "numero"
  | "horodatage"
  | "versionLogiciel"
  | "etablissementId"
  | "caisseId"
  | "hashPrecedent"
  | "hash"
  | "signature"
  | "cleId"
>;

export const TOTAUX_VIDES: TotauxPeriode = {
  nbVentes: 0,
  nbAnnulations: 0,
  totalHT: 0,
  totalTVA: 0,
  totalTTC: 0,
  ventilationTVA: [],
  paiements: [],
  totalRemisesTTC: 0,
};

/** Extrait les seuls champs de totaux (comparaisons). */
export function champsTotaux(x: TotauxPeriode): TotauxPeriode {
  return {
    nbVentes: x.nbVentes,
    nbAnnulations: x.nbAnnulations,
    totalHT: x.totalHT,
    totalTVA: x.totalTVA,
    totalTTC: x.totalTTC,
    ventilationTVA: x.ventilationTVA,
    paiements: x.paiements,
    totalRemisesTTC: x.totalRemisesTTC,
    ...(x.comptesClients ? { comptesClients: x.comptesClients } : {}),
  };
}

/** Identifiant de client : « cli- » et 8 chiffres hexadécimaux (le même format côté serveur). */
export const CLIENT_ID_VALIDE = /^cli-[0-9a-f]{8}$/;

/** Client d'une vente en compte ou d'un règlement : identifiant stable et nom lisible. */
function clientValide(c: ClientCompte | undefined): ClientCompte {
  const nom = c?.nom?.trim() ?? "";
  if (!c || !CLIENT_ID_VALIDE.test(c.id ?? "") || !nom || nom.length > 80 || /[\u0000-\u001f\u007f]/.test(nom)) {
    throw new ErreurFiscale("CLIENT_INVALIDE", "client du compte invalide (identifiant et nom obligatoires)");
  }
  return { id: c.id, nom };
}

/** Montant d'une vente porté en compte (signé : négatif sur une annulation). */
export function montantEnCompte(t: Ticket): number {
  return t.paiements.filter((p) => p.mode === "EN_COMPTE").reduce((s, p) => s + p.montant, 0);
}

/**
 * Moyens de paiement effectifs d'une vente : ceux du ticket, nets du rendu,
 * puis les écarts de ses corrections (tickets CORRECTION qui la désignent).
 */
export function paiementsEffectifs(vente: Ticket, tickets: Ticket[]): Paiement[] {
  const corrections = tickets.filter(
    (t) => t.type === "CORRECTION" && t.ticketOrigine?.numero === vente.numero && t.ticketOrigine.hash === vente.hash,
  );
  return cumulerPaiements([paiementsNets(vente.paiements, vente.renduMonnaie), ...corrections.map((c) => c.paiements)]).filter(
    (p) => p.montant !== 0,
  );
}

/** Règlements reçus (positifs) ou annulés (négatifs) de chaque vente, sur un ensemble de tickets. */
function regleParVente(tickets: Ticket[]): Map<string, number> {
  const regle = new Map<string, number>();
  for (const t of tickets) {
    for (const i of t.reglement?.imputations ?? []) {
      const cle = `${i.caisseId}#${i.numero}`;
      regle.set(cle, (regle.get(cle) ?? 0) + i.montantTTC);
    }
  }
  return regle;
}

/** TVA devenue exigible avec ce ticket : part encaissée d'une vente, ou règlement d'un compte (ou son annulation). */
export function ventilationExigible(t: Ticket): Ticket["ventilationTVA"] {
  if (t.reglement) return t.reglement.ventilationTVA;
  const enCompte = montantEnCompte(t);
  return enCompte === 0 ? t.ventilationTVA : ventilerProrata(t.ventilationTVA, t.totalTTC - enCompte, t.totalTTC);
}

/** Comptes clients d'un ensemble de tickets, ou rien s'ils n'en ont pas. */
function comptesTickets(tickets: Ticket[]): TotauxPeriode["comptesClients"] {
  const concernes = tickets.some((t) => t.reglement || montantEnCompte(t) !== 0);
  if (!concernes) return undefined;
  return {
    ventesEnCompteTTC: tickets.reduce((s, t) => s + montantEnCompte(t), 0),
    nbReglements: tickets.filter((t) => t.type === "REGLEMENT").length,
    // Net des règlements annulés.
    reglementsTTC: tickets.reduce((s, t) => s + (t.reglement?.montantTTC ?? 0), 0),
    ventilationTVAExigible: cumulerVentilations(tickets.map(ventilationExigible)),
  };
}

/** Totaux d'un ensemble de tickets (lecture X, clôture Z). */
export function totauxTickets(tickets: Ticket[]): TotauxPeriode {
  if (tickets.length === 0) return { ...TOTAUX_VIDES };
  const comptesClients = comptesTickets(tickets);
  return {
    nbVentes: tickets.filter((t) => t.type === "VENTE").length,
    nbAnnulations: tickets.filter((t) => t.type === "ANNULATION").length,
    totalHT: tickets.reduce((s, t) => s + t.totalHT, 0),
    totalTVA: tickets.reduce((s, t) => s + t.totalTVA, 0),
    totalTTC: tickets.reduce((s, t) => s + t.totalTTC, 0),
    ventilationTVA: cumulerVentilations(tickets.map((t) => t.ventilationTVA)),
    paiements: cumulerPaiements(tickets.map((t) => paiementsNets(t.paiements, t.renduMonnaie))),
    totalRemisesTTC: tickets.reduce((s, t) => s + t.lignes.reduce((r, l) => r + l.remiseTTC, 0), 0),
    ...(comptesClients ? { comptesClients } : {}),
  };
}

/** Totaux d'un ensemble de clôtures (clôtures mensuelle et annuelle). */
export function totauxClotures(clotures: Cloture[]): TotauxPeriode {
  if (clotures.length === 0) return { ...TOTAUX_VIDES };
  // Une clôture sans comptes clients a une TVA exigible égale à sa TVA collectée.
  const comptesClients = clotures.some((c) => c.comptesClients)
    ? {
        ventesEnCompteTTC: clotures.reduce((s, c) => s + (c.comptesClients?.ventesEnCompteTTC ?? 0), 0),
        nbReglements: clotures.reduce((s, c) => s + (c.comptesClients?.nbReglements ?? 0), 0),
        reglementsTTC: clotures.reduce((s, c) => s + (c.comptesClients?.reglementsTTC ?? 0), 0),
        ventilationTVAExigible: cumulerVentilations(clotures.map((c) => c.comptesClients?.ventilationTVAExigible ?? c.ventilationTVA)),
      }
    : undefined;
  return {
    nbVentes: clotures.reduce((s, c) => s + c.nbVentes, 0),
    nbAnnulations: clotures.reduce((s, c) => s + c.nbAnnulations, 0),
    totalHT: clotures.reduce((s, c) => s + c.totalHT, 0),
    totalTVA: clotures.reduce((s, c) => s + c.totalTVA, 0),
    totalTTC: clotures.reduce((s, c) => s + c.totalTTC, 0),
    ventilationTVA: cumulerVentilations(clotures.map((c) => c.ventilationTVA)),
    paiements: cumulerPaiements(clotures.map((c) => c.paiements)),
    totalRemisesTTC: clotures.reduce((s, c) => s + c.totalRemisesTTC, 0),
    ...(comptesClients ? { comptesClients } : {}),
  };
}

/**
 * Lot d'écriture : accumule les enregistrements d'une opération et les
 * enchaîne entre eux, pour qu'ils soient écrits ensemble ou pas du tout.
 */
class Lot {
  readonly entrees: EntreeLot[] = [];
  private readonly queues = new Map<Chaine, TypesChaines[Chaine] | null>();

  constructor(private readonly stockage: StockageFiscal) {}

  async dernier<C extends Chaine>(chaine: C): Promise<TypesChaines[C] | null> {
    if (!this.queues.has(chaine)) this.queues.set(chaine, await this.stockage.dernier(chaine));
    return this.queues.get(chaine) as TypesChaines[C] | null;
  }

  ajouter<C extends Chaine>(chaine: C, enregistrement: TypesChaines[C]): void {
    this.entrees.push({ chaine, enregistrement } as EntreeLot);
    this.queues.set(chaine, enregistrement);
  }

  /** Clôtures déjà stockées suivies de celles du lot. */
  async clotures(): Promise<Cloture[]> {
    const stockees = await this.stockage.lister("clotures");
    const duLot = this.entrees.filter((e) => e.chaine === "clotures").map((e) => e.enregistrement as Cloture);
    return [...stockees, ...duLot];
  }
}

/**
 * Registre fiscal d'une caisse : seul point d'entrée pour créer des
 * enregistrements fiscaux. Les opérations sont sérialisées et chacune est
 * écrite en un seul lot atomique.
 */
export class Registre {
  private readonly stockage: StockageFiscal;
  private readonly signataire: Signataire;
  readonly contexte: ContexteCaisse;
  private readonly horloge: () => Date;
  readonly heureBascule: number;
  private file: Promise<unknown> = Promise.resolve();

  constructor(o: OptionsRegistre) {
    if (!o.contexte.etablissementId || !o.contexte.caisseId) {
      throw new ErreurFiscale("CONTEXTE_INVALIDE", "établissement et caisse obligatoires");
    }
    const bascule = o.heureBascule ?? 5;
    if (!Number.isInteger(bascule) || bascule < 0 || bascule > 12) {
      throw new ErreurFiscale("CONTEXTE_INVALIDE", "heure de bascule entre 0 et 12");
    }
    this.stockage = o.stockage;
    this.signataire = o.signataire;
    this.contexte = { etablissementId: o.contexte.etablissementId, caisseId: o.contexte.caisseId };
    this.horloge = o.horloge ?? (() => new Date());
    this.heureBascule = bascule;
  }

  /** Exécute une opération après la précédente, même si celle-ci a échoué. */
  private exclusif<T>(operation: () => Promise<T>): Promise<T> {
    const suite = this.file.then(operation, operation);
    this.file = suite.catch(() => undefined);
    return suite;
  }

  /** Construit une opération dans un lot, puis l'écrit d'un bloc. */
  private operation<T>(corps: (lot: Lot, maintenant: Date) => Promise<T>): Promise<T> {
    return this.exclusif(async () => {
      const lot = new Lot(this.stockage);
      const resultat = await corps(lot, this.horloge());
      if (lot.entrees.length > 0) await this.stockage.ajouterLot(lot.entrees);
      return resultat;
    });
  }

  private async sceller<C extends Chaine>(
    lot: Lot,
    chaine: C,
    corps: Corps<C>,
    maintenant: Date,
  ): Promise<TypesChaines[C]> {
    const dernier = await lot.dernier(chaine);
    const sansSceau = {
      ...corps,
      etablissementId: this.contexte.etablissementId,
      caisseId: this.contexte.caisseId,
      numero: (dernier?.numero ?? 0) + 1,
      horodatage: maintenant.toISOString(),
      versionLogiciel: VERSION_NOYAU_FISCAL,
      hashPrecedent: dernier?.hash ?? HASH_GENESE,
      cleId: this.signataire.cleId,
    };
    const hash = await sha256Hex(canonique(sansSceau));
    const signature = await this.signataire.signer(hash);
    const enregistrement = { ...sansSceau, hash, signature } as unknown as TypesChaines[C];
    lot.ajouter(chaine, enregistrement);
    return enregistrement;
  }

  private evenement(
    lot: Lot,
    code: CodeEvenement,
    details: Evenement["details"],
    operateurId: string | null,
    maintenant: Date,
  ): Promise<Evenement> {
    return this.sceller(lot, "evenements", { code, details, operateurId }, maintenant);
  }

  /**
   * Date comptable d'un nouvel enregistrement, monotone : jamais antérieure à
   * celle du ticket précédent ni à un mois déjà clôturé. Une horloge qui
   * recule est consignée au journal mais ne bloque pas l'encaissement.
   */
  /** Date comptable minimale : dernier ticket, dernière Z, lendemain du dernier mois clôturé. */
  private async plancherDate(lot: Lot): Promise<string> {
    const clotures = await lot.clotures();
    const moisClotures = clotures.filter((c) => c.periode === "MOIS").map((c) => c.identifiantPeriode).sort();
    const derniereZ = clotures.filter((c) => c.periode === "JOUR").at(-1);
    return [
      (await lot.dernier("tickets"))?.dateComptable ?? "",
      derniereZ?.identifiantPeriode ?? "",
      moisClotures.length ? premierJourMoisSuivant(moisClotures.at(-1)!) : "",
    ]
      .sort()
      .at(-1)!;
  }

  private async dateComptableSure(lot: Lot, maintenant: Date): Promise<string> {
    const calculee = calculerDateComptable(maintenant, this.heureBascule);
    const precedent = await lot.dernier("tickets");
    const retenue = [calculee, await this.plancherDate(lot)].sort().at(-1)!;

    const recul = precedent && maintenant.getTime() < Date.parse(precedent.horodatage);
    if (recul || retenue !== calculee) {
      await this.evenement(
        lot,
        "HORLOGE_INCOHERENTE",
        {
          horodatagePrecedent: precedent?.horodatage ?? null,
          horodatageCourant: maintenant.toISOString(),
          dateCalculee: calculee,
          dateRetenue: retenue,
        },
        null,
        maintenant,
      );
    }
    return retenue;
  }

  /** Ajoute un événement au journal (connexion, impression, ouverture de tiroir…). */
  journaliser(
    code: CodeEvenement,
    details: Evenement["details"] = {},
    operateurId: string | null = null,
  ): Promise<Evenement> {
    return this.operation((lot, maintenant) => this.evenement(lot, code, details, operateurId, maintenant));
  }

  /** Enregistre une vente encaissée. Le ticket est définitif dès son retour. */
  enregistrerVente(s: SaisieVente): Promise<Ticket> {
    return this.operation(async (lot, maintenant) => {
      if (!s.operateurId) throw new ErreurFiscale("OPERATEUR_OBLIGATOIRE", "opérateur obligatoire");
      if (!s.lignes?.length) throw new ErreurFiscale("TICKET_VIDE", "un ticket doit contenir au moins une ligne");
      if (s.couverts != null && (!Number.isSafeInteger(s.couverts) || s.couverts < 0)) {
        throw new ErreurFiscale("COUVERTS_INVALIDES", "nombre de couverts invalide");
      }
      const lignes = s.lignes.map(calculerLigne);
      const totalTTC = lignes.reduce((t, l) => t + l.montantTTC, 0);
      const { renduMonnaie } = controlerPaiements(totalTTC, s.paiements);
      const ventilationTVA = ventiler(lignes);
      const totalHT = ventilationTVA.reduce((t, v) => t + v.baseHT, 0);
      const enCompte = s.paiements.some((p) => p.mode === "EN_COMPTE");
      if (!enCompte && s.client) throw new ErreurFiscale("CLIENT_INVALIDE", "client indiqué sans paiement en compte");
      const client = enCompte ? clientValide(s.client) : undefined;

      const dateComptable = await this.dateComptableSure(lot, maintenant);
      const precedent = await lot.dernier("tickets");
      const ticket = await this.sceller(
        lot,
        "tickets",
        {
          type: "VENTE",
          dateComptable,
          operateurId: s.operateurId,
          tableId: s.tableId ?? null,
          couverts: s.couverts ?? null,
          lignes,
          ventilationTVA,
          totalHT,
          totalTVA: totalTTC - totalHT,
          totalTTC,
          paiements: s.paiements.map((p) => ({ mode: p.mode, montant: p.montant })),
          renduMonnaie,
          ticketOrigine: null,
          motif: null,
          ...(client ? { client } : {}),
          grandTotalPerpetuel: (precedent?.grandTotalPerpetuel ?? 0) + totalTTC,
          cumulPerpetuelAbsolu: (precedent?.cumulPerpetuelAbsolu ?? 0) + Math.abs(totalTTC),
        },
        maintenant,
      );

      const remises = lignes.filter((l) => l.remiseTTC > 0);
      if (remises.length > 0) {
        await this.evenement(
          lot,
          "REMISE",
          {
            ticket: ticket.numero,
            montantTTC: remises.reduce((t, l) => t + l.remiseTTC, 0),
            motifs: [...new Set(remises.map((l) => l.motifRemise))].join(" | "),
          },
          s.operateurId,
          maintenant,
        );
      }
      return ticket;
    });
  }

  /**
   * Annule une vente par un ticket négatif lié à l'original. Le ticket
   * d'origine reste intact ; l'annulation est imputée à la journée en cours.
   */
  enregistrerAnnulation(s: SaisieAnnulation): Promise<Ticket> {
    return this.operation(async (lot, maintenant) => {
      if (!s.operateurId) throw new ErreurFiscale("OPERATEUR_OBLIGATOIRE", "opérateur obligatoire");
      if (!s.motif?.trim()) throw new ErreurFiscale("MOTIF_OBLIGATOIRE", "une annulation exige un motif");
      const origine = await this.stockage.trouver("tickets", s.numeroTicket);
      if (!origine) throw new ErreurFiscale("TICKET_INCONNU", `ticket ${s.numeroTicket} introuvable`);
      if (origine.type === "ANNULATION" || origine.type === "CORRECTION") {
        throw new ErreurFiscale("ANNULATION_INTERDITE", "seule une vente ou un règlement peut être annulé");
      }
      const suivants = await this.stockage.lister("tickets", origine.numero + 1);
      if (suivants.some((t) => t.type === "ANNULATION" && t.ticketOrigine?.numero === origine.numero)) {
        throw new ErreurFiscale("DEJA_ANNULE", `le ticket ${origine.numero} est déjà annulé`);
      }
      // Une vente en compte réglée (même en partie) ne s'annule qu'après annulation de ses règlements.
      if ((regleParVente(suivants).get(`${this.contexte.caisseId}#${origine.numero}`) ?? 0) > 0) {
        throw new ErreurFiscale("VENTE_REGLEE", `le ticket ${origine.numero} a déjà reçu un règlement de compte : annulez d'abord le règlement`);
      }

      const lignes = origine.lignes.map(ligneInverse);
      const ventilationTVA = ventiler(lignes);
      const totalTTC = 0 - origine.totalTTC;
      const totalHT = ventilationTVA.reduce((t, v) => t + v.baseHT, 0);
      // Remboursement sur les moyens de paiement effectifs, corrections comprises.
      const remboursements = paiementsEffectifs(origine, suivants).map((p) => ({
        mode: p.mode,
        montant: -p.montant,
      }));

      const dateComptable = await this.dateComptableSure(lot, maintenant);
      const precedent = await lot.dernier("tickets");
      const annulation = await this.sceller(
        lot,
        "tickets",
        {
          type: "ANNULATION",
          dateComptable,
          operateurId: s.operateurId,
          tableId: origine.tableId,
          couverts: origine.couverts == null ? null : -origine.couverts,
          lignes,
          ventilationTVA,
          totalHT,
          totalTVA: totalTTC - totalHT,
          totalTTC,
          paiements: remboursements,
          renduMonnaie: 0,
          ticketOrigine: { numero: origine.numero, hash: origine.hash },
          motif: s.motif.trim(),
          ...(origine.client ? { client: origine.client } : {}),
          // Annulation d'un règlement : miroir négatif, la dette renaît et la TVA exigible est reprise.
          ...(origine.reglement
            ? {
                reglement: {
                  montantTTC: -origine.reglement.montantTTC,
                  imputations: origine.reglement.imputations.map((i) => ({
                    ...i,
                    montantTTC: -i.montantTTC,
                    encaisseAvantTTC: i.encaisseAvantTTC + i.montantTTC,
                    ventilationTVA: i.ventilationTVA.map((v) => ({
                      tauxTVA: v.tauxTVA,
                      baseHT: -v.baseHT,
                      montantTVA: -v.montantTVA,
                      montantTTC: -v.montantTTC,
                    })),
                  })),
                  ventilationTVA: origine.reglement.ventilationTVA.map((v) => ({
                    tauxTVA: v.tauxTVA,
                    baseHT: -v.baseHT,
                    montantTVA: -v.montantTVA,
                    montantTTC: -v.montantTTC,
                  })),
                },
              }
            : {}),
          grandTotalPerpetuel: (precedent?.grandTotalPerpetuel ?? 0) + totalTTC,
          cumulPerpetuelAbsolu: (precedent?.cumulPerpetuelAbsolu ?? 0) + Math.abs(totalTTC),
        },
        maintenant,
      );

      await this.evenement(
        lot,
        "ANNULATION",
        { ticket: annulation.numero, ticketOrigine: origine.numero, montantTTC: totalTTC, motif: annulation.motif },
        s.operateurId,
        maintenant,
      );
      return annulation;
    });
  }

  /**
   * Corrige les moyens de paiement d'une vente encore dans la journée en cours
   * (pas encore couverte par une Z), par un ticket CORRECTION de total nul : la
   * vente reste intacte, les encaissements par mode de la Z en tiennent compte.
   * Exclut les ventes en compte (la part due et la TVA exigible en dépendent).
   */
  enregistrerCorrection(s: SaisieCorrection, ctx?: ContexteEtablissement): Promise<Ticket> {
    return this.operation(async (lot, maintenant) => {
      if (!s.operateurId) throw new ErreurFiscale("OPERATEUR_OBLIGATOIRE", "opérateur obligatoire");
      if (!s.motif?.trim()) throw new ErreurFiscale("MOTIF_OBLIGATOIRE", "une correction exige un motif");
      const origine = await this.stockage.trouver("tickets", s.numeroTicket);
      if (!origine) throw new ErreurFiscale("TICKET_INCONNU", `ticket ${s.numeroTicket} introuvable`);
      if (origine.type !== "VENTE") throw new ErreurFiscale("CORRECTION_INTERDITE", "seuls les paiements d'une vente se corrigent");
      // Couverture par les Z de l'établissement, quel que soit l'appareil qui les a faites.
      const couvert = (await this.etatEtablissement(lot, ctx)).couvertures.get(this.contexte.caisseId)!.dernierTicketCouvert;
      if (origine.numero <= couvert) {
        throw new ErreurFiscale("CORRECTION_INTERDITE", `le ticket ${origine.numero} est déjà clôturé : la correction n'est possible qu'avant la Z`);
      }
      const suivants = await this.stockage.lister("tickets", origine.numero + 1);
      if (suivants.some((t) => t.type === "ANNULATION" && t.ticketOrigine?.numero === origine.numero)) {
        throw new ErreurFiscale("DEJA_ANNULE", `le ticket ${origine.numero} est annulé`);
      }
      const avant = paiementsEffectifs(origine, suivants);
      if (avant.some((p) => p.mode === "EN_COMPTE") || s.paiements.some((p) => p.mode === "EN_COMPTE")) {
        throw new ErreurFiscale("CORRECTION_INTERDITE", "une vente en compte ne se corrige pas : annulez-la");
      }
      // Paiements reçus, nets : exactement le total, sans rendu.
      const { renduMonnaie } = controlerPaiements(origine.totalTTC, s.paiements);
      if (renduMonnaie !== 0) throw new ErreurFiscale("MONTANT_INVALIDE", "les paiements corrigés doivent égaler le total de la vente");
      const apres = cumulerPaiements([s.paiements]);
      const ecart = cumulerPaiements([apres, avant.map((p) => ({ mode: p.mode, montant: -p.montant }))]).filter((p) => p.montant !== 0);
      if (ecart.length === 0) throw new ErreurFiscale("CORRECTION_VIDE", "les moyens de paiement sont déjà ceux-là");

      const dateComptable = await this.dateComptableSure(lot, maintenant);
      const precedent = await lot.dernier("tickets");
      const correction = await this.sceller(
        lot,
        "tickets",
        {
          type: "CORRECTION",
          dateComptable,
          operateurId: s.operateurId,
          tableId: origine.tableId,
          couverts: null,
          lignes: [],
          ventilationTVA: [],
          totalHT: 0,
          totalTVA: 0,
          totalTTC: 0,
          paiements: ecart,
          renduMonnaie: 0,
          ticketOrigine: { numero: origine.numero, hash: origine.hash },
          motif: s.motif.trim(),
          grandTotalPerpetuel: precedent?.grandTotalPerpetuel ?? 0,
          cumulPerpetuelAbsolu: precedent?.cumulPerpetuelAbsolu ?? 0,
        },
        maintenant,
      );
      const resume = (l: Paiement[]) => l.map((p) => `${p.mode} ${p.montant}`).join(" + ");
      await this.evenement(
        lot,
        "CORRECTION_PAIEMENT",
        { ticket: correction.numero, ticketOrigine: origine.numero, avant: resume(avant), apres: resume(apres), motif: correction.motif },
        s.operateurId,
        maintenant,
      );
      return correction;
    });
  }

  /**
   * Règlement d'un compte client : encaisse tout ou partie de ventes portées en
   * compte, sans nouvelle vente. La TVA de ces ventes devient exigible au
   * prorata des sommes réglées. Les ventes de cette caisse sont contrôlées ici
   * (client, empreinte, montant restant dû) ; celles d'une autre caisse le sont
   * par le serveur, qui détient toutes les chaînes.
   */
  enregistrerReglement(s: SaisieReglement): Promise<Ticket> {
    return this.operation(async (lot, maintenant) => {
      if (!s.operateurId) throw new ErreurFiscale("OPERATEUR_OBLIGATOIRE", "opérateur obligatoire");
      const client = clientValide(s.client);
      if (!s.imputations?.length) throw new ErreurFiscale("REGLEMENT_VIDE", "aucune vente à régler");
      if (s.paiements.some((p) => p.mode === "EN_COMPTE")) {
        throw new ErreurFiscale("MODE_PAIEMENT_INVALIDE", "un règlement ne peut pas être porté en compte");
      }
      const vues = new Set<string>();
      const locales = await this.stockage.lister("tickets");
      const regleLocal = regleParVente(locales);
      const invalide = (cle: string, raison: string) => new ErreurFiscale("IMPUTATION_INVALIDE", `vente ${cle} : ${raison}`);
      const imputations: ImputationReglement[] = s.imputations.map((i) => {
        const cle = `${i.caisseId}#${i.numero}`;
        if (!i.caisseId || !Number.isSafeInteger(i.numero) || i.numero < 1 || !/^[0-9a-f]{64}$/.test(i.hash ?? "") || vues.has(cle)) {
          throw invalide(cle, "référence invalide ou en double");
        }
        vues.add(cle);
        const entiers = [i.montantTTC, i.venteTotalTTC, i.venteEnCompteTTC, i.dejaRegleTTC];
        if (!entiers.every((x) => Number.isSafeInteger(x)) || i.montantTTC <= 0 || i.dejaRegleTTC < 0 || i.venteEnCompteTTC <= 0) {
          throw invalide(cle, "montants invalides");
        }
        if (i.venteEnCompteTTC > i.venteTotalTTC || i.dejaRegleTTC + i.montantTTC > i.venteEnCompteTTC) {
          throw invalide(cle, "le règlement dépasse ce qui reste dû");
        }
        // Données d'une vente d'une autre caisse : elles doivent former une ventilation que la vérification acceptera.
        if (!ventilationValide(i.venteVentilationTVA, i.venteTotalTTC)) throw invalide(cle, "ventilation de TVA incohérente");
        if (i.caisseId === this.contexte.caisseId) {
          const vente = locales.find((t) => t.numero === i.numero);
          if (!vente || vente.type !== "VENTE" || vente.hash !== i.hash || vente.client?.id !== client.id) {
            throw invalide(cle, "pas une vente en compte de ce client");
          }
          if (locales.some((t) => t.type === "ANNULATION" && t.ticketOrigine?.numero === vente.numero)) throw invalide(cle, "vente annulée");
          if (
            i.venteTotalTTC !== vente.totalTTC ||
            i.venteEnCompteTTC !== montantEnCompte(vente) ||
            canonique(i.venteVentilationTVA) !== canonique(vente.ventilationTVA) ||
            i.dejaRegleTTC < (regleLocal.get(cle) ?? 0)
          ) {
            throw invalide(cle, "déjà réglée en tout ou partie, ou totaux incohérents");
          }
        }
        const encaisseAvantTTC = i.venteTotalTTC - i.venteEnCompteTTC + i.dejaRegleTTC;
        return {
          caisseId: i.caisseId,
          numero: i.numero,
          hash: i.hash,
          montantTTC: i.montantTTC,
          venteTotalTTC: i.venteTotalTTC,
          encaisseAvantTTC,
          ventilationTVA: ventilerTranche(i.venteVentilationTVA, encaisseAvantTTC, i.montantTTC, i.venteTotalTTC),
        };
      });
      const montantTTC = imputations.reduce((somme, i) => somme + i.montantTTC, 0);
      const { renduMonnaie } = controlerPaiements(montantTTC, s.paiements);

      const dateComptable = await this.dateComptableSure(lot, maintenant);
      const precedent = await lot.dernier("tickets");
      const ticket = await this.sceller(
        lot,
        "tickets",
        {
          type: "REGLEMENT",
          dateComptable,
          operateurId: s.operateurId,
          tableId: null,
          couverts: null,
          lignes: [],
          ventilationTVA: [],
          totalHT: 0,
          totalTVA: 0,
          totalTTC: 0,
          paiements: s.paiements.map((p) => ({ mode: p.mode, montant: p.montant })),
          renduMonnaie,
          ticketOrigine: null,
          motif: null,
          client,
          reglement: { montantTTC, imputations, ventilationTVA: cumulerVentilations(imputations.map((i) => i.ventilationTVA)) },
          grandTotalPerpetuel: precedent?.grandTotalPerpetuel ?? 0,
          cumulPerpetuelAbsolu: precedent?.cumulPerpetuelAbsolu ?? 0,
        },
        maintenant,
      );
      await this.evenement(
        lot,
        "REGLEMENT_COMPTE",
        { ticket: ticket.numero, client: client.id, montantTTC, ventes: imputations.length },
        s.operateurId,
        maintenant,
      );
      return ticket;
    });
  }

  /**
   * État de l'établissement : clôtures de cette caisse et du contexte reçu du
   * serveur, couverture de chaque caisse, tickets qui restent à clôturer.
   * Tout ce qui vient du serveur est vérifié (signatures, chaînage, totaux,
   * ancrage sur la dernière Z) ; la moindre anomalie refuse l'opération.
   * Sans contexte, l'établissement se réduit à cette caisse.
   */
  private async etatEtablissement(lot: Lot, ctx?: ContexteEtablissement): Promise<EtatEtablissement> {
    const moi = this.contexte.caisseId;
    const invalide = (detail: string) => new ErreurFiscale("CONTEXTE_INVALIDE", `données du serveur refusées : ${detail}`);
    const resoudre = (id: string) => ctx?.cles[id] ?? null;
    const codes = (a: Array<{ code: string; numero: number }>) => a.map((x) => `${x.code} n°${x.numero}`).join(", ");

    const externes = (ctx?.clotures ?? []).filter((c) => c.caisseId !== moi);
    for (const c of externes) {
      if (c.etablissementId !== this.contexte.etablissementId) throw invalide(`clôture ${cleRef(c)} d'un autre établissement`);
      const a = await verifierScellement("clotures", c, resoudre);
      if (a.length) throw invalide(`clôture ${cleRef(c)} : ${codes(a)}`);
    }
    const clotures = unir(await lot.clotures(), externes);
    const autres = (ctx?.caisses ?? []).filter((x) => x.caisseId !== moi);
    const cov = couvertures(clotures, [moi, ...autres.map((x) => x.caisseId)]);
    const restants = new Map<string, Ticket[]>();
    const evenements = new Map<string, { numero: number; hash: string }>();

    // Cette caisse : la couverture annoncée doit tomber sur ses propres enregistrements.
    const propre = cov.get(moi)!;
    if (propre.dernierTicketCouvert > 0) {
      const t = await this.stockage.trouver("tickets", propre.dernierTicketCouvert);
      if (!t || (propre.hashDernierTicketCouvert && t.hash !== propre.hashDernierTicketCouvert)) throw invalide("couverture des tickets de cette caisse");
      cov.set(moi, { ...propre, hashDernierTicketCouvert: t.hash, grandTotalPerpetuel: t.grandTotalPerpetuel, cumulPerpetuelAbsolu: t.cumulPerpetuelAbsolu });
    }
    if (propre.dernierEvenement > 0) {
      const ev = await this.stockage.trouver("evenements", propre.dernierEvenement);
      if (!ev || (propre.hashDernierEvenement && ev.hash !== propre.hashDernierEvenement)) throw invalide("couverture du journal de cette caisse");
    }
    restants.set(moi, await this.stockage.lister("tickets", propre.dernierTicketCouvert + 1));

    for (const x of autres) {
      const c = cov.get(x.caisseId)!;
      const n = c.dernierTicketCouvert;
      if (n === 0 ? x.ancre !== null : x.ancre?.numero !== n) throw invalide(`ancre des tickets de ${x.caisseId}`);
      for (const t of x.ancre ? [x.ancre, ...x.tickets] : x.tickets) {
        if (t.caisseId !== x.caisseId || t.etablissementId !== this.contexte.etablissementId) throw invalide(`ticket étranger à ${x.caisseId}`);
      }
      if (x.ancre) {
        const a = await verifierScellement("tickets", x.ancre, resoudre);
        if (a.length || (c.hashDernierTicketCouvert && c.hashDernierTicketCouvert !== x.ancre.hash)) throw invalide(`ancre des tickets de ${x.caisseId}`);
      }
      const anomalies = [
        ...(await verifierChaine("tickets", x.tickets, resoudre, x.ancre ? { numero: x.ancre.numero, hash: x.ancre.hash } : undefined)),
        ...verifierTotauxTickets(x.tickets, x.ancre?.grandTotalPerpetuel ?? 0, x.ancre?.cumulPerpetuelAbsolu ?? 0),
      ];
      if (anomalies.length) throw invalide(`tickets de ${x.caisseId} : ${codes(anomalies)}`);
      cov.set(x.caisseId, {
        ...c,
        hashDernierTicketCouvert: x.ancre?.hash ?? null,
        grandTotalPerpetuel: x.ancre?.grandTotalPerpetuel ?? 0,
        cumulPerpetuelAbsolu: x.ancre?.cumulPerpetuelAbsolu ?? 0,
      });
      restants.set(x.caisseId, x.tickets);
      const e = x.dernierEvenement;
      if (e) {
        const a = await verifierScellement("evenements", e, resoudre);
        const recule = e.numero < c.dernierEvenement || (e.numero === c.dernierEvenement && !!c.hashDernierEvenement && e.hash !== c.hashDernierEvenement);
        if (a.length || e.caisseId !== x.caisseId || recule) throw invalide(`journal de ${x.caisseId}`);
        evenements.set(x.caisseId, { numero: e.numero, hash: e.hash });
      }
    }
    return {
      clotures,
      tetes: { JOUR: tete(clotures, "JOUR"), MOIS: tete(clotures, "MOIS"), EXERCICE: tete(clotures, "EXERCICE") },
      couvertures: cov,
      restants,
      evenements,
    };
  }

  /** Tous les tickets restants, par caisse puis par numéro. */
  private static tousRestants(e: EtatEtablissement): Ticket[] {
    return [...e.restants.keys()].sort().flatMap((id) => e.restants.get(id)!);
  }

  /** Date d'une Z : jamais avant la dernière Z de l'établissement, ni dans un mois clôturé. */
  private static plancherEtablissement(e: EtatEtablissement): string {
    const jour = e.clotures.filter((c) => c.periode === "JOUR").map((c) => c.identifiantPeriode).sort().at(-1) ?? "";
    const mois = e.clotures.filter((c) => c.periode === "MOIS").map((c) => c.identifiantPeriode).sort().at(-1);
    return [jour, mois ? premierJourMoisSuivant(mois) : ""].sort().at(-1)!;
  }

  /**
   * Ce qui reste à clôturer pour l'établissement (comptage, écran des
   * clôtures), sans rien écrire : totaux, tickets, dernière Z.
   */
  etatCloture(ctx?: ContexteEtablissement): Promise<{
    totaux: TotauxPeriode;
    tickets: Ticket[];
    derniereZ: Cloture | null;
    couvertures: CouvertureCaisse[];
  }> {
    return this.exclusif(async () => {
      const e = await this.etatEtablissement(new Lot(this.stockage), ctx);
      const tickets = Registre.tousRestants(e);
      const derniereZ = e.tetes.JOUR ?? e.clotures.filter((c) => c.periode === "JOUR" && c.caisseId === this.contexte.caisseId).at(-1) ?? null;
      return { totaux: totauxTickets(tickets), tickets, derniereZ, couvertures: [...e.couvertures.values()] };
    });
  }

  /** Lecture X : totaux de l'établissement depuis la dernière Z, sans rien figer. */
  lectureX(operateurId: string, ctx?: ContexteEtablissement): Promise<TotauxPeriode & { dateComptable: string }> {
    return this.operation(async (lot, maintenant) => {
      const e = await this.etatEtablissement(lot, ctx);
      const tickets = Registre.tousRestants(e);
      const totaux = totauxTickets(tickets);
      await this.evenement(lot, "LECTURE_X", { totalTTC: totaux.totalTTC, caisses: e.couvertures.size }, operateurId, maintenant);
      return {
        ...totaux,
        dateComptable: tickets.map((t) => t.dateComptable).sort().at(-1) ?? calculerDateComptable(maintenant, this.heureBascule),
      };
    });
  }

  private async plageEvenements(
    lot: Lot,
    periode: Cloture["periode"],
  ): Promise<Pick<Cloture, "premierEvenement" | "dernierEvenement" | "hashDernierEvenement">> {
    const precedente = (await lot.clotures()).filter((c) => c.periode === periode).at(-1);
    const dernier = await lot.dernier("evenements");
    const premier = (precedente?.dernierEvenement ?? 0) + 1;
    if (!dernier || dernier.numero < premier) {
      return { premierEvenement: null, dernierEvenement: null, hashDernierEvenement: null };
    }
    return { premierEvenement: premier, dernierEvenement: dernier.numero, hashDernierEvenement: dernier.hash };
  }

  /**
   * Clôture Z de l'établissement : fige les tickets non clôturés de toutes les
   * caisses (ceux de cette caisse et ceux que le serveur a reçus des autres),
   * une clôture par journée comptable concernée. Un ticket arrivé après la Z
   * de sa journée entre dans la Z suivante. Sans ticket, une clôture à zéro.
   */
  cloturerJournee(operateurId: string, ctx?: ContexteEtablissement): Promise<Cloture[]> {
    return this.operation(async (lot, maintenant) => {
      if (!operateurId) throw new ErreurFiscale("OPERATEUR_OBLIGATOIRE", "opérateur obligatoire");
      const moi = this.contexte.caisseId;
      const e = await this.etatEtablissement(lot, ctx);
      const plancher = Registre.plancherEtablissement(e);

      // Regroupe par journée ; les tickets d'une caisse restent dans l'ordre de sa chaîne. Tout est validé avant de sceller.
      const parJour = new Map<string, Map<string, Ticket[]>>();
      for (const [caisseId, tickets] of e.restants) {
        let precedente = "";
        for (const t of tickets) {
          if (t.dateComptable < precedente) {
            throw new ErreurFiscale("JOURNEES_ENTRELACEES", `ticket ${t.numero} de ${caisseId} hors de l'ordre des journées : vérifier l'horloge de la caisse`);
          }
          precedente = t.dateComptable;
          const jour = t.dateComptable < plancher ? plancher : t.dateComptable;
          const groupe = parJour.get(jour) ?? new Map<string, Ticket[]>();
          groupe.set(caisseId, [...(groupe.get(caisseId) ?? []), t]);
          parJour.set(jour, groupe);
        }
      }
      const jours = [...parJour.keys()].sort();
      if (jours.length === 0) {
        jours.push([calculerDateComptable(maintenant, this.heureBascule), await this.plancherDate(lot), plancher].sort().at(-1)!);
      }

      const cov = new Map(e.couvertures);
      const ids = [...cov.keys()].sort();
      let precedente: RefCloture | null = e.tetes.JOUR ? refDe(e.tetes.JOUR) : null;
      const resultat: Cloture[] = [];
      for (const [rang, jour] of jours.entries()) {
        const groupe = parJour.get(jour) ?? new Map<string, Ticket[]>();
        const tickets: Ticket[] = [];
        for (const id of ids) {
          const avant = cov.get(id)!;
          const ts = groupe.get(id) ?? [];
          const dernier = ts.at(-1);
          let n: CouvertureCaisse = { ...avant, premierTicket: ts[0]?.numero ?? null, premierEvenement: null };
          if (dernier) {
            n = {
              ...n,
              dernierTicketCouvert: dernier.numero,
              hashDernierTicketCouvert: dernier.hash,
              grandTotalPerpetuel: dernier.grandTotalPerpetuel,
              cumulPerpetuelAbsolu: dernier.cumulPerpetuelAbsolu,
            };
          }
          // Journal : celui de cette caisse jusqu'à son dernier événement ; celui des autres, tel que reçu, dans la première Z.
          const ev = id === moi ? await lot.dernier("evenements") : rang === 0 ? e.evenements.get(id) : undefined;
          if (ev && ev.numero > avant.dernierEvenement) {
            n = { ...n, premierEvenement: avant.dernierEvenement + 1, dernierEvenement: ev.numero, hashDernierEvenement: ev.hash };
          }
          cov.set(id, n);
          tickets.push(...ts);
        }
        const caisses = ids.map((id) => cov.get(id)!);
        const propre = cov.get(moi)!;
        const ts = groupe.get(moi) ?? [];
        const cloture = await this.sceller(
          lot,
          "clotures",
          {
            periode: "JOUR",
            identifiantPeriode: jour,
            operateurId,
            ...totauxTickets(tickets),
            premierTicket: ts[0]?.numero ?? null,
            dernierTicket: ts.at(-1)?.numero ?? null,
            hashDernierTicket: ts.at(-1)?.hash ?? null,
            dernierTicketCouvert: propre.dernierTicketCouvert,
            cloturesAgregees: [],
            premierEvenement: propre.premierEvenement,
            dernierEvenement: propre.premierEvenement == null ? null : propre.dernierEvenement,
            hashDernierEvenement: propre.premierEvenement == null ? null : propre.hashDernierEvenement,
            grandTotalPerpetuel: caisses.reduce((s, c) => s + c.grandTotalPerpetuel, 0),
            cumulPerpetuelAbsolu: caisses.reduce((s, c) => s + c.cumulPerpetuelAbsolu, 0),
            etablissement: { precedente, caisses, agregees: [] },
          },
          maintenant,
        );
        precedente = refDe(cloture);
        await this.evenement(
          lot,
          "CLOTURE",
          { periode: "JOUR", identifiantPeriode: jour, cloture: cloture.numero, totalTTC: cloture.totalTTC, caisses: caisses.length },
          operateurId,
          maintenant,
        );
        resultat.push(cloture);
      }
      return resultat;
    });
  }

  /**
   * Z de l'établissement d'un mois, en remontant la chaîne des Z depuis la
   * dernière : le contexte doit les contenir toutes. Y figurent aussi les Z
   * propres à une caisse (avant 0.7.0) du mois, non encore agrégées.
   */
  private static zDuMois(e: EtatEtablissement, mois: string): { sources: Cloture[]; anterieure: Cloture | null } {
    const index = new Map(e.clotures.map((c) => [cleRef(c), c]));
    const debut = `${mois}-01`;
    const chaine: Cloture[] = [];
    let anterieure: Cloture | null = null;
    for (let z = e.tetes.JOUR; z; ) {
      if (z.identifiantPeriode < debut) {
        anterieure = z;
        break;
      }
      if (z.identifiantPeriode.startsWith(`${mois}-`)) chaine.unshift(z);
      const p: RefCloture | null = z.etablissement!.precedente;
      if (!p) break;
      const suivante = index.get(cleRef(p));
      if (!suivante || suivante.hash !== p.hash) {
        throw new ErreurFiscale("CONTEXTE_INCOMPLET", `la clôture ${cleRef(p)} manque : réessayez une fois les appareils synchronisés`);
      }
      z = suivante;
    }
    const moisClos = new Set(e.clotures.filter((c) => !c.etablissement && c.periode === "MOIS").map((c) => `${c.caisseId}#${c.identifiantPeriode}`));
    const anciennes = e.clotures
      .filter((c) => !c.etablissement && c.periode === "JOUR" && c.identifiantPeriode.startsWith(`${mois}-`) && !moisClos.has(`${c.caisseId}#${mois}`))
      .sort((a, b) => a.caisseId.localeCompare(b.caisseId) || a.numero - b.numero);
    if (!anterieure && chaine.length === 0) {
      anterieure = e.clotures.filter((c) => c.periode === "JOUR" && c.identifiantPeriode < debut).sort((a, b) => a.horodatage.localeCompare(b.horodatage)).at(-1) ?? null;
    }
    return { sources: [...anciennes, ...chaine], anterieure };
  }

  /** Clôture mensuelle de l'établissement ("2026-10") : agrège ses Z du mois, une fois le mois terminé. */
  cloturerMois(mois: string, operateurId: string, ctx?: ContexteEtablissement): Promise<Cloture> {
    return this.operation(async (lot, maintenant) => {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mois)) throw new ErreurFiscale("PERIODE_INVALIDE", `mois invalide : ${mois}`);
      if (calculerDateComptable(maintenant, this.heureBascule).slice(0, 7) <= mois) {
        throw new ErreurFiscale("PERIODE_EN_COURS", `le mois ${mois} n'est pas terminé`);
      }
      const e = await this.etatEtablissement(lot, ctx);
      const moi = this.contexte.caisseId;
      if (e.clotures.some((c) => c.periode === "MOIS" && c.identifiantPeriode === mois && (c.etablissement || c.caisseId === moi))) {
        throw new ErreurFiscale("DEJA_CLOTURE", `le mois ${mois} est déjà clôturé`);
      }
      if (Registre.tousRestants(e).some((t) => t.dateComptable.slice(0, 7) <= mois)) {
        throw new ErreurFiscale("CLOTURE_Z_MANQUANTE", `des tickets du mois ${mois} ne sont pas clôturés en Z`);
      }
      const { sources, anterieure } = Registre.zDuMois(e, mois);
      return this.cloturerAgregat(lot, e, "MOIS", mois, sources, anterieure, operateurId, maintenant);
    });
  }

  /** Clôture d'exercice de l'établissement : agrège ses clôtures mensuelles de `moisDebut` à `moisFin`, toutes obligatoires. */
  cloturerExercice(identifiant: string, moisDebut: string, moisFin: string, operateurId: string, ctx?: ContexteEtablissement): Promise<Cloture> {
    return this.operation(async (lot, maintenant) => {
      const mois = listeMois(moisDebut, moisFin);
      if (!identifiant || mois.length === 0 || mois.length > 24 || mois.at(-1) !== moisFin) {
        throw new ErreurFiscale("PERIODE_INVALIDE", "exercice invalide (1 à 24 mois)");
      }
      const e = await this.etatEtablissement(lot, ctx);
      const moi = this.contexte.caisseId;
      const exercices = e.clotures.filter((c) => c.periode === "EXERCICE" && (c.etablissement || c.caisseId === moi));
      if (exercices.some((c) => c.identifiantPeriode === identifiant)) {
        throw new ErreurFiscale("DEJA_CLOTURE", `l'exercice ${identifiant} est déjà clôturé`);
      }
      const dejaAgreges = new Set(
        exercices.flatMap((c) => (c.etablissement ? c.etablissement.agregees.map(cleRef) : c.cloturesAgregees.map((n) => cleRef({ caisseId: moi, numero: n })))),
      );
      const mensuelles = mois.map((m) => {
        const c =
          ordonner(e.clotures, "MOIS").filter((x) => x.identifiantPeriode === m).at(-1) ??
          e.clotures.find((x) => !x.etablissement && x.caisseId === moi && x.periode === "MOIS" && x.identifiantPeriode === m);
        if (!c) throw new ErreurFiscale("CLOTURE_MOIS_MANQUANTE", `le mois ${m} n'est pas clôturé`);
        if (dejaAgreges.has(cleRef(c))) throw new ErreurFiscale("DEJA_CLOTURE", `le mois ${m} appartient déjà à un exercice clôturé`);
        return c;
      });
      return this.cloturerAgregat(lot, e, "EXERCICE", identifiant, mensuelles, null, operateurId, maintenant);
    });
  }

  private async cloturerAgregat(
    lot: Lot,
    e: EtatEtablissement,
    periode: "MOIS" | "EXERCICE",
    identifiant: string,
    sources: Cloture[],
    anterieure: Cloture | null,
    operateurId: string,
    maintenant: Date,
  ): Promise<Cloture> {
    if (!operateurId) throw new ErreurFiscale("OPERATEUR_OBLIGATOIRE", "opérateur obligatoire");
    const moi = this.contexte.caisseId;
    const reference = sources.at(-1) ?? anterieure;
    // Tickets de cette caisse dans les clôtures agrégées : lien avec sa propre chaîne.
    const propres = sources.flatMap((s) => {
      if (s.etablissement) {
        const c = s.etablissement.caisses.find((x) => x.caisseId === moi);
        return c?.premierTicket != null ? [{ premier: c.premierTicket, dernier: c.dernierTicketCouvert, hash: c.hashDernierTicketCouvert }] : [];
      }
      return s.caisseId === moi && s.premierTicket != null ? [{ premier: s.premierTicket, dernier: s.dernierTicket, hash: s.hashDernierTicket }] : [];
    });
    const couvertPropre = reference?.etablissement
      ? (reference.etablissement.caisses.find((x) => x.caisseId === moi)?.dernierTicketCouvert ?? 0)
      : reference?.caisseId === moi
        ? reference.dernierTicketCouvert
        : 0;
    const cloture = await this.sceller(
      lot,
      "clotures",
      {
        periode,
        identifiantPeriode: identifiant,
        operateurId,
        ...totauxClotures(sources),
        premierTicket: propres[0]?.premier ?? null,
        dernierTicket: propres.at(-1)?.dernier ?? null,
        hashDernierTicket: propres.at(-1)?.hash ?? null,
        dernierTicketCouvert: couvertPropre,
        cloturesAgregees: [],
        ...(await this.plageEvenements(lot, periode)),
        grandTotalPerpetuel: reference?.grandTotalPerpetuel ?? 0,
        cumulPerpetuelAbsolu: reference?.cumulPerpetuelAbsolu ?? 0,
        etablissement: {
          precedente: e.tetes[periode] ? refDe(e.tetes[periode]!) : null,
          caisses: (reference?.etablissement?.caisses ?? []).map((c) => ({ ...c, premierTicket: null, premierEvenement: null })),
          agregees: sources.map(refDe),
        },
      },
      maintenant,
    );
    await this.evenement(
      lot,
      "CLOTURE",
      { periode, identifiantPeriode: identifiant, cloture: cloture.numero, totalTTC: cloture.totalTTC },
      operateurId,
      maintenant,
    );
    return cloture;
  }
}
