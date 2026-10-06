/**
 * Contrat d'API partagé entre le serveur, la caisse et l'administration.
 * Ce module ne dépend d'aucune bibliothèque serveur : la caisse l'importe.
 */
import type { Catalogue } from "@matalon/catalogue";
import type { Chaine, Enregistrement } from "@matalon/noyau-fiscal";

export type Role = "serveur" | "responsable";

export interface IdentiteEtablissement {
  enseigne: string;
  raisonSociale: string;
  adresse: string;
  codePostalVille: string;
  telephone: string;
  siret: string;
  tvaIntracom: string;
  /** Forme juridique, capital, RCS : mentions exigées sur les factures (ex. « SAS au capital de 10 000 € · RCS Annecy 123 456 789 »). */
  mentionsLegales: string;
}

export interface Table {
  id: string;
  nom: string;
  zone: string;
}

export interface EtablissementApi {
  id: string;
  identite: IdentiteEtablissement;
  carteId: string;
  /** Version de la carte : la caisse la télécharge quand elle change. */
  carteVersion: number;
  tables: Table[];
  /** Montant TTC (centimes) à partir duquel la note est imprimée d'office. */
  seuilNote: number;
}

export interface UtilisateurApi {
  id: string;
  nom: string;
  role: Role;
  pinHash: string;
  actif: boolean;
}

export interface Queue {
  numero: number;
  hash: string;
}

export type Derniers = Record<Chaine, Queue | null>;

export interface ReponseRattachement {
  jeton: string;
  caisse: { id: string; nom: string };
  etablissement: EtablissementApi;
  utilisateurs: UtilisateurApi[];
}

export interface ReponseEtat {
  caisse: { id: string; nom: string };
  etablissement: EtablissementApi;
  utilisateurs: UtilisateurApi[];
  derniers: Derniers;
  /** Heure du serveur (ISO), pour contrôler l'horloge de l'iPad. */
  heure: string;
}

export interface EntreeSynchro {
  chaine: Chaine;
  enregistrement: Enregistrement;
}

export interface ReponseSynchro {
  acceptes: number;
  derniers: Derniers;
}

export interface ReponseCarte {
  carte: Catalogue;
  version: number;
}

export interface ResumeCarte {
  id: string;
  nom: string;
  version: number;
  majLe: string;
  majPar: string | null;
  nbArticles: number;
  etablissements: string[];
}

export interface ErreurApi {
  code: string;
  message: string;
}

/** Codes de rattachement : 8 caractères sans lettres ambiguës, groupés par 4 à l'affichage. */
export const ALPHABET_CODE = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function normaliserCode(saisie: string): string {
  return saisie
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/O/g, "0")
    .replace(/I/g, "1");
}

export function afficherCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

async function sha256Hex(texte: string): Promise<string> {
  const empreinte = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texte));
  return [...new Uint8Array(empreinte)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Empreinte d'un code PIN, liée à l'utilisateur. Le code lui-même n'est jamais stocké. */
export function hacherPin(utilisateurId: string, pin: string): Promise<string> {
  return sha256Hex(`matalon-pos:${utilisateurId}:${pin}`);
}

export const PIN_VALIDE = /^\d{4}$/;
export const ID_ETABLISSEMENT_VALIDE = /^[a-z0-9][a-z0-9-]{1,40}$/;
