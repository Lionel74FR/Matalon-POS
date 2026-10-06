import { lireCatalogue, nombreArticles, validerCatalogue, type Catalogue } from "@matalon/catalogue";
import {
  canonique,
  NOM_LOGICIEL,
  VERSION_NOYAU_FISCAL,
  exporterCloturesCSV,
  sha256Hex,
  HASH_GENESE,
  verifierRegistre,
  verifierScellement,
  verifierTotauxTickets,
  type Chaine,
  type Cloture,
  type Enregistrement,
  type Ticket,
} from "@matalon/noyau-fiscal";
import { ErreurHttp, type Db } from "./db.js";
import {
  ALPHABET_CODE,
  hacherPin,
  ID_ETABLISSEMENT_VALIDE,
  normaliserCode,
  PIN_VALIDE,
  calculerComptes,
  CLIENT_ID_VALIDE,
  type ClientApi,
  posteValide,
  type Derniers,
  type EntreeSynchro,
  type PostesProduction,
  type ReponseComptes,
  type EtablissementApi,
  type IdentiteEtablissement,
  type ReponseEtat,
  type ReponseCarte,
  type ReponseRattachement,
  type ResumeCarte,
  type ReponseSynchro,
  type Table,
  type UtilisateurApi,
} from "./partage.js";
import { migrer } from "./schema.js";
import {
  aleatoire,
  hacherMotDePasse,
  nouveauJeton,
  nouveauSecretTotp,
  sha256,
  urlOtpAuth,
  verifierMotDePasse,
  verifierTotp,
} from "./securite.js";
import { empreinteCle, FORMAT_ARCHIVE_SERVEUR, type ContenuArchiveServeur } from "./archive.js";
import { StockageServeur } from "./stockage-db.js";

export interface Environnement {
  db: Db;
  /** Horloge injectable (tests). */
  maintenant?: () => Date;
}

const CHAINES: Chaine[] = ["tickets", "evenements", "clotures"];
const TAILLE_MAX_CORPS = 4_000_000;
const DUREE_SESSION_MS = 12 * 3600_000;
const DUREE_CODE_MS = 48 * 3600_000;
const ECHECS_MAX = 5;
const BLOCAGE_MS = 15 * 60_000;
const COOKIE = "mp_admin";

// ───────── Utilitaires HTTP ─────────

function json(statut: number, corps: unknown, entetes: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(corps), {
    status: statut,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...entetes },
  });
}

async function lireJson<T>(requete: Request): Promise<T> {
  const texte = await requete.text();
  if (texte.length > TAILLE_MAX_CORPS) throw new ErreurHttp(413, "TROP_VOLUMINEUX", "Requête trop volumineuse.");
  try {
    return JSON.parse(texte || "{}") as T;
  } catch {
    throw new ErreurHttp(400, "JSON_INVALIDE", "Corps de requête illisible.");
  }
}

function texte(v: unknown, champ: string, max = 200): string {
  if (typeof v !== "string") throw new ErreurHttp(400, "CHAMP_INVALIDE", `Champ ${champ} manquant.`);
  const t = v.trim();
  if (t.length > max) throw new ErreurHttp(400, "CHAMP_INVALIDE", `Champ ${champ} trop long.`);
  return t;
}

// ───────── Conversions base ↔ API ─────────

interface LigneEtablissement {
  id: string;
  enseigne: string;
  raison_sociale: string;
  adresse: string;
  code_postal_ville: string;
  telephone: string;
  siret: string;
  tva_intracom: string;
  mentions_legales: string;
  carte_id: string;
  /** Version de la carte (jointure). */
  carte_version: number | null;
  tables: Table[];
  seuil_note: number;
  postes_production: PostesProduction | null;
}

const SELECT_ETABLISSEMENT = `select e.*, c.version as carte_version from etablissements e left join cartes c on c.id = e.carte_id`;

function versEtablissement(l: LigneEtablissement): EtablissementApi {
  return {
    id: l.id,
    identite: {
      enseigne: l.enseigne,
      raisonSociale: l.raison_sociale,
      adresse: l.adresse,
      codePostalVille: l.code_postal_ville,
      telephone: l.telephone,
      siret: l.siret,
      tvaIntracom: l.tva_intracom,
      mentionsLegales: l.mentions_legales ?? "",
    },
    carteId: l.carte_id,
    carteVersion: l.carte_version ?? 0,
    tables: l.tables,
    seuilNote: l.seuil_note,
    postesProduction: l.postes_production ?? {},
  };
}

function lirePostes(v: unknown): PostesProduction {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new ErreurHttp(400, "CHAMP_INVALIDE", "Postes de production invalides.");
  const entrees = Object.entries(v as Record<string, unknown>);
  if (entrees.length > 12) throw new ErreurHttp(400, "CHAMP_INVALIDE", "12 postes de production au plus.");
  const postes: PostesProduction = {};
  for (const [nom, val] of entrees) {
    const p = val as { adresse?: unknown; sansAccents?: unknown };
    const adresse = typeof p?.adresse === "string" ? p.adresse.trim() : "";
    if (!posteValide(nom) || !/^[a-z0-9.:-]{0,100}$/i.test(adresse)) {
      throw new ErreurHttp(400, "CHAMP_INVALIDE", `Poste « ${nom} » : nom ou adresse d'imprimante invalide.`);
    }
    postes[nom] = { adresse, sansAccents: p?.sansAccents === true };
  }
  return postes;
}

async function majPostes(env: Environnement, etablissementId: string, corps: Record<string, unknown>): Promise<EtablissementApi> {
  const postes = lirePostes(corps.postes);
  const [maj] = await env.db.requete<{ id: string }>(
    "update etablissements set postes_production = $2::jsonb, maj_le = $3 where id = $1 returning id",
    [etablissementId, JSON.stringify(postes), horloge(env).toISOString()],
  );
  if (!maj) throw new ErreurHttp(404, "ETABLISSEMENT_INCONNU", "Établissement introuvable.");
  return etablissement(env.db, etablissementId);
}

interface LigneUtilisateur {
  id: string;
  nom: string;
  role: "serveur" | "responsable";
  pin_hash: string;
  actif: boolean;
}

const versUtilisateur = (l: LigneUtilisateur): UtilisateurApi => ({
  id: l.id,
  nom: l.nom,
  role: l.role,
  pinHash: l.pin_hash,
  actif: l.actif,
});

/**
 * Identité reçue. `mentionsLegales` vaut null quand le champ est absent (iPad
 * d'une version antérieure) : la valeur enregistrée est alors conservée.
 */
function lireIdentite(v: unknown): Omit<IdentiteEtablissement, "mentionsLegales"> & { mentionsLegales: string | null } {
  const o = (v ?? {}) as Record<string, unknown>;
  const identite = {
    enseigne: texte(o.enseigne, "enseigne", 80),
    raisonSociale: texte(o.raisonSociale ?? "", "raisonSociale", 120),
    adresse: texte(o.adresse ?? "", "adresse", 160),
    codePostalVille: texte(o.codePostalVille ?? "", "codePostalVille", 120),
    telephone: texte(o.telephone ?? "", "telephone", 40),
    siret: texte(o.siret ?? "", "siret", 20).replace(/\s/g, ""),
    tvaIntracom: texte(o.tvaIntracom ?? "", "tvaIntracom", 20).replace(/\s/g, ""),
    mentionsLegales: o.mentionsLegales === undefined ? null : texte(o.mentionsLegales, "mentionsLegales", 200),
  };
  if (!identite.enseigne) throw new ErreurHttp(400, "CHAMP_INVALIDE", "L'enseigne est obligatoire.");
  if (identite.siret && !/^\d{14}$/.test(identite.siret)) throw new ErreurHttp(400, "CHAMP_INVALIDE", "Le SIRET compte 14 chiffres.");
  return identite;
}

