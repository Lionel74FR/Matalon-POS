import { baseHT, type Evenement, type Registre, type StockageFiscal, type Ticket } from "@matalon/noyau-fiscal";
import type { Etablissement } from "../donnees/configuration";

/**
 * Factures sur demande, établies à partir d'un ticket.
 *
 * Chaque facture est un événement FACTURE du journal chaîné et signé : elle ne
 * peut être ni modifiée ni supprimée, et sa numérotation (une série par caisse)
 * est continue par construction. Le contenu chiffré vient du ticket d'origine,
 * lié par son numéro et son empreinte.
 */

export interface ClientFacture {
  nom: string;
  adresse: string;
  codePostalVille: string;
  /** SIREN ou SIRET du client professionnel, facultatif. */
  siren: string;
  tvaIntracom: string;
}

export interface Facture {
  evenement: Evenement;
  /** Un avoir annule une facture : il accompagne le ticket d'annulation de la vente facturée. */
  nature: "FACTURE" | "AVOIR";
  factureOrigine: string | null;
  sequence: number;
  numero: string;
  ticket: number;
  client: ClientFacture;
}

export const CLIENT_VIDE: ClientFacture = { nom: "", adresse: "", codePostalVille: "", siren: "", tvaIntracom: "" };

/** « F-1DE068F6-000012 » : série propre à la caisse, numéro séquentiel sans trou. */
export function numeroFacture(caisseId: string, sequence: number): string {
  return `F-${caisseId.replace(/^ipad-/, "").toUpperCase()}-${String(sequence).padStart(6, "0")}`;
}

function versFacture(e: Evenement): Facture {
  const d = e.details;
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    evenement: e,
    nature: d.nature === "AVOIR" ? "AVOIR" : "FACTURE",
    factureOrigine: typeof d.factureOrigine === "string" ? d.factureOrigine : null,
    sequence: Number(d.sequence),
    numero: s(d.numero),
    ticket: Number(d.ticket),
    client: { nom: s(d.clientNom), adresse: s(d.clientAdresse), codePostalVille: s(d.clientCodePostalVille), siren: s(d.clientSiren), tvaIntracom: s(d.clientTva) },
  };
}

/** Le journal est en ajout seul : on ne relit que les événements écrits depuis la dernière lecture. */
const caches = new WeakMap<StockageFiscal, { jusqua: number; factures: Facture[]; impressions: Map<string, number> }>();

async function lireJournal(stockage: StockageFiscal) {
  const cache = caches.get(stockage) ?? { jusqua: 0, factures: [], impressions: new Map<string, number>() };
  const dernier = (await stockage.dernier("evenements"))?.numero ?? 0;
  if (dernier > cache.jusqua) {
    for (const e of await stockage.lister("evenements", cache.jusqua + 1, dernier)) {
      if (e.code === "FACTURE") cache.factures.push(versFacture(e));
      const f = e.details.facture;
      if ((e.code === "IMPRESSION_TICKET" || e.code === "REIMPRESSION_TICKET") && typeof f === "string") {
        cache.impressions.set(f, (cache.impressions.get(f) ?? 0) + 1);
      }
    }
    cache.jusqua = dernier;
    caches.set(stockage, cache);
  }
  return cache;
}

export async function listerFactures(stockage: StockageFiscal): Promise<Facture[]> {
  return [...(await lireJournal(stockage)).factures];
}

/** Nombre d'impressions déjà tracées d'une facture : au-delà de la première, c'est un duplicata. */
export async function impressionsFacture(stockage: StockageFiscal, numero: string): Promise<number> {
  return (await lireJournal(stockage)).impressions.get(numero) ?? 0;
}

/** Trace l'impression d'une facture (la première en original, les suivantes en duplicata). */
export async function tracerImpressionFacture(registre: Registre, stockage: StockageFiscal, f: Facture, canal: string, operateurId: string) {
  const deja = await impressionsFacture(stockage, f.numero);
  await registre.journaliser(deja ? "REIMPRESSION_TICKET" : "IMPRESSION_TICKET", { facture: f.numero, ticket: f.ticket, canal, duplicata: deja }, operateurId);
}

/** Nature de l'opération (mention de la facture) : restauration sur place, ou vente de denrées à 5,5 %. */
export function natureOperation(t: Ticket): string {
  return t.lignes.some((l) => l.tauxTVA === 550) ? "Livraison de biens et prestation de services" : "Prestation de services (restauration sur place)";
}

/** Mentions exigées entre professionnels (art. L441-9 et L441-10 du Code de commerce). */
export const MENTIONS_PROFESSIONNELS =
  "Échéance : paiement comptant, à la date d'émission. Pénalités de retard : taux de la BCE majoré de 10 points. Indemnité forfaitaire pour frais de recouvrement : 40 €.";

