import {
  formaterEuros,
  VERSION_NOYAU_FISCAL,
  type Cloture,
  type ModePaiement,
  type Paiement,
  type Ticket,
  type TotauxPeriode,
  type VentilationTVA,
} from "@matalon/noyau-fiscal";
import type { Configuration } from "../donnees/configuration";
import { MODE_TEST } from "../fiscal/caisse";
import { totauxCommande, versSaisie, type Commande } from "../metier/commande";
import { Recu } from "./recu";

export const LIBELLES_PAIEMENT: Record<ModePaiement, string> = {
  CB: "Carte bancaire",
  ESPECES: "Espèces",
  TITRE_RESTAURANT_PAPIER: "Titre-restaurant papier",
  TITRE_RESTAURANT_CARTE: "Titre-restaurant carte",
  AUTRE: "Autre",
};

const tauxLisible = (t: number) => `${(t / 100).toLocaleString("fr-FR")} %`;
const dateHeure = (iso: string) =>
  new Date(iso).toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" });
const numero = (n: number) => String(n).padStart(6, "0");
export const nomTable = (config: Configuration, tableId: string | null) =>
  !tableId || tableId === "comptoir" ? "Comptoir" : `Table ${config.tables.find((t) => t.id === tableId)?.nom ?? tableId}`;
export const nomUtilisateur = (config: Configuration, id: string | null) =>
  config.utilisateurs.find((u) => u.id === id)?.nom ?? id ?? "";

function entete(r: Recu, config: Configuration): void {
  const e = config.etablissement;
  if (MODE_TEST) r.texte("CAISSE DE TEST - SANS VALEUR", { align: "centre", gras: true }).filet();
  r.texte(e.enseigne, { align: "centre", gras: true, grand: true }).saut();
  for (const l of [e.raisonSociale, e.adresse, e.codePostalVille, e.telephone && `Tél. ${e.telephone}`]) {
    if (l) r.texte(l, { align: "centre" });
  }
  if (e.siret) r.texte(`SIRET ${e.siret}`, { align: "centre" });
  if (e.tvaIntracom) r.texte(`TVA ${e.tvaIntracom}`, { align: "centre" });
  r.filet();
}

function tableauTVA(r: Recu, ventilation: VentilationTVA[]): void {
  r.colonnes("Taux        HT        TVA", "TTC");
  for (const v of ventilation) {
    const gauche = `${tauxLisible(v.tauxTVA).padEnd(8)}${formaterEuros(v.baseHT).padStart(8)}${formaterEuros(v.montantTVA).padStart(11)}`;
    r.colonnes(gauche, formaterEuros(v.montantTTC));
  }
}

function paiements(r: Recu, liste: Paiement[], rendu: number): void {
  for (const p of liste) r.colonnes(LIBELLES_PAIEMENT[p.mode], formaterEuros(p.montant));
  if (rendu > 0) r.colonnes("Rendu monnaie", formaterEuros(rendu));
}

/** Note client (ticket de caisse) d'une vente ou d'une annulation, éventuellement en duplicata. */
export function gabaritNote(ticket: Ticket, config: Configuration, duplicata?: number): Recu {
  const r = new Recu();
  entete(r, config);
  if (duplicata) r.texte(`DUPLICATA n° ${duplicata}`, { align: "centre", gras: true }).filet();
  if (ticket.type === "ANNULATION") {
    r.texte(`ANNULATION du ticket n° ${numero(ticket.ticketOrigine!.numero)}`, { align: "centre", gras: true });
    if (ticket.motif) r.texte(`Motif : ${ticket.motif}`, { align: "centre" });
    r.filet();
  }
  r.colonnes(`Note n° ${numero(ticket.numero)}`, dateHeure(ticket.horodatage), { gras: true });
  r.colonnes(nomTable(config, ticket.tableId), ticket.couverts ? `${Math.abs(ticket.couverts)} couvert(s)` : "");
  r.texte(`Servi par ${nomUtilisateur(config, ticket.operateurId)}`);
  r.filet();
  for (const l of ticket.lignes) {
    const qte = `${l.quantite} x `;
    r.colonnes(`${qte}${l.libelle}`, formaterEuros(l.quantite * l.prixUnitaireTTC));
    if (l.remiseTTC !== 0) r.colonnes(`   Remise (${l.motifRemise ?? ""})`, formaterEuros(-l.remiseTTC));
  }
  r.filet();
  r.colonnes("TOTAL TTC", `${formaterEuros(ticket.totalTTC)} EUR`, { gras: true, grand: true });
  r.saut();
  tableauTVA(r, ticket.ventilationTVA);
  r.filet();
  paiements(r, ticket.paiements, ticket.renduMonnaie);
  r.filet();
  r.texte("Prix nets, service compris", { align: "centre" });
  r.texte(`${config.caisseId} · Matalon POS ${VERSION_NOYAU_FISCAL}`, { align: "centre" });
  r.texte(`Empreinte ${ticket.hash.slice(0, 16)}`, { align: "centre" });
  if (!duplicata && ticket.type === "VENTE") r.saut().texte("Merci et à bientôt !", { align: "centre" });
  return r;
}

