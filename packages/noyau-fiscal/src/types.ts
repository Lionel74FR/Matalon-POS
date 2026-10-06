/**
 * Types du noyau fiscal.
 *
 * Conventions :
 * - tous les montants sont des entiers en centimes d'euro ;
 * - les taux de TVA sont en points de base (1000 = 10 %, 2000 = 20 %) ;
 * - les horodatages sont des chaînes ISO 8601 en UTC ;
 * - les dates comptables sont des chaînes AAAA-MM-JJ en heure de Paris.
 */

/** Centimes d'euro (entier, signé). */
export type Centimes = number;

/** Taux de TVA en points de base : 550, 1000, 2000… */
export type TauxTVA = number;

export type ModePaiement =
  | "CB"
  | "ESPECES"
  | "TITRE_RESTAURANT_PAPIER"
  | "TITRE_RESTAURANT_CARTE"
  /**
   * Vente portée au compte d'un client (ardoise) : rien n'est encaissé. La
   * vente compte dans le chiffre du jour ; la TVA n'est exigible qu'au
   * règlement (ventes à consommer sur place = prestations de services,
   * BOI-TVA-BASE-20-20 § 130). Depuis 0.5.0.
   */
  | "EN_COMPTE"
  | "AUTRE";

export const MODES_PAIEMENT: readonly ModePaiement[] = [
  "CB",
  "ESPECES",
  "TITRE_RESTAURANT_PAPIER",
  "TITRE_RESTAURANT_CARTE",
  "EN_COMPTE",
  "AUTRE",
];

/** Client débiteur, désigné par un identifiant stable et son nom (aucune autre donnée personnelle). */
export interface ClientCompte {
  id: string;
  nom: string;
}

/** Part d'une vente en compte soldée par un règlement. */
export interface ImputationReglement {
  /** Caisse qui a enregistré la vente (le règlement peut être reçu sur une autre caisse). */
  caisseId: string;
  numero: number;
  hash: string;
  montantTTC: Centimes;
  /** Total de la vente, et ce qui en était déjà encaissé (part payée à la vente et règlements antérieurs). */
  venteTotalTTC: Centimes;
  encaisseAvantTTC: Centimes;
  /** TVA devenue exigible : tranche de la ventilation de la vente (`ventilerTranche`). */
  ventilationTVA: VentilationTVA[];
}

/** Identifie le poste d'encaissement qui produit les enregistrements. */
export interface ContexteCaisse {
  /** Établissement (ex. "moka"). */
  etablissementId: string;
  /** Poste d'encaissement (un iPad = une caisse = une chaîne). */
  caisseId: string;
}

/** Ligne saisie par la caisse, avant calcul. */
export interface SaisieLigne {
  articleId: string;
  libelle: string;
  /** Entier strictement positif. */
  quantite: number;
  prixUnitaireTTC: Centimes;
  tauxTVA: TauxTVA;
  /** Remise TTC appliquée à la ligne (offert = montant total de la ligne). */
  remise?: { montantTTC: Centimes; motif: string };
}

export interface LigneTicket {
  articleId: string;
  libelle: string;
  /** Négative sur un ticket d'annulation. */
  quantite: number;
  prixUnitaireTTC: Centimes;
  tauxTVA: TauxTVA;
  /** Remise TTC (positive sur une vente, négative sur une annulation). */
  remiseTTC: Centimes;
  motifRemise: string | null;
  /** quantite × prixUnitaireTTC − remiseTTC */
  montantTTC: Centimes;
}

export interface Paiement {
  mode: ModePaiement;
  montant: Centimes;
}

export interface VentilationTVA {
  tauxTVA: TauxTVA;
  baseHT: Centimes;
  montantTVA: Centimes;
  montantTTC: Centimes;
}

export type Chaine = "tickets" | "evenements" | "clotures";

/** Champs communs à tout enregistrement chaîné. */
export interface Scellement {
  /** Empreinte SHA-256 (hex) de l'enregistrement précédent de la même chaîne. */
  hashPrecedent: string;
  /** Empreinte SHA-256 (hex) du contenu canonique de cet enregistrement (hors hash et signature). */
  hash: string;
  /** Signature ECDSA P-256 (base64) de `hash`. */
  signature: string;
  /** Identifiant de la clé de signature de la caisse. */
  cleId: string;
}

export interface EnTeteEnregistrement extends ContexteCaisse {
  /** Numéro séquentiel par caisse et par chaîne, sans trou, à partir de 1. */
  numero: number;
  horodatage: string;
  versionLogiciel: string;
}

