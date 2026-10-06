/** Accès minimal à Postgres, commun à Neon (production) et PGlite (tests). */
export interface Db {
  requete<T = Record<string, unknown>>(texte: string, params?: unknown[]): Promise<T[]>;
  /** Exécute plusieurs requêtes d'un seul bloc : toutes ou aucune. */
  lot(requetes: Array<{ texte: string; params?: unknown[] }>): Promise<void>;
}

export class ErreurHttp extends Error {
  constructor(
    readonly statut: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
