import type { Chaine } from "@matalon/noyau-fiscal";
import type { ReponseJournee } from "@matalon/serveur/partage";
import { ErreurApi } from "../serveur/client";
import type { Caisse } from "./caisse";

const CHAINES: Chaine[] = ["tickets", "evenements", "clotures"];
const MESSAGE_HORS_LIGNE = "Connexion nécessaire : les clôtures portent sur tous les appareils de l'établissement.";

/**
 * Journée pour une clôture : en ligne, celle de l'établissement (verrou
 * pris) ; hors ligne, null si cet appareil est seul (sa Z ne couvre que lui),
 * sinon une erreur.
 */
export async function journeePourCloture(caisse: Caisse, synchroniser: () => Promise<void>): Promise<ReponseJournee | null> {
  try {
    return await chargerJournee(caisse, synchroniser, { verrou: true });
  } catch (e) {
    if (e instanceof ErreurApi && e.code === "HORS_LIGNE" && seulAppareil(caisse)) return null;
    throw e;
  }
}

/**
 * Journée de l'établissement pour une lecture X ou une clôture (noyau 0.7.0) :
 * cet appareil envoie d'abord tout ce qu'il a, puis le serveur transmet les
 * tickets non clôturés des autres caisses (vérifiés ensuite par le noyau).
 * `verrou` : réserve la clôture à cet appareil le temps du comptage.
 */
export async function chargerJournee(caisse: Caisse, synchroniser: () => Promise<void>, o: { verrou?: boolean } = {}): Promise<ReponseJournee> {
  if (!navigator.onLine) throw new ErreurApi(0, "HORS_LIGNE", MESSAGE_HORS_LIGNE);
  try {
    await synchroniser();
    const etat = await caisse.client.etat();
    for (const chaine of CHAINES) {
      const local = (await caisse.stockage.dernier(chaine))?.numero ?? 0;
      if ((etat.derniers[chaine]?.numero ?? 0) < local) {
        throw new Error("Cet appareil n'a pas fini d'envoyer ses enregistrements au serveur : réessayez dans un instant.");
      }
    }
    return o.verrou ? await caisse.client.prendreVerrouCloture() : await caisse.client.journee();
  } catch (e) {
    if (e instanceof ErreurApi && e.code === "HORS_LIGNE") {
      throw new ErreurApi(0, "HORS_LIGNE", MESSAGE_HORS_LIGNE);
    }
    throw e;
  }
}

/**
 * Appareil seul de l'établissement (au dernier contact avec le serveur) :
 * il peut clôturer hors ligne, sa Z ne couvrant que lui. Dès qu'un second
 * appareil est rattaché, la clôture se fait en ligne.
 */
export function seulAppareil(caisse: Caisse): boolean {
  const ids = Object.keys(caisse.config.appareils ?? {});
  return ids.length === 1 && ids[0] === caisse.config.caisseId;
}

/** Abandon d'une clôture : le verrou tombe tout de suite (sinon au bout de 10 minutes). */
export function rendreVerrou(caisse: Caisse): void {
  void caisse.client.rendreVerrouCloture().catch(() => undefined);
}

/** « il y a 3 min », « à 21:43 » : fraîcheur de la synchronisation d'un appareil. */
export function fraicheur(iso: string | null, maintenant = Date.now()): string {
  if (!iso) return "jamais synchronisé";
  const minutes = Math.round((maintenant - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "synchronisé à l'instant";
  if (minutes < 60) return `synchronisé il y a ${minutes} min`;
  return `synchronisé le ${new Date(iso).toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" })}`;
}
