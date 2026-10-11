/**
 * Clés d'accès (passkeys, WebAuthn niveau 2) pour l'administration.
 *
 * Vérification minimale et complète pour notre usage, sans dépendance (WebCrypto, runtime Edge) :
 * - enregistrement sans attestation (« none ») : on ne cherche pas à savoir quel appareil a créé la clé,
 *   seulement à retenir sa clé publique ;
 * - connexion : défi à usage unique, origine et domaine (rpId) contrôlés, présence ET vérification de
 *   l'utilisateur exigées (Face ID, Touch ID, code de l'appareil), signature vérifiée, compteur monotone.
 * Algorithmes acceptés : ES256 (-7, Apple, Google, la plupart des clés) et RS256 (-257, Windows Hello).
 */
import { base64Url } from "./securite.js";

export class ErreurWebAuthn extends Error {}

const ALG_ES256 = -7;
const ALG_RS256 = -257;
export const ALGORITHMES = [ALG_ES256, ALG_RS256];

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_AT = 0x40;

export function depuisBase64Url(s: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new ErreurWebAuthn("Encodage base64url invalide.");
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  const o = new Uint8Array(new ArrayBuffer(b.length));
  for (let i = 0; i < b.length; i++) o[i] = b.charCodeAt(i);
  return o;
}

// ───────── CBOR (RFC 8949), le sous-ensemble utilisé par WebAuthn ─────────

type Cbor = number | bigint | Uint8Array | string | Cbor[] | Map<Cbor, Cbor> | boolean | null | undefined;

/** Décode une valeur CBOR à partir de `debut` ; rend la valeur et la position qui suit. */
export function decoderCbor(o: Uint8Array, debut = 0): { valeur: Cbor; fin: number } {
  let p = debut;
  const octet = () => {
    if (p >= o.length) throw new ErreurWebAuthn("CBOR tronqué.");
    return o[p++]!;
  };
  const longueur = (info: number): number => {
    if (info < 24) return info;
    let n = 0;
    const taille = info === 24 ? 1 : info === 25 ? 2 : info === 26 ? 4 : info === 27 ? 8 : 0;
    if (!taille) throw new ErreurWebAuthn("CBOR : longueur indéfinie non prise en charge.");
    for (let i = 0; i < taille; i++) n = n * 256 + octet();
    if (!Number.isSafeInteger(n)) throw new ErreurWebAuthn("CBOR : entier trop grand.");
    return n;
  };
  const lire = (profondeur: number): Cbor => {
    if (profondeur > 16) throw new ErreurWebAuthn("CBOR trop imbriqué.");
    const t = octet();
    const majeur = t >> 5;
    const info = t & 31;
    switch (majeur) {
      case 0:
        return longueur(info);
      case 1:
        return -1 - longueur(info);
      case 2:
      case 3: {
        const n = longueur(info);
        if (p + n > o.length) throw new ErreurWebAuthn("CBOR tronqué.");
        const morceau = o.slice(p, p + n);
        p += n;
        return majeur === 2 ? morceau : new TextDecoder("utf-8", { fatal: true }).decode(morceau);
      }
      case 4: {
        const n = longueur(info);
        const t: Cbor[] = [];
        for (let i = 0; i < n; i++) t.push(lire(profondeur + 1));
        return t;
      }
      case 5: {
        const n = longueur(info);
        const m = new Map<Cbor, Cbor>();
        for (let i = 0; i < n; i++) {
          const k = lire(profondeur + 1);
          m.set(k, lire(profondeur + 1));
        }
        return m;
      }
      case 7:
        if (info === 20) return false;
        if (info === 21) return true;
        if (info === 22) return null;
        if (info === 23) return undefined;
        throw new ErreurWebAuthn("CBOR : valeur simple non prise en charge.");
      default:
        throw new ErreurWebAuthn("CBOR : type non pris en charge.");
    }
  };
  const valeur = lire(0);
  return { valeur, fin: p };
}

// ───────── Données communes ─────────

interface DonneesClient {
  type: string;
  challenge: string;
  origin: string;
  crossOrigin?: boolean;
}

