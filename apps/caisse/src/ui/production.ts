import type { Catalogue } from "@matalon/catalogue";
import { useCallback, useRef } from "react";
import type { Configuration } from "../donnees/configuration";
import { envoyerEpson } from "../impression/epson";
import { gabaritBon } from "../impression/gabarits";
import type { Commande } from "../metier/commande";
import { bonsAEnvoyer, marquerEnvoyees, type Bon } from "../metier/production";
import { useCaisse } from "./contexte";

/** Imprimantes de production en service : au moins un poste relié à une imprimante. */
export function productionActive(config: Configuration): boolean {
  return Object.values(config.postesProduction ?? {}).some((p) => p.adresse.trim() !== "");
}

/**
 * Envoi des bons de production. Rend la mise à jour à appliquer à la
 * commande la plus récente (lignes marquées envoyées), ou null s'il n'y avait
 * rien à envoyer. Un poste sans imprimante est signalé et ses lignes sont
 * marquées : on le prépare d'après l'écran. Un échec d'impression laisse les
 * lignes à envoyer pour le prochain essai (ou l'encaissement).
 */
export function useEnvoiProduction() {
  const { config, utilisateur, notifier } = useCaisse();
  const enCours = useRef(false);
  return useCallback(
    async (c: Commande, carte: Catalogue, o: { annulationsSeules?: boolean } = {}): Promise<((c: Commande) => Commande) | null> => {
      if (!productionActive(config) || enCours.current) return null;
      const bons = bonsAEnvoyer(c, carte, o);
      if (bons.length === 0) return null;
      enCours.current = true;
      const echecs = new Set<Bon>();
      const sansImprimante = new Set<string>();
      try {
        // Un bon après l'autre : plusieurs postes peuvent partager une imprimante.
        for (const bon of bons) {
          const p = config.postesProduction?.[bon.poste];
          if (!p?.adresse.trim()) {
            sansImprimante.add(bon.poste);
            continue;
          }
          try {
            await envoyerEpson(p.adresse.trim(), gabaritBon(bon, c, config, utilisateur.id), { sansAccents: p.sansAccents });
          } catch (e) {
            echecs.add(bon);
            notifier(`${bon.poste} : bon non imprimé (${e instanceof Error ? e.message : String(e)}). Il repartira au prochain envoi.`, "erreur");
          }
        }
      } finally {
        enCours.current = false;
      }
      if (sansImprimante.size) notifier(`Aucune imprimante pour ${[...sansImprimante].join(", ")} : à préparer d'après l'écran.`);
      const imprimes = bons.filter((b) => !echecs.has(b) && !sansImprimante.has(b.poste));
      if (imprimes.length) {
        notifier(`Envoyé : ${[...new Set(imprimes.map((b) => (b.annulation ? `annulation ${b.poste}` : b.poste)))].join(", ")}.`);
      }
      return (derniere) => marquerEnvoyees(derniere, bons, echecs, utilisateur.id);
    },
    [config, utilisateur.id, notifier],
  );
}
