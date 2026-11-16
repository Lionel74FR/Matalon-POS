import type { Catalogue } from "@matalon/catalogue";
import { useCallback, useRef } from "react";
import type { Configuration } from "../donnees/configuration";
import { imprimanteParId, imprimerSur, type ImprimanteEtablissement } from "../impression/imprimantes";
import { gabaritBon } from "../impression/gabarits";
import { nomSuite, reclamer, type Commande, type SuiteAttente } from "../metier/commande";
import { aEnvoyerDans, bonsAEnvoyer, bonsReclame, validerEnvoi, type Bon } from "../metier/production";
import { useCaisse } from "./contexte";

/**
 * Imprimante d'un poste : celle de la liste de l'établissement (16 novembre 2026), ou l'ancienne Epson
 * du poste tant que le serveur n'envoie pas la liste.
 */
function imprimantePoste(config: Configuration, poste: string): ImprimanteEtablissement | null {
  if (config.imprimantes) return imprimanteParId(config, config.postesImprimantes?.[poste]);
  const p = config.postesProduction?.[poste];
  return p?.adresse.trim() ? { id: `ancien-${poste}`, nom: poste, branchement: { type: "epson", adresse: p.adresse.trim() }, sansAccents: p.sansAccents } : null;
}

/** Imprimantes de production en service : au moins un poste relié à une imprimante. */
export function productionActive(config: Configuration): boolean {
  if (config.imprimantes) return Object.keys(config.postesImprimantes ?? {}).some((poste) => imprimantePoste(config, poste));
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
  const { caisse, config, utilisateur, notifier } = useCaisse();
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
          const imprimante = imprimantePoste(config, bon.poste);
          if (!imprimante) {
            sansImprimante.add(bon.poste);
            continue;
          }
          try {
            await imprimerSur({
              config,
              client: caisse.client,
              imprimante,
              recu: gabaritBon(bon, c, config, utilisateur.id),
              titre: `Bon ${bon.poste}`,
              surEchec: (e) => notifier(`${bon.poste} : bon non sorti sur « ${imprimante.nom} » (${e}). À préparer d'après l'écran.`, "erreur"),
            });
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
    [caisse.client, config, utilisateur.id, notifier],
  );
}

/**
 * « Réclamer » une suite : ce qui reste à envoyer part d'abord (la suite
 * réclamée y est marquée « réclamé »), puis chaque poste qui en tient déjà des
 * articles reçoit un bon de réclame. La réclame est notée sur la commande
 * (heure, qui) ; si un bon de réclame n'a pas pu s'imprimer, elle ne l'est pas
 * et le bouton reste là pour réessayer.
 */
export function useReclame() {
  const { caisse, config, utilisateur, notifier } = useCaisse();
  const envoyer = useEnvoiProduction();
  return useCallback(
    async (c: Commande, carte: Catalogue, suite: SuiteAttente): Promise<(c: Commande) => Commande> => {
      const par = utilisateur.id;
      const majEnvoi = await envoyer(reclamer(c, suite, par), carte);
      const echecs: string[] = [];
      const imprimes: string[] = [];
      if (productionActive(config)) {
        for (const bon of bonsReclame(c, carte, suite)) {
          const imprimante = imprimantePoste(config, bon.poste);
          if (!imprimante) continue;
          try {
            await imprimerSur({
              config,
              client: caisse.client,
              imprimante,
              recu: gabaritBon(bon, reclamer(c, suite, par), config, par),
              titre: `Réclame ${bon.poste}`,
              surEchec: (e) => notifier(`${bon.poste} : réclame non sortie sur « ${imprimante.nom} » (${e}). Réclamez à nouveau.`, "erreur"),
            });
            imprimes.push(bon.poste);
          } catch (e) {
            echecs.push(bon.poste);
            notifier(`${bon.poste} : réclame non imprimée (${e instanceof Error ? e.message : String(e)}). Réclamez à nouveau.`, "erreur");
          }
        }
      }
      if (!echecs.length) notifier(`${nomSuite(suite)} réclamée${imprimes.length ? ` : ${imprimes.join(", ")}` : ""}.`);
      return (derniere) => {
        const envoyee = majEnvoi ? majEnvoi(derniere) : derniere;
        return echecs.length ? envoyee : reclamer(envoyee, suite, par);
      };
    },
    [caisse.client, config, utilisateur.id, notifier, envoyer],
  );
}