function lireTables(v: unknown): Table[] {
  if (!Array.isArray(v) || v.length > 200) throw new ErreurHttp(400, "CHAMP_INVALIDE", "Liste de tables invalide.");
  return v.map((t, i) => {
    const o = (t ?? {}) as Record<string, unknown>;
    return { id: texte(o.id, `tables[${i}].id`, 40), nom: texte(o.nom, `tables[${i}].nom`, 20), zone: texte(o.zone, `tables[${i}].zone`, 40) };
  });
}

function lireSeuil(v: unknown): number {
  if (!Number.isSafeInteger(v) || (v as number) < 0 || (v as number) > 1_000_000) {
    throw new ErreurHttp(400, "CHAMP_INVALIDE", "Seuil de note invalide.");
  }
  return v as number;
}

// ───────── Requêtes communes ─────────

async function etablissement(db: Db, id: string): Promise<EtablissementApi> {
  const [l] = await db.requete<LigneEtablissement>(`${SELECT_ETABLISSEMENT} where e.id = $1`, [id]);
  if (!l) throw new ErreurHttp(404, "ETABLISSEMENT_INCONNU", "Établissement introuvable.");
  return versEtablissement(l);
}

async function utilisateurs(db: Db, etablissementId: string): Promise<UtilisateurApi[]> {
  const lignes = await db.requete<LigneUtilisateur>(
    "select id, nom, role, pin_hash, actif from utilisateurs where etablissement_id = $1 order by nom",
    [etablissementId],
  );
  return lignes.map(versUtilisateur);
}

async function clients(db: Db, etablissementId: string): Promise<ClientApi[]> {
  return db.requete<ClientApi>(
    "select id, nom, telephone, actif from clients where etablissement_id = $1 order by nom",
    [etablissementId],
  );
}

/** Comptes clients d'un établissement, recalculés à partir des tickets répliqués de toutes ses caisses. */
async function comptes(env: Environnement, etablissementId: string): Promise<ReponseComptes> {
  const lignes = await env.db.requete<{ contenu: Ticket }>(
    `select e.contenu from enregistrements e join caisses c on c.id = e.caisse_id
     where c.etablissement_id = $1 and e.chaine = 'tickets' and e.contenu ? 'client'
     order by e.horodatage, e.caisse_id, e.numero`,
    [etablissementId],
  );
  return { ...calculerComptes(lignes.map((l) => l.contenu), await clients(env.db, etablissementId)), calculeLe: horloge(env).toISOString() };
}

async function derniers(db: Db, caisseId: string): Promise<Derniers> {
  const lignes = await db.requete<{ chaine: Chaine; numero: number; hash: string }>(
    `select e.chaine, e.numero, e.hash from enregistrements e
     join (select chaine, max(numero) as numero from enregistrements where caisse_id = $1 group by chaine) m
       on m.chaine = e.chaine and m.numero = e.numero
     where e.caisse_id = $1`,
    [caisseId],
  );
  const resultat: Derniers = { tickets: null, evenements: null, clotures: null };
  for (const l of lignes) resultat[l.chaine] = { numero: Number(l.numero), hash: l.hash };
  return resultat;
}

async function journaliserAdmin(env: Environnement, adminId: string | null, action: string, details: Record<string, unknown>) {
  await env.db.requete("insert into journal_admin (horodatage, admin_id, action, details) values ($1, $2, $3, $4::jsonb)", [
    horloge(env).toISOString(),
    adminId,
    action,
    JSON.stringify(details),
  ]);
}

const horloge = (env: Environnement) => (env.maintenant ?? (() => new Date()))();

// ───────── Caisses ─────────

interface LigneCaisse {
  id: string;
  etablissement_id: string;
  nom: string;
  cle_id: string;
  cle_publique: JsonWebKey;
  revoquee_le: string | null;
}

async function caisseAuthentifiee(env: Environnement, requete: Request): Promise<LigneCaisse> {
  const jeton = /^Bearer (.+)$/.exec(requete.headers.get("Authorization") ?? "")?.[1];
  if (!jeton) throw new ErreurHttp(401, "NON_AUTHENTIFIE", "Caisse non rattachée.");
  const [c] = await env.db.requete<LigneCaisse>(
    "select id, etablissement_id, nom, cle_id, cle_publique, revoquee_le from caisses where jeton_hash = $1",
    [await sha256(jeton)],
  );
  if (!c) throw new ErreurHttp(401, "NON_AUTHENTIFIE", "Caisse inconnue : rattachez-la de nouveau.");
  if (c.revoquee_le) throw new ErreurHttp(403, "CAISSE_REVOQUEE", "Cette caisse a été révoquée par l'administrateur.");
  return c;
}

function cleValide(jwk: unknown): jwk is JsonWebKey {
  const k = jwk as JsonWebKey;
  return !!k && k.kty === "EC" && k.crv === "P-256" && typeof k.x === "string" && typeof k.y === "string" && !k.d;
}

