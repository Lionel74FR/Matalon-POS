import type { Catalogue } from "@matalon/catalogue";
import type { ArticleFournisseur, PrixAchat, Produit, Recette } from "@matalon/stock";
import type { ReglagesReservation, Reservation } from "@matalon/reservations";
import type { AlerteApi, ClientApi, Derniers, EtablissementApi, ReponseComptes, IdentiteEtablissement, PostesProduction, CleApi, DocumentStock, EtatStock, LigneFactureApi, MouvementApi, RapportFoodCost, ReponseCarte, ReponseImport, ReponseStock, ReponseVentesCarte, ResumeCarte, Role, Table, UtilisateurApi, ZonePlan } from "@matalon/serveur/partage";

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
  /** Deux clôtures faites depuis la même précédente (noyau 0.7.0). */
  anomalieCloture: string | null;
  /** Alertes pas encore vues (prix, article hors carte, code PIN bloqué). */
  alertesNonVues: number;
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
  modifierEtablissement: (id: string, corps: { identite: IdentiteEtablissement; carteId: string; seuilNote: number }) =>
    appel("PUT", `/etablissements/${id}`, corps),
  enregistrerUtilisateur: (etablissementId: string, corps: { id?: string; nom: string; role: Role; pin?: string; actif: boolean }) =>
    appel("POST", `/etablissements/${etablissementId}/utilisateurs`, corps),
  genererCode: (etablissementId: string, nomCaisse: string) =>
    appel<{ code: string; expireLe: string; nomCaisse: string }>("POST", `/etablissements/${etablissementId}/codes`, { nomCaisse }),
  revoquer: (caisseId: string) => appel("POST", `/caisses/${caisseId}/revoquer`, {}),
  verifier: (caisseId: string) => appel<RapportVerification>("GET", `/caisses/${caisseId}/verification`),
  alertes: (etablissementId: string, toutes = false) => appel<{ alertes: AlerteApi[] }>("GET", `/etablissements/${etablissementId}/alertes${toutes ? "?toutes=1" : ""}`),
  marquerAlerteVue: (id: string) => appel("POST", `/alertes/${id}/vue`, {}),
  verifierEtablissement: (etablissementId: string) => appel<RapportVerification>("GET", `/etablissements/${etablissementId}/verification`),
  cartes: () => appel<{ cartes: ResumeCarte[] }>("GET", "/cartes"),
  carte: (id: string) => appel<ReponseCarte>("GET", `/cartes/${id}`),
  enregistrerCarte: (id: string, carte: Catalogue, version: number) => appel<ReponseCarte>("PUT", `/cartes/${id}`, { carte, version }),
  creerCarte: (corps: { id: string; nom: string; depuis?: string }) => appel<ReponseCarte>("POST", "/cartes", corps),
  enregistrerPlan: (etablissementId: string, plan: { zones: ZonePlan[]; tables: Table[]; version: number }) =>
    appel<{ etablissement: EtablissementApi }>("PUT", `/etablissements/${etablissementId}/plan`, plan),
  enregistrerPostes: (etablissementId: string, postes: PostesProduction) =>
    appel<{ etablissement: EtablissementApi }>("PUT", `/etablissements/${etablissementId}/postes`, { postes }),
  comptes: (etablissementId: string) => appel<ReponseComptes>("GET", `/etablissements/${etablissementId}/comptes`),
  enregistrerClient: (etablissementId: string, client: ClientApi) =>
    appel<{ client: ClientApi }>("PUT", `/etablissements/${etablissementId}/clients`, client),
  clotures: (caisseId: string) => appel<{ clotures: ResumeCloture[] }>("GET", `/caisses/${caisseId}/clotures`),
  ventesCarte: (id: string) => appel<ReponseVentesCarte>("GET", `/cartes/${id}/ventes`),
  stock: () => appel<ReponseStock>("GET", "/stock"),
  enregistrerProduit: (produit: Produit) => appel<ReponseStock>("PUT", `/stock/produits/${produit.id}`, { produit }),
  enregistrerArticleFournisseur: (article: ArticleFournisseur) => appel<ReponseStock>("PUT", `/stock/articles/${article.id}`, { article }),
  enregistrerRecette: (recette: Recette) => appel<ReponseStock>("PUT", `/stock/recettes/${recette.id}`, { recette }),
  enregistrerPrix: (articleId: string, etablissementId: string, prixHT: number) => appel<ReponseStock>("POST", "/stock/prix", { articleId, etablissementId, prixHT }),
  historiquePrix: (articleId: string) => appel<{ prix: Array<PrixAchat & { par: string | null }> }>("GET", `/stock/prix/${articleId}`),
  importerStock: (etablissementId: string, tableau: string[][], simuler: boolean) => appel<ReponseImport>("POST", "/stock/import", { etablissementId, tableau, simuler }),
  etatStock: (etab: string) => appel<EtatStock>("GET", `/stock/etat?etab=${etab}`),
  mouvementsStock: (etab: string, f: { du?: string; au?: string; produit?: string; type?: string } = {}) =>
    appel<{ mouvements: MouvementApi[] }>("GET", `/stock/mouvements?${new URLSearchParams({ etab, ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)) })}`),
  documentsStock: (etab: string, type?: string) => appel<{ documents: DocumentStock[] }>("GET", `/stock/documents?etab=${etab}${type ? `&type=${type}` : ""}`),
  operationStock: (type: "receptions" | "inventaires" | "pertes" | "transferts", corps: Record<string, unknown>) =>
    appel<{ document: DocumentStock; etat: EtatStock }>("POST", `/stock/${type}`, corps),
  annulerReception: (etablissementId: string, id: string) => appel<{ etat: EtatStock }>("POST", `/stock/receptions/${id}/annuler`, { etablissementId }),
  recalculerConsommation: (etablissementId: string, du: string, au: string) => appel<{ mouvements: number }>("POST", "/stock/consommation", { etablissementId, du, au }),
  foodCost: (etab: string, du: string, au: string) => appel<RapportFoodCost>("GET", `/stock/food-cost?etab=${etab}&du=${du}&au=${au}`),
  clesApi: () => appel<{ cles: CleApi[] }>("GET", "/stock/cles"),
  creerCleApi: (nom: string) => appel<{ id: string; cle: string }>("POST", "/stock/cles", { nom }),
  revoquerCleApi: (id: string) => appel("POST", `/stock/cles/${id}/revoquer`, {}),
  lignesFacture: (etab: string, toutes = false) => appel<{ lignes: LigneFactureApi[] }>("GET", `/stock/factures?etab=${etab}${toutes ? "&toutes=1" : ""}`),
  rapprocherLigne: (id: number, articleId: string | null) =>
    appel<{ stock: ReponseStock }>("POST", `/stock/factures/${id}/${articleId ? "rapprocher" : "ignorer"}`, articleId ? { articleId } : {}),
  reglagesReservation: (etab: string) =>
    appel<{ reglages: ReglagesReservation; version: number; envoi: boolean }>("GET", `/etablissements/${etab}/reservations/reglages`),
  essaiEmailReservation: (etab: string) => appel<{ a: string; de: string | null }>("POST", `/etablissements/${etab}/reservations/essai-email`, {}),
  enregistrerReglagesReservation: (etab: string, reglages: ReglagesReservation, version: number) =>
    appel<{ reglages: ReglagesReservation; version: number }>("PUT", `/etablissements/${etab}/reservations/reglages`, { reglages, version }),
  reservations: (etab: string, du: string, au = du) => appel<{ reservations: Reservation[] }>("GET", `/etablissements/${etab}/reservations?du=${du}&au=${au}`),
  creerReservation: (etab: string, corps: Record<string, unknown>) =>
    appel<{ reservation: Reservation; conflits: Reservation[] }>("POST", `/etablissements/${etab}/reservations`, corps),
  modifierReservation: (etab: string, id: string, corps: Record<string, unknown>) =>
    appel<{ reservation: Reservation; conflits: Reservation[] }>("PATCH", `/etablissements/${etab}/reservations/${id}`, corps),
  urlArchive: (caisseId: string, numero: number) => `/api/admin/caisses/${caisseId}/clotures/${numero}/archive.json`,
  urlCsv: (caisseId: string) => `/api/admin/caisses/${caisseId}/clotures.csv`,
  urlJournal: (caisseId: string) => `/api/admin/caisses/${caisseId}/journal.json`,
};
