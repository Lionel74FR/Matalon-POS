import { PGlite } from "@electric-sql/pglite";
import {
  genererPaireCles,
  Registre,
  signataireDepuis,
  StockageMemoire,
  verifierRegistre,
  canonique,
  sha256Hex,
  verifierChaine,
  verifierScellement,
  verifierTotauxTickets,
  totauxTickets,
  champsTotaux,
  type Chaine,
  type SaisieLigne,
} from "@matalon/noyau-fiscal";
import { beforeEach, describe, expect, it } from "vitest";
import { traiter, verifierArchiveServeur, type Db } from "../src/index.js";
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

async function caisseRattachee(cookie: string, caisseId = "ipad-0a1b2c3d") {
  if (caisseId === "ipad-0a1b2c3d") {
    const sansEquipe = await appel("POST", "/api/admin/etablissements/moka/codes", { nomCaisse: "Comptoir" }, { Cookie: cookie });
    expect(sansEquipe.corps.code).toBe("RESPONSABLE_REQUIS");
    const u = await appel("POST", "/api/admin/etablissements/moka/utilisateurs", { nom: "Léa", role: "responsable", pin: "1234" }, { Cookie: cookie });
    expect(u.statut).toBe(200);
  }
  const code = await appel("POST", "/api/admin/etablissements/moka/codes", { nomCaisse: "Comptoir" }, { Cookie: cookie });
  expect(code.statut).toBe(201);
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
    const maj = await appel("PUT", "/api/admin/etablissements/moka", { identite: { enseigne: "Moka", siret: "123 456 789 00012", mentionsLegales: "SAS au capital de 10 000 €" }, tables: [], seuilNote: 3000 }, { Cookie: cookie });
    expect(maj.corps.etablissement).toMatchObject({ seuilNote: 3000, identite: { siret: "12345678900012", mentionsLegales: "SAS au capital de 10 000 €" } });
    // Un iPad d'une version antérieure n'envoie pas le champ : la valeur enregistrée reste.
    const ancien = await appel("PUT", "/api/admin/etablissements/moka", { identite: { enseigne: "Moka" }, tables: [], seuilNote: 3000 }, { Cookie: cookie });
    expect(ancien.corps.etablissement.identite.mentionsLegales).toBe("SAS au capital de 10 000 €");
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
    // Journal complet en JSON : il se vérifie seul avec la clé publique qu'il porte.
    const journal = await appel("GET", `/api/admin/caisses/${caisseId}/journal.json`, undefined, { Cookie: cookie });
    expect(journal.corps.tickets).toHaveLength(181);
    const copie = new StockageMemoire();
    await copie.ajouterLot((["tickets", "evenements", "clotures"] as Chaine[]).flatMap((chaine) => journal.corps[chaine].map((enregistrement: any) => ({ chaine, enregistrement }))));
    expect((await verifierRegistre(copie, (id) => (id === journal.corps.cleId ? journal.corps.clePublique : null))).integre).toBe(true);

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
    // Le refus n'a rien écrit : Léa reste responsable active.
    const etat = await appel("GET", "/api/caisse/etat", undefined, bearer);
    expect(etat.corps.utilisateurs.find((u: any) => u.id === lea.id).actif).toBe(true);

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

describe("cartes", () => {
  it("amorce la carte du code, l'édite avec contrôle de version et la diffuse aux caisses", async () => {
    const cookie = await adminConnecte();
    const { bearer } = await caisseRattachee(cookie);
    const liste = await appel("GET", "/api/admin/cartes", undefined, { Cookie: cookie });
    expect(liste.corps.cartes).toMatchObject([{ id: "carte-automne-2026", version: 1, etablissements: ["moka"] }]);
    expect((await appel("GET", "/api/caisse/etat", undefined, bearer)).corps.etablissement.carteVersion).toBe(1);

    const lue = await appel("GET", "/api/admin/cartes/carte-automne-2026", undefined, { Cookie: cookie });
    const carte = lue.corps.carte;
    carte.categories[0].articles[0].prixTTC = 260;
    carte.categories[0].articles.push({ id: "ristretto", nom: "Ristretto", prixTTC: 250, tauxTVA: 1000 });
    const maj = await appel("PUT", "/api/admin/cartes/carte-automne-2026", { carte, version: 1 }, { Cookie: cookie });
    expect(maj.statut).toBe(200);
    expect(maj.corps.version).toBe(2);
    // Un second éditeur resté sur la version 1 ne peut pas écraser la modification.
    const conflit = await appel("PUT", "/api/admin/cartes/carte-automne-2026", { carte, version: 1 }, { Cookie: cookie });
    expect(conflit.statut).toBe(409);
    for (const version of [undefined, "2", 1.5]) {
      expect((await appel("PUT", "/api/admin/cartes/carte-automne-2026", { carte, version }, { Cookie: cookie })).statut).toBe(400);
    }

    const invalide = structuredClone(carte);
    invalide.categories[0].articles[0].prixTTC = 2.6;
    invalide.categories[0].articles.push({ id: "ristretto", nom: "Doublon", prixTTC: 100, tauxTVA: 1000 });
    const refus = await appel("PUT", "/api/admin/cartes/carte-automne-2026", { carte: invalide, version: 2 }, { Cookie: cookie });
    expect(refus.statut).toBe(400);
    expect(refus.corps.message).toMatch(/prix en centimes/);

    const etat = await appel("GET", "/api/caisse/etat", undefined, bearer);
    expect(etat.corps.etablissement.carteVersion).toBe(2);
    const telechargee = await appel("GET", "/api/caisse/carte", undefined, bearer);
    expect(telechargee.corps.version).toBe(2);
    expect(telechargee.corps.carte.categories[0].articles.find((a: any) => a.id === "espresso").prixTTC).toBe(260);
  });

  it("crée une carte par copie et l'attribue à un établissement", async () => {
    const cookie = await adminConnecte();
    const copie = await appel("POST", "/api/admin/cartes", { id: "carte-hiver-2026", nom: "Carte hiver 2026", depuis: "carte-automne-2026" }, { Cookie: cookie });
    expect(copie.statut).toBe(201);
    expect(copie.corps.carte).toMatchObject({ id: "carte-hiver-2026", nom: "Carte hiver 2026" });
    expect((await appel("POST", "/api/admin/cartes", { id: "carte-hiver-2026", nom: "x" }, { Cookie: cookie })).statut).toBe(409);
    const vide = await appel("POST", "/api/admin/cartes", { id: "carte-vide", nom: "Vide" }, { Cookie: cookie });
    expect(vide.corps.carte.categories).toEqual([]);
    const maj = await appel("PUT", "/api/admin/etablissements/moka", { identite: { enseigne: "Moka" }, tables: [], seuilNote: 2500, carteId: "carte-hiver-2026" }, { Cookie: cookie });
    expect(maj.corps.etablissement).toMatchObject({ carteId: "carte-hiver-2026", carteVersion: 1 });
    expect((await appel("PUT", "/api/admin/etablissements/moka", { identite: { enseigne: "Moka" }, carteId: "inexistante" }, { Cookie: cookie })).statut).toBe(400);
  });
});

describe("comptes clients", () => {
  it("vend en compte sur une caisse, règle sur une autre, et recalcule les soldes côté serveur", async () => {
    const cookie = await adminConnecte();
    const a = await caisseRattachee(cookie);
    const b = await caisseRattachee(cookie, "ipad-1111aaaa");
    const martin = { id: "cli-0000abcd", nom: "M. Martin" };
    // Client créé hors ligne : il n'existe que dans le ticket.
    const vente = await a.registre.enregistrerVente({
      lignes: [CAFE, SPRITZ],
      paiements: [
        { mode: "CB", montant: 500 },
        { mode: "EN_COMPTE", montant: 1000 },
      ],
      operateurId: "u-1",
      client: martin,
    });
    expect((await a.synchro()).statut).toBe(200);
    const etat = (await appel("GET", "/api/caisse/etat", undefined, b.bearer)).corps as ReponseEtat;
    expect(etat.clients).toEqual([{ ...martin, telephone: "", email: "", actif: true }]);

    let comptes = (await appel("GET", "/api/caisse/comptes", undefined, b.bearer)).corps;
    expect(comptes.comptes[0]).toMatchObject({ client: { id: martin.id }, soldeTTC: 1000 });
    const v = comptes.comptes[0].ventes[0];
    expect(v).toMatchObject({ caisseId: a.caisseId, numero: vente.numero, resteTTC: 1000 });

    await b.registre.enregistrerReglement({
      client: martin,
      paiements: [{ mode: "ESPECES", montant: 600 }],
      imputations: [{ caisseId: v.caisseId, numero: v.numero, hash: v.hash, montantTTC: 600, venteTotalTTC: v.totalTTC, venteEnCompteTTC: v.enCompteTTC, dejaRegleTTC: v.regleTTC, venteVentilationTVA: v.ventilationTVA }],
      operateurId: "u-1",
    });
    expect((await b.synchro()).statut).toBe(200);
    comptes = (await appel("GET", "/api/caisse/comptes", undefined, a.bearer)).corps;
    expect(comptes.comptes[0]).toMatchObject({ soldeTTC: 400 });
    expect(comptes.anomalies).toEqual([]);
    expect(comptes.dernierTicketCaisse).toBe(1);

    // Fiche client complétée par la caisse, puis vue de l'administration.
    const maj = await appel("PUT", "/api/caisse/clients", { id: martin.id, nom: "Martin Paul", telephone: "06 00 00 00 00", email: "Paul.Martin@Exemple.fr " }, a.bearer);
    expect(maj.corps.clients[0]).toMatchObject({ nom: "Martin Paul", telephone: "06 00 00 00 00", email: "paul.martin@exemple.fr" });
    // Une caisse d'une version antérieure n'envoie pas l'e-mail : il est conservé.
    const ancienne = await appel("PUT", "/api/caisse/clients", { id: martin.id, nom: "Martin Paul", telephone: "06 00 00 00 00" }, a.bearer);
    expect(ancienne.corps.client.email).toBe("paul.martin@exemple.fr");
    expect((await appel("PUT", "/api/caisse/clients", { id: martin.id, nom: "Martin Paul", email: "pas-un-email" }, a.bearer)).statut).toBe(400);
    const admin = await appel("GET", "/api/admin/etablissements/moka/comptes", undefined, { Cookie: cookie });
    expect(admin.corps.comptes[0]).toMatchObject({ client: { nom: "Martin Paul" }, soldeTTC: 400 });
    expect((await appel("PUT", "/api/caisse/clients", { id: "pas-un-id", nom: "X" }, a.bearer)).statut).toBe(400);
    // La fiche du compte rouvre la note d'origine, même encaissée sur une autre caisse.
    const ouverte = comptes.comptes[0].ventes[0];
    const note = await appel("GET", `/api/caisse/tickets/${ouverte.caisseId}/${ouverte.numero}`, undefined, a.bearer);
    expect(note.corps.ticket).toMatchObject({ numero: ouverte.numero, hash: ouverte.hash, client: { id: martin.id } });
    expect((await appel("GET", `/api/caisse/tickets/${ouverte.caisseId}/999`, undefined, a.bearer)).statut).toBe(404);

    // Un sur-règlement (deux caisses qui règlent la même dette) est signalé, jamais bloqué.
    await a.registre.enregistrerReglement({
      client: martin,
      paiements: [{ mode: "CB", montant: 1000 }],
      imputations: [{ caisseId: v.caisseId, numero: v.numero, hash: v.hash, montantTTC: 1000, venteTotalTTC: v.totalTTC, venteEnCompteTTC: v.enCompteTTC, dejaRegleTTC: 0, venteVentilationTVA: v.ventilationTVA }],
      operateurId: "u-1",
    }).catch(() => null);
    // La caisse A connaît le règlement de B seulement par le serveur : son contrôle local ne voit que ses tickets.
    expect((await a.synchro({ tickets: 1, evenements: 0, clotures: 0 } as never)).statut).toBe(200);
    comptes = (await appel("GET", "/api/caisse/comptes", undefined, a.bearer)).corps;
    expect(comptes.anomalies.join(" ")).toContain("de trop");
  });
});

describe("imprimantes de production", () => {
  it("relie les postes de la carte aux imprimantes de l'établissement, depuis l'administration ou une caisse", async () => {
    const cookie = await adminConnecte();
    const a = await caisseRattachee(cookie);
    const postes = { Bar: { adresse: "192.168.1.51", sansAccents: false }, Cuisine: { adresse: "192.168.1.52", sansAccents: true } };
    const r = await appel("PUT", "/api/admin/etablissements/moka/postes", { postes }, { Cookie: cookie });
    expect(r.statut).toBe(200);
    const etat = (await appel("GET", "/api/caisse/etat", undefined, a.bearer)).corps as ReponseEtat;
    expect(etat.etablissement.postesProduction).toEqual(postes);
    const caisse = await appel("PUT", "/api/caisse/postes", { postes: { Bar: { adresse: "192.168.1.60", sansAccents: false } } }, a.bearer);
    expect(caisse.corps.etablissement.postesProduction).toEqual({ Bar: { adresse: "192.168.1.60", sansAccents: false } });
    expect((await appel("PUT", "/api/caisse/postes", { postes: { "Bar\n": { adresse: "x" } } }, a.bearer)).statut).toBe(400);
    expect((await appel("PUT", "/api/caisse/postes", { postes: { Bar: { adresse: "http://evil" } } }, a.bearer)).statut).toBe(400);
  });
});

describe("plan de salle", () => {
  it("enregistre formes, chaises et décor ; refuse une version dépassée et une table supprimée", async () => {
    const cookie = await adminConnecte();
    const a = await caisseRattachee(cookie);
    const depart = (await appel("GET", "/api/caisse/etat", undefined, a.bearer)).corps as ReponseEtat;
    expect(depart.etablissement.planVersion).toBe(0);
    const tables = depart.etablissement.tables.map((t, i) => ({ ...t, forme: "rond", chaises: 4, x: 2 + (i % 6) * 6, y: 2 + Math.floor(i / 6) * 6 }));
    const zones = [{ nom: "Salle", largeur: 40, hauteur: 24, decor: [{ id: "bar", type: "bar", x: 0, y: 20, largeur: 12, hauteur: 3, libelle: "Bar" }] }];
    const r = await appel("PUT", "/api/admin/etablissements/moka/plan", { version: 0, zones, tables }, { Cookie: cookie });
    expect(r.statut).toBe(200);
    expect(r.corps.etablissement).toMatchObject({ planVersion: 1, zones });
    expect(r.corps.etablissement.tables[0]).toMatchObject({ forme: "rond", chaises: 4, x: 2, y: 2 });

    // L'iPad d'un responsable modifie le plan qu'il a reçu.
    const etat = (await appel("GET", "/api/caisse/etat", undefined, a.bearer)).corps as ReponseEtat;
    const deplacee = etat.etablissement.tables.map((t) => (t.id === "t1" ? { ...t, x: 30, rotation: 90 as const } : t));
    const c = await appel("PUT", "/api/caisse/plan", { version: etat.etablissement.planVersion, zones, tables: deplacee }, a.bearer);
    expect(c.statut).toBe(200);
    expect(c.corps.etablissement.planVersion).toBe(2);
    // L'administration travaillait sur la version 1 : refus, rien d'écrasé.
    const conflit = await appel("PUT", "/api/admin/etablissements/moka/plan", { version: 1, zones, tables }, { Cookie: cookie });
    expect(conflit.statut).toBe(409);
    expect(conflit.corps.code).toBe("PLAN_MODIFIE");

    const plan = (t: unknown[]) => ({ version: 2, zones, tables: t });
    const suppression = await appel("PUT", "/api/caisse/plan", plan(deplacee.slice(1)), a.bearer);
    expect(suppression.statut).toBe(400);
    expect(suppression.corps.message).toMatch(/masquez-la/);
    expect((await appel("PUT", "/api/caisse/plan", plan(deplacee.map((t) => ({ ...t, zone: "Cave" }))), a.bearer)).statut).toBe(400);
    expect((await appel("PUT", "/api/caisse/plan", plan(deplacee.map((t) => ({ ...t, chaises: 99 }))), a.bearer)).statut).toBe(400);
    expect((await appel("PUT", "/api/caisse/plan", plan(deplacee.map((t) => ({ ...t, nom: "1" }))), a.bearer)).statut).toBe(400);
    const masquee = await appel("PUT", "/api/caisse/plan", plan(deplacee.map((t) => (t.id === "t2" ? { ...t, masquee: true } : t))), a.bearer);
    expect(masquee.corps.etablissement.tables.find((t: any) => t.id === "t2").masquee).toBe(true);

    // Modifier l'identité de l'établissement ne touche plus aux tables.
    await appel("PUT", "/api/admin/etablissements/moka", { identite: { enseigne: "Moka" }, tables: [], seuilNote: 2500 }, { Cookie: cookie });
    const apres = (await appel("GET", "/api/caisse/etat", undefined, a.bearer)).corps as ReponseEtat;
    expect(apres.etablissement.tables).toHaveLength(12);
    expect(apres.etablissement.tables[0]).toMatchObject({ x: 30, rotation: 90 });
  });
});

describe("archives côté serveur", () => {
  it("exporte l'archive d'une Z depuis la copie du serveur, vérifiable seule", async () => {
    const cookie = await adminConnecte();
    const { registre, synchro, caisseId } = await caisseRattachee(cookie);
    await registre.enregistrerVente({ lignes: [CAFE], paiements: [{ mode: "CB", montant: 400 }], operateurId: "u-lea" });
    await registre.cloturerJournee("u-lea");
    instant += 3_600_000;
    await registre.enregistrerVente({ lignes: [SPRITZ, CAFE], paiements: [{ mode: "ESPECES", montant: 1500 }], operateurId: "u-lea" });
    await registre.cloturerJournee("u-lea");
    expect((await synchro()).statut).toBe(200);

    const liste = await appel("GET", `/api/admin/caisses/${caisseId}/clotures`, undefined, { Cookie: cookie });
    expect(liste.corps.clotures.map((c: any) => [c.numero, c.totalTTC])).toEqual([
      [2, 1500],
      [1, 400],
    ]);
    const r = await appel("GET", `/api/admin/caisses/${caisseId}/clotures/2/archive.json`, undefined, { Cookie: cookie });
    const { empreinte, ...contenu } = r.corps;
    expect(await sha256Hex(canonique(contenu))).toBe(empreinte);
    const attendue = (await appel("GET", "/api/admin/etablissements", undefined, { Cookie: cookie })).corps.etablissements[0].caisses[0].empreinteCle;
    expect(await verifierArchiveServeur(r.corps, attendue)).toEqual({ integre: true, anomalies: [] });
    // Un fichier forgé, re-signé avec une autre clé, est démasqué par l'empreinte de clé attendue.
    const autre = await genererPaireCles(`${caisseId}-k1`);
    const forge = { ...r.corps, clePublique: autre.clePubliqueJwk, empreinteCle: "x" };
    expect((await verifierArchiveServeur(forge, attendue)).anomalies.map((a) => a.code)).toContain("CLE_INATTENDUE");
    const modifiee = structuredClone(r.corps);
    modifiee.tickets[0].totalTTC = 1;
    expect((await verifierArchiveServeur(modifiee, attendue)).integre).toBe(false);
    // Le journal d'administration (où l'empreinte est tracée) est en ajout seul.
    await expect(db.requete("delete from journal_admin")).rejects.toThrow(/ajout seul/);
    const resoudre = (id: string) => (id === contenu.cleId ? contenu.clePublique : null);
    const anomalies = [
      ...(await verifierChaine("tickets", contenu.tickets, resoudre, contenu.ancrages.ticketPrecedent ?? undefined)),
      ...(await verifierChaine("evenements", contenu.evenements, resoudre, contenu.ancrages.evenementPrecedent ?? undefined)),
      ...verifierTotauxTickets(contenu.tickets, contenu.ancrages.ticketPrecedent.grandTotalPerpetuel, contenu.ancrages.ticketPrecedent.cumulPerpetuelAbsolu),
      ...(await verifierScellement("clotures", contenu.cloture, resoudre)),
    ];
    expect(anomalies).toEqual([]);
    expect(canonique(champsTotaux(contenu.cloture))).toBe(canonique(champsTotaux(totauxTickets(contenu.tickets))));
    expect((await appel("GET", `/api/admin/caisses/${caisseId}/clotures/9/archive.json`, undefined, { Cookie: cookie })).statut).toBe(404);
  });
});
