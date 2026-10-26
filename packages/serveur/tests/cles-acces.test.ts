/**
 * Clés d'accès de l'administration : un authentificateur simulé (WebCrypto) crée la clé, puis signe
 * les connexions comme le ferait Face ID ou Touch ID. On vérifie le parcours complet et chaque refus.
 */
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { traiter, type Db } from "../src/index.js";
import { _oublierMigration } from "../src/schema.js";
import { base64Url, codeTotp } from "../src/securite.js";
import { decoderCbor } from "../src/webauthn.js";
import { Authentificateur, cbor } from "./authentificateur.js";

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