function lireDonneesClient(clientDataJSON: Uint8Array, type: string, defi: string, origine: string): void {
  let d: DonneesClient;
  try {
    d = JSON.parse(new TextDecoder().decode(clientDataJSON)) as DonneesClient;
  } catch {
    throw new ErreurWebAuthn("Données du navigateur illisibles.");
  }
  if (d.type !== type) throw new ErreurWebAuthn("Type d'opération inattendu.");
  if (d.challenge !== defi) throw new ErreurWebAuthn("Défi inattendu.");
  if (d.origin !== origine) throw new ErreurWebAuthn("Origine inattendue.");
  if (d.crossOrigin === true) throw new ErreurWebAuthn("Opération depuis un cadre d'un autre site refusée.");
}

interface DonneesAuthentificateur {
  drapeaux: number;
  compteur: number;
  idCle?: Uint8Array;
  clePublique?: Map<Cbor, Cbor>;
}

async function lireDonneesAuthentificateur(o: Uint8Array, rpId: string): Promise<DonneesAuthentificateur> {
  if (o.length < 37) throw new ErreurWebAuthn("Données de l'authentificateur tronquées.");
  const attendu = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rpId)));
  for (let i = 0; i < 32; i++) if (o[i] !== attendu[i]) throw new ErreurWebAuthn("Clé créée pour un autre domaine.");
  const drapeaux = o[32]!;
  if (!(drapeaux & FLAG_UP)) throw new ErreurWebAuthn("Présence de l'utilisateur non confirmée.");
  if (!(drapeaux & FLAG_UV)) throw new ErreurWebAuthn("Vérification de l'utilisateur (Face ID, Touch ID, code) exigée.");
  const compteur = ((o[33]! << 24) >>> 0) + (o[34]! << 16) + (o[35]! << 8) + o[36]!;
  if (!(drapeaux & FLAG_AT)) return { drapeaux, compteur };
  if (o.length < 55) throw new ErreurWebAuthn("Données de clé tronquées.");
  const n = (o[53]! << 8) + o[54]!;
  if (n < 16 || n > 1023 || o.length < 55 + n) throw new ErreurWebAuthn("Identifiant de clé invalide.");
  const idCle = o.slice(55, 55 + n);
  const { valeur } = decoderCbor(o, 55 + n);
  if (!(valeur instanceof Map)) throw new ErreurWebAuthn("Clé publique illisible.");
  return { drapeaux, compteur, idCle, clePublique: valeur };
}

/** Clé publique COSE → JWK pour WebCrypto. */
function coseVersJwk(c: Map<Cbor, Cbor>): { alg: number; jwk: JsonWebKey } {
  const kty = c.get(1);
  const alg = c.get(3);
  const octets = (k: number) => {
    const v = c.get(k);
    if (!(v instanceof Uint8Array)) throw new ErreurWebAuthn("Clé publique incomplète.");
    return base64Url(v);
  };
  if (kty === 2 && alg === ALG_ES256 && c.get(-1) === 1) return { alg, jwk: { kty: "EC", crv: "P-256", x: octets(-2), y: octets(-3) } };
  if (kty === 3 && alg === ALG_RS256) return { alg, jwk: { kty: "RSA", n: octets(-1), e: octets(-2), alg: "RS256" } };
  throw new ErreurWebAuthn("Type de clé non pris en charge (ES256 ou RS256 attendu).");
}

function paramsAlgo(alg: number): { importer: EcKeyImportParams | RsaHashedImportParams; verifier: EcdsaParams | AlgorithmIdentifier } {
  if (alg === ALG_ES256) return { importer: { name: "ECDSA", namedCurve: "P-256" }, verifier: { name: "ECDSA", hash: "SHA-256" } };
  if (alg === ALG_RS256) return { importer: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, verifier: { name: "RSASSA-PKCS1-v1_5" } };
  throw new ErreurWebAuthn("Algorithme non pris en charge.");
}

/** Signature ECDSA DER (WebAuthn) → r‖s de 64 octets (WebCrypto). */
function derVersBrut(der: Uint8Array): Uint8Array<ArrayBuffer> {
  let p = 0;
  const lire = () => {
    if (p >= der.length) throw new ErreurWebAuthn("Signature tronquée.");
    return der[p++]!;
  };
  if (lire() !== 0x30) throw new ErreurWebAuthn("Signature invalide.");
  let l = lire();
  if (l & 0x80) {
    const n = l & 0x7f;
    l = 0;
    for (let i = 0; i < n; i++) l = (l << 8) | lire();
  }
  const sortie = new Uint8Array(new ArrayBuffer(64));
  for (const decalage of [0, 32]) {
    if (lire() !== 0x02) throw new ErreurWebAuthn("Signature invalide.");
    const n = lire();
    if (n < 1 || n > 33 || p + n > der.length) throw new ErreurWebAuthn("Signature invalide.");
    let entier = der.slice(p, p + n);
    p += n;
    while (entier.length > 32 && entier[0] === 0) entier = entier.slice(1);
    if (entier.length > 32) throw new ErreurWebAuthn("Signature invalide.");
    sortie.set(entier, decalage + 32 - entier.length);
  }
  return sortie;
}

