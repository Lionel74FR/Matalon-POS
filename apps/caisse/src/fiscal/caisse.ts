import { descriptionAppareil } from "../donnees/appareil";
import {
  genererPaireCles,
  Registre,
  signataireDepuis,
  VERSION_NOYAU_FISCAL,
  type ResolveurCle,
} from "@matalon/noyau-fiscal";
import { ouvrirBase, type BaseCaisse, type ConnexionServeur } from "../donnees/base";
import { empreinteCle, identifiantAleatoire, type Configuration } from "../donnees/configuration";
import { StockageIndexedDB } from "../donnees/stockage-idb";
import { ClientApi } from "../serveur/client";

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
  /** Client de l'API, authentifié avec le jeton de cette caisse. */
  client: ClientApi;
}

export type Demarrage =
  | { etat: "rattachement"; db: BaseCaisse }
  /** Caisse installée par une version antérieure au référentiel serveur : non synchronisable. */
  | { etat: "ancienne"; db: BaseCaisse; config: Configuration }
  | { etat: "prete"; caisse: Caisse; connexion: ConnexionServeur };

async function assembler(db: BaseCaisse, config: Configuration, jeton: string, client: ClientApi): Promise<Caisse> {
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
    client: client.avecJeton(jeton),
  };
}

/** Ouvre la base et retrouve la caisse rattachée, ou signale qu'il faut la rattacher. */
export async function demarrer(client = new ClientApi()): Promise<Demarrage> {
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* non bloquant : l'état est affiché dans les réglages */
  }
  const db = await ouvrirBase();
  const config = await db.get("config", "configuration");
  if (!config) return { etat: "rattachement", db };
  const connexion = await db.get("serveur", "connexion");
  if (!connexion || !config.carteId) return { etat: "ancienne", db, config };
  const caisse = await assembler(db, config, connexion.jeton, client);

  const dernierEvenement = await caisse.stockage.dernier("evenements");
  if (dernierEvenement && dernierEvenement.versionLogiciel !== VERSION_NOYAU_FISCAL) {
    await caisse.registre.journaliser("MISE_A_JOUR_LOGICIEL", {
      versionPrecedente: dernierEvenement.versionLogiciel,
      versionNoyau: VERSION_NOYAU_FISCAL,
      build: VERSION_APPLICATION,
    });
  }
  return { etat: "prete", caisse, connexion };
}

/**
 * Mise en service par code de rattachement : l'iPad crée sa clé de signature
 * (non exportable), le serveur l'enregistre et renvoie l'établissement, son
 * équipe et sa carte. Rien n'est écrit localement si le serveur refuse.
 */
export async function rattacher(
  db: BaseCaisse,
  code: string,
  client = new ClientApi(),
): Promise<{ caisse: Caisse; connexion: ConnexionServeur }> {
  if (await db.get("config", "configuration")) throw new Error("Cette caisse est déjà mise en service.");
  const caisseId = identifiantAleatoire("ipad");
  const paire = await genererPaireCles(`${caisseId}-k1`);
  const r = await client.rattacher({
    code,
    caisseId,
    cleId: paire.cleId,
    clePubliqueJwk: paire.clePubliqueJwk,
    appareil: typeof navigator === "undefined" ? "" : descriptionAppareil(),
  });
  const maintenant = new Date().toISOString();
  const config: Configuration = {
    etablissementId: r.etablissement.id,
    caisseId,
    caisseNom: r.caisse.nom,
    installeeLe: maintenant,
    etablissement: r.etablissement.identite,
    utilisateurs: r.utilisateurs,
    tables: r.etablissement.tables,
    carteId: r.etablissement.carteId,
    imprimante: { adresse: "", sansAccents: false },
    seuilNoteAutomatique: r.etablissement.seuilNote,
    ...(r.etablissement.postesProduction ? { postesProduction: r.etablissement.postesProduction } : {}),
    ...(r.etablissement.zones ? { zones: r.etablissement.zones, planVersion: r.etablissement.planVersion ?? 0 } : {}),
  };
  const connexion: ConnexionServeur = {
    jeton: r.jeton,
    rattacheeLe: maintenant,
    derniereSynchro: null,
    decalageHorloge: 0,
    revoquee: false,
    derniers: null,
    divergence: null,
  };
  // La carte vient avec le rattachement ; si le téléchargement échoue, la synchronisation la reprendra.
  for (let essai = 0; essai < 3 && !config.carte; essai++) {
    try {
      const { carte, version } = await client.avecJeton(r.jeton).carte();
      config.carte = carte;
      config.carteId = carte.id;
      config.carteVersion = version;
    } catch {
      /* repli sur la carte livrée avec l'application, signalé à l'écran, repris à la synchronisation */
    }
  }
  const tx = db.transaction(["cles", "config", "serveur"], "readwrite");
  await tx.objectStore("cles").put({ ...paire, creeeLe: maintenant }, "caisse");
  await tx.objectStore("config").put(config, "configuration");
  await tx.objectStore("serveur").put(connexion, "connexion");
  await tx.done;

  const caisse = await assembler(db, config, r.jeton, client);
  await caisse.registre.journaliser("INITIALISATION_CAISSE", {
    cleId: paire.cleId,
    empreinteCle: caisse.cle.empreinte,
    etablissementId: config.etablissementId,
    caisseId,
    heureBascule: HEURE_BASCULE,
    build: VERSION_APPLICATION,
  });
  return { caisse, connexion };
}

export async function enregistrerConfiguration(caisse: Caisse, config: Configuration): Promise<Caisse> {
  await caisse.db.put("config", config, "configuration");
  return { ...caisse, config };
}

/**
 * Caisse de test d'une version antérieure : ses données « sans valeur » ne
 * peuvent pas rejoindre le serveur. Elles sont effacées pour rattacher l'iPad.
 * Impossible hors caisse de test.
 */
export async function effacerCaisseDeTest(db: BaseCaisse): Promise<void> {
  if (!MODE_TEST) throw new Error("Seule une caisse de test peut être effacée.");
  const magasins = ["tickets", "evenements", "clotures", "config", "cles", "commandes", "serveur"] as const;
  const tx = db.transaction(magasins, "readwrite");
  for (const m of magasins) await tx.objectStore(m).clear();
  await tx.done;
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
