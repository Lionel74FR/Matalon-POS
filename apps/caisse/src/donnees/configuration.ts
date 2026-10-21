import { canonique, sha256Hex } from "@matalon/noyau-fiscal";
import { CARTES, type Catalogue } from "@matalon/catalogue";
import type { ProgrammeCaisse } from "@matalon/serveur/fidelite";
import type { ClientApi, IdentiteEtablissement, ImprimanteReseau, PostesProduction, ReponseEtat, Role, Table, UtilisateurApi, ZonePlan } from "@matalon/serveur/partage";

export type { Role, Table };
export type Utilisateur = UtilisateurApi;
export type Etablissement = IdentiteEtablissement;

/**
 * Configuration locale de la caisse. L'établissement, l'équipe, les tables, le
 * seuil et la carte viennent du serveur (référentiel du groupe) et sont gardés
 * ici pour fonctionner hors ligne. L'imprimante des tickets est celle de l'établissement,
 * sauf si cet appareil en a une à lui.
 */
export interface Configuration {
  etablissementId: string;
  caisseId: string;
  /** Nom donné à cet iPad dans l'administration (« Comptoir », « Terrasse »…). */
  caisseNom: string;
  installeeLe: string;
  etablissement: Etablissement;
  utilisateurs: Utilisateur[];
  tables: Table[];
  /** Identifiant de la carte de l'établissement. */
  carteId: string;
  /** Carte reçue du serveur (éditée dans l'administration) et sa version. */
  carte?: Catalogue;
  carteVersion?: number;
  /** Imprimante propre à cet appareil ; adresse vide = celle de l'établissement (`imprimanteEtablissement`). */
  imprimante: {
    /** Adresse IP de l'imprimante Epson (ePOS-Print), ex. 192.168.1.50. */
    adresse: string;
    /** Retire les accents si l'imprimante les affiche mal. */
    sansAccents: boolean;
  };
  /** Montant TTC à partir duquel la note est due au client, imprimée d'office sauf `noteAutomatique` faux (centimes). */
  seuilNoteAutomatique: number;
  /** Faux : la note n'est plus imprimée d'office ; la caisse rappelle de la remettre (papier ou QR code). */
  noteAutomatique?: boolean;
  /**
   * Clients des comptes (ardoises) : ceux du serveur, plus ceux créés ici et
   * pas encore connus du serveur (il les apprend par le ticket en compte).
   */
  clients?: ClientApi[];
  /** Imprimantes de production de l'établissement : poste de la carte → imprimante. */
  postesProduction?: PostesProduction;
  /** Imprimante des tickets commune à l'établissement (reçue du serveur). */
  imprimanteEtablissement?: ImprimanteReseau | null;
  /** Dernière imprimante utilisée par cet appareil : survit à un retrait, pour la rétablir d'un toucher. */
  imprimanteConnue?: ImprimanteReseau;
  /** Appareils en service de l'établissement, au dernier contact avec le serveur (clôture hors ligne d'un appareil seul). */
  appareils?: Record<string, string>;
  /** Plan de salle : zones dimensionnées et décor (les tables sont dans `tables`) et sa version. */
  zones?: ZonePlan[];
  planVersion?: number;
  /** Programme de fidélité de l'établissement (lot 7a) ; null ou absent : la caisse ne propose pas la fidélité. */
  fidelite?: ProgrammeCaisse | null;
}

