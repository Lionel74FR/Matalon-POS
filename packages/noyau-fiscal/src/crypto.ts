/**
 * Primitives cryptographiques (WebCrypto : navigateur, PWA et Node ≥ 20).
 *
 * Chaque caisse possède sa propre paire de clés ECDSA P-256. La clé privée
 * reste sur l'appareil (non exportable) ; la clé publique est enregistrée
 * côté serveur pour vérifier les chaînes.
 */

const sousCrypto = (): SubtleCrypto => {
  const c = globalThis.crypto?.subtle;
  if (!c) throw new Error("WebCrypto indisponible : contexte sécurisé (HTTPS) requis");
  return c;
};

/** Empreinte de la chaîne de genèse (premier enregistrement de chaque chaîne). */
export const HASH_GENESE = "0".repeat(64);

function versHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function versBase64(buf: ArrayBuffer): string {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s);
}

function depuisBase64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export async function sha256Hex(texte: string): Promise<string> {
  return versHex(await sousCrypto().digest("SHA-256", new TextEncoder().encode(texte)));
}

const ALGO_CLE = { name: "ECDSA", namedCurve: "P-256" } as const;
const ALGO_SIGNATURE = { name: "ECDSA", hash: "SHA-256" } as const;

/** Signe les empreintes des enregistrements d'une caisse. */
export interface Signataire {
  readonly cleId: string;
  signer(hash: string): Promise<string>;
}

/** Retrouve la clé publique d'une caisse à partir de son identifiant de clé. */
export type ResolveurCle = (cleId: string) => Promise<JsonWebKey | null> | JsonWebKey | null;

export interface PaireCles {
  cleId: string;
  clePrivee: CryptoKey;
  clePubliqueJwk: JsonWebKey;
}

/** Génère une paire de clés de caisse. La clé privée n'est pas exportable. */
export async function genererPaireCles(cleId: string): Promise<PaireCles> {
  const paire = (await sousCrypto().generateKey(ALGO_CLE, false, ["sign", "verify"])) as CryptoKeyPair;
  const clePubliqueJwk = await sousCrypto().exportKey("jwk", paire.publicKey);
  return { cleId, clePrivee: paire.privateKey, clePubliqueJwk };
}

export function signataireDepuis(paire: Pick<PaireCles, "cleId" | "clePrivee">): Signataire {
  return {
    cleId: paire.cleId,
    async signer(hash: string) {
      const sig = await sousCrypto().sign(ALGO_SIGNATURE, paire.clePrivee, new TextEncoder().encode(hash));
      return versBase64(sig);
    },
  };
}

export async function verifierSignature(
  clePubliqueJwk: JsonWebKey,
  hash: string,
  signature: string,
): Promise<boolean> {
  try {
    const cle = await sousCrypto().importKey("jwk", clePubliqueJwk, ALGO_CLE, false, ["verify"]);
    return await sousCrypto().verify(
      ALGO_SIGNATURE,
      cle,
      depuisBase64(signature),
      new TextEncoder().encode(hash),
    );
  } catch {
    return false;
  }
}
