import type { Catalogue } from "@matalon/catalogue";
import { useCallback, useRef } from "react";
import type { Configuration } from "../donnees/configuration";
import { envoyerEpson } from "../impression/epson";
import { gabaritBon } from "../impression/gabarits";
import type { Commande } from "../metier/commande";
import { aEnvoyerDans, bonsAEnvoyer, validerEnvoi, type Bon } from "../metier/production";
import { useCaisse } from "./contexte";

/** Imprimantes de production en service : au moins un poste relié à une imprimante. */
export function productionActive(config: Configuration): boolean {
  return Object.values(config.postesProduction ?? {}).some((p) => p.adresse.trim() !== "");
}

/**
 * « Envoyer » : valide la commande. Les articles envoyés ne s'effacent plus,
 * un retrait est alors barré et tracé. S'il y a des imprimantes de
 * production, les bons partent poste par poste ; un poste sans imprimante est
 * signalé (préparé d'après l'écran), un bon en échec laisse ses lignes à
 * envoyer. Rend la mise à jour à appliquer à la dernière version de la
 * commande, ou null s'il n'y avait rien à envoyer.
 */
export function useEnvoiProduction() {
  const { config, utilisateur, notifier } = useCaisse();
  const enCours = useRef(false);
  return useCallback(
    async (c: Commande, carte: Catalogue, o: { annulationsSeules?: boolean } = {}): Promise<((c: Commande) => Commande) | null> => {
      if (enCours.current) return null;
      const production = productionActive(config);
      const prevu = aEnvoyerDans(c, production, o);
      if (prevu.envois.size + prevu.annulations.size === 0) return null;
      const bons = production ? bonsAEnvoyer(c, carte, o) : [];
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
      } else if (!echecs.size && prevu.envois.size) {
        notifier("Commande envoyée.");
      }
      return (derniere) => validerEnvoi(derniere, prevu, echecs, utilisateur.id);
    },
    [config, utilisateur.id, notifier],
  );
}
