import { createContext, useContext } from "react";
import type { Configuration, Utilisateur } from "../donnees/configuration";
import type { Caisse } from "../fiscal/caisse";
import type { Recu } from "../impression/recu";

export interface ContexteCaisse {
  caisse: Caisse;
  config: Configuration;
  utilisateur: Utilisateur;
  majConfig(config: Configuration): Promise<void>;
  notifier(message: string, ton?: "info" | "erreur"): void;
  /** Une adresse d'imprimante est enregistrée. Sans elle, rien ne s'imprime d'office. */
  imprimanteConfiguree: boolean;
  /** Imprime ; sans imprimante ou en cas d'échec, affiche l'aperçu à l'écran. */
  imprimer(recu: Recu, titre: string): Promise<void>;
  /**
   * Renvoie l'identifiant d'un responsable : l'utilisateur connecté s'il l'est,
   * sinon celui qui saisit son code PIN. `null` si la demande est annulée.
   */
  demanderResponsable(raison: string): Promise<string | null>;
  deconnecter(): void;
}

export const Contexte = createContext<ContexteCaisse | null>(null);

export function useCaisse(): ContexteCaisse {
  const c = useContext(Contexte);
  if (!c) throw new Error("useCaisse hors du contexte de caisse");
  return c;
}

export const euros = (centimes: number) =>
  (centimes / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
