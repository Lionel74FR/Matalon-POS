/**
 * Contrat d'API partagé entre le serveur, la caisse et l'administration.
 * Ce module ne dépend d'aucune bibliothèque serveur : la caisse l'importe.
 */
import type { Catalogue } from "@matalon/catalogue";
import {
  canonique,
  montantEnCompte,
  ventilerTranche,
  type Chaine,
  type Cloture,
  type ContexteEtablissement,
  type Enregistrement,
  type Evenement,
  type Ticket,
} from "@matalon/noyau-fiscal";

export type Role = "serveur" | "responsable";

export interface IdentiteEtablissement {
  enseigne: string;
  raisonSociale: string;
  adresse: string;
  codePostalVille: string;
  telephone: string;
  siret: string;
  tvaIntracom: string;
  /** Forme juridique, capital, RCS : mentions exigées sur les factures (ex. « SAS au capital de 10 000 € · RCS Annecy 123 456 789 »). */
  mentionsLegales: string;
}

export interface Table {
  id: string;
  nom: string;
  zone: string;
  /** Plan de salle (depuis le plan) : forme, chaises, position et rotation sur la grille de la zone. */
  forme?: FormeTable;
  chaises?: number;
  /** Coin haut-gauche, en cases de la grille (CASE_CM). Absent : placée d'office. */
  x?: number;
  y?: number;
  rotation?: 0 | 90;
  /** Une table n'est jamais supprimée (les tickets la citent) : elle est masquée. */
  masquee?: boolean;
}

export type FormeTable = "carre" | "rectangle" | "rond";

/** Pas de la grille du plan de salle, en centimètres. */
export const CASE_CM = 25;

/** Repère non cliquable du plan (bar, porte, mur). */
export interface ElementDecor {
  id: string;
  type: "bar" | "porte" | "mur";
  x: number;
  y: number;
  largeur: number;
  hauteur: number;
  libelle?: string;
}

/** Espace du plan de salle (« Salle », « Terrasse ») : dimensions en cases, décor. */
export interface ZonePlan {
  nom: string;
  largeur: number;
  hauteur: number;
  decor: ElementDecor[];
}

export interface PlanSalle {
  zones: ZonePlan[];
  tables: Table[];
  /** Incrémentée à chaque enregistrement : une modification faite ailleurs entre-temps est refusée. */
  version: number;
}

export const ID_PLAN_VALIDE = /^[a-z0-9][a-z0-9-]{0,39}$/;

/**
 * Contrôle d'un plan reçu ; renvoie le premier problème, ou null. Partagé par
 * le serveur (qui refuse) et l'éditeur (qui prévient avant d'envoyer).
 * `anciennes` : tables déjà enregistrées, qui ne peuvent pas disparaître.
 */
