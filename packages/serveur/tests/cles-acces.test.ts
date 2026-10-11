/**
 * Clés d'accès de l'administration : un authentificateur simulé (WebCrypto) crée la clé, puis signe
 * les connexions comme le ferait Face ID ou Touch ID. On vérifie le parcours complet et chaque refus.
 */
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { traiter, type Db } from "../src/index.js";
import { _oublierMigration } from "../src/schema.js";
import { base64Url, codeTotp } from "../src/securite.js";
import { decoderCbor, depuisBase64Url } from "../src/webauthn.js";

let pg: PGlite;
let db: Db;
let instant: number;

async function appel(methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}, hote = "pos.test") {
  const reponse = await traiter(
    new Request(`https://${hote}${chemin}`, {
      method: methode,
      headers: { "Content-Type": "application/json", Origin: `https://${hote}`, ...entetes },
      body: corps === undefined ? undefined : JSON.stringify(corps),
    }),
    { db, maintenant: () => new Date(instant) },
  );
  return { statut: reponse.status, corps: (await reponse.json()) as any, cookie: reponse.headers.get("Set-Cookie")?.split(";")[0] };
}

beforeEach(async () => {
  _oublierMigration();
  pg = new PGlite();
  db = {
    requete: async (t, p = []) => (await pg.query(t, p)).rows as never,
    lot: async (requetes) => {
      await pg.transaction(async (tx) => {
        for (const r of requetes) await tx.query(r.texte, r.params ?? []);
      });
    },
  };
  instant = Date.parse("2026-10-11T17:00:00Z");
});

async function admin(): Promise<{ cookie: Record<string, string>; secret: string }> {
  const init = await appel("POST", "/api/admin/initialiser", { identifiant: "lionel", motDePasse: "un-mot-de-passe-solide" });
  const ok = await appel("POST", "/api/admin/confirmer", { identifiant: "lionel", motDePasse: "un-mot-de-passe-solide", code: await codeTotp(init.corps.secret, instant) });
  return { cookie: { Cookie: ok.cookie! }, secret: init.corps.secret };
}

// ───────── Authentificateur simulé ─────────

