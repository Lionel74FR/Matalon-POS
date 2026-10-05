import { canonique, sha256Hex } from "@matalon/noyau-fiscal";

export type Role = "serveur" | "responsable";

export interface Utilisateur {
  id: string;
  nom: string;
  role: Role;
  /** Empreinte du code PIN, jamais le code lui-même. */
  pinHash: string;
  actif: boolean;
}

export interface Table {
  id: string;
  nom: string;
  zone: string;
}

export interface Etablissement {
  enseigne: string;
  raisonSociale: string;
  adresse: string;
  codePostalVille: string;
  telephone: string;
  siret: string;
  tvaIntracom: string;
}

export interface Configuration {
  etablissementId: string;
  caisseId: string;
  installeeLe: string;
  etablissement: Etablissement;
  utilisateurs: Utilisateur[];
  tables: Table[];
  imprimante: {
    /** Adresse IP de l'imprimante Epson (ePOS-Print), ex. 192.168.1.50. */
    adresse: string;
    /** Retire les accents si l'imprimante les affiche mal. */
    sansAccents: boolean;
  };
  /** Montant TTC à partir duquel la note est imprimée d'office (centimes). */
  seuilNoteAutomatique: number;
}

export const ID_COMPTOIR = "comptoir";

export async function hacherPin(utilisateurId: string, pin: string): Promise<string> {
  return sha256Hex(`matalon-pos:${utilisateurId}:${pin}`);
}

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
