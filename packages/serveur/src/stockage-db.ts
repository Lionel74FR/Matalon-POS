import type { Chaine, StockageFiscal, TypesChaines } from "@matalon/noyau-fiscal";
import type { Db } from "./db.js";

/**
 * Lecture de la chaîne fiscale d'une caisse répliquée sur le serveur, au
 * format du noyau fiscal : permet de rejouer `verifierRegistre` côté serveur.
 * L'écriture passe exclusivement par la synchronisation vérifiée.
 */
export class StockageServeur implements StockageFiscal {
  constructor(
    private readonly db: Db,
    private readonly caisseId: string,
  ) {}

  async ajouterLot(): Promise<void> {
    throw new Error("Lecture seule : les enregistrements arrivent par la synchronisation.");
  }

  async dernier<C extends Chaine>(chaine: C): Promise<TypesChaines[C] | null> {
    const [ligne] = await this.db.requete<{ contenu: TypesChaines[C] }>(
      "select contenu from enregistrements where caisse_id = $1 and chaine = $2 order by numero desc limit 1",
      [this.caisseId, chaine],
    );
    return ligne?.contenu ?? null;
  }

  async trouver<C extends Chaine>(chaine: C, numero: number): Promise<TypesChaines[C] | null> {
    const [ligne] = await this.db.requete<{ contenu: TypesChaines[C] }>(
      "select contenu from enregistrements where caisse_id = $1 and chaine = $2 and numero = $3",
      [this.caisseId, chaine, numero],
    );
    return ligne?.contenu ?? null;
  }

  async lister<C extends Chaine>(chaine: C, depuis = 1, jusqua = 2_147_483_647): Promise<TypesChaines[C][]> {
    const lignes = await this.db.requete<{ contenu: TypesChaines[C] }>(
      "select contenu from enregistrements where caisse_id = $1 and chaine = $2 and numero between $3 and $4 order by numero",
      [this.caisseId, chaine, depuis, Math.min(jusqua, 2_147_483_647)],
    );
    return lignes.map((l) => l.contenu);
  }
}
