import {
  controlerLot,
  type Chaine,
  type EntreeLot,
  type StockageFiscal,
  type TypesChaines,
} from "@matalon/noyau-fiscal";
import type { BaseCaisse } from "./base";

const CHAINES: Chaine[] = ["tickets", "evenements", "clotures"];

/**
 * Stockage fiscal IndexedDB, en ajout seul.
 * Chaque lot est écrit dans une seule transaction sur les trois chaînes :
 * soit tout est écrit, soit rien (coupure, fermeture de l'app, erreur).
 */
export class StockageIndexedDB implements StockageFiscal {
  private readonly abonnes = new Set<() => void>();

  constructor(private readonly db: BaseCaisse) {}

  /** Prévient après chaque lot écrit (déclenche la synchronisation). Renvoie la fonction de désabonnement. */
  surEcriture(rappel: () => void): () => void {
    this.abonnes.add(rappel);
    return () => this.abonnes.delete(rappel);
  }

  async ajouterLot(lot: EntreeLot[]): Promise<void> {
    const tx = this.db.transaction(CHAINES, "readwrite");
    try {
      const derniers = {} as { [C in Chaine]: TypesChaines[C] | null };
      for (const chaine of CHAINES) {
        const curseur = await tx.objectStore(chaine).openCursor(null, "prev");
        (derniers as Record<Chaine, unknown>)[chaine] = curseur?.value ?? null;
      }
      controlerLot(lot, derniers);
      for (const { chaine, enregistrement } of lot) {
        // `add` refuse une clé existante : aucune réécriture possible.
        void tx.objectStore(chaine).add(enregistrement as never);
      }
      await tx.done;
    } catch (e) {
      tx.done.catch(() => undefined);
      try {
        tx.abort();
      } catch {
        /* transaction déjà terminée */
      }
      throw e;
    }
    for (const rappel of this.abonnes) rappel();
  }

  async dernier<C extends Chaine>(chaine: C): Promise<TypesChaines[C] | null> {
    const curseur = await this.db.transaction(chaine).store.openCursor(null, "prev");
    return (curseur?.value as TypesChaines[C] | undefined) ?? null;
  }

  async trouver<C extends Chaine>(chaine: C, numero: number): Promise<TypesChaines[C] | null> {
    return ((await this.db.get(chaine, numero)) as TypesChaines[C] | undefined) ?? null;
  }

  async lister<C extends Chaine>(chaine: C, depuis = 1, jusqua = Number.MAX_SAFE_INTEGER): Promise<TypesChaines[C][]> {
    if (jusqua < depuis) return [];
    return (await this.db.getAll(chaine, IDBKeyRange.bound(depuis, jusqua))) as TypesChaines[C][];
  }

  /** Les `n` derniers enregistrements, du plus récent au plus ancien. */
  async derniers<C extends Chaine>(chaine: C, n: number): Promise<TypesChaines[C][]> {
    const resultat: TypesChaines[C][] = [];
    let curseur = await this.db.transaction(chaine).store.openCursor(null, "prev");
    while (curseur && resultat.length < n) {
      resultat.push(curseur.value as TypesChaines[C]);
      curseur = await curseur.continue();
    }
    return resultat;
  }
}
