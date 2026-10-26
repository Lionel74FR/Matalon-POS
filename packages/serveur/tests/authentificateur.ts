/**
 * Authentificateur simulé (WebCrypto) pour les tests des clés d'accès : il crée la clé, puis signe
 * les connexions comme le ferait Face ID ou Touch ID.
 */
import { base64Url } from "../src/securite.js";
import { depuisBase64Url } from "../src/webauthn.js";

// ───────── Authentificateur simulé ─────────

/** Encodeur CBOR minimal (entiers, octets, texte, tableaux, tables) pour fabriquer les réponses. */
export function cbor(v: unknown): number[] {
  const tete = (majeur: number, n: number): number[] => {
    if (n < 24) return [(majeur << 5) | n];
    if (n < 256) return [(majeur << 5) | 24, n];
    if (n < 65536) return [(majeur << 5) | 25, n >> 8, n & 255];
    return [(majeur << 5) | 26, (n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  if (typeof v === "number") return v >= 0 ? tete(0, v) : tete(1, -1 - v);
  if (v instanceof Uint8Array) return [...tete(2, v.length), ...v];
  if (typeof v === "string") {
    const o = new TextEncoder().encode(v);
    return [...tete(3, o.length), ...o];
  }
  if (Array.isArray(v)) return [...tete(4, v.length), ...v.flatMap(cbor)];
  if (v instanceof Map) return [...tete(5, v.size), ...[...v].flatMap(([k, x]) => [...cbor(k), ...cbor(x)])];
  throw new Error("type non encodable");
}

const b64 = (o: Uint8Array | ArrayBuffer | number[]) => base64Url(o instanceof Uint8Array ? o : new Uint8Array(o as ArrayBuffer));
const octets = (...parts: Array<Uint8Array | number[]>) => new Uint8Array(parts.flatMap((p) => [...p]));
const sha = async (o: Uint8Array | string) => new Uint8Array(await crypto.subtle.digest("SHA-256", typeof o === "string" ? new TextEncoder().encode(o) : new Uint8Array(o)));
const compteur4 = (n: number) => [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];

/** Signature brute r‖s → DER, comme la rendent les authentificateurs. */
function brutVersDer(brut: Uint8Array): Uint8Array {
  const entier = (x: Uint8Array) => {
    let i = 0;
    while (i < x.length - 1 && x[i] === 0) i++;
    const y = [...x.slice(i)];
    if (y[0]! & 0x80) y.unshift(0);
    return [0x02, y.length, ...y];
  };
  const corps = [...entier(brut.slice(0, 32)), ...entier(brut.slice(32))];
  return new Uint8Array([0x30, corps.length, ...corps]);
}

export class Authentificateur {
  id = crypto.getRandomValues(new Uint8Array(32));
  compteur = 0;
  private paire!: CryptoKeyPair;
  constructor(private readonly algo: "ES256" | "RS256" = "ES256", private readonly incrementer = false) {}

  async creer(options: any, origine = "https://pos.test", drapeaux = 0x45) {
    this.paire = (await crypto.subtle.generateKey(
      this.algo === "ES256"
        ? { name: "ECDSA", namedCurve: "P-256" }
        : { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    this.utilisateur = options.user.id;
    const jwk = await crypto.subtle.exportKey("jwk", this.paire.publicKey);
    const cose =
      this.algo === "ES256"
        ? new Map<number, unknown>([[1, 2], [3, -7], [-1, 1], [-2, depuisBase64Url(jwk.x!)], [-3, depuisBase64Url(jwk.y!)]])
        : new Map<number, unknown>([[1, 3], [3, -257], [-1, depuisBase64Url(jwk.n!)], [-2, depuisBase64Url(jwk.e!)]]);
    const authData = octets(await sha(options.rp.id), [drapeaux], compteur4(this.compteur), new Uint8Array(16), [0, this.id.length], this.id, cbor(cose));
    const clientData = JSON.stringify({ type: "webauthn.create", challenge: options.challenge, origin: origine, crossOrigin: false });
    return {
      id: b64(this.id),
      rawId: b64(this.id),
      type: "public-key",
      response: {
        clientDataJSON: b64(new TextEncoder().encode(clientData)),
        attestationObject: b64(cbor(new Map<string, unknown>([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]]))),
      },
    };
  }
  utilisateur = "";

  async signer(options: any, reglages: { origine?: string; rpId?: string; drapeaux?: number; type?: string } = {}) {
    if (this.incrementer) this.compteur++;
    const authData = octets(await sha(reglages.rpId ?? options.rpId), [reglages.drapeaux ?? 0x05], compteur4(this.compteur));
    const clientData = new TextEncoder().encode(
      JSON.stringify({ type: reglages.type ?? "webauthn.get", challenge: options.challenge, origin: reglages.origine ?? "https://pos.test" }),
    );
    const signe = octets(authData, await sha(clientData));
    const sig = new Uint8Array(
      await crypto.subtle.sign(this.algo === "ES256" ? { name: "ECDSA", hash: "SHA-256" } : { name: "RSASSA-PKCS1-v1_5" }, this.paire.privateKey, signe),
    );
    return {
      id: b64(this.id),
      rawId: b64(this.id),
      type: "public-key",
      response: {
        clientDataJSON: b64(clientData),
        authenticatorData: b64(authData),
        signature: b64(this.algo === "ES256" ? brutVersDer(sig) : sig),
        userHandle: this.utilisateur,
      },
    };
  }
}