/** Addition présentée au client avant paiement : ne vaut pas ticket de caisse. */
export function gabaritAddition(commande: Commande, config: Configuration, operateurId: string): Recu {
  const r = new Recu();
  const totaux = totauxCommande(commande);
  entete(r, config);
  r.texte("ADDITION", { align: "centre", gras: true });
  r.colonnes(nomTable(config, commande.tableId), dateHeure(new Date().toISOString()));
  if (commande.couverts) r.texte(`${commande.couverts} couvert(s) · servi par ${nomUtilisateur(config, operateurId)}`);
  r.filet();
  for (const l of commande.lignes) {
    const s = versSaisie(l);
    r.colonnes(`${l.quantite} x ${s.libelle}`, formaterEuros(l.quantite * l.prixUnitaireTTC));
    if (l.remise) r.colonnes(`   Remise (${l.remise.motif})`, formaterEuros(-l.remise.montantTTC));
  }
  r.filet();
  r.colonnes("TOTAL TTC", `${formaterEuros(totaux.totalTTC)} EUR`, { gras: true, grand: true });
  r.saut();
  tableauTVA(r, totaux.ventilation);
  r.filet();
  r.texte("Note provisoire, ne vaut pas ticket de caisse", { align: "centre" });
  return r;
}

function corpsTotaux(r: Recu, t: TotauxPeriode): void {
  r.colonnes("Ventes", String(t.nbVentes));
  r.colonnes("Annulations", String(t.nbAnnulations));
  r.colonnes("Remises et offerts TTC", formaterEuros(t.totalRemisesTTC));
  r.filet();
  tableauTVA(r, t.ventilationTVA);
  r.colonnes("Total HT", formaterEuros(t.totalHT));
  r.colonnes("Total TVA", formaterEuros(t.totalTVA));
  r.colonnes("TOTAL TTC", formaterEuros(t.totalTTC), { gras: true, grand: true });
  r.filet();
  r.texte("Encaissements", { gras: true });
  paiements(r, t.paiements, 0);
}

const LIBELLES_PERIODE = { JOUR: "CLÔTURE JOURNALIÈRE Z", MOIS: "CLÔTURE MENSUELLE", EXERCICE: "CLÔTURE D'EXERCICE" } as const;

export function gabaritCloture(c: Cloture, config: Configuration): Recu {
  const r = new Recu();
  entete(r, config);
  r.texte(LIBELLES_PERIODE[c.periode], { align: "centre", gras: true });
  r.texte(`n° ${numero(c.numero)} · ${c.identifiantPeriode}`, { align: "centre", gras: true });
  r.colonnes("Éditée le", dateHeure(c.horodatage));
  r.colonnes("Par", nomUtilisateur(config, c.operateurId));
  r.colonnes("Tickets", c.premierTicket == null ? "aucun" : `${numero(c.premierTicket)} à ${numero(c.dernierTicket!)}`);
  r.filet();
  corpsTotaux(r, c);
  r.filet();
  r.colonnes("Grand total perpétuel", formaterEuros(c.grandTotalPerpetuel));
  r.colonnes("Cumul perpétuel absolu", formaterEuros(c.cumulPerpetuelAbsolu));
  r.filet();
  r.texte(`${config.caisseId} · Matalon POS ${VERSION_NOYAU_FISCAL}`, { align: "centre" });
  r.texte(`Empreinte ${c.hash.slice(0, 32)}`, { align: "centre" });
  return r;
}

export function gabaritLectureX(t: TotauxPeriode & { dateComptable: string }, config: Configuration, operateurId: string): Recu {
  const r = new Recu();
  entete(r, config);
  r.texte("LECTURE X", { align: "centre", gras: true });
  r.texte(`Journée du ${t.dateComptable}, non clôturée`, { align: "centre" });
  r.colonnes("Éditée le", dateHeure(new Date().toISOString()));
  r.colonnes("Par", nomUtilisateur(config, operateurId));
  r.filet();
  corpsTotaux(r, t);
  return r;
}

export function gabaritTest(config: Configuration): Recu {
  const r = new Recu();
  entete(r, config);
  r.texte("Test d'impression", { align: "centre", gras: true });
  r.texte("Accents : é è à ç ô œ — 12,50 €", { align: "centre" });
  r.colonnes("Cappuccino", "4,00");
  r.colonnes("TOTAL", "4,00", { gras: true, grand: true });
  return r;
}
