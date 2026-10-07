/**
 * Archive d'une clôture produite depuis la copie du serveur, et sa vérification.
 *
 * Le serveur ne détient pas la clé de l'iPad : l'archive n'a pas de signature
 * d'ensemble, contrairement à celle produite par l'iPad (`construireArchive`).
 * Chaque enregistrement y garde la signature de sa caisse ; les clés publiques
 * jointes doivent être comparées à celles enregistrées au rattachement
 * (empreintes affichées dans l'administration) avant de faire foi.
 *
 * Format 2 (noyau 0.7.0) : une clôture d'établissement couvre plusieurs
 * caisses. La partie de la caisse qui a clôturé reste au premier niveau
 * (comme au format 1) ; `autresCaisses` porte, pour chacune des autres, sa clé
 * et les tickets et événements que la clôture couvre.
 */
import {
  canonique,
  champsTotaux,
  cleRef,
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

export const FORMAT_ARCHIVE_SERVEUR = "matalon-archive-serveur/2";

type Ancrages = {
  ticketPrecedent: { numero: number; hash: string; grandTotalPerpetuel: number; cumulPerpetuelAbsolu: number } | null;
  evenementPrecedent: { numero: number; hash: string } | null;
};

/** Ce qu'une archive contient d'une caisse. */
export interface PartieCaisse {
  caisseId: string;
  cleId: string;
  clePublique: JsonWebKey;
  empreinteCle: string;
  tickets: Ticket[];
  evenements: Evenement[];
  ancrages: Ancrages;
}

export interface ContenuArchiveServeur extends Omit<PartieCaisse, "caisseId"> {
  format: typeof FORMAT_ARCHIVE_SERVEUR | "matalon-archive-serveur/1";
  logiciel: string;
  versionLogiciel: string;
  etablissementId: string;
  caisseId: string;
  genereeLe: string;
  cloture: Cloture;
  cloturesAgregees: Cloture[];
  /** Format 2 : les autres caisses de la clôture. */
  autresCaisses?: PartieCaisse[];
}

/** Empreinte d'une clé publique (la même que celle affichée par l'iPad dans ses réglages). */
export function empreinteCle(jwk: JsonWebKey): Promise<string> {
  return sha256Hex(canonique({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y }));
}

/**
 * Vérifie une archive serveur seule : empreinte du fichier, clés attendues,
 * signatures et chaînage de chaque caisse, totaux, rattachement de la clôture
 * aux tickets et aux journaux. `empreintesAttendues` : l'empreinte de la clé
 * de la caisse (format 1), ou celle de chaque caisse par identifiant.
 */
export async function verifierArchiveServeur(
  archive: ContenuArchiveServeur & { empreinte: string },
  empreintesAttendues: string | Record<string, string>,
): Promise<{ integre: boolean; anomalies: Array<{ code: string; detail?: string }> }> {
  const { empreinte, ...contenu } = archive;
  const anomalies: Array<{ code: string; detail?: string }> = [];
  if ((await sha256Hex(canonique(contenu))) !== empreinte) anomalies.push({ code: "ARCHIVE_MODIFIEE", detail: "empreinte du fichier" });
  const attendue = (id: string) => (typeof empreintesAttendues === "string" ? (id === contenu.caisseId ? empreintesAttendues : undefined) : empreintesAttendues[id]);
  const parties: PartieCaisse[] = [
    { caisseId: contenu.caisseId, cleId: contenu.cleId, clePublique: contenu.clePublique, empreinteCle: contenu.empreinteCle, tickets: contenu.tickets, evenements: contenu.evenements, ancrages: contenu.ancrages },
    ...(contenu.autresCaisses ?? []),
  ];
  const cles = new Map<string, JsonWebKey>();
  for (const p of parties) {
    const jointe = await empreinteCle(p.clePublique);
    if (jointe !== attendue(p.caisseId) || p.empreinteCle !== jointe) {
      anomalies.push({ code: "CLE_INATTENDUE", detail: `la clé jointe n'est pas celle de la caisse ${p.caisseId}` });
    }
    if (!p.cleId.startsWith(`${p.caisseId}-k`)) anomalies.push({ code: "CLE_INATTENDUE", detail: `clé ${p.cleId}` });
    cles.set(p.cleId, p.clePublique);
  }
  const resoudre = (id: string) => cles.get(id) ?? null;
  for (const p of parties) {
    const { ticketPrecedent, evenementPrecedent } = p.ancrages;
    const etrangers = [...p.tickets, ...p.evenements].filter((e) => e.caisseId !== p.caisseId);
    if (etrangers.length) anomalies.push({ code: "CAISSE_INATTENDUE", detail: `enregistrements d'une autre caisse dans la partie ${p.caisseId}` });
    anomalies.push(
      ...(await verifierChaine("tickets", p.tickets, resoudre, ticketPrecedent ?? undefined)),
      ...(await verifierChaine("evenements", p.evenements, resoudre, evenementPrecedent ?? undefined)),
      ...verifierTotauxTickets(p.tickets, ticketPrecedent?.grandTotalPerpetuel ?? 0, ticketPrecedent?.cumulPerpetuelAbsolu ?? 0),
      ...verifierCorrections(p.tickets),
    );
  }
  const c = contenu.cloture;
  anomalies.push(...(await verifierScellement("clotures", c, resoudre)));
  for (const a of contenu.cloturesAgregees) anomalies.push(...(await verifierScellement("clotures", a, resoudre)));
  const tous = parties.flatMap((p) => p.tickets);
  const attendus = c.periode === "JOUR" ? totauxTickets(tous) : totauxClotures(contenu.cloturesAgregees);
  if (canonique(champsTotaux(c)) !== canonique(champsTotaux(attendus))) anomalies.push({ code: "TOTAUX_CLOTURE" });
  if ((contenu.evenements.at(-1)?.hash ?? null) !== c.hashDernierEvenement) anomalies.push({ code: "EVENEMENTS_INCOMPLETS" });
  if (c.dernierTicket != null && contenu.tickets.at(-1)?.hash !== c.hashDernierTicket) anomalies.push({ code: "CLOTURE_DETACHEE" });

  const e = c.etablissement;
  if (e) {
    if (c.periode === "JOUR") {
      // Chaque caisse : exactement la plage annoncée par la Z, ni plus ni moins.
      for (const x of e.caisses) {
        const p = parties.find((q) => q.caisseId === x.caisseId);
        const numeros = p?.tickets.map((t) => t.numero) ?? [];
        const attendusNumeros = x.premierTicket == null ? [] : Array.from({ length: x.dernierTicketCouvert - x.premierTicket + 1 }, (_, i) => x.premierTicket! + i);
        if (canonique(numeros) !== canonique(attendusNumeros) || (x.premierTicket != null && p!.tickets.at(-1)?.hash !== x.hashDernierTicketCouvert)) {
          anomalies.push({ code: "CLOTURE_DETACHEE", detail: `tickets de ${x.caisseId}` });
        }
        const evts = p?.evenements ?? [];
        const debutOk = x.premierEvenement == null ? evts.length === 0 : evts[0]?.numero === x.premierEvenement && evts.at(-1)?.numero === x.dernierEvenement && evts.at(-1)?.hash === x.hashDernierEvenement;
        if (!debutOk) anomalies.push({ code: "EVENEMENTS_INCOMPLETS", detail: `journal de ${x.caisseId}` });
      }
      if (parties.some((p) => !e.caisses.some((x) => x.caisseId === p.caisseId))) anomalies.push({ code: "CAISSE_INATTENDUE" });
    } else {
      const agregees = contenu.cloturesAgregees.map(cleRef);
      if (canonique(agregees) !== canonique(e.agregees.map(cleRef)) || contenu.cloturesAgregees.some((a, i) => a.hash !== e.agregees[i]!.hash)) {
        anomalies.push({ code: "AGREGAT_INVALIDE", detail: "les clôtures agrégées jointes ne sont pas celles désignées" });
      }
    }
  }
  return { integre: anomalies.length === 0, anomalies };
}
