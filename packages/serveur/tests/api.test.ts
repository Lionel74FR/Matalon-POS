import { PGlite } from "@electric-sql/pglite";
import {
  genererPaireCles,
  Registre,
  signataireDepuis,
  StockageMemoire,
  type Chaine,
  type SaisieLigne,
} from "@matalon/noyau-fiscal";
import { beforeEach, describe, expect, it } from "vitest";
import { traiter, type Db } from "../src/index.js";
import type { EntreeSynchro, ReponseEtat, ReponseRattachement, ReponseSynchro } from "../src/partage.js";
import { _oublierMigration } from "../src/schema.js";
import { codeTotp } from "../src/securite.js";

const CAFE: SaisieLigne = { articleId: "cappuccino", libelle: "Cappuccino", quantite: 1, prixUnitaireTTC: 400, tauxTVA: 1000 };
const SPRITZ: SaisieLigne = { articleId: "spritz-aperol", libelle: "Spritz Aperol", quantite: 1, prixUnitaireTTC: 1100, tauxTVA: 2000 };

let pg: PGlite;
let db: Db;
let instant: number;
const env = () => ({ db, maintenant: () => new Date(instant) });

async function appel(methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}) {
  const reponse = await traiter(
    new Request(`https://pos.test${chemin}`, {
      method: methode,
      headers: { "Content-Type": "application/json", Origin: "https://pos.test", ...entetes },
      body: corps === undefined ? undefined : JSON.stringify(corps),
    }),
    env(),
  );
  const type = reponse.headers.get("Content-Type") ?? "";
  return {
    statut: reponse.status,
    corps: (type.includes("json") ? await reponse.json() : await reponse.text()) as any,
    cookie: reponse.headers.get("Set-Cookie"),
  };
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
  instant = Date.parse("2026-10-15T08:00:00Z");
});

async function adminConnecte(): Promise<string> {
  const init = await appel("POST", "/api/admin/initialiser", { identifiant: "lionel", motDePasse: "un-mot-de-passe-solide" });
  expect(init.statut).toBe(201);
  const code = await codeTotp(init.corps.secret, instant);
  const conf = await appel("POST", "/api/admin/confirmer", { identifiant: "lionel", motDePasse: "un-mot-de-passe-solide", code });
  expect(conf.statut).toBe(200);
  return conf.cookie!.split(";")[0]!;
}

async function caisseRattachee(cookie: string) {
  const u = await appel("POST", "/api/admin/etablissements/moka/utilisateurs", { nom: "Léa", role: "responsable", pin: "1234" }, { Cookie: cookie });
  expect(u.statut).toBe(200);
  const code = await appel("POST", "/api/admin/etablissements/moka/codes", { nomCaisse: "Comptoir" }, { Cookie: cookie });
  expect(code.statut).toBe(201);
  const caisseId = "ipad-0a1b2c3d";
  const paire = await genererPaireCles(`${caisseId}-k1`);
  const r = await appel("POST", "/api/caisse/rattacher", {
    code: code.corps.code.toLowerCase().replace(/(.{4})/, "$1-"),
    caisseId,
    cleId: paire.cleId,
    clePubliqueJwk: paire.clePubliqueJwk,
    appareil: "iPad test",
  });
  expect(r.statut).toBe(201);
  const rattachement = r.corps as ReponseRattachement;
  const stockage = new StockageMemoire();
  const registre = new Registre({
    stockage,
    signataire: signataireDepuis(paire),
    contexte: { etablissementId: rattachement.etablissement.id, caisseId },
    horloge: () => new Date(instant),
  });
  const bearer = { Authorization: `Bearer ${rattachement.jeton}` };
  const synchro = async (depuis?: Record<Chaine, number>) => {
    const lot: EntreeSynchro[] = [];
    for (const chaine of ["tickets", "evenements", "clotures"] as Chaine[]) {
      for (const e of await stockage.lister(chaine, (depuis?.[chaine] ?? 0) + 1)) lot.push({ chaine, enregistrement: e });
    }
    return appel("POST", "/api/caisse/synchro", { lot }, bearer);
  };
  return { rattachement, registre, stockage, bearer, synchro, code: code.corps.code as string, caisseId };
}