export function problemePlan(zones: ZonePlan[], tables: Table[], anciennes: Table[] = []): string | null {
  if (zones.length > 10) return "10 zones au plus.";
  if (tables.length > 200) return "200 tables au plus.";
  const nomsZones = new Set<string>();
  for (const z of zones) {
    if (!z.nom || z.nom.length > 40 || z.nom.trim() !== z.nom) return "Nom de zone invalide.";
    if (nomsZones.has(z.nom)) return `Deux zones s'appellent « ${z.nom} ».`;
    nomsZones.add(z.nom);
    if (![z.largeur, z.hauteur].every((v) => Number.isInteger(v) && v >= 8 && v <= 200)) return `${z.nom} : dimensions invalides.`;
    if (z.decor.length > 60) return `${z.nom} : 60 éléments de décor au plus.`;
    const ids = new Set<string>();
    for (const d of z.decor) {
      if (!ID_PLAN_VALIDE.test(d.id) || ids.has(d.id)) return `${z.nom} : élément de décor mal identifié.`;
      ids.add(d.id);
      if (!["bar", "porte", "mur"].includes(d.type)) return `${z.nom} : type de décor inconnu.`;
      if (![d.x, d.y].every((v) => Number.isInteger(v) && v >= 0 && v <= 200)) return `${z.nom} : décor mal placé.`;
      if (![d.largeur, d.hauteur].every((v) => Number.isInteger(v) && v >= 1 && v <= 200)) return `${z.nom} : décor mal dimensionné.`;
      if (d.libelle !== undefined && (typeof d.libelle !== "string" || d.libelle.length > 30)) return `${z.nom} : libellé de décor trop long.`;
    }
  }
  const ids = new Set<string>();
  const noms = new Map<string, string>();
  for (const t of tables) {
    if (!ID_PLAN_VALIDE.test(t.id) || ids.has(t.id)) return `Table « ${t.nom} » mal identifiée.`;
    ids.add(t.id);
    if (!t.nom || t.nom.length > 20 || t.nom.trim() !== t.nom) return "Nom de table invalide (20 caractères au plus).";
    if (!t.zone || t.zone.length > 40 || (zones.length && !nomsZones.has(t.zone))) return `Table ${t.nom} : zone inconnue.`;
    if (!t.masquee) {
      const cle = t.nom.toLowerCase();
      if (noms.has(cle)) return `Deux tables s'appellent « ${t.nom} ».`;
      noms.set(cle, t.id);
    }
    if (t.forme !== undefined && !["carre", "rectangle", "rond"].includes(t.forme)) return `Table ${t.nom} : forme inconnue.`;
    if (t.chaises !== undefined && !(Number.isInteger(t.chaises) && t.chaises >= 0 && t.chaises <= 20)) return `Table ${t.nom} : 0 à 20 chaises.`;
    if ((t.x === undefined) !== (t.y === undefined)) return `Table ${t.nom} : position incomplète.`;
    if (t.x !== undefined && ![t.x, t.y].every((v) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 200)) {
      return `Table ${t.nom} : position invalide.`;
    }
    if (t.rotation !== undefined && t.rotation !== 0 && t.rotation !== 90) return `Table ${t.nom} : rotation invalide.`;
    if (t.masquee !== undefined && typeof t.masquee !== "boolean") return `Table ${t.nom} : état invalide.`;
  }
  const disparue = anciennes.find((a) => !ids.has(a.id));
  if (disparue) return `La table ${disparue.nom} ne peut pas être supprimée (les tickets la citent) : masquez-la.`;
  return null;
}

export interface EtablissementApi {
  id: string;
  identite: IdentiteEtablissement;
  carteId: string;
  /** Version de la carte : la caisse la télécharge quand elle change. */
  carteVersion: number;
  tables: Table[];
  /** Montant TTC (centimes) à partir duquel la note est imprimée d'office. */
  seuilNote: number;
  /** Imprimantes de production : poste de la carte → imprimante Epson du réseau de l'établissement. */
  postesProduction?: PostesProduction;
  /** Plan de salle : zones dimensionnées et décor (les tables sont dans `tables`). */
  zones?: ZonePlan[];
  planVersion?: number;
}

export type PostesProduction = Record<string, { adresse: string; sansAccents: boolean }>;

/** Nom de poste de production (« Bar », « Cuisine ») : court, lisible, sans caractère de contrôle. */
export function posteValide(nom: unknown): nom is string {
  return typeof nom === "string" && nom.trim() === nom && nom.length >= 1 && nom.length <= 30 && !/[\u0000-\u001f\u007f]/.test(nom);
}

export interface UtilisateurApi {
  id: string;
  nom: string;
  role: Role;
  pinHash: string;
  actif: boolean;
}

export interface Queue {
  numero: number;
  hash: string;
}

export type Derniers = Record<Chaine, Queue | null>;

export interface ReponseRattachement {
  jeton: string;
  caisse: { id: string; nom: string };
  etablissement: EtablissementApi;
  utilisateurs: UtilisateurApi[];
}

export interface ReponseEtat {
  caisse: { id: string; nom: string };
  etablissement: EtablissementApi;
  utilisateurs: UtilisateurApi[];
  /** Clients des comptes (ardoises) de l'établissement, pour vendre en compte hors ligne. Depuis 0.5.0. */
  clients?: ClientApi[];
  derniers: Derniers;
  /** Heure du serveur (ISO), pour contrôler l'horloge de l'iPad. */
  heure: string;
  /** Appareils en service de l'établissement (identifiant → nom). Seul, un appareil peut clôturer hors ligne. Depuis 0.7.0. */
  appareils?: Record<string, string>;
}

export interface EntreeSynchro {
  chaine: Chaine;
  enregistrement: Enregistrement;
}

export interface ReponseSynchro {
  acceptes: number;
  derniers: Derniers;
}

export interface ReponseCarte {
  carte: Catalogue;
  version: number;
}

