import type { Configuration } from "../donnees/configuration";
import type { ClientApi } from "../serveur/client";
import { logoTicketSerie } from "./logo-serie";
import { Recu, type ElementRecu } from "./recu";
import { envoyerSerie } from "./serie";

/**
 * Impression relayée par une dalle (16 novembre 2026, backlog n° 5). Un iPad ou un iPhone ne joint pas
 * l'imprimante série d'une dalle : il confie le reçu au serveur, et la dalle relais (caisse ouverte dans
 * Chrome, « Imprimer aussi pour les iPad et iPhone ») le prend toutes les 3 secondes, l'imprime et rend
 * compte. Il faut Internet des deux côtés ; le reçu, déjà enregistré sur l'appareil qui l'a produit, ne
 * sert ici qu'à sortir sur papier.
 */

/** Passage de la dalle relais au serveur. */
export const PASSAGE_RELAIS_MS = 3000;

/**
 * Confie le reçu à la dalle. Rejette tout de suite si le serveur ou la dalle ne répond pas (l'appelant
 * montre alors l'aperçu) ; ensuite suit l'impression et appelle `surEchec` si la dalle ne l'a pas sortie.
 */
export async function imprimerParRelais(
  client: ClientApi,
  relaisId: string,
  recu: Recu,
  titre: string,
  surEchec: (erreur: string) => void,
  attendre: (ms: number) => Promise<void> = (ms) => new Promise((fin) => setTimeout(fin, ms)),
): Promise<void> {
  const { id } = await client.deposerImpression({ relaisId, titre, recu: recu.elements });
  void (async () => {
    // Suivi : vite au début (le ticket sort en quelques secondes), puis plus lentement jusqu'aux délais du serveur.
    for (let essai = 0, ecoule = 0; ecoule < 190_000; essai++) {
      const pause = essai < 15 ? 2000 : 10_000;
      await attendre(pause);
      ecoule += pause;
      try {
        const e = await client.etatImpression(id);
        if (e.etat === "faite") return;
        if (e.etat === "echec") return surEchec(e.erreur ?? "La dalle n'a pas imprimé.");
      } catch {
        // Réseau coupé pendant le suivi : on réessaie au tour suivant.
      }
    }
    surEchec("Impression sur la dalle sans nouvelle.");
  })();
}

/**
 * Boucle de la dalle relais : s'inscrit, puis prend et imprime les reçus des autres appareils. Rend la
 * fonction qui l'arrête. `config()` donne la configuration du moment (imprimante série et logo).
 */
export function demarrerRelais(o: {
  client: ClientApi;
  config: () => Configuration;
  notifier: (message: string, ton?: "info" | "erreur") => void;
  periode?: number;
}): () => void {
  let actif = true;
  let inscrit = false;
  let enCours = false;
  const passage = async () => {
    if (!actif || enCours || (typeof navigator !== "undefined" && navigator.onLine === false)) return;
    enCours = true;
    try {
      if (!inscrit) {
        await o.client.inscrireRelais(true);
        inscrit = true;
      }
      const { impressions } = await o.client.impressionsEnAttente();
      for (const i of impressions) {
        const config = o.config();
        const serie = config.imprimanteSerie;
        try {
          if (!serie) throw new Error("Cette dalle n'a plus d'imprimante série.");
          await envoyerSerie(Recu.depuis(i.recu as ElementRecu[]), { ...serie, logo: await logoTicketSerie(config) });
          await o.client.compteRenduImpression(i.id, true);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          o.notifier(`Impression pour un autre appareil (${i.titre || "reçu"}) : ${message}`, "erreur");
          await o.client.compteRenduImpression(i.id, false, message).catch(() => undefined);
        }
      }
    } catch {
      // Serveur injoignable : on repasse au tour suivant.
    } finally {
      enCours = false;
    }
  };
  void passage();
  const minuterie = setInterval(() => void passage(), o.periode ?? PASSAGE_RELAIS_MS);
  return () => {
    actif = false;
    clearInterval(minuterie);
  };
}
