import { ErreurHttp, type Db } from "./db.js";

/**
 * Configuration d'une installation, pour la mise en service : tout ce qui
 * a été réglé sur la caisse de test (établissements, équipe, plan, carte,
 * stock, commandes fournisseurs, réservations à venir), sans rien de ce qui
 * a été vendu. Elle ne s'importe que dans une base vierge : aucune vente,
 * aucun appareil, aucune équipe, aucun stock. Les appareils se rattachent ensuite
 * avec des codes neufs ; aucun enregistrement fiscal ne voyage.
 *
 * Restent sur place : tickets et clôtures (enregistrements), appareils et
 * codes, comptes clients, alertes, commandes en cours, comptes et journal
 * d'administration, clés de l'agent de factures, consommations des ventes
 * (mouvements « vente » et « annulation »), clés chiffrées des établissements
 * (Resend) : chaque installation a sa propre clé maîtresse CLE_SECRETS, la clé
 * de l'établissement se ressaisit dans l'administration.
 */

export const FORMAT_CONFIGURATION = "matalon-configuration/1";

type Ligne = Record<string, unknown>;

export interface Configuration {
  format: typeof FORMAT_CONFIGURATION;
  exporteLe: string;
  versionNoyau: string;
  tables: Record<(typeof TABLES)[number]["nom"], Ligne[]>;
}

/** Tables reprises, dans l'ordre d'insertion (clés étrangères d'abord). */
const TABLES = [
  { nom: "etablissements", lecture: "select * from etablissements order by id" },
  { nom: "utilisateurs", lecture: "select * from utilisateurs order by id" },
  { nom: "cartes", lecture: "select * from cartes order by id" },
  { nom: "stock_referentiel", lecture: "select * from stock_referentiel" },
  { nom: "prix_achats", lecture: "select * from prix_achats order by id" },
  { nom: "stock_documents", lecture: "select * from stock_documents order by le" },
  // Les consommations des ventes de test ne suivent pas : le stock repart des inventaires et des livraisons.
  { nom: "stock_mouvements", lecture: "select * from stock_mouvements where type not in ('vente', 'annulation') order by id" },
  { nom: "commandes_fournisseurs", lecture: "select * from commandes_fournisseurs order by etablissement_id, numero" },
  { nom: "stock_reglages", lecture: "select * from stock_reglages" },
  { nom: "reservations_reglages", lecture: "select * from reservations_reglages" },
  // Réservations à venir seulement (les passées sont des essais ou de l'historique).
  { nom: "reservations", lecture: "select * from reservations where date >= $1 and statut <> 'annulee' order by seq" },
  // Programmes de fidélité (règles) ; leurs membres et leur registre sont de vraies données de clients : ils ne suivent pas.
  { nom: "fidelite_programmes", lecture: "select * from fidelite_programmes order by id" },
  { nom: "etablissements_logos", lecture: "select * from etablissements_logos order by etablissement_id" },
] as const;

/**
 * Tables qui doivent être vides avant un import (une seule ligne de trop et
 * rien n'est écrit). L'établissement créé d'office au premier démarrage
 * (« moka », sans équipe ni appareil) est remplacé par ceux de la configuration.
 */
const VIERGES = [
  "enregistrements",
  "caisses",
  "codes_rattachement",
  "utilisateurs",
  "clients",
  "alertes",
  "commandes_ouvertes",
  "stock_mouvements",
  "prix_achats",
  "stock_documents",
  "commandes_fournisseurs",
  "stock_reglages",
  "reservations",
  "reservations_reglages",
  "secrets_etablissement",
  "fidelite_programmes",
  "etablissements_logos",
  "fidelite_membres",
  "fidelite_mouvements",
  "fidelite_liens",
];

