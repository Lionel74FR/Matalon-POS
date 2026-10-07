import type {
  ClientApi as FicheClient,
  EntreeSynchro,
  ReponseComptes,
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

  enregistrerEquipe(utilisateurs: UtilisateurApi[]) {
    return this.appel<{ utilisateurs: UtilisateurApi[] }>("PUT", "/api/caisse/utilisateurs", { utilisateurs });
  }

  enregistrerEtablissement(corps: { identite: IdentiteEtablissement; seuilNote: number }) {
    return this.appel<{ etablissement: EtablissementApi }>("PUT", "/api/caisse/etablissement", corps);
  }
}
