import type { Chaine } from "@matalon/noyau-fiscal";
import type { Derniers, EntreeSynchro, ReponseEtat } from "@matalon/serveur/partage";
import type { BaseCaisse, ConnexionServeur } from "../donnees/base";
import type { StockageIndexedDB } from "../donnees/stockage-idb";
import { ErreurApi, type ClientApi } from "./client";

const CHAINES: Chaine[] = ["tickets", "evenements", "clotures"];

/** Taille maximale d'un envoi : une journée chargée part en quelques lots. */
export const TAILLE_LOT = 200;
/** Au-delà de cet écart avec l'heure du serveur, l'encaissement est bloqué. */
export const DECALAGE_MAX_MS = 5 * 60_000;

export type StatutSynchro = "synchronise" | "en_attente" | "hors_ligne" | "divergence" | "revoquee" | "erreur";

export interface EtatSynchro {
  statut: StatutSynchro;
  /** Enregistrements fiscaux pas encore reçus par le serveur. */
  enAttente: number;
  derniereSynchro: string | null;
  decalageHorloge: number;
  message: string | null;
  enCours: boolean;
}

export interface OptionsSynchro {
  db: BaseCaisse;
  stockage: StockageIndexedDB;
  client: ClientApi;
  /** Référentiel reçu du serveur (établissement, équipe, carte). */
  surReferentiel?: (etat: ReponseEtat) => void | Promise<void>;
  maintenant?: () => number;
}

/**
 * Réplique la chaîne fiscale de l'iPad vers le serveur. La caisse reste
 * l'original : elle encaisse hors ligne et rattrape dès que le réseau revient.
 * Le serveur vérifie chaque enregistrement ; une différence entre les deux
 * copies (divergence) est signalée et n'est jamais « corrigée » en silence.
 */
export class Synchroniseur {
  private etatCourant: EtatSynchro;
  private readonly abonnes = new Set<(e: EtatSynchro) => void>();
  private execution: Promise<void> | null = null;
  private relance = false;
  private minuterie: ReturnType<typeof setTimeout> | null = null;
  private readonly maintenant: () => number;

  constructor(
    private readonly o: OptionsSynchro,
    connexion: ConnexionServeur,
  ) {
    this.maintenant = o.maintenant ?? Date.now;
    this.etatCourant = {
      statut: connexion.revoquee ? "revoquee" : connexion.divergence ? "divergence" : "en_attente",
      enAttente: 0,
      derniereSynchro: connexion.derniereSynchro,
      decalageHorloge: connexion.decalageHorloge,
      message: connexion.revoquee ? "Caisse révoquée par l'administrateur." : connexion.divergence,
      enCours: false,
    };
  }

  get etat(): EtatSynchro {
    return this.etatCourant;
  }

  abonner(rappel: (e: EtatSynchro) => void): () => void {
    this.abonnes.add(rappel);
    rappel(this.etatCourant);
    return () => this.abonnes.delete(rappel);
  }

  private publier(maj: Partial<EtatSynchro>) {
    this.etatCourant = { ...this.etatCourant, ...maj };
    for (const r of this.abonnes) r(this.etatCourant);
  }

  /** Demande une synchronisation groupée (après une écriture, par exemple). */
  demander(delaiMs = 1500) {
    if (this.minuterie) clearTimeout(this.minuterie);
    this.minuterie = setTimeout(() => {
      this.minuterie = null;
      void this.synchroniser();
    }, delaiMs);
  }

  /** Lance une synchronisation complète ; une demande pendant l'exécution relance un tour. */
  synchroniser(): Promise<void> {
    if (this.execution) {
      this.relance = true;
      return this.execution;
    }
    this.execution = (async () => {
      do {
        this.relance = false;
        await this.tour();
      } while (this.relance && this.etatCourant.statut === "synchronise");
    })().finally(() => {
      this.execution = null;
    });
    return this.execution;
  }

  arreter() {
    if (this.minuterie) clearTimeout(this.minuterie);
    this.abonnes.clear();
  }

  private async connexion(): Promise<ConnexionServeur> {
    const c = await this.o.db.get("serveur", "connexion");
    if (!c) throw new Error("Caisse non rattachée.");
    return c;
  }

  private async memoriser(maj: Partial<ConnexionServeur>) {
    await this.o.db.put("serveur", { ...(await this.connexion()), ...maj }, "connexion");
  }