describe("administration", () => {
  it("crée l'administrateur avec double authentification puis bloque après 5 échecs", async () => {
    expect((await appel("GET", "/api/admin/statut")).corps).toMatchObject({ initialise: false, connecte: false });
    const cookie = await adminConnecte();
    expect((await appel("GET", "/api/admin/statut", undefined, { Cookie: cookie })).corps).toMatchObject({ initialise: true, connecte: true });
    expect((await appel("POST", "/api/admin/initialiser", { identifiant: "pirate", motDePasse: "xxxxxxxxxxxxxxxx" })).statut).toBe(403);
    expect((await appel("GET", "/api/admin/etablissements")).statut).toBe(401);

    for (let i = 0; i < 5; i++) {
      const r = await appel("POST", "/api/admin/connexion", { identifiant: "lionel", motDePasse: "un-mot-de-passe-solide", code: "000000" });
      expect(r.statut).toBe(401);
    }
    expect((await appel("POST", "/api/admin/connexion", { identifiant: "lionel", motDePasse: "faux", code: "000000" })).statut).toBe(429);
  });

  it("liste le Moka créé d'office avec sa carte", async () => {
    const cookie = await adminConnecte();
    const r = await appel("GET", "/api/admin/etablissements", undefined, { Cookie: cookie });
    expect(r.corps.etablissements.map((e: any) => [e.id, e.carteId, e.tables.length])).toEqual([["moka", "carte-automne-2026", 12]]);
    expect(r.corps.cartes[0].id).toBe("carte-automne-2026");
  });

  it("crée un second établissement et refuse les identifiants invalides", async () => {
    const cookie = await adminConnecte();
    const corps = { id: "bao-canteen", identite: { enseigne: "Bao Canteen" }, carteId: "carte-automne-2026", tables: [], seuilNote: 2500 };
    expect((await appel("POST", "/api/admin/etablissements", corps, { Cookie: cookie })).statut).toBe(201);
    expect((await appel("POST", "/api/admin/etablissements", corps, { Cookie: cookie })).statut).toBe(409);
    expect((await appel("POST", "/api/admin/etablissements", { ...corps, id: "Bao Canteen" }, { Cookie: cookie })).statut).toBe(400);
    const maj = await appel("PUT", "/api/admin/etablissements/moka", { identite: { enseigne: "Moka", siret: "123 456 789 00012" }, tables: [], seuilNote: 3000 }, { Cookie: cookie });
    expect(maj.corps.etablissement).toMatchObject({ seuilNote: 3000, identite: { siret: "12345678900012" } });
  });
});

