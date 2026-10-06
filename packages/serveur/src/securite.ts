/** Primitives de sécurité (WebCrypto, compatibles runtime Edge). */

const enc = new TextEncoder();

export function aleatoire(octets: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(new ArrayBuffer(octets)));
}

export function base64Url(octets: Uint8Array): string {
  let s = "";
  for (const b of octets) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function hex(octets: ArrayBuffer | Uint8Array): string {
  return [...new Uint8Array(octets)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256(texte: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(texte)));
}

/** Jeton opaque : seule son empreinte est stockée. */
export function nouveauJeton(): string {
  return base64Url(aleatoire(32));
}

/** Comparaison en temps constant de deux chaînes de même longueur. */
export function egaux(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const ITERATIONS = 210_000;

/** Mot de passe : PBKDF2-SHA256, format « pbkdf2$iterations$sel$empreinte ». */
export async function hacherMotDePasse(motDePasse: string, sel = base64Url(aleatoire(16)), iterations = ITERATIONS): Promise<string> {
  const cle = await crypto.subtle.importKey("raw", enc.encode(motDePasse), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode(sel), iterations }, cle, 256);
  return `pbkdf2$${iterations}$${sel}$${hex(bits)}`;
}

export async function verifierMotDePasse(motDePasse: string, stocke: string): Promise<boolean> {
  const [algo, iterations, sel] = stocke.split("$");
  if (algo !== "pbkdf2" || !iterations || !sel) return false;
  return egaux(await hacherMotDePasse(motDePasse, sel, Number(iterations)), stocke);
}

// ───────── TOTP (RFC 6238) pour la double authentification ─────────

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32(octets: Uint8Array): string {
  let bits = 0;
  let valeur = 0;
  let sortie = "";
  for (const b of octets) {
    valeur = (valeur << 8) | b;
    bits += 8;
    while (bits >= 5) {
      sortie += BASE32[(valeur >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) sortie += BASE32[(valeur << (5 - bits)) & 31];
  return sortie;
}

function depuisBase32(texte: string): Uint8Array<ArrayBuffer> {
  const propre = texte.toUpperCase().replace(/[^A-Z2-7]/g, "");
  const out: number[] = [];
  let bits = 0;
  let valeur = 0;
  for (const c of propre) {
    valeur = (valeur << 5) | BASE32.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      out.push((valeur >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out) as Uint8Array<ArrayBuffer>;
}

export function nouveauSecretTotp(): string {
  return base32(aleatoire(20));
}

export async function codeTotp(secret: string, instant: number, pas = 30): Promise<string> {
  const compteur = Math.floor(instant / 1000 / pas);
  const message = new Uint8Array(8);
  new DataView(message.buffer).setBigUint64(0, BigInt(compteur));
  const cle = await crypto.subtle.importKey("raw", depuisBase32(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", cle, message));
  const decalage = mac[mac.length - 1]! & 0x0f;
  const nombre =
    ((mac[decalage]! & 0x7f) << 24) | (mac[decalage + 1]! << 16) | (mac[decalage + 2]! << 8) | mac[decalage + 3]!;
  return String(nombre % 1_000_000).padStart(6, "0");
}

/** Accepte le code de la période courante et des périodes voisines (décalage d'horloge). */
export async function verifierTotp(secret: string, code: string, instant: number): Promise<boolean> {
  const saisi = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(saisi)) return false;
  for (const d of [0, -1, 1]) {
    if (egaux(await codeTotp(secret, instant + d * 30_000), saisi)) return true;
  }
  return false;
}

export function urlOtpAuth(secret: string, compte: string, emetteur = "Matalon POS"): string {
  return `otpauth://totp/${encodeURIComponent(`${emetteur}:${compte}`)}?secret=${secret}&issuer=${encodeURIComponent(emetteur)}&algorithm=SHA1&digits=6&period=30`;
}
