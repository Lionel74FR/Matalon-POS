/**
 * Accès comptable à l'administration (26 octobre 2026) : le propriétaire invite, la comptable crée sa
 * clé depuis le lien, puis ne lit que les statistiques et les clôtures de ses établissements ; toute
 * autre route est refusée par le serveur. Révocation, nouveau lien, invitation à usage unique.
 */
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { traiter, type Db } from "../src/index.js";
import { _oublierMigration } from "../src/schema.js";
import { codeTotp } from "../src/securite.js";
import { Authentificateur } from "./authentificateur.js";

let pg: PGlite;
let db: Db;
let instant: number;

async function appel(methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}) {
  const reponse = await traiter(
    new Request(`https://pos.test${chemin}`, {
      method: methode,
      headers: { "Content-Type": "application/json", Origin: "https://pos.test", ...entetes },
      body: corps === undefined ? undefined : JSON.stringify(corps),
    }),
    { db, maintenant: () => new Date(instant) },
  );
  const texte = await reponse.text();
  let json: any = null;
  try {
    json = JSON.parse(texte);
  } catch {
    json = texte;
  }
  return { statut: reponse.status, corps: json, cookie: reponse.headers.get("Set-Cookie")?.split(";")[0] };
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
  instant = Date.parse("2026-10-26T08:00:00Z");
});

async function proprietaire(): Promise<Record<string, string>> {
  const init = await appel("POST", "/api/admin/initialiser", { identifiant: "lionel", motDePasse: "un-mot-de-passe-solide" });
  const ok = await appel("POST", "/api/admin/confirmer", { identifiant: "lionel", motDePasse: "un-mot-de-passe-solide", code: await codeTotp(init.corps.secret, instant) });
  const cookie = { Cookie: ok.cookie! };
  const corps = { id: "bao-canteen", identite: { enseigne: "Bao Canteen" }, carteId: "carte-automne-2026", tables: [], seuilNote: 2500 };
  expect((await appel("POST", "/api/admin/etablissements", corps, cookie)).statut).toBe(201);
  return cookie;
}

/** La comptable ouvre le lien, crée sa clé : la session s'ouvre. */
async function accepter(jeton: string, cle = new Authentificateur()) {
  const options = await appel("POST", "/api/admin/invitation", { jeton, options: true });
  expect(options.statut).toBe(200);
  return appel("POST", "/api/admin/invitation/accepter", { jeton, nom: "Mac de Caroline", reponse: await cle.creer(options.corps.options) });
}

