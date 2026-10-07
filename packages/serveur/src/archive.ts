/**
 * Archive d'une clôture produite depuis la copie du serveur, et sa vérification.
 *
 * Le serveur ne détient pas la clé de l'iPad : l'archive n'a pas de signature
 * d'ensemble, contrairement à celle produite par l'iPad (`construireArchive`).
 * Chaque enregistrement y garde la signature de l'iPad ; la clé publique jointe
 * doit être comparée à celle enregistrée au rattachement (empreinte affichée
 * dans l'administration) avant de faire foi.
 */
import {
  canonique,
  champsTotaux,
  sha256Hex,
  totauxClotures,
  totauxTickets,
  verifierChaine,
  verifierCorrections,
  verifierScellement,
  verifierTotauxTickets,
  type Cloture,
  type Evenement,
  type Ticket,
} from "@matalon/noyau-fiscal";

export const FORMAT_ARCHIVE_SERVEUR = "matalon-archive-serveur/1";

export interface ContenuArchiveServeur {
  format: typeof FORMAT_ARCHIVE_SERVEUR;
  logiciel: string;
  versionLogiciel: string;
  etablissementId: string;
  caisseId: string;
  genereeLe: string;
  cleId: string;
  clePublique: JsonWebKey;
  empreinteCle: string;
  cloture: Cloture;
  cloturesAgregees: Cloture[];
  tickets: Ticket[];
  evenements: Evenement[];
  ancrages: {
    ticketPrecedent: { numero: number; hash: string; grandTotalPerpetuel: number; cumulPerpetuelAbsolu: number } | null;
    evenementPrecedent: { numero: number; hash: string } | null;
  };
}

/** Empreinte d'une clé publique (la même que celle affichée par l'iPad dans ses réglages). */
export function empreinteCle(jwk: JsonWebKey): Promise<string> {
  return sha256Hex(canonique({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y }));
}

/**
 * Vérifie une archive serveur seule : empreinte du fichier, clé attendue,
 * signatures et chaînage, totaux, rattachement de la clôture aux tickets et
 * au journal. Mêmes contrôles que `verifierArchive` du noyau, hors signature
 * d'ensemble.
 */
export async function verifierArchiveServeur(
  archive: ContenuArchiveServeur & { empreinte: string },
  empreinteCleAttendue: string,
): Promise<{ integre: boolean; anomalies: Array<{ code: string; detail?: string }> }> {
  const { empreinte, ...contenu } = archive;
  const anomalies: Array<{ code: string; detail?: string }> = [];
  if ((await sha256Hex(canonique(contenu))) !== empreinte) anomalies.push({ code: "ARCHIVE_MODIFIEE", detail: "empreinte du fichier" });
  const empreinteJointe = await empreinteCle(contenu.clePublique);
  if (empreinteJointe !== empreinteCleAttendue || contenu.empreinteCle !== empreinteCleAttendue) {
    anomalies.push({ code: "CLE_INATTENDUE", detail: "la clé jointe n'est pas celle de la caisse" });
  }
  const resoudre = (id: string) => (id === contenu.cleId ? contenu.clePublique : null);
  const { ticketPrecedent, evenementPrecedent } = contenu.ancrages;
  anomalies.push(
    ...(await verifierChaine("tickets", contenu.tickets, resoudre, ticketPrecedent ?? undefined)),
    ...(await verifierChaine("evenements", contenu.evenements, resoudre, evenementPrecedent ?? undefined)),
    ...verifierTotauxTickets(contenu.tickets, ticketPrecedent?.grandTotalPerpetuel ?? 0, ticketPrecedent?.cumulPerpetuelAbsolu ?? 0),
    ...verifierCorrections(contenu.tickets),
    ...(await verifierScellement("clotures", contenu.cloture, resoudre)),
  );
  for (const c of contenu.cloturesAgregees) anomalies.push(...(await verifierScellement("clotures", c, resoudre)));
  const attendus = contenu.cloture.periode === "JOUR" ? totauxTickets(contenu.tickets) : totauxClotures(contenu.cloturesAgregees);
  if (canonique(champsTotaux(contenu.cloture)) !== canonique(champsTotaux(attendus))) anomalies.push({ code: "TOTAUX_CLOTURE" });
  if ((contenu.evenements.at(-1)?.hash ?? null) !== contenu.cloture.hashDernierEvenement) anomalies.push({ code: "EVENEMENTS_INCOMPLETS" });
  if (contenu.cloture.dernierTicket != null && contenu.tickets.at(-1)?.hash !== contenu.cloture.hashDernierTicket) anomalies.push({ code: "CLOTURE_DETACHEE" });
  return { integre: anomalies.length === 0, anomalies };
}
