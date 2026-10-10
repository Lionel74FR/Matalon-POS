import { PGlite } from "@electric-sql/pglite";
import { genererPaireCles } from "@matalon/noyau-fiscal";
import { beforeEach, describe, expect, it } from "vitest";
import { traiter, type Db } from "../src/index.js";
import type { Courriel } from "../src/reservations-serveur.js";
import { _oublierMigration } from "../src/schema.js";
import { codeTotp } from "../src/securite.js";

let pg: PGlite;
let db: Db;
let instant: number;
let courriels: Courriel[];

async function appel(methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}) {
  const reponse = await traiter(
    new Request(`https://pos.test${chemin}`, {
      method: methode,
      headers: { "Content-Type": "application/json", Origin: "https://pos.test", ...entetes },
      body: corps === undefined ? undefined : JSON.stringify(corps),
    }),
    { db, maintenant: () => new Date(instant), envoyerCourriel: async (c) => void courriels.push(c) },
  );
  return { statut: reponse.status, corps: (await reponse.json()) as any };
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
  courriels = [];
  // Jeudi 15 octobre 2026, 10 h à Paris.
  instant = Date.parse("2026-10-15T08:00:00Z");
});

async function admin(): Promise<Record<string, string>> {
  const init = await appel("POST", "/api/admin/initialiser", { identifiant: "lionel", motDePasse: "un-mot-de-passe-solide" });
  const reponse = await traiter(
    new Request("https://pos.test/api/admin/confirmer", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://pos.test" },
      body: JSON.stringify({ identifiant: "lionel", motDePasse: "un-mot-de-passe-solide", code: await codeTotp(init.corps.secret, instant) }),
    }),
    { db, maintenant: () => new Date(instant) },
  );
  return { Cookie: reponse.headers.get("Set-Cookie")!.split(";")[0]! };
}

const REGLAGES = {
  actif: true,
  dureeMinutes: 90,
  pasMinutes: 30,
  delaiMinutes: 60,
  horizonJours: 30,
  groupeMax: 6,
  fermetures: [],
  accueil: "Bienvenue au Moka",
  email: "bonjour@moka.test",
  services: [
    { id: "dej", nom: "Déjeuner", jours: [1, 2, 3, 4, 5, 6, 7], debut: "12:00", fin: "13:30", couvertsMax: 10, simultanesMax: 8, arriveesMax: 6 },
    { id: "din", nom: "Dîner", jours: [4, 5, 6], debut: "19:00", fin: "21:00", couvertsMax: 30, simultanesMax: null, arriveesMax: null, dureeMinutes: 120 },
  ],
};

const CLIENT = { prenom: "Léa", nom: "Martin", telephone: "06 12 34 56 78", email: "lea@exemple.fr", conditions: true };

