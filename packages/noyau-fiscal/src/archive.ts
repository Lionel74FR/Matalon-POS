import { canonique } from "./canonique.js";
import { sha256Hex, verifierSignature, type ResolveurCle, type Signataire } from "./crypto.js";
import type { StockageFiscal } from "./stockage.js";
import type { Cloture, Evenement, Ticket } from "./types.js";
import { ErreurFiscale } from "./types.js";
import { NOM_LOGICIEL, VERSION_NOYAU_FISCAL } from "./version.js";
import { champsTotaux, totauxClotures, totauxTickets } from "./registre.js";
import { verifierChaine, verifierScellement, verifierTotauxTickets, type Anomalie } from "./verification.js";

export const FORMAT_ARCHIVE = "matalon-archive-fiscale/1";

export interface ContenuArchive {
  format: typeof FORMAT_ARCHIVE;
  logiciel: string;
  versionLogiciel: string;
  etablissementId: string;
  caisseId: string;
  genereeLe: string;
  cloture: Cloture;
  /** Clôtures agrégées par `cloture` (MOIS, EXERCICE). */
  cloturesAgregees: Cloture[];
  tickets: Ticket[];
  evenements: Evenement[];
  /** Points d'ancrage permettant de vérifier la chaîne sans les enregistrements antérieurs. */
  ancrages: {
    ticketPrecedent: { numero: number; hash: string; grandTotalPerpetuel: number; cumulPerpetuelAbsolu: number } | null;
    evenementPrecedent: { numero: number; hash: string } | null;
  };
}

export interface ArchiveFiscale extends ContenuArchive {
  empreinte: string;
  signature: string;
  cleId: string;
}

/**
 * Construit l'archive signée d'une clôture : tous les tickets et événements
 * qu'elle couvre, lisibles sans le logiciel (JSON) et vérifiables seuls.
 */
export async function construireArchive(
  stockage: StockageFiscal,
  numeroCloture: number,
  signataire: Signataire,
  maintenant: Date = new Date(),
): Promise<ArchiveFiscale> {
  const cloture = await stockage.trouver("clotures", numeroCloture);
  if (!cloture) throw new ErreurFiscale("CLOTURE_INCONNUE", `clôture ${numeroCloture} introuvable`);

  const cloturesAgregees = await Promise.all(
    cloture.cloturesAgregees.map(async (n) => {
      const c = await stockage.trouver("clotures", n);
      if (!c) throw new ErreurFiscale("CLOTURE_INCONNUE", `clôture agrégée ${n} introuvable`);
      return c;
    }),
  );

  const tickets =
    cloture.premierTicket != null && cloture.dernierTicket != null
      ? await stockage.lister("tickets", cloture.premierTicket, cloture.dernierTicket)
      : [];
  const evenements =
    cloture.premierEvenement != null && cloture.dernierEvenement != null
      ? await stockage.lister("evenements", cloture.premierEvenement, cloture.dernierEvenement)
      : [];

  const tPrec = cloture.premierTicket && cloture.premierTicket > 1
    ? await stockage.trouver("tickets", cloture.premierTicket - 1)
    : null;
  const ePrec = cloture.premierEvenement && cloture.premierEvenement > 1
    ? await stockage.trouver("evenements", cloture.premierEvenement - 1)
    : null;

  const contenu: ContenuArchive = {
    format: FORMAT_ARCHIVE,
    logiciel: NOM_LOGICIEL,
    versionLogiciel: VERSION_NOYAU_FISCAL,
    etablissementId: cloture.etablissementId,
    caisseId: cloture.caisseId,
    genereeLe: maintenant.toISOString(),
    cloture,
    cloturesAgregees,
    tickets,
    evenements,
    ancrages: {
      ticketPrecedent: tPrec
        ? {
            numero: tPrec.numero,
            hash: tPrec.hash,
            grandTotalPerpetuel: tPrec.grandTotalPerpetuel,
            cumulPerpetuelAbsolu: tPrec.cumulPerpetuelAbsolu,
          }
        : null,
      evenementPrecedent: ePrec ? { numero: ePrec.numero, hash: ePrec.hash } : null,
    },
  };
  const empreinte = await sha256Hex(canonique(contenu));
  return { ...contenu, empreinte, signature: await signataire.signer(empreinte), cleId: signataire.cleId };
}

/** Vérifie une archive isolée : empreinte, signature, chaînes et totaux. */
export async function verifierArchive(
  archive: ArchiveFiscale,
  resoudreCle: ResolveurCle,
): Promise<{ integre: boolean; anomalies: Array<Anomalie | { code: string; detail: string }> }> {
  const { empreinte, signature, cleId, ...contenu } = archive;
  const anomalies: Array<Anomalie | { code: string; detail: string }> = [];

  if ((await sha256Hex(canonique(contenu))) !== empreinte) {
    anomalies.push({ code: "ARCHIVE_MODIFIEE", detail: "l'empreinte de l'archive ne correspond pas" });
  }
  const cle = await resoudreCle(cleId);
  if (!cle || !(await verifierSignature(cle, empreinte, signature))) {
    anomalies.push({ code: "SIGNATURE_ARCHIVE_INVALIDE", detail: "signature de l'archive non valide" });
  }

  const { ticketPrecedent, evenementPrecedent } = contenu.ancrages;
  anomalies.push(
    ...(await verifierChaine("tickets", contenu.tickets, resoudreCle, ticketPrecedent ?? undefined)),
    ...(await verifierChaine("evenements", contenu.evenements, resoudreCle, evenementPrecedent ?? undefined)),
    ...verifierTotauxTickets(
      contenu.tickets,
      ticketPrecedent?.grandTotalPerpetuel ?? 0,
      ticketPrecedent?.cumulPerpetuelAbsolu ?? 0,
    ),
  );

  // La clôture archivée et ses sources doivent être authentiques et exactes.
  anomalies.push(...(await verifierScellement("clotures", contenu.cloture, resoudreCle)));
  for (const c of contenu.cloturesAgregees) anomalies.push(...(await verifierScellement("clotures", c, resoudreCle)));
  const attendus =
    contenu.cloture.periode === "JOUR" ? totauxTickets(contenu.tickets) : totauxClotures(contenu.cloturesAgregees);
  if (canonique(champsTotaux(contenu.cloture)) !== canonique(champsTotaux(attendus))) {
    anomalies.push({ code: "TOTAUX_CLOTURE", detail: "les totaux de la clôture ne correspondent pas au contenu archivé" });
  }
  const dernierEvt = contenu.evenements.at(-1);
  if ((dernierEvt?.hash ?? null) !== contenu.cloture.hashDernierEvenement) {
    anomalies.push({ code: "EVENEMENTS_INCOMPLETS", detail: "le journal archivé ne s'arrête pas où la clôture l'indique" });
  }

  const dernier = contenu.tickets.at(-1);
  if (contenu.cloture.dernierTicket != null && dernier?.hash !== contenu.cloture.hashDernierTicket) {
    anomalies.push({ code: "CLOTURE_DETACHEE", detail: "la clôture ne pointe pas sur le dernier ticket archivé" });
  }
  return { integre: anomalies.length === 0, anomalies };
}
