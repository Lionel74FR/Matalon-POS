import { nouvelIdImprimante, type ImprimanteEtablissement } from "@matalon/serveur/partage";
import { imprimantesRecues, type Configuration } from "../donnees/configuration";
import type { ClientApi } from "../serveur/client";
import { envoyerEpson, ErreurImpression } from "./epson";
import { logoTicketSerie } from "./logo-serie";
import { Recu } from "./recu";
import { imprimerParRelais } from "./relais";
import { envoyerReseau, imprimerReseau } from "./reseau";
import { envoyerOctets, envoyerSerie } from "./serie";
import { COUPES_PARTIELLES_ESSAI, versEscPos } from "./escpos";

export type { ImprimanteEtablissement };

/**
 * Imprimantes de l'établissement (16 novembre 2026, demande de Lionel) : une liste réglée une fois,
 * où les postes de production et chaque appareil (tickets, additions) choisissent. La caisse trouve le
 * chemin : une Epson en direct ; une imprimante portée par une dalle (série, ou réseau ESC/POS par son
 * script) en direct sur cette dalle, et par elle depuis les autres appareils (impression relayée).
 */

/** Port série de cette dalle pour une imprimante qu'elle porte (propre à l'appareil : autorisation de Chrome). */
export interface PortSerie {
  rang: number;
  bauds: number;
  /** Logo enregistré dans l'imprimante (clé de `cleLogo`) : les tickets ne l'envoient plus. */
  logoMemoire?: string;
}

export function imprimanteParId(config: Pick<Configuration, "imprimantes">, id: string | null | undefined): ImprimanteEtablissement | null {
  return (id && config.imprimantes?.find((i) => i.id === id)) || null;
}

/** Imprimantes que cet appareil porte (série sur son port COM, ou réseau par son script). */
export function imprimantesPortees(config: Pick<Configuration, "imprimantes" | "caisseId">): ImprimanteEtablissement[] {
  return (config.imprimantes ?? []).filter((i) => i.branchement.type !== "epson" && i.branchement.dalleId === config.caisseId);
}

/** Description courte du branchement, pour les réglages. */
export function descriptionBranchement(i: ImprimanteEtablissement, appareils: Record<string, string> = {}): string {
  const b = i.branchement;
  if (b.type === "epson") return `Epson réseau · ${b.adresse}`;
  const dalle = appareils[b.dalleId] ?? "dalle inconnue";
  return b.type === "serie" ? `série sur ${dalle}` : `réseau ${b.adresse} par ${dalle}`;
}

/** Imprime sur une imprimante que cet appareil joint lui-même (Epson, ou portée par lui). */
export async function imprimerIci(config: Configuration, i: ImprimanteEtablissement, recu: Recu): Promise<void> {
  const b = i.branchement;
  if (b.type === "epson") return envoyerEpson(b.adresse, recu, { sansAccents: i.sansAccents });
  if (b.dalleId !== config.caisseId) throw new ErreurImpression(`« ${i.nom} » est portée par un autre appareil.`, "injoignable");
  const coupePartielle = i.coupe === "partielle";
  if (b.type === "reseau") return imprimerReseau(recu, { adresse: b.adresse, sansAccents: i.sansAccents, coupePartielle }, config);
  const port = config.portsSerie?.[i.id];
  if (!port) {
    throw new ErreurImpression(`Port COM de « ${i.nom} » pas encore choisi sur cet appareil : Réglages › Imprimantes portées par cet appareil.`, "injoignable");
  }
  return envoyerSerie(recu, { rang: port.rang, bauds: port.bauds, sansAccents: i.sansAccents, coupePartielle, logo: await logoTicketSerie(config, port.logoMemoire) });
}

/**
 * Essai des commandes de coupe partielle (18 novembre 2026) : un petit ticket par commande, sa lettre en grand,
 * pour repérer celle que l'imprimante comprend (le ticket reste accroché).
 */
export async function essaiCoupesPartielles(config: Configuration, i: ImprimanteEtablissement): Promise<void> {
  const b = i.branchement;
  if (b.type === "epson") throw new ErreurImpression("Une Epson ne fait que la coupe totale.", "refus");
  for (const c of COUPES_PARTIELLES_ESSAI) {
    const recu = new Recu().texte(`Coupe ${c.nom}`, { gras: true, grand: true, align: "centre" }).texte("Le ticket reste-t-il accroché ?", { align: "centre" });
    const octets = versEscPos(recu, { sansAccents: i.sansAccents, commandeCoupe: c.octets });
    if (b.type === "reseau") await envoyerReseau(octets, b.adresse);
    else {
      const port = config.portsSerie?.[i.id];
      if (!port) throw new ErreurImpression(`Port COM de « ${i.nom} » pas encore choisi sur cet appareil.`, "injoignable");
      await envoyerOctets(octets, port);
    }
  }
}

/**
 * Imprime sur une imprimante de l'établissement, en direct ou par la dalle qui la porte. Rejette si
 * l'impression échoue tout de suite ; pour une impression relayée, `surEchec` dit plus tard si la dalle
 * ne l'a pas sortie.
 */
export async function imprimerSur(o: {
  config: Configuration;
  client: ClientApi;
  imprimante: ImprimanteEtablissement;
  recu: Recu;
  titre: string;
  surEchec: (erreur: string) => void;
}): Promise<void> {
  const b = o.imprimante.branchement;
  if (b.type === "epson" || b.dalleId === o.config.caisseId) return imprimerIci(o.config, o.imprimante, o.recu);
  return imprimerParRelais(o.client, { imprimanteId: o.imprimante.id }, o.recu, o.titre, o.surEchec);
}

/**
 * Epson connectée par l'assistant (certificat accepté sur cet appareil) : rejoint la liste de
 * l'établissement si elle n'y est pas, et devient l'imprimante des tickets de cet appareil. Hors ligne,
 * elle reste sur cet appareil seul (ancien réglage) jusqu'au prochain passage.
 */
export async function adopterEpson(
  client: ClientApi,
  config: Configuration,
  epson: { adresse: string; sansAccents: boolean },
): Promise<{ config: Configuration; partagee: boolean }> {
  const liste = config.imprimantes;
  if (liste) {
    try {
      let suivante = config;
      let i = liste.find((x) => x.branchement.type === "epson" && x.branchement.adresse === epson.adresse);
      if (!i) {
        let nom = "Epson";
        for (let k = 2; liste.some((x) => x.nom.toLowerCase() === nom.toLowerCase()); k++) nom = `Epson ${k}`;
        i = { id: nouvelIdImprimante(), nom, branchement: { type: "epson", adresse: epson.adresse }, sansAccents: epson.sansAccents };
        const { etablissement: e } = await client.enregistrerImprimantes({ imprimantes: [...liste, i], postes: config.postesImprimantes ?? {} });
        suivante = { ...config, ...imprimantesRecues(config, e) };
      }
      return { config: { ...suivante, imprimanteTicketsId: i.id }, partagee: true };
    } catch {
      // Hors ligne : gardée sur cet appareil.
    }
  }
  const { imprimanteTicketsId: _, ...sans } = config;
  return { config: { ...sans, imprimante: epson, imprimanteConnue: epson }, partagee: false };
}