describe("réservations", () => {
  it("se règle dans l'administration, puis se réserve en ligne avec table attribuée et e-mail", async () => {
    const cookie = await admin();
    // Fermée par défaut.
    expect((await appel("GET", "/api/public/reservation/moka")).statut).toBe(404);
    const invalide = await appel("PUT", "/api/admin/etablissements/moka/reservations/reglages", { reglages: { ...REGLAGES, dureeMinutes: 7 }, version: 0 }, cookie);
    expect(invalide.statut).toBe(400);
    const ok = await appel("PUT", "/api/admin/etablissements/moka/reservations/reglages", { reglages: REGLAGES, version: 0 }, cookie);
    expect(ok.statut).toBe(200);
    expect(ok.corps.version).toBe(1);
    // Version périmée : refusée.
    expect((await appel("PUT", "/api/admin/etablissements/moka/reservations/reglages", { reglages: REGLAGES, version: 0 }, cookie)).statut).toBe(409);

    const config = await appel("GET", "/api/public/reservation/moka");
    expect(config.corps).toMatchObject({ accueil: "Bienvenue au Moka", groupeMax: 6, aujourdhui: "2026-10-15", etablissement: { nom: "Moka" } });
    const creneaux = await appel("GET", "/api/public/reservation/moka/creneaux?date=2026-10-15&couverts=2");
    expect(creneaux.corps.services.map((s: any) => [s.nom, s.creneaux.length])).toEqual([
      ["Déjeuner", 4],
      ["Dîner", 5],
    ]);
    const jours = await appel("GET", "/api/public/reservation/moka/jours?du=2026-10-15&au=2026-10-21&couverts=2");
    expect(jours.corps.jours).toHaveLength(7);

    // Réservation : coordonnées vérifiées, conditions obligatoires, robot écarté.
    expect((await appel("POST", "/api/public/reservation/moka", { date: "2026-10-15", heure: "12:00", couverts: 2, ...CLIENT, conditions: false })).corps.code).toBe("CONDITIONS");
    expect((await appel("POST", "/api/public/reservation/moka", { date: "2026-10-15", heure: "12:00", couverts: 2, ...CLIENT, site: "spam" })).statut).toBe(400);
    expect((await appel("POST", "/api/public/reservation/moka", { date: "2026-10-15", heure: "12:00", couverts: 2, ...CLIENT, email: "" })).corps.code).toBe("COORDONNEES_INVALIDES");
    const r = await appel("POST", "/api/public/reservation/moka", { date: "2026-10-15", heure: "12:00", couverts: 2, ...CLIENT, commentaire: "Sans gluten" });
    expect(r.statut).toBe(201);
    expect(r.corps.reservation).toMatchObject({ heure: "12:00", couverts: 2, statut: "confirmee", annulable: true });
    expect(courriels.map((c) => [c.a, c.sujet.split(" · ")[0]])).toEqual([
      ["lea@exemple.fr", "Réservation confirmée"],
      ["bonjour@moka.test", "Nouvelle réservation"],
    ]);
    expect(courriels[0]!.html).toContain("/reserver/annuler?j=");
    // Même téléphone le même jour : refusé.
    expect((await appel("POST", "/api/public/reservation/moka", { date: "2026-10-15", heure: "13:00", couverts: 2, ...CLIENT })).corps.code).toBe("DEJA_RESERVE");
    // Groupe trop grand, créneau plein.
    expect((await appel("POST", "/api/public/reservation/moka", { date: "2026-10-15", heure: "12:30", couverts: 7, ...CLIENT, telephone: "0611111111" })).corps.code).toBe("GROUPE");
    await appel("POST", "/api/public/reservation/moka", { date: "2026-10-15", heure: "12:00", couverts: 4, ...CLIENT, telephone: "0622222222" });
    expect((await appel("POST", "/api/public/reservation/moka", { date: "2026-10-15", heure: "12:00", couverts: 1, ...CLIENT, telephone: "0633333333" })).corps.code).toBe("CRENEAU_COMPLET");

    // L'administration voit les réservations, avec une table chacune (t1, puis t2).
    const liste = await appel("GET", "/api/admin/etablissements/moka/reservations?du=2026-10-15", undefined, cookie);
    expect(liste.corps.reservations.map((x: any) => [x.heure, x.couverts, x.tables, x.telephone])).toEqual([
      ["12:00", 2, ["t1"], "+33612345678"],
      ["12:00", 4, ["t2"], "+33622222222"],
    ]);

    // Annulation par le lien de l'e-mail.
    const jeton = r.corps.annulation as string;
    expect((await appel("GET", `/api/public/reservation/annulation/${jeton}`)).corps.reservation.annulable).toBe(true);
    const annule = await appel("POST", `/api/public/reservation/annulation/${jeton}`);
    expect(annule.corps.reservation.statut).toBe("annulee");
    expect((await appel("POST", `/api/public/reservation/annulation/${jeton}`)).corps.code).toBe("NON_ANNULABLE");
    expect(courriels.slice(-2).map((c) => c.sujet.split(" · ")[0])).toEqual(["Réservation annulée", "Réservation annulée par le client"]);
  });

  it("se gère depuis la caisse : saisie au téléphone, dépassement accepté sur demande, arrivée et table", async () => {
    const cookie = await admin();
    await appel("PUT", "/api/admin/etablissements/moka/reservations/reglages", { reglages: REGLAGES, version: 0 }, cookie);
    await appel("POST", "/api/admin/etablissements/moka/utilisateurs", { nom: "Léa", role: "responsable", pin: "1234" }, cookie);
    const code = await appel("POST", "/api/admin/etablissements/moka/codes", { nomCaisse: "Comptoir" }, cookie);
    const paire = await genererPaireCles("ipad-0a1b2c3d-k1");
    const rattache = await appel("POST", "/api/caisse/rattacher", {
      code: code.corps.code.toLowerCase().replace(/(.{4})/, "$1-"),
      caisseId: "ipad-0a1b2c3d",
      cleId: paire.cleId,
      clePubliqueJwk: paire.clePubliqueJwk,
      appareil: "iPad test",
    });
    const bearer = { Authorization: `Bearer ${rattache.corps.jeton}` };
    const lea = rattache.corps.utilisateurs.find((u: any) => u.nom === "Léa").id;

    // Au téléphone : pas d'e-mail obligatoire, 8 personnes (au-delà du groupe en ligne), même à 11 h 30.
    const tel = await appel("POST", "/api/caisse/reservations", { date: "2026-10-15", heure: "12:30", couverts: 6, prenom: "Paul", nom: "Durand", telephone: "0644444444", par: lea }, bearer);
    expect(tel.statut).toBe(201);
    expect(tel.corps.reservation).toMatchObject({ source: "telephone", tables: [] }); // aucune table de 6 : à placer
    // 4 de plus à 12 h 30 : la salle (8 en même temps) refuse, sauf « quand même ».
    const plein = { date: "2026-10-15", heure: "12:30", couverts: 4, prenom: "Zoé", nom: "Roux", telephone: "0655555555", par: lea };
    expect((await appel("POST", "/api/caisse/reservations", plein, bearer)).corps.code).toBe("CRENEAU_COMPLET");
    const force = await appel("POST", "/api/caisse/reservations", { ...plein, forcer: true }, bearer);
    expect(force.statut).toBe(201);
    expect(force.corps.reservation.historique[0].action).toMatch(/dépassement/);

    // Tables assemblées pour Paul, puis arrivée.
    const id = tel.corps.reservation.id;
    const place = await appel("PATCH", `/api/caisse/reservations/${id}`, { tables: ["t3", "t4"], par: lea }, bearer);
    expect(place.corps.reservation.tables).toEqual(["t3", "t4"]);
    const arrive = await appel("PATCH", `/api/caisse/reservations/${id}`, { statut: "arrivee", par: lea }, bearer);
    expect(arrive.corps.reservation.historique.map((h: any) => [h.par, h.action])).toEqual([
      ["Comptoir · Léa", "créée"],
      ["Comptoir · Léa", "table 3 + 4"],
      ["Comptoir · Léa", "arrivée"],
    ]);
    // Inconnu de l'établissement : refusé.
    expect((await appel("PATCH", `/api/caisse/reservations/${id}`, { statut: "absente", par: "u-inconnu" }, bearer)).statut).toBe(403);

    const jour = await appel("GET", "/api/caisse/reservations", undefined, bearer);
    expect(jour.corps).toMatchObject({ date: "2026-10-15", dureeMinutes: 90, actif: true });
    expect(jour.corps.reservations.map((r: any) => [r.prenom, r.statut])).toEqual([
      ["Paul", "arrivee"],
      ["Zoé", "confirmee"],
    ]);
    // Déplacer Zoé au dîner : la durée du dîner s'applique, une table lui est attribuée.
    const zoe = force.corps.reservation.id;
    const dep = await appel("PATCH", `/api/caisse/reservations/${zoe}`, { heure: "20:00", par: lea }, bearer);
    expect(dep.corps.reservation).toMatchObject({ heure: "20:00", serviceId: "din", dureeMinutes: 120, tables: ["t1"] });
  });

  it("efface les coordonnées un an après la date", async () => {
    const cookie = await admin();
    await appel("PUT", "/api/admin/etablissements/moka/reservations/reglages", { reglages: REGLAGES, version: 0 }, cookie);
    await appel("POST", "/api/admin/etablissements/moka/reservations", { date: "2026-10-16", heure: "12:00", couverts: 2, prenom: "Ana", nom: "Lopez", telephone: "0666666666" }, cookie);
    instant = Date.parse("2027-10-20T08:00:00Z");
    // Une réservation un an plus tard déclenche l'effacement (la session d'administration a expiré : réservation en ligne).
    expect((await appel("POST", "/api/public/reservation/moka", { date: "2027-10-20", heure: "12:00", couverts: 2, ...CLIENT })).statut).toBe(201);
    const [ancienne] = await db.requete<{ contenu: any; jeton_hash: string | null }>("select contenu, jeton_hash from reservations where date = '2026-10-16'");
    expect(ancienne!.contenu).toMatchObject({ prenom: "", nom: "(effacé)", telephone: "", couverts: 2 });
    expect(ancienne!.jeton_hash).toBeNull();
  });
});
