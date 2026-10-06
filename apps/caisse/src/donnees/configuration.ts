import { canonique, sha256Hex } from "@matalon/noyau-fiscal";
import { CARTES, type Catalogue } from "@matalon/catalogue";
import type { ClientApi, IdentiteEtablissement, PostesProduction, ReponseEtat, Role, Table, UtilisateurApi } from "@matalon/serveur/partage";

export type { Role, Table };
export type Utilisateur = UtilisateurApi;
export type Etablissement = IdentiteEtablissement;

/**
 * Configuration locale de la caisse. L'établissement, l'équipe, les tables, le
 * seuil et la carte viennent du serveur (référentiel du groupe) et sont gardés
 * ici pour fonctionner hors ligne. Seule l'imprimante est propre à l'iPad.
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
  imprimante: {
    /** Adresse IP de l'imprimante Epson (ePOS-Print), ex. 192.168.1.50. */
    adresse: string;
    /** Retire les accents si l'imprimante les affiche mal. */
    sansAccents: boolean;
  };
  /** Montant TTC à partir duquel la note est imprimée d'office (centimes). */
  seuilNoteAutomatique: number;
  /**
   * Clients des comptes (ardoises) : ceux du serveur, plus ceux créés ici et
   * pas encore connus du serveur (il les apprend par le ticket en compte).
   */
  clients?: ClientApi[];
  /** Imprimantes de production de l'établissement : poste de la carte → imprimante. */
  postesProduction?: PostesProduction;
}

/** Applique le référentiel reçu du serveur ; renvoie `null` si rien n'a changé. */
export function fusionnerReferentiel(
  config: Configuration,
  etat: Pick<ReponseEtat, "caisse" | "etablissement" | "utilisateurs" | "clients">,
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
    ...(etat.etablissement.postesProduction ? { postesProduction: etat.etablissement.postesProduction } : {}),
  };
  return canonique(suivante) === canonique(config) ? null : suivante;
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
