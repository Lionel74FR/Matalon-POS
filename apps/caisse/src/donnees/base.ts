import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Cloture, Evenement, PaireCles, Ticket } from "@matalon/noyau-fiscal";
import type { Commande } from "../metier/commande";
import type { Configuration } from "./configuration";

export interface ClesStockees extends Omit<PaireCles, "clePrivee"> {
  /** Clé privée non exportable : IndexedDB la conserve sans jamais exposer son contenu. */
  clePrivee: CryptoKey;
  creeeLe: string;
}

export interface SchemaCaisse extends DBSchema {
  tickets: { key: number; value: Ticket };
  evenements: { key: number; value: Evenement };
  clotures: { key: number; value: Cloture };
  /** Données non fiscales. */
  config: { key: "configuration"; value: Configuration };
  cles: { key: "caisse"; value: ClesStockees };
  commandes: { key: string; value: Commande };
}

export type BaseCaisse = IDBPDatabase<SchemaCaisse>;

export const NOM_BASE = "matalon-pos";

export function ouvrirBase(nom = NOM_BASE): Promise<BaseCaisse> {
  return openDB<SchemaCaisse>(nom, 1, {
    upgrade(db) {
      db.createObjectStore("tickets", { keyPath: "numero" });
      db.createObjectStore("evenements", { keyPath: "numero" });
      db.createObjectStore("clotures", { keyPath: "numero" });
      db.createObjectStore("config");
      db.createObjectStore("cles");
      db.createObjectStore("commandes", { keyPath: "tableId" });
    },
  });
}
