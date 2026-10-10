/**
 * Secrets propres à un établissement (clé API Resend, demain d'autres) : chiffrés
 * en AES-256-GCM avec une clé maîtresse gardée hors de la base (CLE_SECRETS,
 * variable de l'hébergement). Une copie de la base seule ne les révèle pas ; le
 * chiffré est lié à l'établissement et au nom du secret (données associées).
 * Jamais renvoyés à l'administration : seulement un aperçu (« re_…a1b2 »).
 */
import { ErreurHttp, type Db } from "./db.js";

export type NomSecret = "resend";

const b64 = (o: Uint8Array) => btoa(String.fromCharCode(...o));
const deB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function cle(maitresse: string): Promise<CryptoKey> {
  const brut = deB64(maitresse);
  if (brut.length !== 32) throw new ErreurHttp(500, "CLE_SECRETS_INVALIDE", "CLE_SECRETS doit faire 32 octets en base64 (openssl rand -base64 32).");
  return crypto.subtle.importKey("raw", brut, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export const apercuSecret = (s: string) => (s.length > 10 ? `${s.slice(0, 3)}…${s.slice(-4)}` : "…");

export async function enregistrerSecret(db: Db, maitresse: string, etablissementId: string, nom: NomSecret, valeur: string, par: string, le: string): Promise<{ apercu: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const chiffre = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(`${etablissementId}:${nom}`) }, await cle(maitresse), new TextEncoder().encode(valeur)),
  );
  const apercu = apercuSecret(valeur);
  await db.requete(
    `insert into secrets_etablissement (etablissement_id, nom, iv, chiffre, apercu, maj_le, maj_par) values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (etablissement_id, nom) do update set iv = excluded.iv, chiffre = excluded.chiffre, apercu = excluded.apercu, maj_le = excluded.maj_le, maj_par = excluded.maj_par`,
    [etablissementId, nom, b64(iv), b64(chiffre), apercu, le, par],
  );
  return { apercu };
}

export async function lireSecret(db: Db, maitresse: string | undefined, etablissementId: string, nom: NomSecret): Promise<string | null> {
  const [l] = await db.requete<{ iv: string; chiffre: string }>("select iv, chiffre from secrets_etablissement where etablissement_id = $1 and nom = $2", [etablissementId, nom]);
  if (!l || !maitresse) return null;
  const clair = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: deB64(l.iv), additionalData: new TextEncoder().encode(`${etablissementId}:${nom}`) },
    await cle(maitresse),
    deB64(l.chiffre),
  );
  return new TextDecoder().decode(clair);
}

export async function etatSecret(db: Db, etablissementId: string, nom: NomSecret): Promise<{ apercu: string; majLe: string; majPar: string | null } | null> {
  const [l] = await db.requete<{ apercu: string; maj_le: string; maj_par: string | null }>(
    "select apercu, maj_le, maj_par from secrets_etablissement where etablissement_id = $1 and nom = $2",
    [etablissementId, nom],
  );
  return l ? { apercu: l.apercu, majLe: l.maj_le, majPar: l.maj_par } : null;
}

export async function retirerSecret(db: Db, etablissementId: string, nom: NomSecret): Promise<void> {
  await db.requete("delete from secrets_etablissement where etablissement_id = $1 and nom = $2", [etablissementId, nom]);
}
