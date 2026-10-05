import { HASH_GENESE } from "./crypto.js";
import type { Chaine, Cloture, Enregistrement, Evenement, Ticket } from "./types.js";

export interface TypesChaines {
  tickets: Ticket;
  evenements: Evenement;
  clotures: Cloture;
}

/** Un enregistrement à écrire, avec sa chaîne. */
export type EntreeLot = { [C in Chaine]: { chaine: C; enregistrement: TypesChaines[C] } }[Chaine];

/**
 * Stockage fiscal en ajout seul.
 *
 * Contrat :
 * - aucune méthode ne permet de modifier ni de supprimer un enregistrement ;
 * - `ajouterLot` est atomique : tout le lot est écrit, ou rien (une
 *   transaction IndexedDB sur les trois chaînes côté PWA) ;
 * - chaque enregistrement doit porter le numéro suivant de sa chaîne et
 *   l'empreinte du précédent, sinon le lot entier est refusé.
 *
 * Les enregistrements sont stockés tels quels : toute donnée technique
 * (indicateur de synchronisation…) vit dans une enveloppe séparée, jamais
 * dans l'enregistrement scellé.
 */
export interface StockageFiscal {
  ajouterLot(lot: EntreeLot[]): Promise<void>;
  dernier<C extends Chaine>(chaine: C): Promise<TypesChaines[C] | null>;
  trouver<C extends Chaine>(chaine: C, numero: number): Promise<TypesChaines[C] | null>;
  /** Enregistrements de numéro compris entre `depuis` et `jusqua` inclus, triés par numéro. */
  lister<C extends Chaine>(chaine: C, depuis?: number, jusqua?: number): Promise<TypesChaines[C][]>;
}

/** Contrôle qu'un lot prolonge exactement les chaînes existantes. Lève une erreur sinon. */
export function controlerLot(
  lot: EntreeLot[],
  derniers: { [C in Chaine]: Pick<Enregistrement, "numero" | "hash"> | null },
): void {
  const queues = { ...derniers };
  for (const { chaine, enregistrement: e } of lot) {
    const queue = queues[chaine];
    const numero = (queue?.numero ?? 0) + 1;
    const hash = queue?.hash ?? HASH_GENESE;
    if (e.numero !== numero || e.hashPrecedent !== hash) {
      throw new Error(`enregistrement ${chaine} n°${e.numero} refusé : la chaîne attend le n°${numero}`);
    }
    queues[chaine] = e;
  }
}

/** Stockage en mémoire : tests et démonstration. */
export class StockageMemoire implements StockageFiscal {
  private readonly donnees: { [C in Chaine]: TypesChaines[C][] } = {
    tickets: [],
    evenements: [],
    clotures: [],
  };

  async ajouterLot(lot: EntreeLot[]): Promise<void> {
    controlerLot(lot, {
      tickets: this.donnees.tickets.at(-1) ?? null,
      evenements: this.donnees.evenements.at(-1) ?? null,
      clotures: this.donnees.clotures.at(-1) ?? null,
    });
    for (const { chaine, enregistrement } of lot) {
      (this.donnees[chaine] as Enregistrement[]).push(structuredClone(enregistrement));
    }
  }

  async dernier<C extends Chaine>(chaine: C): Promise<TypesChaines[C] | null> {
    const d = (this.donnees[chaine] as TypesChaines[C][]).at(-1);
    return d ? structuredClone(d) : null;
  }

  async trouver<C extends Chaine>(chaine: C, numero: number): Promise<TypesChaines[C] | null> {
    const e = (this.donnees[chaine] as TypesChaines[C][])[numero - 1];
    return e ? structuredClone(e) : null;
  }

  async lister<C extends Chaine>(chaine: C, depuis = 1, jusqua = Number.MAX_SAFE_INTEGER): Promise<TypesChaines[C][]> {
    return (this.donnees[chaine] as TypesChaines[C][])
      .filter((e) => e.numero >= depuis && e.numero <= jusqua)
      .map((e) => structuredClone(e));
  }

  /** Accès brut réservé aux tests d'altération. */
  _brut<C extends Chaine>(chaine: C): TypesChaines[C][] {
    return this.donnees[chaine] as TypesChaines[C][];
  }
}
