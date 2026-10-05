import { canonique } from "./canonique.js";
import { HASH_GENESE, sha256Hex, type Signataire } from "./crypto.js";
import { dateComptable as calculerDateComptable, listeMois, premierJourMoisSuivant } from "./dates.js";
import {
  calculerLigne,
  controlerPaiements,
  cumulerPaiements,
  cumulerVentilations,
  ligneInverse,
  paiementsNets,
  ventiler,
} from "./montants.js";
import type { EntreeLot, StockageFiscal, TypesChaines } from "./stockage.js";
import {
  ErreurFiscale,
  type Chaine,
  type Cloture,
  type CodeEvenement,
  type ContexteCaisse,
  type Evenement,
  type Paiement,
  type SaisieLigne,
  type Ticket,
  type TotauxPeriode,
} from "./types.js";
import { VERSION_NOYAU_FISCAL } from "./version.js";

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
  };
}

/** Totaux d'un ensemble de tickets (lecture X, clôture Z). */
export function totauxTickets(tickets: Ticket[]): TotauxPeriode {
  if (tickets.length === 0) return { ...TOTAUX_VIDES };
  return {
    nbVentes: tickets.filter((t) => t.type === "VENTE").length,
    nbAnnulations: tickets.filter((t) => t.type === "ANNULATION").length,
    totalHT: tickets.reduce((s, t) => s + t.totalHT, 0),
    totalTVA: tickets.reduce((s, t) => s + t.totalTVA, 0),
    totalTTC: tickets.reduce((s, t) => s + t.totalTTC, 0),
    ventilationTVA: cumulerVentilations(tickets.map((t) => t.ventilationTVA)),
    paiements: cumulerPaiements(tickets.map((t) => paiementsNets(t.paiements, t.renduMonnaie))),
    totalRemisesTTC: tickets.reduce((s, t) => s + t.lignes.reduce((r, l) => r + l.remiseTTC, 0), 0),
  };
}