export interface ResumeCarte {
  id: string;
  nom: string;
  version: number;
  majLe: string;
  majPar: string | null;
  nbArticles: number;
  etablissements: string[];
}

export interface ErreurApi {
  code: string;
  message: string;
}

/** Codes de rattachement : 8 caractères sans lettres ambiguës, groupés par 4 à l'affichage. */
export const ALPHABET_CODE = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function normaliserCode(saisie: string): string {
  return saisie
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/O/g, "0")
    .replace(/I/g, "1");
}

export function afficherCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

async function sha256Hex(texte: string): Promise<string> {
  const empreinte = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texte));
  return [...new Uint8Array(empreinte)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Empreinte d'un code PIN, liée à l'utilisateur. Le code lui-même n'est jamais stocké. */
export function hacherPin(utilisateurId: string, pin: string): Promise<string> {
  return sha256Hex(`matalon-pos:${utilisateurId}:${pin}`);
}

export const PIN_VALIDE = /^\d{4}$/;
export const ID_ETABLISSEMENT_VALIDE = /^[a-z0-9][a-z0-9-]{1,40}$/;

// ───────── Comptes clients ─────────

export interface ClientApi {
  /** « cli-xxxxxxxx », créé par une caisse (même hors ligne) ou par l'administration. */
  id: string;
  nom: string;
  telephone: string;
  /** Pour lui envoyer factures et relances. Depuis le 6 octobre 2026 ; vide si inconnu. */
  email?: string;
  actif: boolean;
}

/** Adresse e-mail plausible (contrôle de forme seulement). */
export const EMAIL_VALIDE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

export const CLIENT_ID_VALIDE = /^cli-[0-9a-f]{8}$/;

/** Vente portée en compte, encore due en tout ou partie. */
export interface VenteOuverte {
  caisseId: string;
  numero: number;
  hash: string;
  dateComptable: string;
  horodatage: string;
  totalTTC: number;
  enCompteTTC: number;
  regleTTC: number;
  resteTTC: number;
  ventilationTVA: Ticket["ventilationTVA"];
}

export interface CompteClient {
  client: ClientApi;
  soldeTTC: number;
  ventes: VenteOuverte[];
}

/** Derniers tickets de toutes les caisses de l'établissement (copie du serveur), avec le nom de chaque appareil. */
export interface ReponseTickets {
  tickets: Ticket[];
  appareils: Record<string, string>;
}

/** Dernières clôtures de toutes les caisses de l'établissement (copie du serveur). */
export interface ReponseClotures {
  clotures: Cloture[];
  appareils: Record<string, string>;
}

/**
 * Journée de l'établissement (0.7.0) : ce que l'appareil qui fait la lecture X
 * ou la Z doit savoir des autres caisses. Le contexte est vérifié par le noyau.
 */
export interface ReponseJournee {
  contexte: ContexteEtablissement;
  appareils: Record<string, string>;
  /** Dernière synchronisation de chaque caisse : un appareil en retard verra ses tickets dans la Z suivante. */
  synchros: Record<string, string | null>;
  /** Fond de caisse déclaré depuis la dernière Z, sur n'importe quel appareil. */
  fond: Evenement | null;
  /** Dernier comptage de l'établissement (fond conservé pour le lendemain). */
  comptage: Evenement | null;
  /** Clôture en cours sur un appareil : les autres attendent. */
  verrou: { caisseId: string; expireLe: string } | null;
  /** Anomalie relevée à la réception d'une clôture (deux Z depuis la même précédente). */
  anomalie: string | null;
}

/** Alerte de l'établissement, à lire dans l'administration. */
export interface AlerteApi {
  id: string;
  caisseId: string | null;
  type: "PRIX_DIFFERENT" | "ARTICLE_HORS_CARTE" | "PIN_BLOQUE";
  message: string;
  details: Record<string, unknown>;
  creeLe: string;
  vueLe: string | null;
  vuePar: string | null;
}

export interface ReponseComptes {
  comptes: CompteClient[];
  /** Incohérences relevées entre caisses (sur-règlement, vente inconnue…) : signalées, jamais bloquantes. */
  anomalies: string[];
  /** Heure du calcul (serveur). */
  calculeLe: string;
  /** Réponse à une caisse : dernier ticket d'elle que le serveur a reçu. */
  dernierTicketCaisse?: number;
}

/**
 * Comptes clients d'un établissement, recalculés à partir des tickets de
 * toutes ses caisses : ventes en compte, annulations et règlements (le
 * règlement peut être reçu sur une autre caisse que la vente).
 */
export function calculerComptes(tickets: Ticket[], clients: ClientApi[]): Omit<ReponseComptes, "calculeLe"> {
  const cle = (caisseId: string, numero: number) => `${caisseId}#${numero}`;
  const ventes = new Map<string, { t: Ticket; enCompte: number; regle: number }>();
  const anomalies: string[] = [];
  for (const t of tickets) {
    if (t.type === "VENTE" && montantEnCompte(t) !== 0) ventes.set(cle(t.caisseId, t.numero), { t, enCompte: montantEnCompte(t), regle: 0 });
  }
  for (const t of tickets) {
    if (t.type !== "ANNULATION" || !t.ticketOrigine) continue;
    const v = ventes.get(cle(t.caisseId, t.ticketOrigine.numero));
    if (v) v.enCompte += montantEnCompte(t);
  }
  // Règlements et annulations de règlements (montants négatifs), dans l'ordre où ils ont été reçus.
  for (const t of tickets) {
    if (!t.reglement) continue;
    for (const i of t.reglement.imputations) {
      const ref = `${t.type === "REGLEMENT" ? "règlement" : "annulation de règlement"} ${t.caisseId} n°${t.numero}`;
      const v = ventes.get(cle(i.caisseId, i.numero));
      if (!v || v.t.hash !== i.hash) {
        anomalies.push(`${ref} : vente ${i.caisseId} n°${i.numero} introuvable ou différente`);
        continue;
      }
      if (v.t.client?.id !== t.client?.id) anomalies.push(`${ref} : client différent de celui de la vente n°${i.numero}`);
      const part = Math.abs(i.montantTTC);
      const debut = i.montantTTC > 0 ? i.encaisseAvantTTC : i.encaisseAvantTTC - part;
      let attendue: Ticket["ventilationTVA"] | null = null;
      try {
        attendue = ventilerTranche(v.t.ventilationTVA, debut, part, v.t.totalTTC);
      } catch {
        /* tranche hors de la vente : signalée ci-dessous */
      }
      const obtenue = i.montantTTC > 0 ? i.ventilationTVA : i.ventilationTVA.map((x) => ({ ...x, baseHT: -x.baseHT, montantTVA: -x.montantTVA, montantTTC: -x.montantTTC }));
      if (!attendue || i.venteTotalTTC !== v.t.totalTTC || canonique(attendue) !== canonique(obtenue)) {
        anomalies.push(`${ref} : TVA de la vente n°${i.numero} mal répartie`);
      }
      v.regle += i.montantTTC;
    }
  }
  const parClient = new Map<string, CompteClient>();
  const connus = new Map(clients.map((c) => [c.id, c]));
  for (const { t, enCompte, regle } of ventes.values()) {
    const reste = enCompte - regle;
    if (reste < 0) anomalies.push(`vente ${t.caisseId} n°${t.numero} : réglée ${-reste} centimes de trop`);
    if (reste <= 0) continue;
    const id = t.client!.id;
    const client = connus.get(id) ?? { id, nom: t.client!.nom, telephone: "", actif: true };
    const compte = parClient.get(id) ?? { client, soldeTTC: 0, ventes: [] };
    compte.soldeTTC += reste;
    compte.ventes.push({
      caisseId: t.caisseId,
      numero: t.numero,
      hash: t.hash,
      dateComptable: t.dateComptable,
      horodatage: t.horodatage,
      totalTTC: t.totalTTC,
      enCompteTTC: enCompte,
      regleTTC: regle,
      resteTTC: reste,
      ventilationTVA: t.ventilationTVA,
    });
    parClient.set(id, compte);
  }
  const comptes = [...parClient.values()];
  for (const c of comptes) c.ventes.sort((a, b) => a.horodatage.localeCompare(b.horodatage));
  // Les clients sans dette restent listés (solde nul) pour être choisis à la prochaine vente.
  for (const c of clients) if (!parClient.has(c.id)) comptes.push({ client: c, soldeTTC: 0, ventes: [] });
  comptes.sort((a, b) => b.soldeTTC - a.soldeTTC || a.client.nom.localeCompare(b.client.nom, "fr"));
  return { comptes, anomalies };
}