/** Applique le référentiel reçu du serveur ; renvoie `null` si rien n'a changé. */
export function fusionnerReferentiel(
  config: Configuration,
  etat: Pick<ReponseEtat, "caisse" | "etablissement" | "utilisateurs" | "clients" | "appareils" | "fidelite">,
): Configuration | null {
  const serveur = etat.clients;
  const clients = serveur
    ? [...serveur, ...(config.clients ?? []).filter((c) => !serveur.some((s) => s.id === c.id))]
    : config.clients;
  const suivante: Configuration = {
    ...config,
    ...(clients ? { clients } : {}),
    caisseNom: etat.caisse.nom,
    etablissement: etat.etablissement.identite,
    utilisateurs: etat.utilisateurs,
    tables: etat.etablissement.tables,
    // La carte (et son identifiant) ne change qu'une fois la nouvelle carte téléchargée.
    seuilNoteAutomatique: etat.etablissement.seuilNote,
    ...(etat.etablissement.noteAutomatique !== undefined ? { noteAutomatique: etat.etablissement.noteAutomatique } : {}),
    ...(etat.etablissement.postesProduction ? { postesProduction: etat.etablissement.postesProduction } : {}),
    ...(etat.etablissement.imprimanteTickets !== undefined ? { imprimanteEtablissement: etat.etablissement.imprimanteTickets } : {}),
    ...(etat.etablissement.imprimanteTickets?.adresse && !config.imprimante.adresse ? { imprimanteConnue: etat.etablissement.imprimanteTickets } : {}),
    ...(etat.etablissement.zones ? { zones: etat.etablissement.zones, planVersion: etat.etablissement.planVersion ?? 0 } : {}),
    ...(etat.appareils ? { appareils: etat.appareils } : {}),
    ...(etat.fidelite !== undefined ? { fidelite: etat.fidelite } : {}),
  };
  return canonique(suivante) === canonique(config) ? null : suivante;
}

/** Retient l'imprimante en service, pour pouvoir la rétablir si elle est retirée. */
export function retenirImprimante(config: Configuration): Configuration {
  const i = imprimanteDe(config);
  return i ? { ...config, imprimanteConnue: { adresse: i.adresse, sansAccents: i.sansAccents } } : config;
}

/** Imprimante des tickets utilisée par cet appareil : la sienne, sinon celle de l'établissement. */
export function imprimanteDe(config: Configuration): (ImprimanteReseau & { source: "appareil" | "etablissement" }) | null {
  if (config.imprimante.adresse.trim()) return { ...config.imprimante, source: "appareil" };
  if (config.imprimanteEtablissement?.adresse) return { ...config.imprimanteEtablissement, source: "etablissement" };
  return null;
}

/**
 * Carte utilisée pour vendre : la dernière reçue du serveur, même si une
 * nouvelle est annoncée et pas encore téléchargée (hors ligne, on continue
 * de vendre). La carte livrée avec l'application ne sert qu'avant la première réception.
 */
export function carteDe(config: Configuration): Catalogue | undefined {
  return config.carte ?? CARTES[config.carteId];
}

/** Vrai quand la caisse doit télécharger la carte (nouvelle version ou autre carte). */
export function carteATelecharger(config: Configuration, etat: Pick<ReponseEtat, "etablissement">): boolean {
  return config.carte?.id !== etat.etablissement.carteId || config.carteVersion !== etat.etablissement.carteVersion;
}

export const ID_COMPTOIR = "comptoir";

export { hacherPin } from "@matalon/serveur/partage";
import { hacherPin } from "@matalon/serveur/partage";

export async function verifierPin(u: Utilisateur, pin: string): Promise<boolean> {
  return u.actif && (await hacherPin(u.id, pin)) === u.pinHash;
}

export function genererTables(nombre: number, terrasse = 0): Table[] {
  return [
    ...Array.from({ length: nombre }, (_, i) => ({ id: `t${i + 1}`, nom: `${i + 1}`, zone: "Salle" })),
    ...Array.from({ length: terrasse }, (_, i) => ({ id: `ter${i + 1}`, nom: `T${i + 1}`, zone: "Terrasse" })),
  ];
}

export function identifiantAleatoire(prefixe: string): string {
  const octets = crypto.getRandomValues(new Uint8Array(4));
  return `${prefixe}-${[...octets].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export async function empreinteCle(jwk: JsonWebKey): Promise<string> {
  return sha256Hex(canonique({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y }));
}
