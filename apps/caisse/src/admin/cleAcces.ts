/**
 * Clés d'accès (passkeys) côté navigateur : options du serveur (JSON) → WebAuthn → réponse JSON.
 * Conversion faite ici plutôt que par parseCreationOptionsFromJSON, absent des iPad plus anciens.
 */

export const cleAccesDisponible = () => typeof window !== "undefined" && "PublicKeyCredential" in window && !!navigator.credentials;

function octets(b64: string): ArrayBuffer {
  const b = atob(b64.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64.length + 3) % 4));
  const o = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) o[i] = b.charCodeAt(i);
  return o.buffer;
}

function b64(o: ArrayBuffer | ArrayBufferView): string {
  const t = o instanceof ArrayBuffer ? new Uint8Array(o) : new Uint8Array(o.buffer, o.byteOffset, o.byteLength);
  let s = "";
  for (const x of t) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

interface OptionsCreation {
  challenge: string;
  rp: { name: string; id: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: Array<{ type: "public-key"; alg: number }>;
  timeout: number;
  attestation: AttestationConveyancePreference;
  authenticatorSelection: AuthenticatorSelectionCriteria;
  excludeCredentials: Array<{ type: "public-key"; id: string }>;
}

interface OptionsConnexion {
  challenge: string;
  rpId: string;
  timeout: number;
  userVerification: UserVerificationRequirement;
  allowCredentials: Array<{ type: "public-key"; id: string }>;
}

/** Message lisible pour les refus du navigateur (annulation, clé déjà présente…). */
function traduire(e: unknown): Error {
  const nom = e instanceof DOMException ? e.name : "";
  if (nom === "NotAllowedError" || nom === "AbortError") return new Error("Opération annulée ou délai dépassé.");
  if (nom === "InvalidStateError") return new Error("Cet appareil a déjà une clé d'accès pour ce compte.");
  if (nom === "SecurityError") return new Error("Les clés d'accès demandent une adresse sécurisée (https).");
  if (nom === "NotSupportedError") return new Error("Cet appareil ne prend pas en charge les clés d'accès.");
  return e instanceof Error ? e : new Error(String(e));
}

export async function creerCleAcces(o: OptionsCreation) {
  let c: PublicKeyCredential;
  try {
    c = (await navigator.credentials.create({
      publicKey: {
        ...o,
        challenge: octets(o.challenge),
        user: { ...o.user, id: octets(o.user.id) },
        excludeCredentials: o.excludeCredentials.map((x) => ({ type: x.type, id: octets(x.id) })),
      },
    })) as PublicKeyCredential;
  } catch (e) {
    throw traduire(e);
  }
  const r = c.response as AuthenticatorAttestationResponse;
  return {
    id: c.id,
    rawId: b64(c.rawId),
    type: c.type,
    response: {
      clientDataJSON: b64(r.clientDataJSON),
      attestationObject: b64(r.attestationObject),
      transports: typeof r.getTransports === "function" ? r.getTransports() : [],
    },
  };
}

export async function utiliserCleAcces(o: OptionsConnexion) {
  let c: PublicKeyCredential;
  try {
    c = (await navigator.credentials.get({
      publicKey: { ...o, challenge: octets(o.challenge), allowCredentials: o.allowCredentials.map((x) => ({ type: x.type, id: octets(x.id) })) },
    })) as PublicKeyCredential;
  } catch (e) {
    throw traduire(e);
  }
  const r = c.response as AuthenticatorAssertionResponse;
  return {
    id: c.id,
    rawId: b64(c.rawId),
    type: c.type,
    response: {
      clientDataJSON: b64(r.clientDataJSON),
      authenticatorData: b64(r.authenticatorData),
      signature: b64(r.signature),
      userHandle: r.userHandle ? b64(r.userHandle) : null,
    },
  };
}

/** Nom proposé pour la clé : l'appareil sur lequel on la crée. */
export function nomAppareil(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "iPad";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Android/.test(ua)) return "Android";
  if (/Windows/.test(ua)) return "PC Windows";
  return "Cet appareil";
}

export type { OptionsConnexion, OptionsCreation };