export async function exporterConfiguration(db: Db, versionNoyau: string, maintenant: string, aujourdhui: string): Promise<Configuration> {
  const tables = {} as Configuration["tables"];
  for (const t of TABLES) {
    const lignes = await db.requete<Ligne>(t.lecture, t.lecture.includes("$1") ? [aujourdhui] : []);
    tables[t.nom] = lignes.map((l) => {
      if (t.nom === "etablissements") return { ...l, verrou_cloture: null, anomalie_cloture: null };
      if (t.nom === "utilisateurs") return { ...l, echecs_pin: 0, pin_bloque_jusqua: null };
      return l;
    });
  }
  return { format: FORMAT_CONFIGURATION, exporteLe: maintenant, versionNoyau, tables };
}

/** Résumé lisible d'une configuration (contrôle avant et après import). */
export function resumeConfiguration(c: Configuration): Record<string, number> {
  return Object.fromEntries(Object.entries(c.tables).map(([k, v]) => [k, v.length]));
}

/**
 * Import dans une base vierge, d'un seul bloc. La carte et le référentiel,
 * créés d'office au premier démarrage, sont remplacés par ceux de la
 * configuration ; tout le reste est inséré tel quel.
 */
export async function importerConfiguration(db: Db, c: unknown): Promise<Record<string, number>> {
  const conf = c as Partial<Configuration> | null;
  if (!conf || conf.format !== FORMAT_CONFIGURATION || typeof conf.tables !== "object" || conf.tables === null) {
    throw new ErreurHttp(400, "FORMAT_INVALIDE", "Ce fichier n'est pas une configuration Matalon POS.");
  }
  for (const t of TABLES) {
    if (!Array.isArray(conf.tables[t.nom])) throw new ErreurHttp(400, "FORMAT_INVALIDE", `Configuration incomplète : ${t.nom}.`);
  }
  if (!conf.tables.etablissements!.length) throw new ErreurHttp(400, "FORMAT_INVALIDE", "La configuration ne contient aucun établissement.");
  for (const table of VIERGES) {
    const [r] = await db.requete<{ n: string | number }>(`select count(*) as n from ${table}`);
    if (Number(r?.n ?? 0) > 0) {
      throw new ErreurHttp(409, "BASE_NON_VIERGE", `Import refusé : la base contient déjà des données (${table}). La configuration ne s'importe que dans une installation neuve, avant la première vente.`);
    }
  }
  const tables = conf.tables as Configuration["tables"];
  const inserer = (nom: string, suite = "") => ({
    texte: `insert into ${nom} select * from jsonb_populate_recordset(null::${nom}, $1::jsonb)${suite}`,
    params: [JSON.stringify(tables[nom as keyof Configuration["tables"]])],
  });
  const recaler = (nom: string, colonne: string) => ({
    texte: `select setval(pg_get_serial_sequence('${nom}', '${colonne}'), greatest((select coalesce(max(${colonne}), 0) from ${nom}), 1))`,
  });
  await db.lot([
    // Seul l'établissement de départ peut exister ici (tout le reste est vide, vérifié plus haut).
    { texte: "delete from etablissements" },
    inserer("etablissements"),
    inserer("utilisateurs"),
    inserer("cartes", " on conflict (id) do update set nom = excluded.nom, contenu = excluded.contenu, version = excluded.version, maj_le = excluded.maj_le, maj_par = excluded.maj_par"),
    inserer("stock_referentiel", " on conflict (id) do update set contenu = excluded.contenu, version = excluded.version, maj_le = excluded.maj_le, maj_par = excluded.maj_par"),
    inserer("prix_achats"),
    inserer("stock_documents"),
    inserer("stock_mouvements"),
    inserer("commandes_fournisseurs"),
    inserer("stock_reglages"),
    inserer("reservations_reglages"),
    inserer("reservations"),
    recaler("prix_achats", "id"),
    recaler("stock_mouvements", "id"),
    recaler("reservations", "seq"),
  ]);
  return resumeConfiguration(conf as Configuration);
}