// ───────── Enregistrement ─────────

export interface CleEnregistree {
  /** Identifiant de la clé (base64url), tel que le navigateur le renverra à la connexion. */
  id: string;
  alg: number;
  jwk: JsonWebKey;
  compteur: number;
}

export interface ReponseEnregistrement {
  id: string;
  rawId?: string;
  type?: string;
  response: { clientDataJSON: string; attestationObject: string; transports?: string[] };
}

export async function verifierEnregistrement(
  r: ReponseEnregistrement,
  attendu: { defi: string; origine: string; rpId: string },
): Promise<CleEnregistree> {
  if (r.type !== undefined && r.type !== "public-key") throw new ErreurWebAuthn("Type de clé inattendu.");
  lireDonneesClient(depuisBase64Url(r.response.clientDataJSON), "webauthn.create", attendu.defi, attendu.origine);
  const { valeur } = decoderCbor(depuisBase64Url(r.response.attestationObject));
  const authData = valeur instanceof Map ? valeur.get("authData") : undefined;
  if (!(authData instanceof Uint8Array)) throw new ErreurWebAuthn("Attestation illisible.");
  const d = await lireDonneesAuthentificateur(authData, attendu.rpId);
  if (!d.idCle || !d.clePublique) throw new ErreurWebAuthn("La réponse ne contient pas de clé.");
  const id = base64Url(d.idCle);
  if (id !== r.id) throw new ErreurWebAuthn("Identifiant de clé incohérent.");
  const { alg, jwk } = coseVersJwk(d.clePublique);
  // La clé doit être importable : on refuse dès maintenant une clé publique malformée.
  await crypto.subtle.importKey("jwk", jwk, paramsAlgo(alg).importer, false, ["verify"]);
  return { id, alg, jwk, compteur: d.compteur };
}

// ───────── Connexion ─────────

export interface ReponseAssertion {
  id: string;
  rawId?: string;
  type?: string;
  response: { clientDataJSON: string; authenticatorData: string; signature: string; userHandle?: string | null };
}

/** Vérifie une connexion ; rend le nouveau compteur à enregistrer. */
export async function verifierAssertion(
  r: ReponseAssertion,
  cle: CleEnregistree,
  attendu: { defi: string; origine: string; rpId: string; utilisateur: string },
): Promise<{ compteur: number }> {
  if (r.type !== undefined && r.type !== "public-key") throw new ErreurWebAuthn("Type de clé inattendu.");
  if (r.id !== cle.id) throw new ErreurWebAuthn("Clé inattendue.");
  const clientData = depuisBase64Url(r.response.clientDataJSON);
  lireDonneesClient(clientData, "webauthn.get", attendu.defi, attendu.origine);
  const authData = depuisBase64Url(r.response.authenticatorData);
  const d = await lireDonneesAuthentificateur(authData, attendu.rpId);
  if (r.response.userHandle && new TextDecoder().decode(depuisBase64Url(r.response.userHandle)) !== attendu.utilisateur) {
    throw new ErreurWebAuthn("Clé d'un autre compte.");
  }
  const signe = new Uint8Array(new ArrayBuffer(authData.length + 32));
  signe.set(authData);
  signe.set(new Uint8Array(await crypto.subtle.digest("SHA-256", clientData)), authData.length);
  const p = paramsAlgo(cle.alg);
  const publique = await crypto.subtle.importKey("jwk", cle.jwk, p.importer, false, ["verify"]);
  const brute = depuisBase64Url(r.response.signature);
  const signature = cle.alg === ALG_ES256 ? derVersBrut(brute) : brute;
  if (!(await crypto.subtle.verify(p.verifier, publique, signature, signe))) throw new ErreurWebAuthn("Signature invalide.");
  // Compteur : les clés synchronisées (iCloud, Google) restent à 0 ; sinon il doit augmenter (clé clonée).
  if ((d.compteur !== 0 || cle.compteur !== 0) && d.compteur <= cle.compteur) throw new ErreurWebAuthn("Compteur de la clé incohérent.");
  return { compteur: d.compteur };
}
