import type { Catalogue } from "@matalon/catalogue";
import type { ClientApi, Derniers, EtablissementApi, ReponseComptes, IdentiteEtablissement, ReponseCarte, ResumeCarte, Role, Table, UtilisateurApi } from "@matalon/serveur/partage";

export interface ResumeCloture {
  numero: number;
  periode: "JOUR" | "MOIS" | "EXERCICE";
  identifiantPeriode: string;
  horodatage: string;
  totalTTC: number;
  nbVentes: number;
}

export interface CaisseAdmin {
  id: string;
  nom: string;
  appareil: string;
  rattacheeLe: string;
  derniereSynchro: string | null;
  revoqueeLe: string | null;
  divergence: string | null;
  /** Empreinte de la clé de signature enregistrée au rattachement (comparable à celle des réglages de l'iPad). */
  empreinteCle: string;
  derniers: Derniers;
}

export interface EtablissementAdmin extends EtablissementApi {
  utilisateurs: UtilisateurApi[];
  codes: Array<{ code: string; nomCaisse: string; expireLe: string }>;
  caisses: CaisseAdmin[];
}

export interface RapportVerification {
  integre: boolean;
  anomalies: Array<{ chaine?: string; numero?: number; code: string; detail?: string }>;
  compteurs: Record<string, number>;
}

export class ErreurAdmin extends Error {
  constructor(
    readonly statut: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function appel<T>(methode: string, chemin: string, corps?: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`/api/admin${chemin}`, {
      method: methode,
      credentials: "same-origin",
      headers: corps === undefined ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" },
      body: corps === undefined ? undefined : JSON.stringify(corps),
      cache: "no-store",
    });
  } catch {
    throw new ErreurAdmin(0, "HORS_LIGNE", "Serveur injoignable : vérifiez la connexion Internet.");
  }
  const donnees = (await r.json().catch(() => null)) as { code?: string; message?: string } | null;
  if (!r.ok) throw new ErreurAdmin(r.status, donnees?.code ?? "ERREUR", donnees?.message ?? `Erreur du serveur (${r.status}).`);
  return donnees as T;
}

export const api = {
  statut: () => appel<{ initialise: boolean; connecte: boolean; identifiant: string | null }>("GET", "/statut"),
  initialiser: (identifiant: string, motDePasse: string) =>
    appel<{ secret: string; otpauth: string }>("POST", "/initialiser", { identifiant, motDePasse }),
  confirmer: (identifiant: string, motDePasse: string, code: string) => appel("POST", "/confirmer", { identifiant, motDePasse, code }),
  connexion: (identifiant: string, motDePasse: string, code: string) => appel("POST", "/connexion", { identifiant, motDePasse, code }),
  deconnexion: () => appel("POST", "/deconnexion", {}),
  etablissements: () => appel<{ etablissements: EtablissementAdmin[]; cartes: Array<{ id: string; nom: string }> }>("GET", "/etablissements"),
  creerEtablissement: (corps: { id: string; identite: Partial<IdentiteEtablissement>; carteId: string; tables: Table[]; seuilNote: number }) =>
    appel("POST", "/etablissements", corps),
  modifierEtablissement: (id: string, corps: { identite: IdentiteEtablissement; carteId: string; tables: Table[]; seuilNote: number }) =>
    appel("PUT", `/etablissements/${id}`, corps),
  enregistrerUtilisateur: (etablissementId: string, corps: { id?: string; nom: string; role: Role; pin?: string; actif: boolean }) =>
    appel("POST", `/etablissements/${etablissementId}/utilisateurs`, corps),
  genererCode: (etablissementId: string, nomCaisse: string) =>
    appel<{ code: string; expireLe: string; nomCaisse: string }>("POST", `/etablissements/${etablissementId}/codes`, { nomCaisse }),
  revoquer: (caisseId: string) => appel("POST", `/caisses/${caisseId}/revoquer`, {}),
  verifier: (caisseId: string) => appel<RapportVerification>("GET", `/caisses/${caisseId}/verification`),
  cartes: () => appel<{ cartes: ResumeCarte[] }>("GET", "/cartes"),
  carte: (id: string) => appel<ReponseCarte>("GET", `/cartes/${id}`),
  enregistrerCarte: (id: string, carte: Catalogue, version: number) => appel<ReponseCarte>("PUT", `/cartes/${id}`, { carte, version }),
  creerCarte: (corps: { id: string; nom: string; depuis?: string }) => appel<ReponseCarte>("POST", "/cartes", corps),
  comptes: (etablissementId: string) => appel<ReponseComptes>("GET", `/etablissements/${etablissementId}/comptes`),
  enregistrerClient: (etablissementId: string, client: ClientApi) =>
    appel<{ client: ClientApi }>("PUT", `/etablissements/${etablissementId}/clients`, client),
  clotures: (caisseId: string) => appel<{ clotures: ResumeCloture[] }>("GET", `/caisses/${caisseId}/clotures`),
  urlArchive: (caisseId: string, numero: number) => `/api/admin/caisses/${caisseId}/clotures/${numero}/archive.json`,
  urlCsv: (caisseId: string) => `/api/admin/caisses/${caisseId}/clotures.csv`,
  urlJournal: (caisseId: string) => `/api/admin/caisses/${caisseId}/journal.json`,
};