describe("Accès comptable", () => {
  it("s'ouvre par une invitation à usage unique et une clé d'accès, sans mot de passe ni code", async () => {
    const lionel = await proprietaire();
    const invite = await appel("POST", "/api/admin/acces", { nom: "Caroline Petrod", email: "Caroline@Audrex.fr", etablissements: ["moka"] }, lionel);
    expect(invite.statut).toBe(201);
    expect(invite.corps.expireLe).toBe("2026-11-02T08:00:00.000Z");
    const { jeton } = invite.corps;

    // La page d'invitation dit à qui elle s'adresse et ce qu'elle ouvre.
    const lue = await appel("POST", "/api/admin/invitation", { jeton });
    expect(lue.corps.invitation).toEqual({ nom: "Caroline Petrod", identifiant: "caroline@audrex.fr", etablissements: [{ id: "moka", enseigne: "Moka" }], expireLe: "2026-11-02T08:00:00.000Z" });
    expect((await appel("POST", "/api/admin/invitation", { jeton: "faux-jeton-de-vingt-caracteres" })).corps.code).toBe("INVITATION_INVALIDE");

    const cle = new Authentificateur();
    const ok = await accepter(jeton, cle);
    expect(ok.statut).toBe(200);
    const caroline = { Cookie: ok.cookie! };
    expect((await appel("GET", "/api/admin/statut", undefined, caroline)).corps).toMatchObject({ connecte: true, identifiant: "caroline@audrex.fr", role: "comptable", nom: "Caroline Petrod" });
    // Le lien ne sert qu'une fois.
    expect((await appel("POST", "/api/admin/invitation", { jeton, options: true })).corps.code).toBe("INVITATION_INVALIDE");
    // L'administration reste « initialisée » par le seul propriétaire ; aucun mot de passe ne vaut pour elle.
    expect((await appel("POST", "/api/admin/initialiser", { identifiant: "x", motDePasse: "un-autre-mot-de-passe" })).corps.code).toBe("DEJA_INITIALISE");
    expect((await appel("POST", "/api/admin/connexion", { identifiant: "caroline@audrex.fr", motDePasse: "", code: "000000" })).statut).toBe(401);

    // Elle se reconnecte avec sa clé.
    const opt = await appel("POST", "/api/admin/cle-acces/options");
    const connexion = await appel("POST", "/api/admin/cle-acces/connexion", { reponse: await cle.signer(opt.corps.options) });
    expect(connexion.statut).toBe(200);

    // Le propriétaire voit l'accès, sa clé et sa dernière connexion.
    const liste = await appel("GET", "/api/admin/acces", undefined, lionel);
    const acces = liste.corps.acces.find((a: any) => a.role === "comptable");
    expect(acces).toMatchObject({ nom: "Caroline Petrod", identifiant: "caroline@audrex.fr", etablissements: ["moka"], cles: 1, revoqueLe: null, invitation: null, derniereConnexion: "2026-10-26T08:00:00.000Z" });
    expect(liste.corps.acces[0]).toMatchObject({ role: "proprietaire", identifiant: "lionel", etablissements: null });
  });

  it("ne lit que les statistiques et les clôtures de ses établissements : tout le reste est refusé", async () => {
    const lionel = await proprietaire();
    const { jeton } = (await appel("POST", "/api/admin/acces", { nom: "Caroline", email: "caroline@audrex.fr", etablissements: ["moka"] }, lionel)).corps;
    const caroline = { Cookie: (await accepter(jeton)).cookie! };

    const etabs = await appel("GET", "/api/admin/etablissements", undefined, caroline);
    expect(etabs.corps.etablissements.map((e: any) => e.id)).toEqual(["moka"]);
    // Ni équipe (codes PIN), ni appareils, ni codes de rattachement.
    expect(etabs.corps.etablissements[0]).toMatchObject({ utilisateurs: [], caisses: [], codes: [], alertesNonVues: 0 });

    const stats = await appel("GET", "/api/admin/etablissements/moka/statistiques?du=2026-10-25&au=2026-10-25", undefined, caroline);
    expect(stats.statut).toBe(200);
    expect(stats.corps.alertes).toEqual([]);
    expect((await appel("GET", "/api/admin/etablissements/moka/clotures?du=2026-10-01&au=2026-10-31", undefined, caroline)).statut).toBe(200);
    const csv = await appel("GET", "/api/admin/etablissements/moka/clotures.csv?du=2026-10-01&au=2026-10-31", undefined, caroline);
    expect(csv.statut).toBe(200);
    expect((await appel("GET", "/api/admin/etablissements/moka/comptages.csv?du=2026-10-01&au=2026-10-31", undefined, caroline)).statut).toBe(200);

    // Un autre établissement, les tickets, l'équipe, le stock, la carte, la configuration, les accès : refusés.
    expect((await appel("GET", "/api/admin/etablissements/bao-canteen/statistiques?du=2026-10-25&au=2026-10-25", undefined, caroline)).statut).toBe(403);
    expect((await appel("GET", "/api/admin/etablissements/bao-canteen/clotures?du=2026-10-01&au=2026-10-31", undefined, caroline)).statut).toBe(403);
    for (const chemin of [
      "/api/admin/etablissements/moka/tickets?du=2026-10-25&au=2026-10-25",
      "/api/admin/etablissements/moka/alertes",
      "/api/admin/etablissements/moka/comptes",
      "/api/admin/stock",
      "/api/admin/cartes",
      "/api/admin/configuration",
      "/api/admin/acces",
      "/api/admin/etablissements/moka/reservations",
    ]) {
      const r = await appel("GET", chemin, undefined, caroline);
      expect([chemin, r.statut, r.corps.code]).toEqual([chemin, 403, "ACCES_COMPTABLE"]);
    }
    const ecritures: Array<[string, string, unknown]> = [
      ["PUT", "/api/admin/etablissements/moka/utilisateurs", { nom: "Intrus", role: "responsable", pin: "1234" }],
      ["POST", "/api/admin/etablissements/moka/codes", { nomCaisse: "Intrus" }],
      ["POST", "/api/admin/acces", { nom: "X", email: "x@x.fr", etablissements: ["moka"] }],
      ["POST", "/api/admin/cles-acces/options", { code: "000000" }],
      ["PUT", "/api/admin/etablissements/moka/moments", { moments: [] }],
    ];
    for (const [m, chemin, corps] of ecritures) expect((await appel(m, chemin, corps, caroline)).statut).toBe(403);

    // Ses exports sont au journal, à son nom.
    const acces = (await appel("GET", "/api/admin/acces", undefined, lionel)).corps.acces.find((a: any) => a.role === "comptable");
    expect(acces.journal.map((j: any) => j.action)).toEqual(expect.arrayContaining(["export_csv_etablissement", "export_comptages", "connexion"]));
  });

  it("se révoque (sessions et clés retirées), puis se rétablit par un nouveau lien", async () => {
    const lionel = await proprietaire();
    const inv = (await appel("POST", "/api/admin/acces", { nom: "Caroline", email: "caroline@audrex.fr", etablissements: ["moka", "bao-canteen"] }, lionel)).corps;
    const cle = new Authentificateur();
    const caroline = { Cookie: (await accepter(inv.jeton, cle)).cookie! };
    expect((await appel("GET", "/api/admin/etablissements", undefined, caroline)).corps.etablissements).toHaveLength(2);

    // Le propriétaire restreint l'accès au Moka : effet immédiat.
    expect((await appel("PUT", `/api/admin/acces/${inv.id}`, { etablissements: ["moka"] }, lionel)).statut).toBe(200);
    expect((await appel("GET", "/api/admin/etablissements/bao-canteen/clotures?du=2026-10-01&au=2026-10-31", undefined, caroline)).statut).toBe(403);
    expect((await appel("PUT", `/api/admin/acces/${inv.id}`, { etablissements: [] }, lionel)).statut).toBe(400);
    // Une même adresse ne reçoit pas deux accès.
    expect((await appel("POST", "/api/admin/acces", { nom: "Bis", email: "caroline@audrex.fr", etablissements: ["moka"] }, lionel)).statut).toBe(409);

    const revoque = await appel("POST", `/api/admin/acces/${inv.id}/revoquer`, {}, lionel);
    expect(revoque.corps.acces.find((a: any) => a.id === inv.id)).toMatchObject({ cles: 0 });
    expect(revoque.corps.acces.find((a: any) => a.id === inv.id).revoqueLe).toBeTruthy();
    expect((await appel("GET", "/api/admin/etablissements", undefined, caroline)).statut).toBe(401);
    const opt = await appel("POST", "/api/admin/cle-acces/options");
    expect((await appel("POST", "/api/admin/cle-acces/connexion", { reponse: await cle.signer(opt.corps.options) })).statut).toBe(401);

    // Nouveau lien : l'accès revit, avec une nouvelle clé ; l'ancien lien ne vaut plus.
    const lien = await appel("POST", `/api/admin/acces/${inv.id}/lien`, {}, lionel);
    expect(lien.statut).toBe(200);
    const encore = await appel("POST", `/api/admin/acces/${inv.id}/lien`, {}, lionel);
    expect((await appel("POST", "/api/admin/invitation", { jeton: lien.corps.jeton })).corps.code).toBe("INVITATION_INVALIDE");
    const retour = await accepter(encore.corps.jeton);
    expect(retour.statut).toBe(200);
    expect((await appel("GET", "/api/admin/etablissements", undefined, { Cookie: retour.cookie! })).corps.etablissements.map((e: any) => e.id)).toEqual(["moka"]);

    // Le lien expire au bout de 7 jours.
    const tard = (await appel("POST", `/api/admin/acces/${inv.id}/lien`, {}, lionel)).corps.jeton;
    instant += 7 * 24 * 3600_000 + 1000;
    expect((await appel("POST", "/api/admin/invitation", { jeton: tard })).corps.code).toBe("INVITATION_INVALIDE");
  });
});