/** Encodeur CBOR minimal (entiers, octets, texte, tableaux, tables) pour fabriquer les réponses. */
function cbor(v: unknown): number[] {
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

class Authentificateur {
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

async function ajouterCle(a: { cookie: Record<string, string>; secret: string }, cle: Authentificateur, nom = "iPhone de Lionel") {
  const options = await appel("POST", "/api/admin/cles-acces/options", { code: await codeTotp(a.secret, instant) }, a.cookie);
  expect(options.statut).toBe(200);
  return appel("POST", "/api/admin/cles-acces", { nom, reponse: await cle.creer(options.corps.options) }, a.cookie);
}

async function seConnecter(cle: Authentificateur, reglages: Parameters<Authentificateur["signer"]>[1] = {}, hote = "pos.test") {
  const options = await appel("POST", "/api/admin/cle-acces/options", undefined, {}, hote);
  return appel("POST", "/api/admin/cle-acces/connexion", { reponse: await cle.signer(options.corps.options, reglages) }, {}, hote);
}

describe("Clés d'accès de l'administration", () => {
  it("s'ajoutent avec le code de vérification puis ouvrent une session sans mot de passe ni code", async () => {
    const a = await admin();
    // Le code est redemandé : une session volée ne suffit pas pour ajouter une clé.
    const refus = await appel("POST", "/api/admin/cles-acces/options", { code: "000000" }, a.cookie);
    expect(refus.corps.code).toBe("CODE_INVALIDE");
    const options = await appel("POST", "/api/admin/cles-acces/options", { code: await codeTotp(a.secret, instant) }, a.cookie);
    expect(options.corps.options).toMatchObject({
      rp: { id: "pos.test" },
      attestation: "none",
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
      pubKeyCredParams: [{ alg: -7 }, { alg: -257 }],
    });
    const cle = new Authentificateur();
    const ajout = await appel("POST", "/api/admin/cles-acces", { nom: "iPhone de Lionel", reponse: await cle.creer(options.corps.options) }, a.cookie);
    expect(ajout.statut).toBe(200);
    expect(ajout.corps.cles).toEqual([expect.objectContaining({ nom: "iPhone de Lionel", domaine: "pos.test", utiliseeLe: null })]);
    // Le même défi ne sert pas deux fois.
    expect((await appel("POST", "/api/admin/cles-acces", { nom: "Bis", reponse: await new Authentificateur().creer(options.corps.options) }, a.cookie)).corps.code).toBe("DEFI_EXPIRE");
    // La clé suivante est exclue des options (l'appareil ne la recrée pas).
    const suivantes = await appel("POST", "/api/admin/cles-acces/options", { code: await codeTotp(a.secret, instant) }, a.cookie);
    expect(suivantes.corps.options.excludeCredentials).toEqual([{ type: "public-key", id: base64Url(cle.id) }]);

    const connexion = await seConnecter(cle);
    expect(connexion.statut).toBe(200);
    expect(connexion.cookie).toMatch(/^mp_admin=/);
    expect((await appel("GET", "/api/admin/etablissements", undefined, { Cookie: connexion.cookie! })).statut).toBe(200);
    const liste = await appel("GET", "/api/admin/cles-acces", undefined, { Cookie: connexion.cookie! });
    expect(liste.corps.cles[0].utiliseeLe).toBe(new Date(instant).toISOString());
    const journal = await db.requete<{ action: string; details: any }>("select action, details from journal_admin order by id");
    expect(journal.map((j) => j.action)).toEqual(expect.arrayContaining(["cle_acces_ajoutee", "connexion"]));
    expect(journal.at(-1)).toMatchObject({ action: "connexion", details: { methode: "cle", nom: "iPhone de Lionel" } });

    // Retirée, elle n'ouvre plus rien.
    const retrait = await appel("DELETE", `/api/admin/cles-acces/${base64Url(cle.id)}`, undefined, a.cookie);
    expect(retrait.corps.cles).toEqual([]);
    expect((await seConnecter(cle)).corps.code).toBe("CLE_INCONNUE");
  });

  it("refuse une connexion rejouée, d'une autre origine, d'un autre domaine, sans Face ID ou mal signée", async () => {
    const a = await admin();
    const cle = new Authentificateur();
    expect((await ajouterCle(a, cle)).statut).toBe(200);

    // Rejeu : la même réponse signée ne rouvre pas de session.
    const options = await appel("POST", "/api/admin/cle-acces/options");
    const reponse = await cle.signer(options.corps.options);
    expect((await appel("POST", "/api/admin/cle-acces/connexion", { reponse })).statut).toBe(200);
    expect((await appel("POST", "/api/admin/cle-acces/connexion", { reponse })).corps.code).toBe("DEFI_EXPIRE");

    expect((await seConnecter(cle, { origine: "https://pos-imitation.test" })).corps.code).toBe("CLE_INCONNUE");
    expect((await seConnecter(cle, { rpId: "pos-imitation.test" })).corps.code).toBe("CLE_INCONNUE");
    expect((await seConnecter(cle, { drapeaux: 0x01 })).corps.code).toBe("CLE_INCONNUE"); // présence sans vérification
    expect((await seConnecter(cle, { type: "webauthn.create" })).corps.code).toBe("CLE_INCONNUE");
    // Une clé créée pour pos.test ne vaut pas sur un autre domaine servi par la même application.
    expect((await seConnecter(cle, { rpId: "autre.test", origine: "https://autre.test" }, "autre.test")).corps.code).toBe("CLE_INCONNUE");

    // Signature d'une autre clé sous le même identifiant.
    const imposteur = new Authentificateur();
    imposteur.id = cle.id;
    imposteur.utilisateur = cle.utilisateur;
    await imposteur.creer({ rp: { id: "pos.test" }, user: { id: cle.utilisateur }, challenge: "x" });
    expect((await seConnecter(imposteur)).corps.code).toBe("CLE_INCONNUE");

    // Défi périmé au bout de 5 minutes.
    const vieux = await appel("POST", "/api/admin/cle-acces/options");
    instant += 6 * 60_000;
    expect((await appel("POST", "/api/admin/cle-acces/connexion", { reponse: await cle.signer(vieux.corps.options) })).corps.code).toBe("DEFI_EXPIRE");

    const refus = await db.requete<{ details: any }>("select details from journal_admin where action = 'connexion_refusee'");
    expect(refus.length).toBe(5);
    expect(refus.map((r) => r.details.motif)).toEqual(
      expect.arrayContaining(["Origine inattendue.", "Clé créée pour un autre domaine.", "Signature invalide."]),
    );
  });

  it("refuse une clé sans vérification de l'utilisateur, d'une autre origine, ou un compteur qui recule", async () => {
    const a = await admin();
    const opts = async () => (await appel("POST", "/api/admin/cles-acces/options", { code: await codeTotp(a.secret, instant) }, a.cookie)).corps.options;
    const sansUv = await appel("POST", "/api/admin/cles-acces", { nom: "Clé", reponse: await new Authentificateur().creer(await opts(), "https://pos.test", 0x41) }, a.cookie);
    expect(sansUv.corps.message).toMatch(/Vérification de l'utilisateur/);
    const ailleurs = await appel("POST", "/api/admin/cles-acces", { nom: "Clé", reponse: await new Authentificateur().creer(await opts(), "https://pos-imitation.test") }, a.cookie);
    expect(ailleurs.corps.code).toBe("CLE_REFUSEE");

    // Clé matérielle à compteur : chaque connexion doit l'augmenter.
    const materielle = new Authentificateur("ES256", true);
    expect((await ajouterCle(a, materielle, "Clé USB")).statut).toBe(200);
    expect((await seConnecter(materielle)).statut).toBe(200);
    materielle.compteur = 0; // clone resté en arrière
    expect((await seConnecter(materielle)).corps.code).toBe("CLE_INCONNUE");
  });

  it("accepte aussi une clé RS256 (Windows Hello)", async () => {
    const a = await admin();
    const cle = new Authentificateur("RS256");
    expect((await ajouterCle(a, cle, "PC du bureau")).statut).toBe(200);
    expect((await seConnecter(cle)).statut).toBe(200);
  });

  it("décode le CBOR des authentificateurs", () => {
    const { valeur, fin } = decoderCbor(new Uint8Array([...cbor(new Map<unknown, unknown>([[1, 2], [-1, 1], ["fmt", "none"], [3, [1, -257]]])), 0xff]));
    expect(valeur).toEqual(new Map<unknown, unknown>([[1, 2], [-1, 1], ["fmt", "none"], [3, [1, -257]]]));
    expect(fin).toBe(cbor(new Map<unknown, unknown>([[1, 2], [-1, 1], ["fmt", "none"], [3, [1, -257]]])).length);
    expect(() => decoderCbor(new Uint8Array([0x5f]))).toThrow(/indéfinie/);
    expect(() => decoderCbor(new Uint8Array([0x58, 10, 1]))).toThrow(/tronqué/);
  });
});
