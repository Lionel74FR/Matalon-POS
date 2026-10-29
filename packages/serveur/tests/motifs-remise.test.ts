/**
 * Motifs de remise et d'offert (29 octobre 2026, demande de Lionel : isoler les offerts à Camby dans
 * les statistiques) : réglés dans l'administration, contrôlés au serveur, reçus par la caisse.
 */
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { traiter, type Db } from "../src/index.js";
import { MOTIFS_REMISE_DEFAUT, problemeMotifsRemise } from "../src/partage.js";
import { _oublierMigration } from "../src/schema.js";
import { codeTotp } from "../src/securite.js";

let pg: PGlite;
let db: Db;
const instant = Date.parse("2026-10-29T15:00:00Z");

async function appel(methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}) {
  const r = await traiter(
    new Request(`https://pos.test${chemin}`, {
      method: methode,
      headers: { "Content-Type": "application/json", Origin: "https://pos.test", ...entetes },
      body: corps === undefined ? undefined : JSON.stringify(corps),
    }),
    { db, maintenant: () => new Date(instant) },
  );
  return { statut: r.status, corps: (await r.json()) as any, cookie: r.headers.get("Set-Cookie")?.split(";")[0] };
}

beforeEach(() => {
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
});

describe("motifs de remise et d'offert", () => {
  it("se contrôlent de la même façon à l'écran et au serveur", () => {
    expect(problemeMotifsRemise(MOTIFS_REMISE_DEFAUT)).toBeNull();
    expect(problemeMotifsRemise([...MOTIFS_REMISE_DEFAUT, "Camby"])).toBeNull();
    expect(problemeMotifsRemise([])).toBe("Gardez au moins un motif.");
    expect(problemeMotifsRemise(["Camby", "camby"])).toBe("« camby » figure deux fois.");
    expect(problemeMotifsRemise(["X"])).toBe("Chaque motif compte au moins 2 caractères.");
    expect(problemeMotifsRemise(["Fidélité"])).toBe("« Fidélité » est réservé à la carte de fidélité.");
    expect(problemeMotifsRemise(Array.from({ length: 13 }, (_, i) => `Motif ${i}`))).toBe("12 motifs au plus.");
  });

  it("se règlent dans l'administration et partent à la caisse", async () => {
    const init = await appel("POST", "/api/admin/initialiser", { identifiant: "lionel", motDePasse: "un-mot-de-passe-solide" });
    const ok = await appel("POST", "/api/admin/confirmer", { identifiant: "lionel", motDePasse: "un-mot-de-passe-solide", code: await codeTotp(init.corps.secret, instant) });
    const cookie = { Cookie: ok.cookie! };
    const avant = await appel("GET", "/api/admin/etablissements", undefined, cookie);
    expect(avant.corps.etablissements[0].motifsRemise).toEqual(MOTIFS_REMISE_DEFAUT);

    const motifs = ["Camby", "Geste commercial", "Repas du personnel"];
    const r = await appel("PUT", "/api/admin/etablissements/moka/motifs-remise", { motifs: ["  Camby ", "Geste   commercial", "Repas du personnel"] }, cookie);
    expect(r.statut).toBe(200);
    expect(r.corps.etablissement.motifsRemise).toEqual(motifs);
    expect((await appel("PUT", "/api/admin/etablissements/moka/motifs-remise", { motifs: ["Camby", "CAMBY"] }, cookie)).corps.code).toBe("MOTIFS_INVALIDES");
    expect((await appel("PUT", "/api/admin/etablissements/moka/motifs-remise", { motifs: "Camby" }, cookie)).statut).toBe(400);
    expect((await appel("PUT", "/api/admin/etablissements/moka/motifs-remise", { motifs }, {})).statut).toBe(401);

    // La caisse les reçoit avec l'établissement (rattachement et synchronisation lisent la même fiche).
    const etabs = await appel("GET", "/api/admin/etablissements", undefined, cookie);
    expect(etabs.corps.etablissements[0].motifsRemise).toEqual(motifs);
    const journal = await pg.query<{ action: string; details: { motifs: string } }>("select action, details from journal_admin where action = 'motifs_remise'");
    expect(journal.rows[0]?.details.motifs).toBe("Camby, Geste commercial, Repas du personnel");
  });
});
