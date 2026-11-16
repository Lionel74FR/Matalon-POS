import { ErreurHttp, type Db } from "./db.js";
import { adresseLocale, type DestinationReseau, type EtatImpressionRelayee, type ImpressionRelayee, type RelaisImpression } from "./partage.js";

/**
 * Impression relayée par une dalle (16 novembre 2026, backlog n° 5) : un iPad ou un iPhone, qui ne peut
 * pas joindre l'imprimante série d'une dalle, dépose son reçu ici ; la dalle relais (caisse ouverte dans
 * Chrome, imprimante série, « Imprimer aussi pour les iPad et iPhone ») vient le chercher toutes les
 * quelques secondes, l'imprime et rend compte. Données de travail hors périmètre fiscal : le reçu est
 * déjà signé et enregistré sur l'appareil qui l'a produit ; ici il ne sert qu'à sortir sur papier, et
 * la file est purgée au bout d'un jour.
 */

/** Une dalle relais vue il y a moins de 30 secondes est en ligne (elle passe toutes les 3 secondes). */
export const RELAIS_EN_LIGNE_MS = 30_000;
/** Une impression qu'aucune dalle n'a prise en 2 minutes est abandonnée : le ticket arriverait trop tard. */
export const ATTENTE_MAX_MS = 120_000;
/** Une impression prise sans compte rendu en 1 minute est réputée perdue (dalle fermée en cours de route). */
export const PRISE_MAX_MS = 60_000;
const PURGE_MS = 24 * 3600_000;
const OCTETS_MAX = 64_000;
const ELEMENTS_MAX = 600;
const TYPES = new Set(["texte", "colonnes", "filet", "saut", "tiroir"]);
const ID = /^ir-[0-9a-f]{12}$/;

interface Appareil {
  id: string;
  etablissement_id: string;
}

const iso = (ms: number) => new Date(ms).toISOString();

/** Le reçu tel que la caisse le décrit (`ElementRecu[]`) : contrôlé ici, jamais interprété. */
function lireRecu(v: unknown): unknown[] {
  if (!Array.isArray(v) || !v.length || v.length > ELEMENTS_MAX) throw new ErreurHttp(400, "RECU_INVALIDE", "Reçu vide ou trop long.");
  for (const e of v) {
    if (!e || typeof e !== "object" || Array.isArray(e) || !TYPES.has((e as { type?: unknown }).type as string)) {
      throw new ErreurHttp(400, "RECU_INVALIDE", "Élément de reçu inconnu.");
    }
    for (const x of Object.values(e as Record<string, unknown>)) {
      if (typeof x === "string" ? x.length > 400 : !["number", "boolean"].includes(typeof x)) throw new ErreurHttp(400, "RECU_INVALIDE", "Élément de reçu invalide.");
    }
  }
  if (JSON.stringify(v).length > OCTETS_MAX) throw new ErreurHttp(400, "RECU_INVALIDE", "Reçu trop volumineux.");
  return v;
}

/** Inscrit ou retire cet appareil comme relais d'impression de son établissement. */
export async function inscrireRelais(db: Db, c: Appareil, actif: boolean, maintenant: Date): Promise<void> {
  if (!actif) {
    await db.requete("delete from relais_impression where caisse_id = $1", [c.id]);
    return;
  }
  await db.requete(
    `insert into relais_impression (caisse_id, etablissement_id, inscrit_le, vu_le) values ($1, $2, $3, $3)
     on conflict (caisse_id) do update set vu_le = excluded.vu_le, etablissement_id = excluded.etablissement_id`,
    [c.id, c.etablissement_id, maintenant.toISOString()],
  );
}

/** Dalles relais de l'établissement (appareils non révoqués), en ligne d'abord. */
export async function listeRelais(db: Db, etablissementId: string, maintenant: Date): Promise<RelaisImpression[]> {
  const lignes = await db.requete<{ id: string; nom: string; vu_le: string }>(
    `select r.caisse_id as id, c.nom, r.vu_le from relais_impression r join caisses c on c.id = r.caisse_id
     where r.etablissement_id = $1 and c.revoquee_le is null order by c.nom, r.caisse_id`,
    [etablissementId],
  );
  return lignes.map((l) => ({ id: l.id, nom: l.nom, vuLe: l.vu_le, enLigne: Date.parse(l.vu_le) > maintenant.getTime() - RELAIS_EN_LIGNE_MS }));
}