async function rattacher(env: Environnement, requete: Request): Promise<Response> {
  const corps = await lireJson<Record<string, unknown>>(requete);
  const code = normaliserCode(texte(corps.code, "code", 20));
  const caisseId = texte(corps.caisseId, "caisseId", 40);
  const cleId = texte(corps.cleId, "cleId", 80);
  if (!/^ipad-[0-9a-f]{8}$/.test(caisseId) || cleId !== `${caisseId}-k1`) {
    throw new ErreurHttp(400, "CHAMP_INVALIDE", "Identifiant de caisse invalide.");
  }
  if (!cleValide(corps.clePubliqueJwk)) throw new ErreurHttp(400, "CLE_INVALIDE", "Clé publique invalide.");
  try {
    await crypto.subtle.importKey("jwk", corps.clePubliqueJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  } catch {
    throw new ErreurHttp(400, "CLE_INVALIDE", "Clé publique invalide.");
  }
  const maintenant = horloge(env).toISOString();
  const [c] = await env.db.requete<{ etablissement_id: string; nom_caisse: string; expire_le: string; utilise_le: string | null }>(
    "select etablissement_id, nom_caisse, expire_le, utilise_le from codes_rattachement where code = $1",
    [code],
  );
  if (!c || c.utilise_le || c.expire_le < maintenant) {
    throw new ErreurHttp(400, "CODE_INVALIDE", "Code inconnu, déjà utilisé ou expiré. Demandez un nouveau code à l'administrateur.");
  }
  const jeton = nouveauJeton();
  await env.db.lot([
    {
      texte: `insert into caisses (id, etablissement_id, nom, cle_id, cle_publique, jeton_hash, appareil, rattachee_le)
              values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
      params: [
        caisseId,
        c.etablissement_id,
        c.nom_caisse,
        cleId,
        JSON.stringify(corps.clePubliqueJwk),
        await sha256(jeton),
        texte(corps.appareil ?? "", "appareil", 200),
        maintenant,
      ],
    },
    {
      texte: "update codes_rattachement set utilise_le = $2, caisse_id = $3 where code = $1 and utilise_le is null",
      params: [code, maintenant, caisseId],
    },
  ]);
  const reponse: ReponseRattachement = {
    jeton,
    caisse: { id: caisseId, nom: c.nom_caisse },
    etablissement: await etablissement(env.db, c.etablissement_id),
    utilisateurs: await utilisateurs(env.db, c.etablissement_id),
  };
  return json(201, reponse);
}

async function etatCaisse(env: Environnement, requete: Request): Promise<Response> {
  const c = await caisseAuthentifiee(env, requete);
  const reponse: ReponseEtat = {
    caisse: { id: c.id, nom: c.nom },
    etablissement: await etablissement(env.db, c.etablissement_id),
    utilisateurs: await utilisateurs(env.db, c.etablissement_id),
    clients: await clients(env.db, c.etablissement_id),
    derniers: await derniers(env.db, c.id),
    heure: horloge(env).toISOString(),
  };
  return json(200, reponse);
}

async function comptesCaisse(env: Environnement, requete: Request): Promise<Response> {
  const c = await caisseAuthentifiee(env, requete);
  // Dernier ticket reçu de cette caisse : elle vérifie que ses propres règlements sont bien comptés.
  const reponse: ReponseComptes = { ...(await comptes(env, c.etablissement_id)), dernierTicketCaisse: (await derniers(env.db, c.id)).tickets?.numero ?? 0 };
  return json(200, reponse);
}

/** Fiche client (nom, téléphone, actif), créée ou modifiée par une caisse ou par l'administration. */
async function enregistrerClient(env: Environnement, etablissementId: string, corps: Record<string, unknown>): Promise<ClientApi> {
  const id = texte(corps.id, "id", 12);
  if (!CLIENT_ID_VALIDE.test(id)) throw new ErreurHttp(400, "CHAMP_INVALIDE", "Identifiant de client invalide.");
  const nom = texte(corps.nom, "nom", 80).trim();
  if (!nom) throw new ErreurHttp(400, "CHAMP_INVALIDE", "Le nom du client est obligatoire.");
  const telephone = texte(corps.telephone ?? "", "telephone", 30).trim();
  const [existant] = await env.db.requete<{ etablissement_id: string }>("select etablissement_id from clients where id = $1", [id]);
  if (existant && existant.etablissement_id !== etablissementId) throw new ErreurHttp(403, "INTERDIT", "Client d'un autre établissement.");
  const maintenant = horloge(env).toISOString();
  await env.db.requete(
    `insert into clients (id, etablissement_id, nom, telephone, actif, cree_le, maj_le) values ($1, $2, $3, $4, $5, $6, $6)
     on conflict (id) do update set nom = excluded.nom, telephone = excluded.telephone, actif = excluded.actif, maj_le = excluded.maj_le
     where clients.etablissement_id = excluded.etablissement_id`,
    [id, etablissementId, nom, telephone, corps.actif !== false, maintenant],
  );
  return { id, nom, telephone, actif: corps.actif !== false };
}

async function majClientCaisse(env: Environnement, requete: Request): Promise<Response> {
  const c = await caisseAuthentifiee(env, requete);
  const client = await enregistrerClient(env, c.etablissement_id, await lireJson<Record<string, unknown>>(requete));
  return json(200, { client, clients: await clients(env.db, c.etablissement_id) });
}

/**
 * Réplique des enregistrements fiscaux. Chacun est vérifié avant d'être
 * accepté : appartenance à la caisse, continuité de la chaîne, empreinte,
 * signature avec la clé enregistrée au rattachement, arithmétique des
 * tickets. Le lot est écrit en entier ou pas du tout.
 */
async function synchroniser(env: Environnement, requete: Request): Promise<Response> {
  const c = await caisseAuthentifiee(env, requete);
  const { lot } = await lireJson<{ lot?: EntreeSynchro[] }>(requete);
  if (!Array.isArray(lot) || lot.length > 500) throw new ErreurHttp(400, "LOT_INVALIDE", "Lot de synchronisation invalide.");

  const queues = await derniers(env.db, c.id);
  const resoudre = (id: string) => (id === c.cle_id ? c.cle_publique : null);
  const aInserer: Array<{ texte: string; params: unknown[] }> = [];
  const ticketsNouveaux: Ticket[] = [];
  const maintenant = horloge(env).toISOString();

  const divergence = async (message: string): Promise<never> => {
    await env.db.requete("update caisses set divergence = $2 where id = $1", [c.id, `${maintenant} · ${message}`]);
    throw new ErreurHttp(409, "DIVERGENCE", message);
  };

  for (const entree of lot) {
    const { chaine, enregistrement: e } = entree ?? ({} as EntreeSynchro);
    if (!CHAINES.includes(chaine) || typeof e !== "object" || e === null || !Number.isSafeInteger(e.numero)) {
      throw new ErreurHttp(400, "LOT_INVALIDE", "Entrée de synchronisation invalide.");
    }
    if (e.caisseId !== c.id || e.etablissementId !== c.etablissement_id || e.cleId !== c.cle_id) {
      await divergence(`${chaine} n°${e.numero} : enregistrement d'une autre caisse ou d'une autre clé`);
    }
    const queue = queues[chaine];
    if (queue && e.numero <= queue.numero) {
      const [existant] = await env.db.requete<{ hash: string }>(
        "select hash from enregistrements where caisse_id = $1 and chaine = $2 and numero = $3",
        [c.id, chaine, e.numero],
      );
      if (existant?.hash === e.hash) continue; // déjà reçu : renvoi après coupure réseau
      await divergence(`${chaine} n°${e.numero} : diffère de l'enregistrement déjà reçu`);
    }
    const attendu = { numero: (queue?.numero ?? 0) + 1, hash: queue?.hash ?? HASH_GENESE };
    if (e.numero !== attendu.numero || e.hashPrecedent !== attendu.hash) {
      await divergence(`${chaine} n°${e.numero} : rupture de chaîne, n°${attendu.numero} attendu`);
    }
    const anomalies = await verifierScellement(chaine, e as Enregistrement, resoudre);
    if (anomalies.length) await divergence(`${chaine} n°${e.numero} : ${anomalies.map((a) => a.code).join(", ")}`);
    if (chaine === "tickets") ticketsNouveaux.push(e as Ticket);

    aInserer.push({
      texte: `insert into enregistrements (caisse_id, chaine, numero, hash, hash_precedent, horodatage, contenu, recu_le)
              values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
      params: [c.id, chaine, e.numero, e.hash, e.hashPrecedent, e.horodatage, JSON.stringify(e), maintenant],
    });
    queues[chaine] = { numero: e.numero, hash: e.hash };
  }

  if (ticketsNouveaux.length) {
    const precedent = ticketsNouveaux[0]!.numero > 1 ? await new StockageServeur(env.db, c.id).trouver("tickets", ticketsNouveaux[0]!.numero - 1) : null;
    const anomalies = verifierTotauxTickets(ticketsNouveaux, precedent?.grandTotalPerpetuel ?? 0, precedent?.cumulPerpetuelAbsolu ?? 0);
    if (anomalies.length) await divergence(`tickets : ${anomalies.map((a) => `${a.code} n°${a.numero}`).join(", ")}`);
  }

  // Un client créé hors ligne n'existe que dans ses tickets : on le crée à leur réception (sans écraser une fiche existante).
  const nouveauxClients = new Map<string, string>();
  for (const t of ticketsNouveaux) if (t.client && CLIENT_ID_VALIDE.test(t.client.id)) nouveauxClients.set(t.client.id, t.client.nom);
  if (nouveauxClients.size) {
    const autres = await env.db.requete<{ id: string }>(
      "select id from clients where id = any($1) and etablissement_id <> $2",
      [[...nouveauxClients.keys()], c.etablissement_id],
    );
    for (const [id, nom] of nouveauxClients) {
      if (autres.some((x) => x.id === id)) continue;
      aInserer.push({
        texte: `insert into clients (id, etablissement_id, nom, cree_le, maj_le) values ($1, $2, $3, $4, $4) on conflict (id) do nothing`,
        params: [id, c.etablissement_id, nom.slice(0, 80), maintenant],
      });
    }
  }

  aInserer.push({ texte: "update caisses set derniere_synchro = $2 where id = $1", params: [c.id, maintenant] });
  await env.db.lot(aInserer);
  const reponse: ReponseSynchro = { acceptes: aInserer.filter((x) => x.texte.includes("insert into enregistrements")).length, derniers: queues };
  return json(200, reponse);
}

async function majUtilisateursCaisse(env: Environnement, requete: Request): Promise<Response> {
  const c = await caisseAuthentifiee(env, requete);
  const { utilisateurs: liste } = await lireJson<{ utilisateurs?: UtilisateurApi[] }>(requete);
  if (!Array.isArray(liste) || liste.length > 200) throw new ErreurHttp(400, "CHAMP_INVALIDE", "Équipe invalide.");
  await enregistrerUtilisateurs(env, c.etablissement_id, liste);
  return json(200, { utilisateurs: await utilisateurs(env.db, c.etablissement_id) });
}

async function enregistrerUtilisateurs(env: Environnement, etablissementId: string, liste: UtilisateurApi[]) {
  const maintenant = horloge(env).toISOString();
  const existants = await env.db.requete<{ id: string; etablissement_id: string }>(
    "select id, etablissement_id from utilisateurs where id = any($1)",
    [liste.map((u) => String(u?.id))],
  );
  if (existants.some((u) => u.etablissement_id !== etablissementId)) {
    throw new ErreurHttp(403, "INTERDIT", "Utilisateur d'un autre établissement.");
  }
  const requetes = liste.map((u, i) => {
    const id = texte(u.id, `utilisateurs[${i}].id`, 40);
    if (!/^u-[0-9a-f]{8}$/.test(id)) throw new ErreurHttp(400, "CHAMP_INVALIDE", "Identifiant d'utilisateur invalide.");
    if (u.role !== "serveur" && u.role !== "responsable") throw new ErreurHttp(400, "CHAMP_INVALIDE", "Rôle invalide.");
    if (!/^[0-9a-f]{64}$/.test(String(u.pinHash))) throw new ErreurHttp(400, "CHAMP_INVALIDE", "Code PIN invalide.");
    return {
      texte: `insert into utilisateurs (id, etablissement_id, nom, role, pin_hash, actif, maj_le) values ($1, $2, $3, $4, $5, $6, $7)
              on conflict (id) do update set nom = excluded.nom, role = excluded.role, pin_hash = excluded.pin_hash,
                actif = excluded.actif, maj_le = excluded.maj_le`,
      params: [id, etablissementId, texte(u.nom, "nom", 60), u.role, u.pinHash, !!u.actif, maintenant],
    };
  });
  // Contrôle avant écriture : il doit rester au moins un responsable actif.
  const actuels = await env.db.requete<{ id: string }>(
    "select id from utilisateurs where etablissement_id = $1 and role = 'responsable' and actif",
    [etablissementId],
  );
  const modifies = new Set(liste.map((u) => String(u.id)));
  const restants = actuels.filter((u) => !modifies.has(u.id)).length + liste.filter((u) => u.role === "responsable" && u.actif).length;
  if (liste.length && !restants) {
    throw new ErreurHttp(400, "RESPONSABLE_REQUIS", "Il faut au moins un responsable actif.");
  }
  if (requetes.length) await env.db.lot(requetes);
}

async function majEtablissementCaisse(env: Environnement, requete: Request): Promise<Response> {
  const c = await caisseAuthentifiee(env, requete);
  const corps = await lireJson<Record<string, unknown>>(requete);
  await majEtablissement(env, c.etablissement_id, corps, false);
  return json(200, { etablissement: await etablissement(env.db, c.etablissement_id) });
}

async function majEtablissement(env: Environnement, id: string, corps: Record<string, unknown>, creation: boolean) {
  const identite = lireIdentite(corps.identite);
  const tables = lireTables(corps.tables ?? []);
  const seuil = lireSeuil(corps.seuilNote ?? 2500);
  const maintenant = horloge(env).toISOString();
  const valeurs = [
    id,
    identite.enseigne,
    identite.raisonSociale,
    identite.adresse,
    identite.codePostalVille,
    identite.telephone,
    identite.siret,
    identite.tvaIntracom,
    JSON.stringify(tables),
    seuil,
    maintenant,
    identite.mentionsLegales,
  ];
  if (creation) {
    const carteId = texte(corps.carteId, "carteId", 60);
    await exigerCarte(env.db, carteId);
    await env.db.requete(
      `insert into etablissements (id, enseigne, raison_sociale, adresse, code_postal_ville, telephone, siret, tva_intracom,
         tables, seuil_note, cree_le, maj_le, mentions_legales, carte_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $11, coalesce($12, ''), $13)`,
      [...valeurs, carteId],
    );
  } else {
    const [maj] = await env.db.requete<{ id: string }>(
      `update etablissements set enseigne = $2, raison_sociale = $3, adresse = $4, code_postal_ville = $5, telephone = $6,
         siret = $7, tva_intracom = $8, tables = $9::jsonb, seuil_note = $10, maj_le = $11, mentions_legales = coalesce($12, mentions_legales)
       where id = $1 returning id`,
      valeurs,
    );
    if (!maj) throw new ErreurHttp(404, "ETABLISSEMENT_INCONNU", "Établissement introuvable.");
    if (corps.carteId !== undefined) {
      const carteId = texte(corps.carteId, "carteId", 60);
      await exigerCarte(env.db, carteId);
      await env.db.requete("update etablissements set carte_id = $2 where id = $1", [id, carteId]);
    }
  }
}

// ───────── Cartes ─────────

async function exigerCarte(db: Db, id: string): Promise<{ contenu: Catalogue; version: number }> {
  const [c] = await db.requete<{ contenu: Catalogue; version: number }>("select contenu, version from cartes where id = $1", [id]);
  if (!c) throw new ErreurHttp(400, "CARTE_INCONNUE", "Carte inconnue.");
  return c;
}

/** Carte de l'établissement de la caisse, téléchargée quand sa version change. */
async function carteCaisse(env: Environnement, requete: Request): Promise<Response> {
  const c = await caisseAuthentifiee(env, requete);
  const [e] = await env.db.requete<{ carte_id: string }>("select carte_id from etablissements where id = $1", [c.etablissement_id]);
  const carte = await exigerCarte(env.db, e!.carte_id);
  const reponse: ReponseCarte = { carte: carte.contenu, version: carte.version };
  return json(200, reponse);
}

async function listeCartes(env: Environnement): Promise<Response> {
  const lignes = await env.db.requete<{ id: string; nom: string; version: number; maj_le: string; maj_par: string | null; contenu: Catalogue }>(
    "select id, nom, version, maj_le, maj_par, contenu from cartes order by nom",
  );
  const etabs = await env.db.requete<{ id: string; carte_id: string }>("select id, carte_id from etablissements");
  const cartes: ResumeCarte[] = lignes.map((l) => ({
    id: l.id,
    nom: l.nom,
    version: l.version,
    majLe: l.maj_le,
    majPar: l.maj_par,
    nbArticles: nombreArticles(l.contenu),
    etablissements: etabs.filter((e) => e.carte_id === l.id).map((e) => e.id),
  }));
  return json(200, { cartes });
}

async function lireCarteAdmin(env: Environnement, id: string): Promise<Response> {
  const c = await exigerCarte(env.db, id).catch(() => {
    throw new ErreurHttp(404, "CARTE_INCONNUE", "Carte introuvable.");
  });
  const reponse: ReponseCarte = { carte: c.contenu, version: c.version };
  return json(200, reponse);
}

/** Lecture stricte et contrôles de cohérence ; lève une erreur 400 qui liste les problèmes. */
function carteValide(v: unknown, id: string): Catalogue {
  const { catalogue, erreurs } = lireCatalogue(v);
  const toutes = catalogue ? validerCatalogue(catalogue) : erreurs;
  if (catalogue && catalogue.id !== id) toutes.push("identifiant de carte modifié");
  if (!catalogue || toutes.length) {
    throw new ErreurHttp(400, "CARTE_INVALIDE", `Carte refusée : ${toutes.slice(0, 8).join(" ; ")}${toutes.length > 8 ? ` (et ${toutes.length - 8} autres)` : ""}.`);
  }
  return catalogue;
}

/**
 * Enregistre une carte entière. `version` est celle sur laquelle l'éditeur a
 * travaillé : si quelqu'un a enregistré entre-temps, la modification est
 * refusée plutôt que d'écraser la sienne.
 */
async function enregistrerCarte(env: Environnement, requete: Request, admin: { id: string; identifiant: string }, id: string): Promise<Response> {
  controlerOrigine(requete);
  const corps = await lireJson<{ carte?: unknown; version?: unknown }>(requete);
  if (typeof corps.version !== "number" || !Number.isSafeInteger(corps.version)) {
    throw new ErreurHttp(400, "CHAMP_INVALIDE", "Version de la carte manquante : rechargez la carte.");
  }
  const carte = carteValide(corps.carte, id);
  const [maj] = await env.db.requete<{ version: number }>(
    `update cartes set nom = $2, contenu = $3::jsonb, version = version + 1, maj_le = $4, maj_par = $5
     where id = $1 and version = $6 returning version`,
    [id, carte.nom, JSON.stringify(carte), horloge(env).toISOString(), admin.identifiant, corps.version],
  );
  if (!maj) {
    await exigerCarte(env.db, id).catch(() => {
      throw new ErreurHttp(404, "CARTE_INCONNUE", "Carte introuvable.");
    });
    throw new ErreurHttp(409, "VERSION_DEPASSEE", "La carte a été modifiée entre-temps : rechargez-la avant d'enregistrer.");
  }
  await journaliserAdmin(env, admin.id, "carte_enregistree", { carte: id, version: maj.version, articles: nombreArticles(carte) });
  const reponse: ReponseCarte = { carte, version: maj.version };
  return json(200, reponse);
}

/** Nouvelle carte, vide ou copiée d'une autre (carte de saison, autre établissement). */
async function creerCarte(env: Environnement, requete: Request, admin: { id: string; identifiant: string }): Promise<Response> {
  controlerOrigine(requete);
  const corps = await lireJson<Record<string, unknown>>(requete);
  const id = texte(corps.id, "id", 60);
  if (!/^[a-z0-9][a-z0-9-]{1,59}$/.test(id)) throw new ErreurHttp(400, "CHAMP_INVALIDE", "Identifiant de carte : minuscules, chiffres et tirets.");
  const nom = texte(corps.nom, "nom", 80);
  if (!nom) throw new ErreurHttp(400, "CHAMP_INVALIDE", "Le nom de la carte est obligatoire.");
  const depuis = typeof corps.depuis === "string" && corps.depuis ? (await exigerCarte(env.db, corps.depuis)).contenu : null;
  const carte = carteValide(
    depuis
      ? { ...depuis, id, nom, source: `Copie de « ${depuis.nom} »` }
      : { id, nom, source: "Administration", etablissementId: "", categories: [] },
    id,
  );
  // Insertion conditionnelle : deux créations simultanées du même identifiant donnent un 409, pas une erreur serveur.
  const [cree] = await env.db.requete<{ id: string }>(
    "insert into cartes (id, nom, contenu, version, maj_le, maj_par) values ($1, $2, $3::jsonb, 1, $4, $5) on conflict (id) do nothing returning id",
    [id, nom, JSON.stringify(carte), horloge(env).toISOString(), admin.identifiant],
  );
  if (!cree) throw new ErreurHttp(409, "DEJA_EXISTANT", "Une carte porte déjà cet identifiant.");
  await journaliserAdmin(env, admin.id, "carte_creee", { carte: id, depuis: depuis?.id ?? null });
  const reponse: ReponseCarte = { carte, version: 1 };
  return json(201, reponse);
}

// ───────── Administration ─────────

function cookie(requete: Request, nom: string): string | null {
  for (const part of (requete.headers.get("Cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === nom) return v.join("=");
  }
  return null;
}

function controlerOrigine(requete: Request) {
  const origine = requete.headers.get("Origin");
  if (requete.method !== "GET" && origine && new URL(origine).host !== new URL(requete.url).host) {
    throw new ErreurHttp(403, "ORIGINE_REFUSEE", "Origine refusée.");
  }
}

async function adminConnecte(env: Environnement, requete: Request): Promise<{ id: string; identifiant: string } | null> {
  const jeton = cookie(requete, COOKIE);
  if (!jeton) return null;
  const [s] = await env.db.requete<{ id: string; identifiant: string; expire_le: string }>(
    `select a.id, a.identifiant, s.expire_le from sessions_admin s join admins a on a.id = s.admin_id
     where s.jeton_hash = $1 and a.totp_actif`,
    [await sha256(jeton)],
  );
  if (!s || s.expire_le < horloge(env).toISOString()) return null;
  return { id: s.id, identifiant: s.identifiant };
}

async function exigerAdmin(env: Environnement, requete: Request) {
  controlerOrigine(requete);
  const a = await adminConnecte(env, requete);
  if (!a) throw new ErreurHttp(401, "NON_AUTHENTIFIE", "Connexion administrateur requise.");
  return a;
}

async function statutAdmin(env: Environnement, requete: Request): Promise<Response> {
  const [n] = await env.db.requete<{ n: number }>("select count(*)::int as n from admins where totp_actif");
  const a = await adminConnecte(env, requete);
  return json(200, { initialise: !!n?.n, connecte: !!a, identifiant: a?.identifiant ?? null });
}

/** Création du premier administrateur, possible tant qu'aucun n'a activé sa double authentification. */
async function initialiserAdmin(env: Environnement, requete: Request): Promise<Response> {
  controlerOrigine(requete);
  const [n] = await env.db.requete<{ n: number }>("select count(*)::int as n from admins where totp_actif");
  if (n?.n) throw new ErreurHttp(403, "DEJA_INITIALISE", "L'administration est déjà configurée.");
  const corps = await lireJson<Record<string, unknown>>(requete);
  const identifiant = texte(corps.identifiant, "identifiant", 80).toLowerCase();
  const motDePasse = typeof corps.motDePasse === "string" ? corps.motDePasse : "";
  if (identifiant.length < 3) throw new ErreurHttp(400, "CHAMP_INVALIDE", "Identifiant trop court.");
  if (motDePasse.length < 12) throw new ErreurHttp(400, "MOT_DE_PASSE_FAIBLE", "Le mot de passe doit compter au moins 12 caractères.");
  const secret = nouveauSecretTotp();
  await env.db.lot([
    { texte: "delete from admins where not totp_actif" },
    {
      texte: "insert into admins (id, identifiant, mot_de_passe, totp_secret, cree_le) values ($1, $2, $3, $4, $5)",
      params: [`a-${[...aleatoire(4)].map((b) => b.toString(16).padStart(2, "0")).join("")}`, identifiant, await hacherMotDePasse(motDePasse), secret, horloge(env).toISOString()],
    },
  ]);
  return json(201, { secret, otpauth: urlOtpAuth(secret, identifiant) });
}

interface LigneAdmin {
  id: string;
  identifiant: string;
  mot_de_passe: string;
  totp_secret: string;
  totp_actif: boolean;
  echecs: number;
  bloque_jusqua: string | null;
}

async function verifierIdentifiants(env: Environnement, corps: Record<string, unknown>, activation: boolean): Promise<LigneAdmin> {
  const maintenant = horloge(env);
  const identifiant = String(corps.identifiant ?? "").trim().toLowerCase();
  const [a] = await env.db.requete<LigneAdmin>("select * from admins where identifiant = $1 and totp_actif = $2", [identifiant, !activation]);
  const refus = new ErreurHttp(401, "IDENTIFIANTS_INVALIDES", "Identifiant, mot de passe ou code incorrect.");
  if (!a) throw refus;
  if (a.bloque_jusqua && a.bloque_jusqua > maintenant.toISOString()) {
    throw new ErreurHttp(429, "COMPTE_BLOQUE", "Trop d'essais : réessayez dans 15 minutes.");
  }
  const ok =
    (await verifierMotDePasse(String(corps.motDePasse ?? ""), a.mot_de_passe)) &&
    (await verifierTotp(a.totp_secret, String(corps.code ?? ""), maintenant.getTime()));
  if (!ok) {
    const echecs = a.echecs + 1;
    await env.db.requete("update admins set echecs = $2, bloque_jusqua = $3 where id = $1", [
      a.id,
      echecs >= ECHECS_MAX ? 0 : echecs,
      echecs >= ECHECS_MAX ? new Date(maintenant.getTime() + BLOCAGE_MS).toISOString() : null,
    ]);
    await journaliserAdmin(env, a.id, "connexion_refusee", {});
    throw refus;
  }
  await env.db.requete("update admins set echecs = 0, bloque_jusqua = null where id = $1", [a.id]);
  return a;
}

async function ouvrirSession(env: Environnement, adminId: string): Promise<Response> {
  const jeton = nouveauJeton();
  const expire = new Date(horloge(env).getTime() + DUREE_SESSION_MS).toISOString();
  await env.db.requete("insert into sessions_admin (jeton_hash, admin_id, expire_le) values ($1, $2, $3)", [await sha256(jeton), adminId, expire]);
  await journaliserAdmin(env, adminId, "connexion", {});
  return json(200, { ok: true }, {
    "Set-Cookie": `${COOKIE}=${jeton}; Path=/api/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=${DUREE_SESSION_MS / 1000}`,
  });
}

async function confirmerAdmin(env: Environnement, requete: Request): Promise<Response> {
  controlerOrigine(requete);
  const a = await verifierIdentifiants(env, await lireJson(requete), true);
  await env.db.requete("update admins set totp_actif = true where id = $1", [a.id]);
  return ouvrirSession(env, a.id);
}

async function connexionAdmin(env: Environnement, requete: Request): Promise<Response> {
  controlerOrigine(requete);
  const a = await verifierIdentifiants(env, await lireJson(requete), false);
  return ouvrirSession(env, a.id);
}

async function deconnexionAdmin(env: Environnement, requete: Request): Promise<Response> {
  const jeton = cookie(requete, COOKIE);
  if (jeton) await env.db.requete("delete from sessions_admin where jeton_hash = $1", [await sha256(jeton)]);
  return json(200, { ok: true }, { "Set-Cookie": `${COOKIE}=; Path=/api/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=0` });
}

async function listeEtablissements(env: Environnement): Promise<Response> {
  const etabs = await env.db.requete<LigneEtablissement>(`${SELECT_ETABLISSEMENT} order by e.enseigne`);
  const caisses = await env.db.requete<{
    id: string;
    etablissement_id: string;
    nom: string;
    appareil: string;
    rattachee_le: string;
    derniere_synchro: string | null;
    revoquee_le: string | null;
    divergence: string | null;
    cle_publique: JsonWebKey;
  }>("select id, etablissement_id, nom, appareil, rattachee_le, derniere_synchro, revoquee_le, divergence, cle_publique from caisses order by rattachee_le");
  const codes = await env.db.requete<{ code: string; etablissement_id: string; nom_caisse: string; expire_le: string }>(
    "select code, etablissement_id, nom_caisse, expire_le from codes_rattachement where utilise_le is null and expire_le > $1",
    [horloge(env).toISOString()],
  );
  const resultat = [];
  for (const e of etabs) {
    resultat.push({
      ...versEtablissement(e),
      utilisateurs: await utilisateurs(env.db, e.id),
      codes: codes.filter((c) => c.etablissement_id === e.id).map((c) => ({ code: c.code, nomCaisse: c.nom_caisse, expireLe: c.expire_le })),
      caisses: await Promise.all(
        caisses
          .filter((c) => c.etablissement_id === e.id)
          .map(async (c) => ({
            id: c.id,
            nom: c.nom,
            appareil: c.appareil,
            rattacheeLe: c.rattachee_le,
            derniereSynchro: c.derniere_synchro,
            revoqueeLe: c.revoquee_le,
            divergence: c.divergence,
            empreinteCle: await empreinteCle(c.cle_publique),
            derniers: await derniers(env.db, c.id),
          })),
      ),
    });
  }
  const cartes = await env.db.requete<{ id: string; nom: string }>("select id, nom from cartes order by nom");
  return json(200, { etablissements: resultat, cartes });
}

async function creerOuModifierEtablissement(env: Environnement, requete: Request, admin: { id: string }, id?: string): Promise<Response> {
  const corps = await lireJson<Record<string, unknown>>(requete);
  const cible = id ?? texte(corps.id, "id", 41);
  if (!ID_ETABLISSEMENT_VALIDE.test(cible)) {
    throw new ErreurHttp(400, "CHAMP_INVALIDE", "Identifiant d'établissement : minuscules, chiffres et tirets.");
  }
  if (!id) {
    const [existe] = await env.db.requete("select 1 from etablissements where id = $1", [cible]);
    if (existe) throw new ErreurHttp(409, "DEJA_EXISTANT", "Cet identifiant d'établissement existe déjà.");
  }
  await majEtablissement(env, cible, corps, !id);
  await journaliserAdmin(env, admin.id, id ? "etablissement_modifie" : "etablissement_cree", { etablissement: cible });
  return json(id ? 200 : 201, { etablissement: await etablissement(env.db, cible) });
}

async function enregistrerUtilisateurAdmin(env: Environnement, requete: Request, admin: { id: string }, etablissementId: string): Promise<Response> {
  await etablissement(env.db, etablissementId);
  const corps = await lireJson<Record<string, unknown>>(requete);
  const id = typeof corps.id === "string" && corps.id ? corps.id : `u-${[...aleatoire(4)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
  const [existant] = await env.db.requete<LigneUtilisateur & { etablissement_id: string }>(
    "select id, nom, role, pin_hash, actif, etablissement_id from utilisateurs where id = $1",
    [id],
  );
  if (existant && existant.etablissement_id !== etablissementId) throw new ErreurHttp(403, "INTERDIT", "Utilisateur d'un autre établissement.");
  const pin = typeof corps.pin === "string" ? corps.pin : "";
  if (!existant && !PIN_VALIDE.test(pin)) throw new ErreurHttp(400, "CHAMP_INVALIDE", "Le code PIN compte 4 chiffres.");
  if (pin && !PIN_VALIDE.test(pin)) throw new ErreurHttp(400, "CHAMP_INVALIDE", "Le code PIN compte 4 chiffres.");
  const u: UtilisateurApi = {
    id,
    nom: texte(corps.nom ?? existant?.nom, "nom", 60),
    role: (corps.role ?? existant?.role) as UtilisateurApi["role"],
    pinHash: pin ? await hacherPin(id, pin) : existant!.pin_hash,
    actif: corps.actif === undefined ? (existant?.actif ?? true) : !!corps.actif,
  };
  if (!u.nom) throw new ErreurHttp(400, "CHAMP_INVALIDE", "Le prénom est obligatoire.");
  await enregistrerUtilisateurs(env, etablissementId, [u]);
  await journaliserAdmin(env, admin.id, "utilisateur_enregistre", { etablissement: etablissementId, utilisateur: id, pinModifie: !!pin });
  return json(200, { utilisateurs: await utilisateurs(env.db, etablissementId) });
}

async function genererCode(env: Environnement, requete: Request, admin: { id: string }, etablissementId: string): Promise<Response> {
  await etablissement(env.db, etablissementId);
  const [responsables] = await env.db.requete<{ n: number }>(
    "select count(*)::int as n from utilisateurs where etablissement_id = $1 and role = 'responsable' and actif",
    [etablissementId],
  );
  // Sans responsable, l'iPad rattaché n'aurait personne pour ouvrir la caisse.
  if (!responsables?.n) throw new ErreurHttp(400, "RESPONSABLE_REQUIS", "Ajoutez d'abord un responsable à l'équipe de cet établissement.");
  const corps = await lireJson<Record<string, unknown>>(requete);
  const nomCaisse = texte(corps.nomCaisse || "iPad", "nomCaisse", 40) || "iPad";
  const octets = aleatoire(8);
  const code = [...octets].map((b) => ALPHABET_CODE[b % ALPHABET_CODE.length]).join("");
  const maintenant = horloge(env);
  const expire = new Date(maintenant.getTime() + DUREE_CODE_MS).toISOString();
  await env.db.requete(
    "insert into codes_rattachement (code, etablissement_id, nom_caisse, cree_le, expire_le) values ($1, $2, $3, $4, $5)",
    [code, etablissementId, nomCaisse, maintenant.toISOString(), expire],
  );
  await journaliserAdmin(env, admin.id, "code_genere", { etablissement: etablissementId, nomCaisse });
  return json(201, { code, expireLe: expire, nomCaisse });
}

async function revoquerCaisse(env: Environnement, admin: { id: string }, caisseId: string): Promise<Response> {
  const [c] = await env.db.requete<{ id: string }>(
    "update caisses set revoquee_le = $2 where id = $1 and revoquee_le is null returning id",
    [caisseId, horloge(env).toISOString()],
  );
  if (!c) throw new ErreurHttp(404, "CAISSE_INCONNUE", "Caisse introuvable ou déjà révoquée.");
  await journaliserAdmin(env, admin.id, "caisse_revoquee", { caisse: caisseId });
  return json(200, { ok: true });
}

async function cleDeCaisse(env: Environnement, caisseId: string): Promise<{ cle_id: string; cle_publique: JsonWebKey }> {
  const [c] = await env.db.requete<{ cle_id: string; cle_publique: JsonWebKey }>("select cle_id, cle_publique from caisses where id = $1", [caisseId]);
  if (!c) throw new ErreurHttp(404, "CAISSE_INCONNUE", "Caisse introuvable.");
  return c;
}

/** Contrôle d'intégrité complet de la copie serveur, pour un contrôle fiscal. */
async function verifierCaisse(env: Environnement, admin: { id: string }, caisseId: string): Promise<Response> {
  const c = await cleDeCaisse(env, caisseId);
  const rapport = await verifierRegistre(new StockageServeur(env.db, caisseId), (id) => (id === c.cle_id ? c.cle_publique : null));
  await journaliserAdmin(env, admin.id, "verification", { caisse: caisseId, integre: rapport.integre });
  return json(200, rapport);
}

async function exporterCaisse(env: Environnement, admin: { id: string }, caisseId: string): Promise<Response> {
  await cleDeCaisse(env, caisseId);
  const clotures = await new StockageServeur(env.db, caisseId).lister("clotures");
  await journaliserAdmin(env, admin.id, "export_csv", { caisse: caisseId, clotures: clotures.length });
  return new Response("﻿" + exporterCloturesCSV(clotures as Cloture[]), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="clotures-${caisseId}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

/**
 * Copie intégrale de la chaîne d'une caisse, en JSON (format ouvert). Chaque
 * enregistrement y garde son empreinte et sa signature : le fichier se vérifie
 * seul avec la clé publique qu'il contient.
 */
async function exporterJournal(env: Environnement, admin: { id: string }, caisseId: string): Promise<Response> {
  const c = await cleDeCaisse(env, caisseId);
  const stockage = new StockageServeur(env.db, caisseId);
  const corps = {
    format: "matalon-pos/journal-caisse",
    version: 1,
    exporteLe: horloge(env).toISOString(),
    caisseId,
    cleId: c.cle_id,
    clePublique: c.cle_publique,
    tickets: await stockage.lister("tickets"),
    evenements: await stockage.lister("evenements"),
    clotures: await stockage.lister("clotures"),
  };
  await journaliserAdmin(env, admin.id, "export_journal", { caisse: caisseId, tickets: corps.tickets.length });
  return new Response(JSON.stringify(corps, null, 1), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="journal-${caisseId}.json"`,
      "Cache-Control": "no-store",
    },
  });
}

/** Clôtures reçues d'une caisse, de la plus récente à la plus ancienne. */
async function listeCloturesCaisse(env: Environnement, caisseId: string): Promise<Response> {
  await cleDeCaisse(env, caisseId);
  const clotures = (await new StockageServeur(env.db, caisseId).lister("clotures")).reverse();
  return json(200, {
    clotures: clotures.map((c) => ({
      numero: c.numero,
      periode: c.periode,
      identifiantPeriode: c.identifiantPeriode,
      horodatage: c.horodatage,
      totalTTC: c.totalTTC,
      nbVentes: c.nbVentes,
    })),
  });
}

/**
 * Archive d'une clôture produite depuis la copie du serveur, sans l'iPad :
 * même contenu que l'archive de l'iPad (clôture, tickets et événements
 * couverts, ancrages), chaque enregistrement gardant la signature de l'iPad.
 * Le serveur ne signe pas : l'empreinte du fichier est tracée au journal
 * d'administration au moment de l'export.
 */
async function archiveCloture(env: Environnement, admin: { id: string }, caisseId: string, numero: number): Promise<Response> {
  const c = await cleDeCaisse(env, caisseId);
  const stockage = new StockageServeur(env.db, caisseId);
  const cloture = await stockage.trouver("clotures", numero);
  if (!cloture) throw new ErreurHttp(404, "CLOTURE_INCONNUE", "Clôture introuvable.");
  const agregees = await Promise.all(cloture.cloturesAgregees.map((n) => stockage.trouver("clotures", n)));
  if (agregees.some((x) => !x)) throw new ErreurHttp(500, "ARCHIVE_INCOMPLETE", "Une clôture agrégée manque dans la copie du serveur.");
  const tickets = cloture.premierTicket != null && cloture.dernierTicket != null ? await stockage.lister("tickets", cloture.premierTicket, cloture.dernierTicket) : [];
  const evenements =
    cloture.premierEvenement != null && cloture.dernierEvenement != null ? await stockage.lister("evenements", cloture.premierEvenement, cloture.dernierEvenement) : [];
  const tPrec = cloture.premierTicket && cloture.premierTicket > 1 ? await stockage.trouver("tickets", cloture.premierTicket - 1) : null;
  const ePrec = cloture.premierEvenement && cloture.premierEvenement > 1 ? await stockage.trouver("evenements", cloture.premierEvenement - 1) : null;
  const contenu: ContenuArchiveServeur = {
    format: FORMAT_ARCHIVE_SERVEUR,
    logiciel: NOM_LOGICIEL,
    versionLogiciel: VERSION_NOYAU_FISCAL,
    etablissementId: cloture.etablissementId,
    caisseId,
    genereeLe: horloge(env).toISOString(),
    cleId: c.cle_id,
    clePublique: c.cle_publique,
    empreinteCle: await empreinteCle(c.cle_publique),
    cloture,
    cloturesAgregees: agregees as Cloture[],
    tickets,
    evenements,
    ancrages: {
      ticketPrecedent: tPrec
        ? { numero: tPrec.numero, hash: tPrec.hash, grandTotalPerpetuel: tPrec.grandTotalPerpetuel, cumulPerpetuelAbsolu: tPrec.cumulPerpetuelAbsolu }
        : null,
      evenementPrecedent: ePrec ? { numero: ePrec.numero, hash: ePrec.hash } : null,
    },
  };
  const empreinte = await sha256Hex(canonique(contenu));
  await journaliserAdmin(env, admin.id, "export_archive", { caisse: caisseId, cloture: numero, empreinte });
  const nom = `archive-${cloture.etablissementId}-${caisseId}-${cloture.periode.toLowerCase()}-${cloture.identifiantPeriode}.json`;
  return new Response(JSON.stringify({ ...contenu, empreinte }, null, 1), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nom}"`,
      "Cache-Control": "no-store",
      "X-Empreinte-Archive": empreinte,
    },
  });
}

// ───────── Routage ─────────

export async function traiter(requete: Request, env: Environnement): Promise<Response> {
  const url = new URL(requete.url);
  const chemin = url.pathname.replace(/\/+$/, "");
  const m = requete.method;
  try {
    await migrer(env.db);
    if (chemin === "/api/sante" && m === "GET") return json(200, { ok: true, heure: horloge(env).toISOString() });

    if (chemin === "/api/caisse/rattacher" && m === "POST") return await rattacher(env, requete);
    if (chemin === "/api/caisse/etat" && m === "GET") return await etatCaisse(env, requete);
    if (chemin === "/api/caisse/synchro" && m === "POST") return await synchroniser(env, requete);
    if (chemin === "/api/caisse/utilisateurs" && m === "PUT") return await majUtilisateursCaisse(env, requete);
    if (chemin === "/api/caisse/etablissement" && m === "PUT") return await majEtablissementCaisse(env, requete);
    if (chemin === "/api/caisse/carte" && m === "GET") return await carteCaisse(env, requete);
    if (chemin === "/api/caisse/comptes" && m === "GET") return await comptesCaisse(env, requete);
    if (chemin === "/api/caisse/clients" && m === "PUT") return await majClientCaisse(env, requete);
    if (chemin === "/api/caisse/postes" && m === "PUT") {
      const c = await caisseAuthentifiee(env, requete);
      return json(200, { etablissement: await majPostes(env, c.etablissement_id, await lireJson<Record<string, unknown>>(requete)) });
    }

    if (chemin === "/api/admin/statut" && m === "GET") return await statutAdmin(env, requete);
    if (chemin === "/api/admin/initialiser" && m === "POST") return await initialiserAdmin(env, requete);
    if (chemin === "/api/admin/confirmer" && m === "POST") return await confirmerAdmin(env, requete);
    if (chemin === "/api/admin/connexion" && m === "POST") return await connexionAdmin(env, requete);
    if (chemin === "/api/admin/deconnexion" && m === "POST") return await deconnexionAdmin(env, requete);

    if (chemin.startsWith("/api/admin/")) {
      const admin = await exigerAdmin(env, requete);
      if (chemin === "/api/admin/etablissements" && m === "GET") return await listeEtablissements(env);
      if (chemin === "/api/admin/cartes" && m === "GET") return await listeCartes(env);
      if (chemin === "/api/admin/cartes" && m === "POST") return await creerCarte(env, requete, admin);
      const pc = /^\/api\/admin\/cartes\/([a-z0-9-]+)$/.exec(chemin);
      if (pc && m === "GET") return await lireCarteAdmin(env, pc[1]!);
      if (pc && m === "PUT") return await enregistrerCarte(env, requete, admin, pc[1]!);
      if (chemin === "/api/admin/etablissements" && m === "POST") return await creerOuModifierEtablissement(env, requete, admin);
      let p = /^\/api\/admin\/etablissements\/([a-z0-9-]+)$/.exec(chemin);
      if (p && m === "PUT") return await creerOuModifierEtablissement(env, requete, admin, p[1]);
      p = /^\/api\/admin\/etablissements\/([a-z0-9-]+)\/utilisateurs$/.exec(chemin);
      if (p && m === "POST") return await enregistrerUtilisateurAdmin(env, requete, admin, p[1]!);
      p = /^\/api\/admin\/etablissements\/([a-z0-9-]+)\/comptes$/.exec(chemin);
      if (p && m === "GET") return json(200, await comptes(env, (await etablissement(env.db, p[1]!)).id));
      p = /^\/api\/admin\/etablissements\/([a-z0-9-]+)\/postes$/.exec(chemin);
      if (p && m === "PUT") {
        const e = await majPostes(env, p[1]!, await lireJson<Record<string, unknown>>(requete));
        await journaliserAdmin(env, admin.id, "postes_production", { etablissement: e.id, postes: e.postesProduction ?? {} });
        return json(200, { etablissement: e });
      }
      p = /^\/api\/admin\/etablissements\/([a-z0-9-]+)\/clients$/.exec(chemin);
      if (p && m === "PUT") {
        const e = await etablissement(env.db, p[1]!);
        const client = await enregistrerClient(env, e.id, await lireJson<Record<string, unknown>>(requete));
        await journaliserAdmin(env, admin.id, "client_enregistre", { etablissement: e.id, client: client.id, nom: client.nom, actif: client.actif });
        return json(200, { client });
      }
      p = /^\/api\/admin\/etablissements\/([a-z0-9-]+)\/codes$/.exec(chemin);
      if (p && m === "POST") return await genererCode(env, requete, admin, p[1]!);
      p = /^\/api\/admin\/caisses\/(ipad-[0-9a-f]{8})\/revoquer$/.exec(chemin);
      if (p && m === "POST") return await revoquerCaisse(env, admin, p[1]!);
      p = /^\/api\/admin\/caisses\/(ipad-[0-9a-f]{8})\/verification$/.exec(chemin);
      if (p && m === "GET") return await verifierCaisse(env, admin, p[1]!);
      p = /^\/api\/admin\/caisses\/(ipad-[0-9a-f]{8})\/journal\.json$/.exec(chemin);
      if (p && m === "GET") return await exporterJournal(env, admin, p[1]!);
      p = /^\/api\/admin\/caisses\/(ipad-[0-9a-f]{8})\/clotures$/.exec(chemin);
      if (p && m === "GET") return await listeCloturesCaisse(env, p[1]!);
      p = /^\/api\/admin\/caisses\/(ipad-[0-9a-f]{8})\/clotures\/(\d{1,9})\/archive\.json$/.exec(chemin);
      if (p && m === "GET") return await archiveCloture(env, admin, p[1]!, Number(p[2]));
      p = /^\/api\/admin\/caisses\/(ipad-[0-9a-f]{8})\/clotures\.csv$/.exec(chemin);
      if (p && m === "GET") return await exporterCaisse(env, admin, p[1]!);
    }
    return json(404, { code: "INTROUVABLE", message: "Route inconnue." });
  } catch (e) {
    if (e instanceof ErreurHttp) return json(e.statut, { code: e.code, message: e.message });
    console.error(e);
    return json(500, { code: "ERREUR_SERVEUR", message: "Erreur interne du serveur." });
  }
}