/** Totaux d'un ensemble de clôtures (clôtures mensuelle et annuelle). */
export function totauxClotures(clotures: Cloture[]): TotauxPeriode {
  if (clotures.length === 0) return { ...TOTAUX_VIDES };
  return {
    nbVentes: clotures.reduce((s, c) => s + c.nbVentes, 0),
    nbAnnulations: clotures.reduce((s, c) => s + c.nbAnnulations, 0),
    totalHT: clotures.reduce((s, c) => s + c.totalHT, 0),
    totalTVA: clotures.reduce((s, c) => s + c.totalTVA, 0),
    totalTTC: clotures.reduce((s, c) => s + c.totalTTC, 0),
    ventilationTVA: cumulerVentilations(clotures.map((c) => c.ventilationTVA)),
    paiements: cumulerPaiements(clotures.map((c) => c.paiements)),
    totalRemisesTTC: clotures.reduce((s, c) => s + c.totalRemisesTTC, 0),
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
      if (origine.type !== "VENTE") {
        throw new ErreurFiscale("ANNULATION_INTERDITE", "seule une vente peut être annulée");
      }
      const suivants = await this.stockage.lister("tickets", origine.numero + 1);
      if (suivants.some((t) => t.type === "ANNULATION" && t.ticketOrigine?.numero === origine.numero)) {
        throw new ErreurFiscale("DEJA_ANNULE", `le ticket ${origine.numero} est déjà annulé`);
      }

      const lignes = origine.lignes.map(ligneInverse);
      const ventilationTVA = ventiler(lignes);
      const totalTTC = -origine.totalTTC;
      const totalHT = ventilationTVA.reduce((t, v) => t + v.baseHT, 0);
      const remboursements = paiementsNets(origine.paiements, origine.renduMonnaie).map((p) => ({
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

  /** Dernière clôture journalière et tickets qui restent à clôturer. */
  private async etatZ(lot: Lot): Promise<{ derniereZ: Cloture | null; restants: Ticket[] }> {
    const derniereZ = (await lot.clotures()).filter((c) => c.periode === "JOUR").at(-1) ?? null;
    const restants = await this.stockage.lister("tickets", (derniereZ?.dernierTicketCouvert ?? 0) + 1);
    return { derniereZ, restants };
  }

  /** Lecture X : totaux depuis la dernière clôture, sans rien figer. */
  lectureX(operateurId: string): Promise<TotauxPeriode & { dateComptable: string }> {
    return this.operation(async (lot, maintenant) => {
      const { restants } = await this.etatZ(lot);
      const totaux = totauxTickets(restants);
      await this.evenement(lot, "LECTURE_X", { totalTTC: totaux.totalTTC }, operateurId, maintenant);
      return {
        ...totaux,
        dateComptable: restants.at(-1)?.dateComptable ?? calculerDateComptable(maintenant, this.heureBascule),
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
   * Clôture Z : fige les tickets non clôturés, une clôture par journée
   * comptable concernée. Sans ticket, produit une clôture à zéro.
   */
  cloturerJournee(operateurId: string): Promise<Cloture[]> {
    return this.operation(async (lot, maintenant) => {
      if (!operateurId) throw new ErreurFiscale("OPERATEUR_OBLIGATOIRE", "opérateur obligatoire");
      const { derniereZ, restants } = await this.etatZ(lot);

      // Regroupe par journée en suivant l'ordre des tickets ; tout est validé avant de sceller.
      const journees: Array<{ jour: string; tickets: Ticket[] }> = [];
      for (const t of restants) {
        const courante = journees.at(-1);
        if (courante?.jour === t.dateComptable) courante.tickets.push(t);
        else if (journees.some((j) => j.jour === t.dateComptable) || (courante && t.dateComptable < courante.jour)) {
          throw new ErreurFiscale(
            "JOURNEES_ENTRELACEES",
            `ticket ${t.numero} hors de l'ordre des journées : vérifier l'horloge de la caisse`,
          );
        } else journees.push({ jour: t.dateComptable, tickets: [t] });
      }
      if (journees.length === 0) {
        const jour = [calculerDateComptable(maintenant, this.heureBascule), await this.plancherDate(lot)].sort().at(-1)!;
        journees.push({ jour, tickets: [] });
      }

      const dernierTicketGlobal = await lot.dernier("tickets");
      let couvert = derniereZ?.dernierTicketCouvert ?? 0;
      const resultat: Cloture[] = [];
      for (const { jour, tickets } of journees) {
        const premier = tickets[0] ?? null;
        const dernier = tickets.at(-1) ?? null;
        couvert = dernier?.numero ?? couvert;
        const cloture = await this.sceller(
          lot,
          "clotures",
          {
            periode: "JOUR",
            identifiantPeriode: jour,
            operateurId,
            ...totauxTickets(tickets),
            premierTicket: premier?.numero ?? null,
            dernierTicket: dernier?.numero ?? null,
            hashDernierTicket: dernier?.hash ?? null,
            dernierTicketCouvert: couvert,
            cloturesAgregees: [],
            ...(await this.plageEvenements(lot, "JOUR")),
            grandTotalPerpetuel: (dernier ?? dernierTicketGlobal)?.grandTotalPerpetuel ?? 0,
            cumulPerpetuelAbsolu: (dernier ?? dernierTicketGlobal)?.cumulPerpetuelAbsolu ?? 0,
          },
          maintenant,
        );
        await this.evenement(
          lot,
          "CLOTURE",
          { periode: "JOUR", identifiantPeriode: jour, cloture: cloture.numero, totalTTC: cloture.totalTTC },
          operateurId,
          maintenant,
        );
        resultat.push(cloture);
      }
      return resultat;
    });
  }

  /** Clôture mensuelle ("2026-10") : agrège les clôtures Z du mois, une fois le mois terminé. */
  cloturerMois(mois: string, operateurId: string): Promise<Cloture> {
    return this.operation(async (lot, maintenant) => {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mois)) throw new ErreurFiscale("PERIODE_INVALIDE", `mois invalide : ${mois}`);
      if (calculerDateComptable(maintenant, this.heureBascule).slice(0, 7) <= mois) {
        throw new ErreurFiscale("PERIODE_EN_COURS", `le mois ${mois} n'est pas terminé`);
      }
      const clotures = await lot.clotures();
      if (clotures.some((c) => c.periode === "MOIS" && c.identifiantPeriode === mois)) {
        throw new ErreurFiscale("DEJA_CLOTURE", `le mois ${mois} est déjà clôturé`);
      }
      const { restants } = await this.etatZ(lot);
      if (restants.some((t) => t.dateComptable.slice(0, 7) <= mois)) {
        throw new ErreurFiscale("CLOTURE_Z_MANQUANTE", `des tickets du mois ${mois} ne sont pas clôturés en Z`);
      }
      const z = clotures.filter((c) => c.periode === "JOUR");
      const zDuMois = z.filter((c) => c.identifiantPeriode.startsWith(`${mois}-`));
      const zAnterieure = z.filter((c) => c.identifiantPeriode < `${mois}-01`).at(-1) ?? null;
      return this.cloturerAgregat(lot, "MOIS", mois, zDuMois, zAnterieure, operateurId, maintenant);
    });
  }

  /** Clôture d'exercice : agrège les clôtures mensuelles de `moisDebut` à `moisFin`, toutes obligatoires. */
  cloturerExercice(identifiant: string, moisDebut: string, moisFin: string, operateurId: string): Promise<Cloture> {
    return this.operation(async (lot, maintenant) => {
      const mois = listeMois(moisDebut, moisFin);
      if (!identifiant || mois.length === 0 || mois.length > 24 || mois.at(-1) !== moisFin) {
        throw new ErreurFiscale("PERIODE_INVALIDE", "exercice invalide (1 à 24 mois)");
      }
      const clotures = await lot.clotures();
      if (clotures.some((c) => c.periode === "EXERCICE" && c.identifiantPeriode === identifiant)) {
        throw new ErreurFiscale("DEJA_CLOTURE", `l'exercice ${identifiant} est déjà clôturé`);
      }
      const dejaAgreges = new Set(clotures.filter((c) => c.periode === "EXERCICE").flatMap((c) => c.cloturesAgregees));
      const mensuelles = mois.map((m) => {
        const c = clotures.find((x) => x.periode === "MOIS" && x.identifiantPeriode === m);
        if (!c) throw new ErreurFiscale("CLOTURE_MOIS_MANQUANTE", `le mois ${m} n'est pas clôturé`);
        if (dejaAgreges.has(c.numero)) {
          throw new ErreurFiscale("DEJA_CLOTURE", `le mois ${m} appartient déjà à un exercice clôturé`);
        }
        return c;
      });
      return this.cloturerAgregat(lot, "EXERCICE", identifiant, mensuelles, null, operateurId, maintenant);
    });
  }

  private async cloturerAgregat(
    lot: Lot,
    periode: "MOIS" | "EXERCICE",
    identifiant: string,
    sources: Cloture[],
    anterieure: Cloture | null,
    operateurId: string,
    maintenant: Date,
  ): Promise<Cloture> {
    if (!operateurId) throw new ErreurFiscale("OPERATEUR_OBLIGATOIRE", "opérateur obligatoire");
    const avecTickets = sources.filter((c) => c.premierTicket != null);
    const derniere = avecTickets.at(-1);
    const reference = sources.at(-1) ?? anterieure;
    const cloture = await this.sceller(
      lot,
      "clotures",
      {
        periode,
        identifiantPeriode: identifiant,
        operateurId,
        ...totauxClotures(sources),
        premierTicket: avecTickets[0]?.premierTicket ?? null,
        dernierTicket: derniere?.dernierTicket ?? null,
        hashDernierTicket: derniere?.hashDernierTicket ?? null,
        dernierTicketCouvert: reference?.dernierTicketCouvert ?? 0,
        cloturesAgregees: sources.map((c) => c.numero),
        ...(await this.plageEvenements(lot, periode)),
        grandTotalPerpetuel: reference?.grandTotalPerpetuel ?? 0,
        cumulPerpetuelAbsolu: reference?.cumulPerpetuelAbsolu ?? 0,
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