export interface Ticket extends EnTeteEnregistrement, Scellement {
  /**
   * REGLEMENT (depuis 0.5.0) : encaissement d'une dette client, sans vente
   * (aucune ligne, totaux à zéro) ; le montant et la TVA exigible sont dans
   * `reglement`. Une ANNULATION d'un règlement en est le miroir négatif.
   */
  type: "VENTE" | "ANNULATION" | "REGLEMENT";
  dateComptable: string;
  operateurId: string;
  tableId: string | null;
  couverts: number | null;
  lignes: LigneTicket[];
  ventilationTVA: VentilationTVA[];
  totalHT: Centimes;
  totalTVA: Centimes;
  totalTTC: Centimes;
  paiements: Paiement[];
  renduMonnaie: Centimes;
  /** Ticket annulé (ANNULATION uniquement). */
  ticketOrigine: { numero: number; hash: string } | null;
  motif: string | null;
  /** Client débiteur : vente en compte, son annulation, ou règlement. Absent sinon. */
  client?: ClientCompte;
  /** REGLEMENT, ou son annulation (montants négatifs). */
  reglement?: { montantTTC: Centimes; imputations: ImputationReglement[]; ventilationTVA: VentilationTVA[] };
  /** Somme signée de tous les totaux TTC de la caisse depuis l'origine, ce ticket inclus. */
  grandTotalPerpetuel: Centimes;
  /** Somme des valeurs absolues de tous les totaux TTC depuis l'origine, ce ticket inclus. */
  cumulPerpetuelAbsolu: Centimes;
}

export type CodeEvenement =
  | "INITIALISATION_CAISSE"
  | "CONNEXION"
  | "DECONNEXION"
  | "REMISE"
  | "ANNULATION"
  | "IMPRESSION_TICKET"
  | "REIMPRESSION_TICKET"
  /** Article retiré d'une commande ouverte avant encaissement. */
  | "SUPPRESSION_LIGNE"
  /** Addition (note provisoire) imprimée avant encaissement. */
  | "IMPRESSION_ADDITION"
  | "OUVERTURE_TIROIR"
  /** Fond de caisse déclaré à l'ouverture de la journée. */
  | "FOND_DE_CAISSE"
  /** Comptage des espèces et rapprochement CB / TPE avant la clôture Z, écarts motivés. */
  | "COMPTAGE_CAISSE"
  /** Facture émise sur demande à partir d'un ticket ; le journal garantit sa numérotation sans trou. */
  | "FACTURE"
  /** Commande ouverte déplacée vers une autre table, ou fusionnée avec elle. */
  | "TRANSFERT_TABLE"
  /** Règlement reçu d'un client débiteur (le ticket REGLEMENT porte le détail). Depuis 0.5.0. */
  | "REGLEMENT_COMPTE"
  | "LECTURE_X"
  | "CLOTURE"
  | "ARCHIVAGE"
  | "EXPORT"
  | "HORLOGE_INCOHERENTE"
  | "MISE_A_JOUR_LOGICIEL"
  | "ANOMALIE";

export interface Evenement extends EnTeteEnregistrement, Scellement {
  code: CodeEvenement;
  operateurId: string | null;
  /** Données complémentaires, sérialisables en JSON. */
  details: Record<string, string | number | boolean | null>;
}

export type PeriodeCloture = "JOUR" | "MOIS" | "EXERCICE";

export interface TotauxPeriode {
  nbVentes: number;
  nbAnnulations: number;
  totalHT: Centimes;
  totalTVA: Centimes;
  totalTTC: Centimes;
  ventilationTVA: VentilationTVA[];
  /**
   * Encaissements nets par mode (espèces nettes du rendu monnaie), règlements
   * de comptes clients compris ; EN_COMPTE = ventes portées en compte.
   */
  paiements: Paiement[];
  totalRemisesTTC: Centimes;
  /**
   * Comptes clients (depuis 0.5.0), présent seulement si la période en compte :
   * ventes portées en compte, règlements reçus, et TVA exigible de la période
   * (TVA des sommes réellement encaissées, ventes et règlements).
   */
  comptesClients?: {
    ventesEnCompteTTC: Centimes;
    nbReglements: number;
    reglementsTTC: Centimes;
    ventilationTVAExigible: VentilationTVA[];
  };
}

export interface Cloture extends EnTeteEnregistrement, Scellement, TotauxPeriode {
  periode: PeriodeCloture;
  /** "2026-10-15" pour un jour, "2026-10" pour un mois, "2026" pour un exercice. */
  identifiantPeriode: string;
  operateurId: string;
  /** Plage de tickets couverte (null si aucun ticket). */
  premierTicket: number | null;
  dernierTicket: number | null;
  /** Empreinte du dernier ticket couvert : lie la clôture à la chaîne des tickets. */
  hashDernierTicket: string | null;
  /**
   * Plus haut numéro de ticket couvert par les clôtures journalières à ce
   * jour (une Z à zéro reprend celui de la précédente). Les tickets suivants
   * sont ceux qui restent à clôturer.
   */
  dernierTicketCouvert: number;
  /** Clôtures de niveau inférieur agrégées (MOIS et EXERCICE). */
  cloturesAgregees: number[];
  /** Plage du journal des événements couverte, pour l'archivage. */
  premierEvenement: number | null;
  dernierEvenement: number | null;
  hashDernierEvenement: string | null;
  grandTotalPerpetuel: Centimes;
  cumulPerpetuelAbsolu: Centimes;
}

export type Enregistrement = Ticket | Evenement | Cloture;

export class ErreurFiscale extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ErreurFiscale";
  }
}
