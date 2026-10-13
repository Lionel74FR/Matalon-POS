import { canonique } from "@matalon/noyau-fiscal";
import type { CommandePartagee, ReponseEcritureCommande } from "@matalon/serveur/partage";
import type { Commande } from "../metier/commande";
import { fusionnerCommande } from "../metier/fusion";
import { ID_COMPTOIR } from "./configuration";

/**
 * Commandes en cours partagées entre les appareils de l'établissement.
 *
 * Chaque appareil garde ses commandes (IndexedDB) et continue sans réseau. Une modification
 * part au serveur en écriture conditionnelle (version) ; si un autre appareil a écrit entre-temps,
 * les deux versions sont fusionnées (`fusionnerCommande`) puis renvoyées. Le serveur est lu toutes
 * les quelques secondes. Le comptoir reste propre à chaque appareil. À l'encaissement, la table est
 * d'abord fermée sur le serveur (`reserver`) : deux appareils ne peuvent pas encaisser la même table.
 */

/** Suivi d'une table : dernière version connue du serveur et son contenu (base des fusions). */
export interface SuiviPartage {
  tableId: string;
  version: number;
  base: Commande | null;
  /** Modification locale pas encore acceptée par le serveur. */
  aEnvoyer: boolean;
}

export interface AccesPartage {
  lister(): Promise<CommandePartagee[]>;
  /** `stricte` : fermeture pour encaisser, refusée si la table a déjà été fermée ailleurs. */
  ecrire(tableId: string, commande: Commande | null, version: number, stricte?: boolean): Promise<ReponseEcritureCommande>;
}

export interface StockagePartage {
  commandes(): Promise<Commande[]>;
  suivis(): Promise<SuiviPartage[]>;
  ecrireCommande(tableId: string, c: Commande | null): Promise<void>;
  ecrireSuivi(s: SuiviPartage | { tableId: string; supprime: true }): Promise<void>;
}

export type Reservation = { ok: true; horsLigne?: boolean } | { ok: false; raison: string };

const egales = (a: unknown, b: unknown) => canonique(a ?? null) === canonique(b ?? null);
export const estPartagee = (tableId: string) => tableId !== ID_COMPTOIR;