/** Mentions légales du vendeur manquantes pour émettre une facture. */
export function mentionsVendeurManquantes(e: Etablissement): string[] {
  const manque: string[] = [];
  if (!e.raisonSociale) manque.push("raison sociale");
  if (!e.adresse || !e.codePostalVille) manque.push("adresse");
  if (!/^\d{14}$/.test(e.siret)) manque.push("SIRET");
  if (!e.tvaIntracom) manque.push("n° de TVA intracommunautaire");
  if (!e.mentionsLegales) manque.push("forme juridique, capital et RCS");
  return manque;
}

export function controlerClient(c: ClientFacture): string | null {
  if (c.nom.trim().length < 2) return "Indiquez le nom ou la raison sociale du client.";
  if (!c.adresse.trim() || !c.codePostalVille.trim()) return "L'adresse du client est obligatoire sur une facture.";
  const siren = c.siren.replace(/\s/g, "");
  if (siren && !/^\d{9}(\d{5})?$/.test(siren)) return "Le SIREN compte 9 chiffres (14 pour un SIRET).";
  return null;
}

let file: Promise<unknown> = Promise.resolve();

/**
 * Émet la facture d'un ticket, ou renvoie celle déjà émise (une seule facture
 * par ticket ; les suivantes sont des duplicatas). Les émissions sont
 * sérialisées pour que deux touches rapprochées ne prennent pas le même numéro.
 */
export function emettreFacture(
  registre: Registre,
  stockage: StockageFiscal,
  o: { ticket: Ticket; client: ClientFacture; operateurId: string; caisseId: string },
): Promise<{ facture: Facture; existante: boolean }> {
  const suite = file.then(async () => {
    if (o.ticket.type !== "VENTE") throw new Error("Une facture s'établit sur une vente, pas sur une annulation.");
    if (o.ticket.totalTTC <= 0) throw new Error("Ce ticket n'a pas de montant à facturer.");
    const annulation = (await stockage.lister("tickets", o.ticket.numero + 1)).find((t) => t.ticketOrigine?.numero === o.ticket.numero);
    if (annulation) throw new Error(`Ce ticket a été annulé (ticket n° ${annulation.numero}) : pas de facture possible.`);
    const factures = await listerFactures(stockage);
    const deja = factures.find((f) => f.nature === "FACTURE" && f.ticket === o.ticket.numero);
    if (deja) return { facture: deja, existante: true };
    const erreur = controlerClient(o.client);
    if (erreur) throw new Error(erreur);

    const sequence = factures.reduce((m, f) => Math.max(m, f.sequence), 0) + 1;
    const c = o.client;
    const evenement = await registre.journaliser(
      "FACTURE",
      {
        nature: "FACTURE",
        sequence,
        numero: numeroFacture(o.caisseId, sequence),
        ticket: o.ticket.numero,
        hashTicket: o.ticket.hash,
        totalTTC: o.ticket.totalTTC,
        clientNom: c.nom.trim(),
        clientAdresse: c.adresse.trim(),
        clientCodePostalVille: c.codePostalVille.trim(),
        clientSiren: c.siren.replace(/\s/g, "") || null,
        clientTva: c.tvaIntracom.replace(/\s/g, "").toUpperCase() || null,
      },
      o.operateurId,
    );
    return { facture: versFacture(evenement), existante: false };
  });
  file = suite.catch(() => undefined);
  return suite;
}

/**
 * Avoir accompagnant l'annulation d'une vente déjà facturée. Il reprend le
 * client de la facture et prend le numéro suivant de la même série.
 */
export function emettreAvoir(
  registre: Registre,
  stockage: StockageFiscal,
  o: { annulation: Ticket; operateurId: string; caisseId: string },
): Promise<Facture | null> {
  const suite = file.then(async () => {
    const origine = o.annulation.ticketOrigine?.numero;
    if (o.annulation.type !== "ANNULATION" || origine == null) return null;
    const factures = await listerFactures(stockage);
    const facture = factures.find((f) => f.nature === "FACTURE" && f.ticket === origine);
    if (!facture) return null;
    const existant = factures.find((f) => f.nature === "AVOIR" && f.ticket === o.annulation.numero);
    if (existant) return existant;
    const sequence = factures.reduce((m, f) => Math.max(m, f.sequence), 0) + 1;
    const c = facture.client;
    const evenement = await registre.journaliser(
      "FACTURE",
      {
        nature: "AVOIR",
        sequence,
        numero: numeroFacture(o.caisseId, sequence),
        factureOrigine: facture.numero,
        ticket: o.annulation.numero,
        hashTicket: o.annulation.hash,
        totalTTC: o.annulation.totalTTC,
        clientNom: c.nom,
        clientAdresse: c.adresse,
        clientCodePostalVille: c.codePostalVille,
        clientSiren: c.siren || null,
        clientTva: c.tvaIntracom || null,
      },
      o.operateurId,
    );
    return versFacture(evenement);
  });
  file = suite.catch(() => undefined);
  return suite;
}

/** Prix unitaire hors taxes d'une ligne, au centime (mention obligatoire). */
export const prixUnitaireHT = (l: Ticket["lignes"][number]) => baseHT(l.prixUnitaireTTC, l.tauxTVA);
