import { canonique, sha256Hex } from "@matalon/noyau-fiscal";
import type { IdentiteEtablissement, ReponseEtat, Role, Table, UtilisateurApi } from "@matalon/serveur/partage";

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
  /** Identifiant de la carte de l'établissement (voir `CARTES`). */
  carteId: string;
  imprimante: {
    /** Adresse IP de l'imprimante Epson (ePOS-Print), ex. 192.168.1.50. */
    adresse: string;
    /** Retire les accents si l'imprimante les affiche mal. */
    sansAccents: boolean;
  };
  /** Montant TTC à partir duquel la note est imprimée d'office (centimes). */
  seuilNoteAutomatique: number;
}

/** Applique le référentiel reçu du serveur ; renvoie `null` si rien n'a changé. */
export function fusionnerReferentiel(config: Configuration, etat: Pick<ReponseEtat, "caisse" | "etablissement" | "utilisateurs">): Configuration | null {
  const suivante: Configuration = {
    ...config,
    caisseNom: etat.caisse.nom,
    etablissement: etat.etablissement.identite,
    utilisateurs: etat.utilisateurs,
    tables: etat.etablissement.tables,
    carteId: etat.etablissement.carteId,
    seuilNoteAutomatique: etat.etablissement.seuilNote,
  };
  return canonique(suivante) === canonique(config) ? null : suivante;
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
