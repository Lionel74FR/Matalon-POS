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

const recu = [
  { type: "texte", texte: "Moka", align: "centre", gras: true, grand: true, enseigne: true },
  { type: "colonnes", gauche: "TOTAL", droite: "12,50 €", gras: true, grand: true },
  { type: "tiroir" },
];

describe("impression relayée par une dalle (backlog n° 5)", () => {
  it("l'iPad dépose un reçu, la dalle relais le prend une fois, l'imprime et rend compte", async () => {
    const { dalle, ipad } = await preparer();
    expect((await appel("GET", "/api/caisse/relais", undefined, ipad)).corps.relais).toEqual([]);
    const inscrit = await appel("PUT", "/api/caisse/relais", { actif: true }, dalle);
    expect(inscrit.corps.relais).toEqual([{ id: "ipad-0000000d", nom: "Dalle bar", vuLe: "2026-11-16T18:00:00.000Z", enLigne: true }]);

    const depot = await appel("POST", "/api/caisse/impressions", { relaisId: "ipad-0000000d", titre: "Ticket 12", recu }, ipad);
    expect(depot.statut).toBe(201);
    const id = depot.corps.id as string;
    expect((await appel("GET", `/api/caisse/impressions/${id}`, undefined, ipad)).corps).toEqual({ etat: "attente" });

    // L'iPad n'est pas relais : il ne prend rien.
    expect((await appel("GET", "/api/caisse/impressions/attente", undefined, ipad)).corps.impressions).toEqual([]);
    instant += 2000;
    const prises = (await appel("GET", "/api/caisse/impressions/attente", undefined, dalle)).corps.impressions;
    expect(prises).toEqual([{ id, titre: "Ticket 12", recu }]);
    expect((await appel("GET", "/api/caisse/impressions/attente", undefined, dalle)).corps.impressions).toEqual([]);
    expect((await appel("GET", `/api/caisse/impressions/${id}`, undefined, ipad)).corps).toEqual({ etat: "prise" });

    expect((await appel("POST", `/api/caisse/impressions/${id}/resultat`, { ok: true }, dalle)).statut).toBe(200);
    expect((await appel("GET", `/api/caisse/impressions/${id}`, undefined, ipad)).corps).toEqual({ etat: "faite" });
    // Pas deux comptes rendus, ni par un autre appareil.
    expect((await appel("POST", `/api/caisse/impressions/${id}/resultat`, { ok: false }, dalle)).statut).toBe(404);
    // La dalle ne lit pas l'état d'une impression qu'elle n'a pas déposée.
    expect((await appel("GET", `/api/caisse/impressions/${id}`, undefined, dalle)).statut).toBe(404);
  });

  it("refuse une dalle qui ne répond plus, signale les délais dépassés et l'erreur de la dalle", async () => {
    const { dalle, ipad } = await preparer();
    await appel("PUT", "/api/caisse/relais", { actif: true }, dalle);
    instant += 31_000;
    const refus = await appel("POST", "/api/caisse/impressions", { relaisId: "ipad-0000000d", titre: "Ticket", recu }, ipad);
    expect([refus.statut, refus.corps.code]).toEqual([409, "RELAIS_HORS_LIGNE"]);
    expect(refus.corps.message).toContain("« Dalle bar »");

    // Revue : prend l'erreur de la dalle.
    expect((await appel("GET", "/api/caisse/impressions/attente", undefined, dalle)).statut).toBe(200);
    const a = (await appel("POST", "/api/caisse/impressions", { relaisId: "ipad-0000000d", titre: "A", recu }, ipad)).corps.id;
    await appel("GET", "/api/caisse/impressions/attente", undefined, dalle);
    await appel("POST", `/api/caisse/impressions/${a}/resultat`, { ok: false, erreur: "Port COM occupé." }, dalle);
    expect((await appel("GET", `/api/caisse/impressions/${a}`, undefined, ipad)).corps).toEqual({ etat: "echec", erreur: "Port COM occupé." });

    // Prise sans compte rendu pendant plus d'une minute : réputée perdue.
    const b = (await appel("POST", "/api/caisse/impressions", { relaisId: "ipad-0000000d", titre: "B", recu }, ipad)).corps.id;
    await appel("GET", "/api/caisse/impressions/attente", undefined, dalle);
    instant += 61_000;
    expect((await appel("GET", `/api/caisse/impressions/${b}`, undefined, ipad)).corps).toEqual({ etat: "echec", erreur: "La dalle « Dalle bar » n'a pas confirmé l'impression." });

    // En attente plus de 2 minutes : abandonnée, et jamais imprimée en retard.
    await appel("GET", "/api/caisse/impressions/attente", undefined, dalle);
    const c = (await appel("POST", "/api/caisse/impressions", { relaisId: "ipad-0000000d", titre: "C", recu }, ipad)).corps.id;
    instant += 121_000;
    expect((await appel("GET", `/api/caisse/impressions/${c}`, undefined, ipad)).corps.etat).toBe("echec");
    expect((await appel("GET", "/api/caisse/impressions/attente", undefined, dalle)).corps.impressions).toEqual([]);
  });

  it("contrôle le reçu et oublie la dalle qui n'est plus relais", async () => {
    const { dalle, ipad } = await preparer();
    await appel("PUT", "/api/caisse/relais", { actif: true }, dalle);
    for (const mauvais of [[], [{ type: "script", texte: "x" }], [{ type: "texte", texte: { html: 1 } }], "texte"]) {
      expect((await appel("POST", "/api/caisse/impressions", { relaisId: "ipad-0000000d", recu: mauvais }, ipad)).corps.code).toBe("RECU_INVALIDE");
    }
    expect((await appel("POST", "/api/caisse/impressions", { relaisId: "ipad-0000000e", recu }, ipad)).corps.code).toBe("RELAIS_INCONNU");
    await appel("PUT", "/api/caisse/relais", { actif: false }, dalle);
    expect((await appel("GET", "/api/caisse/relais", undefined, ipad)).corps.relais).toEqual([]);
    expect((await appel("POST", "/api/caisse/impressions", { relaisId: "ipad-0000000d", recu }, ipad)).corps.code).toBe("RELAIS_INCONNU");
    expect((await appel("GET", "/api/caisse/relais")).statut).toBe(401);
  });
});
