import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Cloture, Evenement, PaireCles, Ticket } from "@matalon/noyau-fiscal";
import type { Derniers } from "@matalon/serveur/partage";
import type { Commande } from "../metier/commande";
import type { Configuration } from "./configuration";

export interface ClesStockees extends Omit<PaireCles, "clePrivee"> {
  /** Clé privée non exportable : IndexedDB la conserve sans jamais exposer son contenu. */
  clePrivee: CryptoKey;
  creeeLe: string;
}

/** Lien de la caisse avec le serveur du groupe. */
export interface ConnexionServeur {
  /** Jeton de la caisse, remis au rattachement. Le serveur n'en garde que l'empreinte. */
  jeton: string;
  rattacheeLe: string;
  derniereSynchro: string | null;
  /** Écart mesuré entre l'heure du serveur et celle de l'iPad (ms, positif si l'iPad retarde). */
  decalageHorloge: number;
  revoquee: boolean;
  /** Dernier état connu des chaînes côté serveur. */
  derniers: Derniers | null;
  divergence: string | null;
}

export interface SchemaCaisse extends DBSchema {
  tickets: { key: number; value: Ticket };
  evenements: { key: number; value: Evenement };
  clotures: { key: number; value: Cloture };
  /** Données non fiscales. */
  config: { key: "configuration"; value: Configuration };
  cles: { key: "caisse"; value: ClesStockees };
  commandes: { key: string; value: Commande };
  serveur: { key: "connexion"; value: ConnexionServeur };
}

export type BaseCaisse = IDBPDatabase<SchemaCaisse>;

export const NOM_BASE = "matalon-pos";

export function ouvrirBase(nom = NOM_BASE): Promise<BaseCaisse> {
  return openDB<SchemaCaisse>(nom, 2, {
    upgrade(db, ancienne) {
      if (ancienne < 1) {
        db.createObjectStore("tickets", { keyPath: "numero" });
        db.createObjectStore("evenements", { keyPath: "numero" });
        db.createObjectStore("clotures", { keyPath: "numero" });
        db.createObjectStore("config");
        db.createObjectStore("cles");
        db.createObjectStore("commandes", { keyPath: "tableId" });
      }
      if (ancienne < 2) db.createObjectStore("serveur");
    },
  });
}
