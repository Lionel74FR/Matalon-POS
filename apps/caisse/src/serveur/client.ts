import type { Ticket } from "@matalon/noyau-fiscal";
import type {
  DocumentStock,
  EtatStock,
  ReponseStockCaisse,
  ClientApi as FicheClient,
  EntreeSynchro,
  ReponseComptes,
  ReponseTickets,
  ReponseClotures,
  ReponseJournee,
  ReponseStatistiques,
  EtablissementApi,
  IdentiteEtablissement,
  PostesProduction,
  ReponseEtat,
  ReponseCarte,
  ReponseRattachement,
  ReponseSynchro,
  Table,
  UtilisateurApi,
  ZonePlan,
} from "@matalon/serveur/partage";

/** Erreur renvoyée par le serveur, ou `HORS_LIGNE` quand il n'a pas pu être joint. */
export class ErreurApi extends Error {
  constructor(
    readonly statut: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ErreurApi";
  }
}

export type Fetch = (entree: string, init?: RequestInit) => Promise<Response>;

/** Client de l'API Matalon POS. Par défaut, le serveur est à la même adresse que la caisse. */
export class ClientApi {
  constructor(
    private readonly jeton: string | null = null,
    private readonly base = "",
    private readonly fetcher: Fetch = (e, i) => fetch(e, i),
  ) {}

  avecJeton(jeton: string): ClientApi {
    return new ClientApi(jeton, this.base, this.fetcher);
  }

  private async appel<T>(methode: string, chemin: string, corps?: unknown): Promise<T> {
    const entetes: Record<string, string> = { Accept: "application/json" };
    if (corps !== undefined) entetes["Content-Type"] = "application/json";
    if (this.jeton) entetes.Authorization = `Bearer ${this.jeton}`;
    let reponse: Response;
    try {
      reponse = await this.fetcher(`${this.base}${chemin}`, {
        method: methode,
        headers: entetes,
        body: corps === undefined ? undefined : JSON.stringify(corps),
        cache: "no-store",
      });
    } catch {
      throw new ErreurApi(0, "HORS_LIGNE", "Serveur injoignable : vérifiez la connexion Internet de l'iPad.");
    }
    const texte = await reponse.text();
    let donnees: unknown = null;
    try {
      donnees = texte ? JSON.parse(texte) : null;
    } catch {
      /* réponse non JSON : page d'erreur d'un intermédiaire */
    }
    if (!reponse.ok) {
      const e = donnees as { code?: string; message?: string } | null;
      throw new ErreurApi(reponse.status, e?.code ?? "ERREUR_SERVEUR", e?.message ?? `Erreur du serveur (${reponse.status}).`);
    }
    if (donnees === null) throw new ErreurApi(reponse.status, "REPONSE_INVALIDE", "Réponse du serveur illisible.");
    return donnees as T;
  }

  rattacher(corps: { code: string; caisseId: string; cleId: string; clePubliqueJwk: JsonWebKey; appareil: string }) {
    return this.appel<ReponseRattachement>("POST", "/api/caisse/rattacher", corps);
  }

  etat() {
    return this.appel<ReponseEtat>("GET", "/api/caisse/etat");
  }

  synchroniser(lot: EntreeSynchro[]) {
    return this.appel<ReponseSynchro>("POST", "/api/caisse/synchro", { lot });
  }

  carte() {
    return this.appel<ReponseCarte>("GET", "/api/caisse/carte");
  }

  /** Derniers tickets de toutes les caisses de l'établissement, depuis la copie du serveur. */
  ticketsEtablissement(limite = 150) {
    return this.appel<ReponseTickets>("GET", `/api/caisse/tickets?limite=${limite}`);
  }

  /** Dernières clôtures de toutes les caisses de l'établissement, depuis la copie du serveur. */
  cloturesEtablissement(limite = 120) {
    return this.appel<ReponseClotures>("GET", `/api/caisse/clotures?limite=${limite}`);
  }

  /** Un ticket d'une caisse de l'établissement, depuis la copie du serveur. */
  ticket(caisseId: string, numero: number) {
    return this.appel<{ ticket: Ticket }>("GET", `/api/caisse/tickets/${encodeURIComponent(caisseId)}/${numero}`);
  }

  /**
   * Journée de l'établissement : clôtures, tickets non clôturés des autres
   * caisses, fond et comptage. `resume` : sans les tickets (fond de caisse,
   * correction d'un paiement).
   */
  journee(resume = false) {
    return this.appel<ReponseJournee>("GET", `/api/caisse/journee${resume ? "?resume=1" : ""}`);
  }

  /** Verrou de clôture (une caisse à la fois) et journée complète. 409 CLOTURE_EN_COURS si un autre appareil clôture. */
  prendreVerrouCloture() {
    return this.appel<ReponseJournee>("POST", "/api/caisse/journee/verrou");
  }

  rendreVerrouCloture() {
    return this.appel<{ ok: true }>("DELETE", "/api/caisse/journee/verrou");
  }

  /** Archive d'une clôture produite par le serveur (toutes les caisses qu'elle couvre). */
  archive(caisseId: string, numero: number) {
    return this.appel<Record<string, unknown>>("GET", `/api/caisse/clotures/${encodeURIComponent(caisseId)}/${numero}/archive.json`);
  }

  /** Statistiques de l'établissement entre deux journées comptables (incluses). */
  statistiques(du: string, au: string) {
    return this.appel<ReponseStatistiques>("GET", `/api/caisse/statistiques?du=${du}&au=${au}`);
  }

  /** Stock de l'établissement : référentiel, derniers prix, stock théorique, dernières pièces. */
  stock() {
    return this.appel<ReponseStockCaisse>("GET", "/api/caisse/stock");
  }

  /** Réception, inventaire ou perte saisi sur l'appareil par un responsable. */
  operationStock(type: "receptions" | "inventaires" | "pertes", corps: Record<string, unknown>) {
    return this.appel<{ document: DocumentStock; etat: EtatStock }>("POST", `/api/caisse/stock/${type}`, corps);
  }

  /** Alerte lue, validée par le code d'un responsable (vérifié par le serveur). */
  marquerAlerteVue(id: string, responsable: { id: string; pin: string }) {
    return this.appel<{ ok: true }>("POST", `/api/caisse/alertes/${encodeURIComponent(id)}/vue`, { responsable });
  }

  comptes() {
    return this.appel<ReponseComptes>("GET", "/api/caisse/comptes");
  }

  enregistrerClient(client: Omit<FicheClient, "actif"> & { actif?: boolean }) {
    return this.appel<{ client: FicheClient; clients: FicheClient[] }>("PUT", "/api/caisse/clients", client);
  }

  enregistrerPlan(plan: { zones: ZonePlan[]; tables: Table[]; version: number }) {
    return this.appel<{ etablissement: EtablissementApi }>("PUT", "/api/caisse/plan", plan);
  }

  enregistrerPostes(postes: PostesProduction) {
    return this.appel<{ etablissement: EtablissementApi }>("PUT", "/api/caisse/postes", { postes });
  }

  /** Équipe : le serveur exige le code PIN d'un responsable, qu'il vérifie lui-même. */
  enregistrerEquipe(utilisateurs: UtilisateurApi[], responsable: { id: string; pin: string }) {
    return this.appel<{ utilisateurs: UtilisateurApi[] }>("PUT", "/api/caisse/utilisateurs", { utilisateurs, responsable });
  }

  enregistrerEtablissement(corps: { identite: IdentiteEtablissement; seuilNote: number }) {
    return this.appel<{ etablissement: EtablissementApi }>("PUT", "/api/caisse/etablissement", corps);
  }
}
