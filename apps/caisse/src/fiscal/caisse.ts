import {
  genererPaireCles,
  Registre,
  signataireDepuis,
  VERSION_NOYAU_FISCAL,
  type ResolveurCle,
} from "@matalon/noyau-fiscal";
import { ouvrirBase, type BaseCaisse } from "../donnees/base";
import {
  empreinteCle,
  hacherPin,
  identifiantAleatoire,
  type Configuration,
  type Etablissement,
  type Table,
} from "../donnees/configuration";
import { StockageIndexedDB } from "../donnees/stockage-idb";

declare const __BUILD__: string;
export const VERSION_APPLICATION = typeof __BUILD__ === "string" ? __BUILD__ : "dev";

/**
 * Caisse de test (déploiement de préversion) : données séparées de la
 * production (autre adresse, donc autre stockage), bandeau permanent et
 * mention « sans valeur » sur chaque ticket.
 */
export const MODE_TEST = import.meta.env.VITE_MODE_TEST === "1";

/** Heure de Paris à laquelle bascule la journée comptable. */
export const HEURE_BASCULE = 5;

export interface Caisse {
  db: BaseCaisse;
  stockage: StockageIndexedDB;
  registre: Registre;
  config: Configuration;
  cle: { cleId: string; clePubliqueJwk: JsonWebKey; empreinte: string };
  resoudreCle: ResolveurCle;
}

export type Demarrage = { etat: "installation"; db: BaseCaisse } | { etat: "prete"; caisse: Caisse };

async function assembler(db: BaseCaisse, config: Configuration): Promise<Caisse> {
  const cles = await db.get("cles", "caisse");
  if (!cles) throw new Error("Clé de caisse introuvable : la caisse doit être réinstallée par un responsable.");
  const stockage = new StockageIndexedDB(db);
  const registre = new Registre({
    stockage,
    signataire: signataireDepuis(cles),
    contexte: { etablissementId: config.etablissementId, caisseId: config.caisseId },
    heureBascule: HEURE_BASCULE,
  });
  return {
    db,
    stockage,
    registre,
    config,
    cle: { cleId: cles.cleId, clePubliqueJwk: cles.clePubliqueJwk, empreinte: await empreinteCle(cles.clePubliqueJwk) },
    resoudreCle: (id) => (id === cles.cleId ? cles.clePubliqueJwk : null),
  };
}

/** Ouvre la base et retrouve la caisse installée, ou signale qu'il faut l'installer. */
export async function demarrer(): Promise<Demarrage> {
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* non bloquant : l'état est affiché dans les réglages */
  }
  const db = await ouvrirBase();
  const config = await db.get("config", "configuration");
  if (!config) return { etat: "installation", db };
  const caisse = await assembler(db, config);

  const dernierEvenement = await caisse.stockage.dernier("evenements");
  if (dernierEvenement && dernierEvenement.versionLogiciel !== VERSION_NOYAU_FISCAL) {
    await caisse.registre.journaliser("MISE_A_JOUR_LOGICIEL", {
      versionPrecedente: dernierEvenement.versionLogiciel,
      versionNoyau: VERSION_NOYAU_FISCAL,
      build: VERSION_APPLICATION,
    });
  }
  return { etat: "prete", caisse };
}

export interface SaisieInstallation {
  etablissement: Etablissement;
  responsable: { nom: string; pin: string };
  tables: Table[];
}

/** Première mise en service : clés de la caisse, configuration, événement d'initialisation. */
export async function installer(db: BaseCaisse, s: SaisieInstallation): Promise<Caisse> {
  if (await db.get("config", "configuration")) throw new Error("Cette caisse est déjà installée.");
  const caisseId = identifiantAleatoire("ipad");
  const etablissementId = MODE_TEST ? "moka-test" : "moka";
  const paire = await genererPaireCles(`${etablissementId}-${caisseId}-k1`);
  const responsableId = identifiantAleatoire("u");
  const config: Configuration = {
    etablissementId,
    caisseId,
    installeeLe: new Date().toISOString(),
    etablissement: s.etablissement,
    utilisateurs: [
      {
        id: responsableId,
        nom: s.responsable.nom,
        role: "responsable",
        pinHash: await hacherPin(responsableId, s.responsable.pin),
        actif: true,
      },
    ],
    tables: s.tables,
    imprimante: { adresse: "", sansAccents: false },
    seuilNoteAutomatique: 2500,
  };
  const tx = db.transaction(["cles", "config"], "readwrite");
  await tx.objectStore("cles").put({ ...paire, creeeLe: new Date().toISOString() }, "caisse");
  await tx.objectStore("config").put(config, "configuration");
  await tx.done;

  const caisse = await assembler(db, config);
  await caisse.registre.journaliser(
    "INITIALISATION_CAISSE",
    {
      cleId: paire.cleId,
      empreinteCle: caisse.cle.empreinte,
      etablissementId,
      caisseId,
      heureBascule: HEURE_BASCULE,
      build: VERSION_APPLICATION,
    },
    responsableId,
  );
  return caisse;
}

export async function enregistrerConfiguration(caisse: Caisse, config: Configuration): Promise<Caisse> {
  await caisse.db.put("config", config, "configuration");
  return { ...caisse, config };
}

/**
 * Empêche deux onglets d'écrire dans la même chaîne : le premier onglet garde
 * le verrou tant qu'il est ouvert. Renvoie false si un autre onglet le détient.
 */
export function prendreVerrouCaisse(): Promise<boolean> {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (!locks) return Promise.resolve(true);
  return new Promise((resolve) => {
    void locks.request("matalon-caisse", { ifAvailable: true }, (verrou) => {
      if (!verrou) {
        resolve(false);
        return undefined;
      }
      resolve(true);
      return new Promise<void>(() => {
        /* conservé jusqu'à la fermeture de l'onglet */
      });
    });
  });
}