  /** Enregistrements locaux au-delà de ce que le serveur a confirmé. */
  private async restants(derniers: Derniers | null): Promise<number> {
    let n = 0;
    for (const chaine of CHAINES) {
      n += ((await this.o.stockage.dernier(chaine))?.numero ?? 0) - (derniers?.[chaine]?.numero ?? 0);
    }
    return Math.max(0, n);
  }

  private async tour(): Promise<void> {
    if ((await this.connexion()).revoquee) return this.publier({ statut: "revoquee", enCours: false });
    this.publier({ enCours: true });
    try {
      const avant = this.maintenant();
      const etat = await this.o.client.etat();
      const decalage = Math.round(Date.parse(etat.heure) - (avant + this.maintenant()) / 2);
      await this.memoriser({ decalageHorloge: decalage });
      this.publier({ decalageHorloge: decalage });
      await this.o.surReferentiel?.(etat);

      let derniers = etat.derniers;
      await this.memoriser({ derniers });
      // Ce que le serveur a déjà doit être identique à l'original de l'iPad.
      for (const chaine of CHAINES) {
        const distant = derniers[chaine];
        if (!distant) continue;
        const local = await this.o.stockage.trouver(chaine, distant.numero);
        if (local?.hash !== distant.hash) {
          throw new ErreurApi(409, "DIVERGENCE", `${chaine} n°${distant.numero} : la copie du serveur diffère de celle de l'iPad`);
        }
      }

      for (;;) {
        const lot: EntreeSynchro[] = [];
        for (const chaine of CHAINES) {
          if (lot.length >= TAILLE_LOT) break;
          const depuis = (derniers[chaine]?.numero ?? 0) + 1;
          const liste = await this.o.stockage.lister(chaine, depuis, depuis + TAILLE_LOT - lot.length - 1);
          for (const enregistrement of liste) lot.push({ chaine, enregistrement });
        }
        if (!lot.length) break;
        this.publier({ statut: "en_attente", enAttente: await this.restants(derniers) });
        derniers = (await this.o.client.synchroniser(lot)).derniers;
        await this.memoriser({ derniers });
      }

      const fin = new Date(this.maintenant()).toISOString();
      await this.memoriser({ derniereSynchro: fin, divergence: null, derniers });
      this.publier({ statut: "synchronise", enAttente: 0, derniereSynchro: fin, message: null, enCours: false });
    } catch (e) {
      await this.echec(e);
    }
  }

  private async echec(e: unknown) {
    const enAttente = await this.compterEnAttente();
    if (e instanceof ErreurApi) {
      if (e.code === "CAISSE_REVOQUEE" || (e.code === "NON_AUTHENTIFIE" && e.statut === 401)) {
        await this.memoriser({ revoquee: true });
        return this.publier({ statut: "revoquee", enAttente, message: e.message, enCours: false });
      }
      if (e.code === "DIVERGENCE") {
        await this.memoriser({ divergence: e.message });
        return this.publier({ statut: "divergence", enAttente, message: e.message, enCours: false });
      }
      if (e.code === "HORS_LIGNE") return this.publier({ statut: "hors_ligne", enAttente, message: e.message, enCours: false });
    }
    this.publier({ statut: "erreur", enAttente, message: e instanceof Error ? e.message : String(e), enCours: false });
  }

  private async compterEnAttente(): Promise<number> {
    return this.restants((await this.connexion()).derniers);
  }

  /** Après une écriture locale : compte l'attente tout de suite, envoie un peu plus tard. */
  signalerEcriture() {
    if (this.etatCourant.statut === "synchronise") this.publier({ statut: "en_attente" });
    void this.compterEnAttente().then((enAttente) => this.publier({ enAttente }));
    this.demander();
  }
}

/** Raison qui interdit d'encaisser, ou `null`. */
export function blocageEncaissement(e: EtatSynchro): string | null {
  if (e.statut === "revoquee") {
    return "Cette caisse a été révoquée par l'administrateur : elle ne peut plus encaisser. Les clôtures restent possibles.";
  }
  if (Math.abs(e.decalageHorloge) > DECALAGE_MAX_MS) {
    const minutes = Math.round(Math.abs(e.decalageHorloge) / 60_000);
    return `L'heure de l'iPad ${e.decalageHorloge > 0 ? "retarde" : "avance"} de ${minutes} min sur l'heure officielle. Activez « Réglage automatique » dans Réglages › Général › Date et heure de l'iPad, puis touchez Vérifier.`;
  }
  return null;
}
