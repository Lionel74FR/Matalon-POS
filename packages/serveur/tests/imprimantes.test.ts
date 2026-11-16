import { PGlite } from "@electric-sql/pglite";
import { genererPaireCles } from "@matalon/noyau-fiscal";
import { beforeEach, describe, expect, it } from "vitest";
import { traiter, type Db } from "../src/index.js";
import { _oublierMigration } from "../src/schema.js";
import { codeTotp } from "../src/securite.js";

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
    { db, maintenant: () => new Date(instant), envoyerCourriel: async () => {}, envoiGroupe: true },
  );
  return { statut: reponse.status, corps: (await reponse.json()) as any, cookie: reponse.headers.get("Set-Cookie") };
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
  instant = Date.parse("2026-11-16T18:00:00Z");
});

async function preparer() {
  const init = await appel("POST", "/api/admin/initialiser", { identifiant: "lionel", motDePasse: "un-mot-de-passe-solide" });
  const conf = await appel("POST", "/api/admin/confirmer", { identifiant: "lionel", motDePasse: "un-mot-de-passe-solide", code: await codeTotp(init.corps.secret, instant) });
  const admin = { Cookie: conf.cookie!.split(";")[0]! };
  expect((await appel("POST", "/api/admin/etablissements/moka/utilisateurs", { nom: "Léa", role: "responsable", pin: "1234" }, admin)).statut).toBe(200);
  const rattacher = async (nom: string, id: string) => {
    const code = await appel("POST", "/api/admin/etablissements/moka/codes", { nomCaisse: nom }, admin);
    const paire = await genererPaireCles(`${id}-k1`);
    const r = await appel("POST", "/api/caisse/rattacher", {
      code: code.corps.code.toLowerCase().replace(/(.{4})/, "$1-"),
      caisseId: id,
      cleId: paire.cleId,
      clePubliqueJwk: paire.clePubliqueJwk,
      appareil: nom,
    });
    expect([r.statut, r.corps.message]).toEqual([201, undefined]);
    return { Authorization: `Bearer ${r.corps.jeton}` };
  };
  return { admin, dalle: await rattacher("Dalle bar", "ipad-0000000d"), ipad: await rattacher("iPad salle", "ipad-0000000e") };
}

const recu = [{ type: "texte", texte: "Addition", align: "centre", gras: true, grand: true }];

describe("imprimantes de l'établissement (16 novembre 2026)", () => {
  it("reprend les anciens réglages : une imprimante par adresse Epson, les postes pointent vers elle", async () => {
    const { ipad } = await preparer();
    await pg.query(
      `update etablissements set imprimantes = null, postes_imprimantes = null, imprimante_tickets = '{"adresse":"10.0.0.30","sansAccents":false}'::jsonb,
       postes_production = '{"Bar":{"adresse":"10.0.0.30","sansAccents":false},"Cuisine":{"adresse":"10.0.0.31","sansAccents":true}}'::jsonb where id = 'moka'`,
    );
    _oublierMigration();
    const e = (await appel("GET", "/api/caisse/etat", undefined, ipad)).corps.etablissement;
    expect(e.imprimantes.map((i: any) => [i.nom, i.branchement, i.sansAccents])).toEqual([
      ["Tickets", { type: "epson", adresse: "10.0.0.30" }, false],
      ["Cuisine", { type: "epson", adresse: "10.0.0.31" }, true],
    ]);
    expect(e.postesImprimantes).toEqual({ Bar: e.imprimantes[0].id, Cuisine: e.imprimantes[1].id });
  });

  it("enregistre la liste depuis une caisse : Epson, série sur une dalle, réseau par une dalle ; recopie les postes Epson pour les anciennes caisses", async () => {
    const { dalle, ipad } = await preparer();
    const imprimantes = [
      { id: "imp-epson01", nom: "Epson cuisine", branchement: { type: "epson", adresse: "192.168.1.50" }, sansAccents: false },
      { id: "imp-oxhoo01", nom: "Oxhoo bar", branchement: { type: "serie", dalleId: "ipad-0000000d" }, sansAccents: false },
      { id: "imp-salle01", nom: "Oxhoo salle", branchement: { type: "reseau", adresse: "192.168.1.248", dalleId: "ipad-0000000d" }, sansAccents: true },
    ];
    const r = await appel("PUT", "/api/caisse/imprimantes", { imprimantes, postes: { Cuisine: "imp-epson01", Bar: "imp-oxhoo01" } }, ipad);
    expect(r.statut).toBe(200);
    expect(r.corps.etablissement.imprimantes).toEqual(imprimantes);
    expect(r.corps.etablissement.postesProduction).toEqual({ Cuisine: { adresse: "192.168.1.50", sansAccents: false } });

    const refus = async (liste: unknown, postes: unknown = {}) => (await appel("PUT", "/api/caisse/imprimantes", { imprimantes: liste, postes }, ipad)).corps.message;
    expect(await refus([{ ...imprimantes[1], branchement: { type: "serie", dalleId: "ipad-99999999" } }])).toContain("choisissez la dalle");
    // Un iPad n'a ni port COM ni script : il ne porte pas d'imprimante.
    expect(await refus([{ ...imprimantes[1], branchement: { type: "serie", dalleId: "ipad-0000000e" } }])).toContain("choisissez la dalle");
    expect(await refus([{ ...imprimantes[2], branchement: { type: "reseau", adresse: "8.8.8.8", dalleId: "ipad-0000000d" } }])).toContain("réseau local");
    expect(await refus([imprimantes[0], { ...imprimantes[1], nom: "epson CUISINE" }])).toContain("Deux imprimantes");
    expect(await refus(imprimantes, { Bar: "imp-inconnue" })).toContain("imprimante inconnue");

    // Impression relayée vers une imprimante portée par la dalle.
    await appel("PUT", "/api/caisse/relais", { actif: true }, dalle);
    const depot = await appel("POST", "/api/caisse/impressions", { imprimanteId: "imp-salle01", titre: "Addition", recu }, ipad);
    expect(depot.statut).toBe(201);
    expect((await appel("GET", "/api/caisse/impressions/attente", undefined, dalle)).corps.impressions).toEqual([
      { id: depot.corps.id, titre: "Addition", recu, imprimanteId: "imp-salle01" },
    ]);
    expect((await appel("POST", "/api/caisse/impressions", { imprimanteId: "imp-epson01", recu }, ipad)).corps.code).toBe("IMPRIMANTE_INCONNUE");
  });

  it("l'ancienne route des postes (caisse pas encore mise à jour) alimente la liste", async () => {
    const { ipad } = await preparer();
    const r = await appel("PUT", "/api/caisse/postes", { postes: { Bar: { adresse: "10.0.0.21", sansAccents: false } } }, ipad);
    expect(r.corps.etablissement.imprimantes.map((i: any) => [i.nom, i.branchement.adresse])).toEqual([["Bar", "10.0.0.21"]]);
    expect(r.corps.etablissement.postesImprimantes).toEqual({ Bar: r.corps.etablissement.imprimantes[0].id });
  });
});