export class PartageCommandes {
  readonly commandes = new Map<string, Commande>();
  private readonly suivis = new Map<string, SuiviPartage>();
  /** Une opération réseau à la fois : pas de lecture pendant une écriture, ni l'inverse. */
  private file: Promise<unknown> = Promise.resolve();
  private envoiPrevu: ReturnType<typeof setTimeout> | null = null;
  private lecture: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly acces: AccesPartage,
    private readonly stockage: StockagePartage,
    private readonly nomTable: (tableId: string) => string,
    private readonly avertir: (message: string) => void,
    private readonly auChangement: (commandes: Map<string, Commande>) => void,
  ) {}

  async charger(): Promise<void> {
    for (const c of await this.stockage.commandes()) this.commandes.set(c.tableId, c);
    for (const s of await this.stockage.suivis()) this.suivis.set(s.tableId, s);
    // Commandes d'avant le partage : à publier.
    for (const t of this.commandes.keys()) {
      if (estPartagee(t) && !this.suivis.has(t)) this.suivis.set(t, { tableId: t, version: 0, base: null, aEnvoyer: true });
    }
    this.emettre();
  }

  /** Lecture régulière du serveur (et envoi de ce qui attend), tant que l'écran est affiché. */
  demarrer(intervalle = 4000): void {
    this.arreter();
    const tic = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void this.synchroniser();
    };
    tic();
    this.lecture = setInterval(tic, intervalle);
  }

  arreter(): void {
    if (this.lecture) clearInterval(this.lecture);
    this.lecture = null;
    if (this.envoiPrevu) clearTimeout(this.envoiPrevu);
    this.envoiPrevu = null;
  }

  /** Modification locale (prise de commande, libération, transfert…). */
  async modifier(tableId: string, c: Commande | null): Promise<void> {
    await this.ecrireLocale(tableId, c);
    if (!estPartagee(tableId)) return;
    const s = this.suivis.get(tableId) ?? { tableId, version: 0, base: null, aEnvoyer: false };
    await this.majSuivi({ ...s, aEnvoyer: !egales(c, s.base) });
    this.prevoirEnvoi();
  }

  /** Envoie les modifications en attente puis lit le serveur. Sans réseau : rien ne se perd, on réessaiera. */
  synchroniser(): Promise<void> {
    return this.enFile(async () => {
      try {
        await this.envoyerTout();
        await this.tirer();
      } catch {
        /* hors ligne : on réessaiera */
      }
    });
  }

  /**
   * Avant d'encaisser : ferme la table sur le serveur, à partir de la commande affichée. Refusé si
   * un autre appareil l'a modifiée ou encaissée entre-temps. Hors ligne, l'encaissement reste possible.
   */
  reserver(tableId: string, affichee: Commande): Promise<Reservation> {
    if (!estPartagee(tableId)) return Promise.resolve({ ok: true });
    return this.enFile(async (): Promise<Reservation> => {
      try {
        await this.envoyer(tableId);
        const locale = this.commandes.get(tableId) ?? null;
        if (!egales(locale, affichee)) {
          return { ok: false, raison: `${this.nomTable(tableId)} vient d'être modifiée sur un autre appareil : vérifiez la commande puis encaissez.` };
        }
        const s = this.suivis.get(tableId) ?? { tableId, version: 0, base: null, aEnvoyer: false };
        const r = await this.acces.ecrire(tableId, null, s.version, true);
        if (r.ok) {
          await this.majSuivi({ tableId, version: r.version, base: null, aEnvoyer: false });
          return { ok: true };
        }
        const par = r.actuelle.majPar ? ` sur ${r.actuelle.majPar}` : " sur un autre appareil";
        await this.appliquerConflit(tableId, r.actuelle, false);
        return {
          ok: false,
          raison: r.actuelle.commande
            ? `${this.nomTable(tableId)} vient d'être modifiée${par} : vérifiez la commande puis encaissez.`
            : `${this.nomTable(tableId)} a déjà été encaissée${par}.`,
        };
      } catch {
        return { ok: true, horsLigne: true };
      }
    });
  }

  /** Encaissement abandonné après `reserver` : la table se rouvre sur le serveur. */
  async liberer(tableId: string): Promise<void> {
    if (!estPartagee(tableId)) return;
    const c = this.commandes.get(tableId) ?? null;
    const s = this.suivis.get(tableId);
    if (!c || !s) return;
    await this.majSuivi({ ...s, aEnvoyer: true });
    this.prevoirEnvoi();
  }

  // ───────── Interne ─────────

  private enFile<T>(op: () => Promise<T>): Promise<T> {
    const suite = this.file.then(op, op);
    this.file = suite.catch(() => undefined);
    return suite;
  }

  private prevoirEnvoi(): void {
    if (this.envoiPrevu) clearTimeout(this.envoiPrevu);
    this.envoiPrevu = setTimeout(() => {
      this.envoiPrevu = null;
      void this.enFile(() => this.envoyerTout().catch(() => undefined));
    }, 250);
  }

  private async envoyerTout(): Promise<void> {
    for (const s of [...this.suivis.values()]) if (s.aEnvoyer) await this.envoyer(s.tableId);
  }

  /** Envoie une table jusqu'à ce que le serveur l'accepte (fusion en cas d'écriture concurrente). */
  private async envoyer(tableId: string): Promise<void> {
    for (let essai = 0; essai < 5; essai++) {
      const s = this.suivis.get(tableId);
      if (!s?.aEnvoyer) return;
      const locale = this.commandes.get(tableId) ?? null;
      const r = await this.acces.ecrire(tableId, locale, s.version);
      if (r.ok) {
        // Modifiée pendant l'envoi : il reste à renvoyer, à partir de la version acceptée.
        const actuelle = this.commandes.get(tableId) ?? null;
        await this.majSuivi({ tableId, version: r.version, base: locale, aEnvoyer: !egales(actuelle, locale) });
        continue;
      }
      await this.appliquerConflit(tableId, r.actuelle, true);
    }
  }

  /** Version du serveur différente de la nôtre : fusion, puis renvoi si la fusion apporte quelque chose. */
  private async appliquerConflit(tableId: string, actuelle: CommandePartagee, prevenir: boolean): Promise<void> {
    const s = this.suivis.get(tableId);
    const locale = this.commandes.get(tableId) ?? null;
    const distante = (actuelle.commande as Commande | null) ?? null;
    const fusion = fusionnerCommande(s?.base ?? null, locale, distante);
    if (prevenir && !distante && locale && s?.base) {
      const par = actuelle.majPar ? ` sur ${actuelle.majPar}` : " sur un autre appareil";
      this.avertir(
        fusion
          ? `${this.nomTable(tableId)} a été fermée${par} : vos derniers ajouts restent ouverts sur la table.`
          : `${this.nomTable(tableId)} a été fermée${par}.`,
      );
    }
    await this.ecrireLocale(tableId, fusion);
    await this.majSuivi({ tableId, version: actuelle.version, base: distante, aEnvoyer: !egales(fusion, distante) });
  }

  private async tirer(): Promise<void> {
    const distantes = await this.acces.lister();
    const vues = new Set<string>();
    for (const d of distantes) {
      vues.add(d.tableId);
      const s = this.suivis.get(d.tableId);
      if (s?.aEnvoyer) continue; // l'envoi fusionnera
      if (!s || d.version !== s.version) {
        const c = (d.commande as Commande | null) ?? null;
        await this.ecrireLocale(d.tableId, c);
        await this.majSuivi({ tableId: d.tableId, version: d.version, base: c, aEnvoyer: false });
      }
    }
    // Fermées ailleurs (encaissées, libérées, déplacées) : elles se ferment ici aussi.
    for (const t of [...this.commandes.keys()]) {
      if (!estPartagee(t) || vues.has(t)) continue;
      const s = this.suivis.get(t);
      if (!s) {
        await this.majSuivi({ tableId: t, version: 0, base: null, aEnvoyer: true });
      } else if (!s.aEnvoyer && s.base) {
        await this.ecrireLocale(t, null);
        await this.stockage.ecrireSuivi({ tableId: t, supprime: true });
        this.suivis.delete(t);
      }
    }
    for (const s of [...this.suivis.values()]) if (s.aEnvoyer) await this.envoyer(s.tableId);
  }

  private async ecrireLocale(tableId: string, c: Commande | null): Promise<void> {
    if (c) this.commandes.set(tableId, c);
    else this.commandes.delete(tableId);
    // L'écran suit tout de suite ; l'écriture sur l'appareil suit.
    this.emettre();
    await this.stockage.ecrireCommande(tableId, c);
  }

  private async majSuivi(s: SuiviPartage): Promise<void> {
    this.suivis.set(s.tableId, s);
    await this.stockage.ecrireSuivi(s);
  }

  private emettre(): void {
    this.auChangement(new Map(this.commandes));
  }
}