describe("rattachement et synchronisation", () => {
  it("rattache une caisse avec un code à usage unique", async () => {
    const cookie = await adminConnecte();
    const { rattachement, code } = await caisseRattachee(cookie);
    expect(rattachement.caisse.nom).toBe("Comptoir");
    expect(rattachement.etablissement.id).toBe("moka");
    expect(rattachement.utilisateurs.map((u) => u.nom)).toEqual(["Léa"]);
    const paire = await genererPaireCles("ipad-ffffffff-k1");
    const encore = await appel("POST", "/api/caisse/rattacher", { code, caisseId: "ipad-ffffffff", cleId: paire.cleId, clePubliqueJwk: paire.clePubliqueJwk });
    expect(encore.statut).toBe(400);
  });

  it("réplique une journée hors ligne à l'identique et la vérifie côté serveur", async () => {
    const cookie = await adminConnecte();
    const { registre, stockage, synchro, bearer, caisseId } = await caisseRattachee(cookie);
    await registre.journaliser("INITIALISATION_CAISSE", {}, null);
    for (let i = 0; i < 180; i++) {
      instant += 3 * 60_000;
      await registre.enregistrerVente({ lignes: [i % 3 ? CAFE : SPRITZ], paiements: [{ mode: i % 2 ? "CB" : "ESPECES", montant: i % 3 ? 400 : 1100 }], operateurId: "u-lea" });
    }
    await registre.enregistrerAnnulation({ numeroTicket: 7, motif: "Erreur", operateurId: "u-lea" });
    await registre.cloturerJournee("u-lea");

    // 181 tickets + événements + 1 clôture : envoyés en deux temps, comme après une coupure.
    const premier = await appel("POST", "/api/caisse/synchro", {
      lot: (await stockage.lister("tickets", 1, 100)).map((e) => ({ chaine: "tickets", enregistrement: e })),
    }, bearer);
    expect(premier.statut).toBe(200);
    const reste = await synchro({ tickets: 100, evenements: 0, clotures: 0 });
    expect(reste.statut).toBe(200);
    const etat = (await appel("GET", "/api/caisse/etat", undefined, bearer)).corps as ReponseEtat;
    for (const chaine of ["tickets", "evenements", "clotures"] as Chaine[]) {
      const local = await stockage.dernier(chaine);
      expect(etat.derniers[chaine]).toEqual({ numero: local!.numero, hash: local!.hash });
    }
    const verif = await appel("GET", `/api/admin/caisses/${caisseId}/verification`, undefined, { Cookie: cookie });
    expect(verif.corps.anomalies).toEqual([]);
    expect(verif.corps.compteurs.tickets).toBe(181);
    const csv = await appel("GET", `/api/admin/caisses/${caisseId}/clotures.csv`, undefined, { Cookie: cookie });
    expect(csv.corps).toContain("JOUR;2026-10-15");

    // Renvoi après coupure réseau : rien n'est dupliqué.
    const renvoi = (await synchro()).corps as ReponseSynchro;
    expect(renvoi.acceptes).toBe(0);
  });

  it("refuse un enregistrement altéré, une rupture de chaîne et une autre caisse", async () => {
    const cookie = await adminConnecte();
    const { registre, stockage, bearer, caisseId } = await caisseRattachee(cookie);
    await registre.enregistrerVente({ lignes: [CAFE], paiements: [{ mode: "CB", montant: 400 }], operateurId: "u-lea" });
    await registre.enregistrerVente({ lignes: [SPRITZ], paiements: [{ mode: "CB", montant: 1100 }], operateurId: "u-lea" });
    const [t1, t2] = await stockage.lister("tickets");

    const altere = await appel("POST", "/api/caisse/synchro", { lot: [{ chaine: "tickets", enregistrement: { ...t1, totalTTC: 1 } }] }, bearer);
    expect(altere.statut).toBe(409);
    expect(altere.corps.code).toBe("DIVERGENCE");

    const trou = await appel("POST", "/api/caisse/synchro", { lot: [{ chaine: "tickets", enregistrement: t2 }] }, bearer);
    expect(trou.statut).toBe(409);
    expect(trou.corps.message).toMatch(/rupture/);

    const autre = await appel("POST", "/api/caisse/synchro", { lot: [{ chaine: "tickets", enregistrement: { ...t1, caisseId: "ipad-99999999" } }] }, bearer);
    expect(autre.statut).toBe(409);

    const liste = await appel("GET", "/api/admin/etablissements", undefined, { Cookie: cookie });
    expect(liste.corps.etablissements[0].caisses[0].divergence).toMatch(/autre caisse/);
    expect((await appel("POST", "/api/caisse/synchro", { lot: [{ chaine: "tickets", enregistrement: t1 }, { chaine: "tickets", enregistrement: t2 }] }, bearer)).statut).toBe(200);

    // Base en ajout seul : même un accès direct ne peut rien modifier.
    await expect(db.requete("update enregistrements set hash = 'x' where caisse_id = $1", [caisseId])).rejects.toThrow(/ajout seul/);
    await expect(db.requete("delete from enregistrements where caisse_id = $1", [caisseId])).rejects.toThrow(/ajout seul/);
  });

  it("partage l'équipe et l'établissement, et coupe une caisse révoquée", async () => {
    const cookie = await adminConnecte();
    const { rattachement, bearer, caisseId } = await caisseRattachee(cookie);
    const lea = rattachement.utilisateurs[0]!;
    const maj = await appel("PUT", "/api/caisse/utilisateurs", {
      utilisateurs: [{ ...lea }, { id: "u-00000002", nom: "Tom", role: "serveur", pinHash: "a".repeat(64), actif: true }],
    }, bearer);
    expect(maj.corps.utilisateurs.map((u: any) => u.nom)).toEqual(["Léa", "Tom"]);
    const sansResponsable = await appel("PUT", "/api/caisse/utilisateurs", { utilisateurs: [{ ...lea, actif: false }] }, bearer);
    expect(sansResponsable.statut).toBe(400);

    const etab = await appel("PUT", "/api/caisse/etablissement", {
      identite: { ...rattachement.etablissement.identite, raisonSociale: "SAS Moka" },
      tables: rattachement.etablissement.tables,
      seuilNote: 2500,
    }, bearer);
    expect(etab.corps.etablissement.identite.raisonSociale).toBe("SAS Moka");

    expect((await appel("POST", `/api/admin/caisses/${caisseId}/revoquer`, {}, { Cookie: cookie })).statut).toBe(200);
    const apres = await appel("GET", "/api/caisse/etat", undefined, bearer);
    expect(apres.statut).toBe(403);
    expect(apres.corps.code).toBe("CAISSE_REVOQUEE");
  });
});