/** Dépose une impression pour une dalle relais de l'établissement. Refusée si la dalle ne répond pas. */
export async function deposerImpression(db: Db, c: Appareil, corps: Record<string, unknown>, maintenant: Date): Promise<{ id: string }> {
  const relaisId = typeof corps.relaisId === "string" ? corps.relaisId : "";
  const titre = typeof corps.titre === "string" ? corps.titre.slice(0, 80) : "";
  const recu = lireRecu(corps.recu);
  let destination: DestinationReseau | null = null;
  if (corps.destination !== undefined && corps.destination !== null) {
    const d = corps.destination as Record<string, unknown>;
    if (!d || typeof d !== "object" || !adresseLocale(d.adresse) || typeof d.sansAccents !== "boolean") {
      throw new ErreurHttp(400, "DESTINATION_INVALIDE", "Imprimante réseau : adresse IPv4 du réseau local attendue (192.168.x.x…).");
    }
    destination = { adresse: d.adresse, sansAccents: d.sansAccents };
  }
  const relais = (await listeRelais(db, c.etablissement_id, maintenant)).find((r) => r.id === relaisId);
  if (!relais) throw new ErreurHttp(404, "RELAIS_INCONNU", "Cette dalle n'imprime plus pour les autres appareils : choisissez une autre sortie dans les Réglages.");
  if (!relais.enLigne) {
    throw new ErreurHttp(409, "RELAIS_HORS_LIGNE", `La dalle « ${relais.nom} » ne répond pas : vérifiez qu'elle est allumée, la caisse ouverte dans Chrome.`);
  }
  const id = `ir-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  await db.requete(
    `insert into impressions_relayees (id, etablissement_id, relais_id, demandeur_id, titre, recu, etat, cree_le, destination)
     values ($1, $2, $3, $4, $5, $6::jsonb, 'attente', $7, $8::jsonb)`,
    [id, c.etablissement_id, relais.id, c.id, titre, JSON.stringify(recu), maintenant.toISOString(), destination ? JSON.stringify(destination) : null],
  );
  return { id };
}

/**
 * Passage de la dalle relais : la tient pour en ligne, purge la file, et lui confie les impressions en
 * attente (les plus anciennes d'abord). Rien si cet appareil n'est pas relais.
 */
export async function prendreImpressions(db: Db, c: Appareil, maintenant: Date): Promise<ImpressionRelayee[]> {
  const t = maintenant.getTime();
  const vu = await db.requete<{ caisse_id: string }>("update relais_impression set vu_le = $2 where caisse_id = $1 returning caisse_id", [c.id, iso(t)]);
  if (!vu.length) return [];
  await db.requete("delete from impressions_relayees where etablissement_id = $1 and cree_le < $2", [c.etablissement_id, iso(t - PURGE_MS)]);
  const lignes = await db.requete<{ id: string; titre: string; recu: unknown[] | string; cree_le: string; destination: DestinationReseau | string | null }>(
    `update impressions_relayees set etat = 'prise', prise_le = $2
     where id in (select id from impressions_relayees where relais_id = $1 and etat = 'attente' and cree_le >= $3 order by cree_le, id limit 5)
     returning id, titre, recu, cree_le, destination`,
    [c.id, iso(t), iso(t - ATTENTE_MAX_MS)],
  );
  return lignes
    .sort((a, b) => a.cree_le.localeCompare(b.cree_le) || a.id.localeCompare(b.id))
    .map((l) => {
      const recu = typeof l.recu === "string" ? (JSON.parse(l.recu) as unknown[]) : l.recu;
      const destination = typeof l.destination === "string" ? (JSON.parse(l.destination) as DestinationReseau) : l.destination;
      return { id: l.id, titre: l.titre, recu, ...(destination ? { destination } : {}) };
    });
}

/** Compte rendu de la dalle relais : imprimé, ou l'erreur rencontrée. */
export async function rendreCompte(db: Db, c: Appareil, id: string, corps: Record<string, unknown>, maintenant: Date): Promise<void> {
  if (!ID.test(id)) throw new ErreurHttp(404, "IMPRESSION_INCONNUE", "Impression inconnue.");
  const ok = corps.ok === true;
  const erreur = ok ? null : typeof corps.erreur === "string" && corps.erreur.trim() ? corps.erreur.trim().slice(0, 300) : "Erreur d'impression sur la dalle.";
  const r = await db.requete<{ id: string }>(
    "update impressions_relayees set etat = $3, erreur = $4, faite_le = $5 where id = $1 and relais_id = $2 and etat = 'prise' returning id",
    [id, c.id, ok ? "faite" : "echec", erreur, maintenant.toISOString()],
  );
  if (!r.length) throw new ErreurHttp(404, "IMPRESSION_INCONNUE", "Impression inconnue ou déjà traitée.");
}

/** Où en est une impression déposée par cet appareil (délais dépassés compris). */
export async function etatImpression(db: Db, c: Appareil, id: string, maintenant: Date): Promise<{ etat: EtatImpressionRelayee; erreur?: string }> {
  if (!ID.test(id)) throw new ErreurHttp(404, "IMPRESSION_INCONNUE", "Impression inconnue.");
  const [l] = await db.requete<{ etat: EtatImpressionRelayee; erreur: string | null; cree_le: string; prise_le: string | null; nom: string | null }>(
    `select i.etat, i.erreur, i.cree_le, i.prise_le, c.nom from impressions_relayees i left join caisses c on c.id = i.relais_id
     where i.id = $1 and i.demandeur_id = $2`,
    [id, c.id],
  );
  if (!l) throw new ErreurHttp(404, "IMPRESSION_INCONNUE", "Impression inconnue.");
  const t = maintenant.getTime();
  const dalle = l.nom ? `La dalle « ${l.nom} »` : "La dalle";
  if (l.etat === "attente" && Date.parse(l.cree_le) < t - ATTENTE_MAX_MS) return { etat: "echec", erreur: `${dalle} n'a pas pris l'impression à temps.` };
  if (l.etat === "prise" && l.prise_le && Date.parse(l.prise_le) < t - PRISE_MAX_MS) return { etat: "echec", erreur: `${dalle} n'a pas confirmé l'impression.` };
  return l.erreur ? { etat: l.etat, erreur: l.erreur } : { etat: l.etat };
}
