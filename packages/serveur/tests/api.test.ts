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

async function caisseRattachee(cookie: string, caisseId = "ipad-0a1b2c3d", etab = "moka") {
  if (caisseId === "ipad-0a1b2c3d") {
    const sansEquipe = await appel("POST", "/api/admin/etablissements/moka/codes", { nomCaisse: "Comptoir" }, { Cookie: cookie });
    expect(sansEquipe.corps.code).toBe("RESPONSABLE_REQUIS");
    const u = await appel("POST", "/api/admin/etablissements/moka/utilisateurs", { nom: "Léa", role: "responsable", pin: "1234" }, { Cookie: cookie });
    expect(u.statut).toBe(200);
  }
  const code = await appel("POST", `/api/admin/etablissements/${etab}/codes`, { nomCaisse: "Comptoir" }, { Cookie: cookie });
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
    const responsable = { id: lea.id, pin: "1234" };
    const tom = { id: "u-00000002", nom: "Tom", role: "serveur", pinHash: "a".repeat(64), actif: true };
    // Le jeton de l'appareil ne suffit pas : le serveur vérifie le code d'un responsable.
    expect((await appel("PUT", "/api/caisse/utilisateurs", { utilisateurs: [tom] }, bearer)).corps.code).toBe("RESPONSABLE_REQUIS");
    const maj = await appel("PUT", "/api/caisse/utilisateurs", { utilisateurs: [{ ...lea }, tom], responsable }, bearer);
    expect(maj.corps.utilisateurs.map((u: any) => u.nom)).toEqual(["Léa", "Tom"]);
    expect((await appel("PUT", "/api/caisse/utilisateurs", { utilisateurs: [{ ...tom, role: "responsable" }], responsable: { id: tom.id, pin: "1234" } }, bearer)).corps.code).toBe("RESPONSABLE_REQUIS");
    const sansResponsable = await appel("PUT", "/api/caisse/utilisateurs", { utilisateurs: [{ ...lea, actif: false }], responsable }, bearer);
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

describe("tickets partagés", () => {
  it("chaque appareil voit les derniers tickets de toutes les caisses de l'établissement", async () => {
    const cookie = await adminConnecte();
    const a = await caisseRattachee(cookie);
    const b = await caisseRattachee(cookie, "ipad-1111aaaa");
    await a.registre.enregistrerVente({ lignes: [CAFE], paiements: [{ mode: "CB", montant: 400 }], operateurId: "u-lea" });
    instant += 60_000;
    await b.registre.enregistrerVente({ lignes: [SPRITZ], paiements: [{ mode: "ESPECES", montant: 1100 }], operateurId: "u-lea" });
    expect((await a.synchro()).statut).toBe(200);
    expect((await b.synchro()).statut).toBe(200);
    const r = await appel("GET", "/api/caisse/tickets?limite=10", undefined, a.bearer);
    expect(r.statut).toBe(200);
    expect(r.corps.tickets.map((t: any) => [t.caisseId, t.numero])).toEqual([
      ["ipad-1111aaaa", 1],
      ["ipad-0a1b2c3d", 1],
    ]);
    expect(r.corps.appareils).toMatchObject({ "ipad-0a1b2c3d": "Comptoir", "ipad-1111aaaa": "Comptoir" });
    expect((await appel("GET", "/api/caisse/tickets", undefined, {})).statut).toBe(401);
    // Idem pour les clôtures : la Z de l'iPhone se consulte depuis l'iPad.
    await b.registre.cloturerJournee("u-lea");
    expect((await b.synchro()).statut).toBe(200);
    const z = await appel("GET", "/api/caisse/clotures", undefined, a.bearer);
    expect(z.corps.clotures.map((c: any) => [c.caisseId, c.periode, c.totalTTC])).toEqual([["ipad-1111aaaa", "JOUR", 1100]]);
  });
});

describe("clôtures de l'établissement", () => {
  it("une Z faite sur un appareil couvre toutes les caisses ; un seul appareil clôture à la fois", async () => {
    const cookie = await adminConnecte();
    const a = await caisseRattachee(cookie);
    const b = await caisseRattachee(cookie, "ipad-1111aaaa");
    await a.registre.enregistrerVente({ lignes: [CAFE], paiements: [{ mode: "CB", montant: 400 }], operateurId: "u-lea" });
    await b.registre.enregistrerVente({ lignes: [SPRITZ], paiements: [{ mode: "ESPECES", montant: 1100 }], operateurId: "u-lea" });
    await b.registre.journaliser("FOND_DE_CAISSE", { montant: 15000 }, "u-lea");
    expect((await a.synchro()).statut).toBe(200);
    expect((await b.synchro()).statut).toBe(200);

    // Lecture X sur l'iPad : les deux caisses, et le fond déclaré sur l'iPhone.
    const j = await appel("GET", "/api/caisse/journee", undefined, a.bearer);
    expect(j.statut).toBe(200);
    expect(j.corps.fond.details.montant).toBe(15000);
    expect((await a.registre.lectureX("u-lea", j.corps.contexte)).totalTTC).toBe(1500);

    // L'iPhone prend le verrou : l'iPad attend.
    instant += 60_000;
    const v = await appel("POST", "/api/caisse/journee/verrou", undefined, b.bearer);
    expect(v.statut).toBe(200);
    const refus = await appel("POST", "/api/caisse/journee/verrou", undefined, a.bearer);
    expect(refus.statut).toBe(409);
    expect(refus.corps.code).toBe("CLOTURE_EN_COURS");
    const [z] = await b.registre.cloturerJournee("u-lea", v.corps.contexte);
    expect(z).toMatchObject({ totalTTC: 1500, nbVentes: 2 });
    expect((await b.synchro()).statut).toBe(200);
    // Clôture reçue : verrou rendu, l'iPad peut clôturer à son tour (Z à zéro, à la suite de celle de l'iPhone).
    const v2 = await appel("POST", "/api/caisse/journee/verrou", undefined, a.bearer);
    expect(v2.statut).toBe(200);
    expect(v2.corps.fond).toBeNull();
    instant += 60_000;
    await a.registre.enregistrerVente({ lignes: [CAFE], paiements: [{ mode: "CB", montant: 400 }], operateurId: "u-lea" });
    const [z2] = await a.registre.cloturerJournee("u-lea", v2.corps.contexte);
    expect(z2!.etablissement!.precedente).toMatchObject({ caisseId: b.caisseId, numero: z!.numero });
    expect(z2!.totalTTC).toBe(400);
    expect((await a.synchro()).statut).toBe(200);
    expect((await appel("DELETE", "/api/caisse/journee/verrou", undefined, a.bearer)).statut).toBe(200);

    // Contrôle de l'établissement : chaînes et clôtures d'établissement intègres.
    const verif = await appel("GET", "/api/admin/etablissements/moka/verification", undefined, { Cookie: cookie });
    expect(verif.corps).toMatchObject({ integre: true, anomalies: [] });

    // Archive de la Z de l'iPhone : les tickets des deux caisses, avec leurs clés.
    const r = await appel("GET", `/api/caisse/clotures/${b.caisseId}/${z!.numero}/archive.json`, undefined, a.bearer);
    expect(r.statut).toBe(200);
    expect(r.corps.format).toBe("matalon-archive-serveur/2");
    expect(r.corps.autresCaisses.map((p: any) => [p.caisseId, p.tickets.length])).toEqual([[a.caisseId, 1]]);
    const empreintes = Object.fromEntries(
      (await appel("GET", "/api/admin/etablissements", undefined, { Cookie: cookie })).corps.etablissements[0].caisses.map((c: any) => [c.id, c.empreinteCle]),
    );
    expect(await verifierArchiveServeur(r.corps, empreintes)).toEqual({ integre: true, anomalies: [] });
    const modifiee = structuredClone(r.corps);
    modifiee.autresCaisses[0].tickets[0].totalTTC = 1;
    expect((await verifierArchiveServeur(modifiee, empreintes)).integre).toBe(false);
    const amputee = structuredClone(r.corps);
    amputee.autresCaisses = [];
    const { empreinte: _e, ...reste } = amputee;
    amputee.empreinte = await sha256Hex(canonique(reste));
    expect((await verifierArchiveServeur(amputee, empreintes)).anomalies.map((x) => x.code)).toContain("TOTAUX_CLOTURE");
  });

  it("signale deux Z faites depuis la même précédente", async () => {
    const cookie = await adminConnecte();
    const a = await caisseRattachee(cookie);
    const b = await caisseRattachee(cookie, "ipad-1111aaaa");
    await a.registre.enregistrerVente({ lignes: [CAFE], paiements: [{ mode: "CB", montant: 400 }], operateurId: "u-lea" });
    expect((await a.synchro()).statut).toBe(200);
    const ctxB = (await appel("GET", "/api/caisse/journee", undefined, b.bearer)).corps.contexte;
    await a.registre.cloturerJournee("u-lea", (await appel("GET", "/api/caisse/journee", undefined, a.bearer)).corps.contexte);
    expect((await a.synchro()).statut).toBe(200);
    // L'iPhone clôture hors verrou, sur un contexte périmé : sa Z est reçue, l'anomalie est signalée.
    await b.registre.cloturerJournee("u-lea", ctxB);
    expect((await b.synchro()).statut).toBe(200);
    const j = await appel("GET", "/api/caisse/journee", undefined, a.bearer);
    expect(j.corps.anomalie).toMatch(/suit aucune au lieu de ipad-0a1b2c3d#1/);
    const verif = await appel("GET", "/api/admin/etablissements/moka/verification", undefined, { Cookie: cookie });
    expect(verif.corps.integre).toBe(false);
    expect(verif.corps.anomalies.map((x: any) => x.code)).toContain("CHAINAGE_CLOTURES");
  });
});

describe("alertes", () => {
  it("bloque 5 minutes un responsable après 5 codes faux sur la modification de l'équipe", async () => {
    const cookie = await adminConnecte();
    const { rattachement, bearer } = await caisseRattachee(cookie);
    const lea = rattachement.utilisateurs[0]!;
    const essai = (pin: string) => appel("PUT", "/api/caisse/utilisateurs", { utilisateurs: [lea], responsable: { id: lea.id, pin } }, bearer);
    for (let i = 0; i < 4; i++) expect((await essai("0000")).corps.code).toBe("PIN_INCORRECT");
    const bloque = await essai("0000");
    expect(bloque.statut).toBe(429);
    expect((await essai("1234")).corps.code).toBe("PIN_BLOQUE");
    instant += 5 * 60_000 + 1000;
    expect((await essai("1234")).statut).toBe(200);
    const alertes = (await appel("GET", "/api/admin/etablissements/moka/alertes", undefined, { Cookie: cookie })).corps.alertes;
    expect(alertes.map((a: any) => a.type)).toEqual(["PIN_BLOQUE"]);
  });

  it("signale une vente à un autre prix que la carte, un article hors carte et un code PIN bloqué sur une caisse", async () => {
    const cookie = await adminConnecte();
    const { registre, synchro } = await caisseRattachee(cookie);
    // Prix de la carte : cappuccino 4,00 € à 10 %.
    await registre.enregistrerVente({ lignes: [{ ...CAFE, articleId: "cappuccino", prixUnitaireTTC: 400 }], paiements: [{ mode: "CB", montant: 400 }], operateurId: "u-lea" });
    await registre.enregistrerVente({ lignes: [{ ...CAFE, articleId: "cappuccino", prixUnitaireTTC: 100 }], paiements: [{ mode: "CB", montant: 100 }], operateurId: "u-lea" });
    await registre.enregistrerVente({ lignes: [{ ...CAFE, articleId: "fantaisie", libelle: "Fantaisie" }], paiements: [{ mode: "CB", montant: 400 }], operateurId: "u-lea" });
    await registre.journaliser("ANOMALIE", { type: "PIN_BLOQUE", utilisateur: "u-00000002", nom: "Tom", contexte: "connexion", minutes: 5 }, null);
    expect((await synchro()).statut).toBe(200);
    expect((await synchro()).statut).toBe(200); // un renvoi ne double rien
    const r = await appel("GET", "/api/admin/etablissements/moka/alertes", undefined, { Cookie: cookie });
    expect(r.corps.alertes.map((a: any) => a.type).sort()).toEqual(["ARTICLE_HORS_CARTE", "PIN_BLOQUE", "PRIX_DIFFERENT"]);
    const prix = r.corps.alertes.find((a: any) => a.type === "PRIX_DIFFERENT");
    expect(prix.message).toMatch(/Ticket n° 2 : « Cappuccino » vendu 1,00 € au lieu de 4,00 €/);
    expect((await appel("GET", "/api/admin/etablissements", undefined, { Cookie: cookie })).corps.etablissements[0].alertesNonVues).toBe(3);
    expect((await appel("POST", `/api/admin/alertes/${prix.id}/vue`, {}, { Cookie: cookie })).statut).toBe(200);
    expect((await appel("GET", "/api/admin/etablissements/moka/alertes", undefined, { Cookie: cookie })).corps.alertes).toHaveLength(2);
    expect((await appel("GET", "/api/admin/etablissements/moka/alertes?toutes=1", undefined, { Cookie: cookie })).corps.alertes).toHaveLength(3);
    expect((await appel("GET", "/api/admin/etablissements/moka/alertes")).statut).toBe(401);
  });
});

describe("statistiques", () => {
  it("calcule CA, ticket moyen, couverts, heures, articles, serveurs, zones et compare à la période précédente", async () => {
    const cookie = await adminConnecte();
    const a = await caisseRattachee(cookie);
    const b = await caisseRattachee(cookie, "ipad-1111aaaa");
    const lea = a.rattachement.utilisateurs[0]!.id;
    const cap = { ...CAFE, articleId: "cappuccino" };
    // Veille (14 octobre, période précédente) : une vente de 4,00 €.
    instant = Date.parse("2026-10-14T09:00:00Z");
    await a.registre.enregistrerVente({ lignes: [cap], paiements: [{ mode: "CB", montant: 400 }], operateurId: lea });
    // 15 octobre : table 2 (2 couverts, 10 h à Paris), un offert ; comptoir sur l'iPhone à 12 h ; une annulation.
    instant = Date.parse("2026-10-15T08:10:00Z");
    await a.registre.enregistrerVente({
      lignes: [{ ...cap, quantite: 2 }, { ...SPRITZ, remise: { montantTTC: 1100, motif: "Fidélité" } }],
      paiements: [{ mode: "CB", montant: 800 }],
      operateurId: lea,
      tableId: "t2",
      couverts: 2,
    });
    instant = Date.parse("2026-10-15T10:05:00Z");
    await b.registre.enregistrerVente({ lignes: [cap], paiements: [{ mode: "ESPECES", montant: 500 }], operateurId: lea });
    await b.registre.enregistrerVente({ lignes: [{ ...cap, quantite: 3 }], paiements: [{ mode: "CB", montant: 1200 }], operateurId: lea });
    await b.registre.enregistrerAnnulation({ numeroTicket: 2, motif: "Erreur de saisie", operateurId: lea });
    expect((await a.synchro()).statut).toBe(200);
    expect((await b.synchro()).statut).toBe(200);

    const r = await appel("GET", "/api/caisse/statistiques?du=2026-10-15&au=2026-10-15", undefined, a.bearer);
    expect(r.statut).toBe(200);
    const st = r.corps;
    expect(st.precedente).toEqual({ du: "2026-10-14", au: "2026-10-14" });
    expect(st.indicateurs).toMatchObject({ caTTC: 1200, nbVentes: 3, ventesConservees: 2, nbAnnulations: 1, montantAnnule: 1200, ticketMoyen: 600, couverts: 2, parCouvert: 400, offerts: 1100, remises: 0, articles: 4 });
    expect(st.indicateursPrecedents).toMatchObject({ caTTC: 400, nbVentes: 1 });
    expect(st.parHeure[10]).toEqual({ heure: 10, ttc: 800, tickets: 1 });
    expect(st.parHeure[12]).toEqual({ heure: 12, ttc: 400, tickets: 2 });
    expect(st.paiements).toEqual([
      { mode: "CB", montant: 800, tickets: 3 },
      { mode: "ESPECES", montant: 400, tickets: 1 },
    ]);
    expect(st.articles.map((x: any) => [x.libelle, x.quantite, x.ttc, x.detail])).toEqual([
      ["Cappuccino", 3, 1200, "Cafés"],
      ["Spritz Aperol", 1, 0, "Spritz"],
    ]);
    expect(st.zones.map((z: any) => [z.libelle, z.ttc, z.tickets])).toEqual([
      ["Salle", 800, 1],
      ["Comptoir", 400, 2],
    ]);
    expect(st.tables[0]).toMatchObject({ libelle: "Table 2", ttc: 800, couverts: 2 });
    expect(st.serveurs[0]).toMatchObject({ nom: "Léa", ttc: 1200, tickets: 3, annulations: 1, offerts: 1100 });
    expect(st.appareils.map((x: any) => x.ttc).sort()).toEqual([400, 800]);
    expect(st.remisesParMotif[0]).toMatchObject({ libelle: "Offert · Fidélité", ttc: 1100 });
    expect(st.annulationsParMotif[0]).toMatchObject({ libelle: "Erreur de saisie", ttc: 1200, tickets: 1 });
    expect(st.parJour).toEqual([{ jour: "2026-10-15", ttc: 1200, tickets: 3, couverts: 2 }]);
    expect(st.parJourSemaine[3]).toMatchObject({ jour: 3, ttc: 1200, moyenne: 1200 });

    expect((await appel("GET", "/api/caisse/statistiques?du=2026-10-15&au=2026-10-01", undefined, a.bearer)).statut).toBe(400);
    expect((await appel("GET", "/api/caisse/statistiques?du=2025-01-01&au=2026-10-15", undefined, a.bearer)).statut).toBe(400);
    expect((await appel("GET", "/api/admin/etablissements/moka/statistiques?du=2026-10-15&au=2026-10-15", undefined, { Cookie: cookie })).corps.indicateurs.caTTC).toBe(1200);
    expect((await appel("GET", "/api/caisse/statistiques?du=2026-10-15&au=2026-10-15")).statut).toBe(401);
  });
});

describe("cloisonnement entre établissements", () => {
  it("une caisse ne lit ni ne modifie rien d'un autre établissement, même en forgeant les identifiants", async () => {
    const cookie = await adminConnecte();
    const corps = { id: "bao-canteen", identite: { enseigne: "Bao Canteen" }, carteId: "carte-automne-2026", tables: [], seuilNote: 2500 };
    expect((await appel("POST", "/api/admin/etablissements", corps, { Cookie: cookie })).statut).toBe(201);
    const chef = await appel("POST", "/api/admin/etablissements/bao-canteen/utilisateurs", { nom: "Chef", role: "responsable", pin: "4321" }, { Cookie: cookie });
    expect(chef.statut).toBe(200);
    const moka = await caisseRattachee(cookie);
    const bao = await caisseRattachee(cookie, "ipad-2222bbbb", "bao-canteen");
    await bao.registre.enregistrerVente({ lignes: [CAFE], paiements: [{ mode: "CB", montant: 400 }], operateurId: "u-chef" });
    const [z] = await bao.registre.cloturerJournee("u-chef");
    expect((await bao.synchro()).statut).toBe(200);
    const clientBao = { id: "cli-0000abcd", nom: "Client Bao", telephone: "", email: "", actif: true };
    expect((await appel("PUT", "/api/caisse/clients", clientBao, bao.bearer)).statut).toBe(200);
    const userBao = (await appel("GET", "/api/caisse/etat", undefined, bao.bearer)).corps.utilisateurs[0];

    // Lectures : le ticket, l'archive, les listes et la journée de Bao restent invisibles depuis le Moka.
    expect((await appel("GET", `/api/caisse/tickets/${bao.caisseId}/1`, undefined, moka.bearer)).statut).toBe(404);
    expect((await appel("GET", `/api/caisse/clotures/${bao.caisseId}/${z!.numero}/archive.json`, undefined, moka.bearer)).statut).toBe(404);
    const tickets = await appel("GET", "/api/caisse/tickets", undefined, moka.bearer);
    expect(tickets.corps.tickets).toEqual([]);
    expect(Object.keys(tickets.corps.appareils)).toEqual([moka.caisseId]);
    expect((await appel("GET", "/api/caisse/clotures", undefined, moka.bearer)).corps.clotures).toEqual([]);
    const journee = (await appel("GET", "/api/caisse/journee", undefined, moka.bearer)).corps;
    expect(journee.contexte.clotures).toEqual([]);
    expect(journee.contexte.caisses).toEqual([]);
    const etat = (await appel("GET", "/api/caisse/etat", undefined, moka.bearer)).corps;
    expect(etat.clients.map((c: any) => c.id)).not.toContain(clientBao.id);
    expect(etat.utilisateurs.map((u: any) => u.id)).not.toContain(userBao.id);

    // Écritures : client et équipe de Bao refusés ; enregistrement de la caisse Bao poussé par le Moka refusé.
    expect((await appel("PUT", "/api/caisse/clients", { ...clientBao, nom: "Pirate" }, moka.bearer)).statut).toBe(403);
    expect((await appel("PUT", "/api/caisse/utilisateurs", { utilisateurs: [{ ...userBao, role: "responsable", pinHash: "0".repeat(64) }] }, moka.bearer)).statut).toBe(403);
    // Même avec le code du responsable de Bao : il n'est pas de l'établissement de la caisse.
    expect((await appel("PUT", "/api/caisse/utilisateurs", { utilisateurs: [], responsable: { id: userBao.id, pin: "4321" } }, moka.bearer)).statut).toBe(403);
    const ticketBao = (await bao.stockage.lister("tickets"))[0];
    expect((await appel("POST", "/api/caisse/synchro", { lot: [{ chaine: "tickets", enregistrement: ticketBao }] }, moka.bearer)).statut).toBe(409);
    expect((await appel("GET", `/api/caisse/tickets/${bao.caisseId}/1`, undefined, bao.bearer)).statut).toBe(200);

    // Sans session : ni API caisse ni administration.
    expect((await appel("GET", "/api/caisse/journee")).statut).toBe(401);
    expect((await appel("GET", "/api/admin/etablissements/bao-canteen/verification")).statut).toBe(401);
    expect((await appel("GET", `/api/admin/caisses/${bao.caisseId}/journal.json`)).statut).toBe(401);
    expect((await appel("POST", "/api/caisse/journee/verrou", undefined, { Authorization: "Bearer faux" })).statut).toBe(401);
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

describe("stock et fiches techniques", () => {
  const tableur = [
    ["Produit", "Unité", "Famille", "Zone", "Fournisseur", "Référence", "Conditionnement", "Quantité", "Prix HT"],
    ["Lait entier", "L", "Crèmerie", "Chambre froide", "Metro", "42", "Pack 6 x 1 L", "6", "7,20"],
    ["Café en grains", "kg", "Épicerie", "Réserve", "Torréfacteur", "", "Sac 1 kg", "1", "24,00"],
    ["Farine", "sac", "", "", "", "", "", "", ""],
  ];

  it("importe des produits, chiffre une recette, relie la carte et calcule les ventes par article", async () => {
    const cookie = await adminConnecte();
    const a = await caisseRattachee(cookie);
    const vide = await appel("GET", "/api/admin/stock", undefined, { Cookie: cookie });
    expect(vide.corps.referentiel).toEqual({ produits: [], articles: [], recettes: [] });
    expect(vide.corps.etablissements).toEqual([{ id: "moka", enseigne: "Moka", carteId: "carte-automne-2026" }]);
    // Sans session administrateur : refusé ; une caisse non plus.
    expect((await appel("GET", "/api/admin/stock")).statut).toBe(401);

    // Simulation : rapport sans écriture.
    const sim = await appel("POST", "/api/admin/stock/import", { etablissementId: "moka", tableau: tableur, simuler: true }, { Cookie: cookie });
    expect(sim.corps.rapport).toMatchObject({ produitsCrees: ["Lait entier", "Café en grains"], articlesCrees: 2, prixEnregistres: 2 });
    expect(sim.corps.rapport.erreurs).toEqual([{ ligne: 4, message: "« Farine » : unité « sac » inconnue (kg, L ou pièce)" }]);
    expect(sim.corps.stock).toBeUndefined();
    expect((await appel("GET", "/api/admin/stock", undefined, { Cookie: cookie })).corps.version).toBe(1);

    const imp = await appel("POST", "/api/admin/stock/import", { etablissementId: "moka", tableau: tableur }, { Cookie: cookie });
    expect(imp.statut).toBe(200);
    const stock = imp.corps.stock;
    expect(stock.version).toBe(2);
    expect(stock.referentiel.produits.map((p: any) => [p.id, p.unite])).toEqual([
      ["lait-entier", "L"],
      ["cafe-en-grains", "kg"],
    ]);
    expect(stock.prix).toHaveLength(2);
    // Réimport identique : rien de nouveau, aucun doublon.
    const re = await appel("POST", "/api/admin/stock/import", { etablissementId: "moka", tableau: tableur }, { Cookie: cookie });
    expect(re.corps.rapport).toMatchObject({ produitsCrees: [], articlesCrees: 0, prixEnregistres: 0 });
    expect(re.corps.stock.referentiel.produits).toHaveLength(2);

    // Un doublon saisi à la main est refusé (accents et casse ignorés).
    const doublon = await appel("PUT", "/api/admin/stock/produits/lait", { produit: { id: "lait", nom: "LAIT ENTIER", unite: "L" } }, { Cookie: cookie });
    expect(doublon.statut).toBe(400);
    expect(doublon.corps.message).toMatch(/existe déjà/);
    expect((await appel("PUT", "/api/admin/stock/produits/autre", { produit: { id: "lait-entier", nom: "Lait", unite: "L" } }, { Cookie: cookie })).statut).toBe(400);

    // Recette : cappuccino = 18 g de café, 150 mL de lait (10 % de perte à la mousse).
    const recette = {
      id: "cappuccino",
      nom: "Cappuccino",
      unite: "piece",
      rendement: 1000,
      lignes: [
        { type: "produit", id: "cafe-en-grains", quantite: { valeur: 18, unite: "g" } },
        { type: "produit", id: "lait-entier", quantite: { valeur: 150, unite: "mL" }, perte: 1000 },
      ],
    };
    const r = await appel("PUT", "/api/admin/stock/recettes/cappuccino", { recette }, { Cookie: cookie });
    expect(r.statut).toBe(200);
    // Une recette qui se contient elle-même est refusée.
    const cycle = await appel("PUT", "/api/admin/stock/recettes/cappuccino", { recette: { ...recette, lignes: [...recette.lignes, { type: "recette", id: "cappuccino", quantite: { valeur: 1000, unite: "piece" } }] } }, { Cookie: cookie });
    expect(cycle.statut).toBe(400);
    expect(cycle.corps.message).toMatch(/se contient elle-même/);
    // Lait en grammes : inconvertible.
    const unite = await appel("PUT", "/api/admin/stock/recettes/latte", { recette: { ...recette, id: "latte", nom: "Latte", lignes: [{ type: "produit", id: "lait-entier", quantite: { valeur: 200, unite: "g" } }] } }, { Cookie: cookie });
    expect(unite.corps.message).toMatch(/Lait entier/);

    // Nouveau prix saisi : l'historique garde l'ancien, le dernier fait foi.
    instant += 60_000;
    const lait = stock.referentiel.articles.find((x: any) => x.produitId === "lait-entier").id;
    const p = await appel("POST", "/api/admin/stock/prix", { articleId: lait, etablissementId: "moka", prixHT: 750 }, { Cookie: cookie });
    expect(p.corps.prix.find((x: any) => x.articleId === lait).prixHT).toBe(750);
    const hist = await appel("GET", `/api/admin/stock/prix/${lait}`, undefined, { Cookie: cookie });
    expect(hist.corps.prix.map((x: any) => [x.prixHT, x.source])).toEqual([
      [750, "saisie"],
      [720, "import"],
    ]);
    await expect(db.requete("delete from prix_achats")).rejects.toThrow(/ajout seul/);

    // Carte : le cappuccino pointe vers sa fiche ; une fiche inconnue est refusée.
    const lue = (await appel("GET", "/api/admin/cartes/carte-automne-2026", undefined, { Cookie: cookie })).corps;
    const article = lue.carte.categories.flatMap((c: any) => c.articles).find((x: any) => x.id === "cappuccino");
    article.fiche = { type: "recette", id: "inconnue", quantite: { valeur: 1000, unite: "piece" } };
    const refus = await appel("PUT", "/api/admin/cartes/carte-automne-2026", { carte: lue.carte, version: lue.version }, { Cookie: cookie });
    expect(refus.statut).toBe(400);
    expect(refus.corps.message).toMatch(/fiche technique introuvable pour Cappuccino/);
    article.fiche.id = "cappuccino";
    const ok = await appel("PUT", "/api/admin/cartes/carte-automne-2026", { carte: lue.carte, version: lue.version }, { Cookie: cookie });
    expect(ok.statut).toBe(200);
    // La caisse reçoit la carte avec sa fiche, sans en dépendre.
    expect((await appel("GET", "/api/caisse/carte", undefined, a.bearer)).corps.carte.categories.flatMap((c: any) => c.articles).find((x: any) => x.id === "cappuccino").fiche.id).toBe("cappuccino");

    // Ventes des 30 derniers jours par article : pondèrent la part du CA couverte par des fiches.
    const lea = a.rattachement.utilisateurs[0]!.id;
    await a.registre.enregistrerVente({ lignes: [{ ...CAFE, quantite: 2 }, SPRITZ], paiements: [{ mode: "CB", montant: 1900 }], operateurId: lea });
    expect((await a.synchro()).statut).toBe(200);
    const ventes = await appel("GET", "/api/admin/cartes/carte-automne-2026/ventes", undefined, { Cookie: cookie });
    expect(ventes.corps).toEqual({ jours: 30, parCle: { cappuccino: 800, "spritz-aperol": 1100 }, total: 1900 });
  });
});

describe("stock : consommation, pièces, food cost, factures", () => {
  it("décompte les ventes, reçoit, inventorie, perd, transfère, chiffre le food cost et prend les prix des factures", async () => {
    const cookie = await adminConnecte();
    const admin = { Cookie: cookie };
    const a = await caisseRattachee(cookie);
    const lea = a.rattachement.utilisateurs[0]!.id;
    expect((await appel("POST", "/api/admin/etablissements", { id: "chardon", identite: { enseigne: "Chardon" }, carteId: "carte-automne-2026", tables: [], seuilNote: 2500 }, admin)).statut).toBe(201);
    const tableau = [
      ["produit", "unite", "famille", "zone", "fournisseur", "reference", "conditionnement", "quantite", "prix_ht"],
      ["Lait entier", "L", "Crèmerie", "Froid", "Metro", "42", "Pack 6 x 1 L", "6", "7,20"],
      ["Café en grains", "kg", "Épicerie", "Réserve", "Torréfacteur", "C1", "Sac 1 kg", "1", "24,00"],
    ];
    expect((await appel("POST", "/api/admin/stock/import", { etablissementId: "moka", tableau }, admin)).statut).toBe(200);
    // Cappuccino : 18 g de café, 150 mL de lait.
    const recette = { id: "cappuccino", nom: "Cappuccino", unite: "piece", rendement: 1000, lignes: [{ type: "produit", id: "cafe-en-grains", quantite: { valeur: 18, unite: "g" } }, { type: "produit", id: "lait-entier", quantite: { valeur: 150, unite: "mL" } }] };
    expect((await appel("PUT", "/api/admin/stock/recettes/cappuccino", { recette }, admin)).statut).toBe(200);
    const lue = (await appel("GET", "/api/admin/cartes/carte-automne-2026", undefined, admin)).corps;
    lue.carte.categories.flatMap((c: any) => c.articles).find((x: any) => x.id === "cappuccino").fiche = { type: "recette", id: "cappuccino", quantite: { valeur: 1000, unite: "piece" } };
    expect((await appel("PUT", "/api/admin/cartes/carte-automne-2026", { carte: lue.carte, version: lue.version }, admin)).statut).toBe(200);

    // ── 4b : 3 cappuccinos vendus, une vente d'un annulée ; le spritz n'a pas de fiche ──
    instant = Date.parse("2026-10-15T09:00:00Z");
    await a.registre.enregistrerVente({ lignes: [{ ...CAFE, quantite: 2 }, SPRITZ], paiements: [{ mode: "CB", montant: 1900 }], operateurId: lea });
    await a.registre.enregistrerVente({ lignes: [CAFE], paiements: [{ mode: "CB", montant: 400 }], operateurId: lea });
    await a.registre.enregistrerAnnulation({ numeroTicket: 2, motif: "Erreur de saisie", operateurId: lea });
    expect((await a.synchro()).statut).toBe(200);
    let etat = (await appel("GET", "/api/admin/stock/etat?etab=moka", undefined, admin)).corps;
    const q = (pid: string) => etat.produits.find((p: any) => p.produitId === pid);
    expect(q("cafe-en-grains").quantite).toBe(-36);
    expect(q("lait-entier").quantite).toBe(-300);
    // 36 g de café à 24 €/kg = 0,864 € ; 300 mL de lait à 1,20 €/L = 0,36 €.
    expect(q("cafe-en-grains").valeurMicro).toBe(-864_000);
    // Recalcul : idempotent.
    expect((await appel("POST", "/api/admin/stock/consommation", { etablissementId: "moka", du: "2026-10-15", au: "2026-10-15" }, admin)).corps.mouvements).toBe(0);

    // ── 4c : réception sur la caisse par un responsable (2 sacs de café à 23,50 €), refusée à un inconnu ──
    const cafe = (await appel("GET", "/api/caisse/stock", undefined, a.bearer)).corps;
    expect(cafe.referentiel.produits).toHaveLength(2);
    const sac = cafe.referentiel.articles.find((x: any) => x.produitId === "cafe-en-grains").id;
    expect((await appel("POST", "/api/caisse/stock/receptions", { utilisateurId: "personne", fournisseur: "Torréfacteur", lignes: [{ articleId: sac, nombre: 2000, prixHT: 2350 }] }, a.bearer)).statut).toBe(403);
    instant += 60_000;
    const rx = await appel("POST", "/api/caisse/stock/receptions", { utilisateurId: lea, fournisseur: "Torréfacteur", numero: "BL-1", lignes: [{ articleId: sac, nombre: 2000, prixHT: 2350 }] }, a.bearer);
    expect(rx.statut).toBe(201);
    expect(rx.corps.document).toMatchObject({ type: "reception", par: "Comptoir · Léa", contenu: { totalHT: 4700 } });
    etat = rx.corps.etat;
    expect(q("cafe-en-grains").quantite).toBe(2000 - 36);
    // Le prix reçu devient le dernier prix payé.
    expect((await appel("GET", "/api/admin/stock", undefined, admin)).corps.prix.find((p: any) => p.articleId === sac).prixHT).toBe(2350);

    // Inventaire de la réserve : 1,9 kg de café comptés (théorique 1 964 g) → écart de −64 g.
    instant += 60_000;
    const inv = await appel("POST", "/api/caisse/stock/inventaires", { utilisateurId: lea, zone: "Réserve", lignes: [{ produitId: "cafe-en-grains", compte: 1900 }] }, a.bearer);
    expect(inv.statut).toBe(201);
    // Premier inventaire du produit : l'écart est le stock d'ouverture, hors food cost.
    expect(inv.corps.document.contenu.lignes[0]).toMatchObject({ compte: 1900, theorique: 1964, ecart: -64, ouverture: true });
    etat = inv.corps.etat;
    expect(q("cafe-en-grains").quantite).toBe(1900);
    // Second inventaire : 1 850 g comptés, l'écart de −50 g est une vraie perte inexpliquée.
    instant += 60_000;
    const inv2 = await appel("POST", "/api/caisse/stock/inventaires", { utilisateurId: lea, zone: "Réserve", lignes: [{ produitId: "cafe-en-grains", compte: 1850 }] }, a.bearer);
    expect(inv2.corps.document.contenu.lignes[0]).toMatchObject({ ecart: -50 });
    expect(inv2.corps.document.contenu.lignes[0].ouverture).toBeUndefined();
    etat = inv2.corps.etat;
    expect(q("lait-entier").quantite).toBe(-300);

    // Perte (administration) : un cappuccino raté, décomposé ; motif obligatoire et connu.
    expect((await appel("POST", "/api/admin/stock/pertes", { etablissementId: "moka", motif: "N'importe", lignes: [{ type: "recette", id: "cappuccino", quantite: { valeur: 1000, unite: "piece" } }] }, admin)).statut).toBe(400);
    const pe = await appel("POST", "/api/admin/stock/pertes", { etablissementId: "moka", motif: "Erreur de préparation", lignes: [{ type: "recette", id: "cappuccino", quantite: { valeur: 1000, unite: "piece" } }] }, admin);
    expect(pe.statut).toBe(201);
    etat = pe.corps.etat;
    expect(q("cafe-en-grains").quantite).toBe(1832);

    // Transfert de 500 g de café au Chardon.
    const tr = await appel("POST", "/api/admin/stock/transferts", { etablissementId: "moka", vers: "chardon", lignes: [{ produitId: "cafe-en-grains", quantite: 500 }] }, admin);
    expect(tr.statut).toBe(201);
    expect((await appel("GET", "/api/admin/stock/etat?etab=chardon", undefined, admin)).corps.produits.find((p: any) => p.produitId === "cafe-en-grains").quantite).toBe(500);

    // Annulation de la réception : les 2 kg ressortent ; une seconde annulation est refusée.
    const id = rx.corps.document.id;
    expect((await appel("POST", `/api/admin/stock/receptions/${id}/annuler`, { etablissementId: "moka" }, admin)).statut).toBe(200);
    expect((await appel("POST", `/api/admin/stock/receptions/${id}/annuler`, { etablissementId: "moka" }, admin)).statut).toBe(409);
    await expect(db.requete("update stock_mouvements set quantite = 0")).rejects.toThrow(/ajout seul/);

    // ── 4d : food cost du 15 octobre ──
    const fc = (await appel("GET", "/api/admin/stock/food-cost?etab=moka&du=2026-10-15&au=2026-10-15", undefined, admin)).corps;
    // CA HT : 2 cappuccinos (8,00 € TTC → 7,27 € HT) + spritz (11,00 € à 20 % → 9,17 € HT) ; la vente annulée se compense.
    expect(fc.caHT).toBe(727 + 917);
    // Théorique : 2 cappuccinos = 36 g de café (0,864 €) + 300 mL de lait (0,36 €).
    expect(fc.theoriqueMicro).toBe(864_000 + 360_000);
    expect(fc.foodCostTheorique).toBe(Math.round(1_224_000 / 1644));
    expect(fc.ecartsMicro).toBeGreaterThan(0);
    expect(fc.pertesMicro).toBeGreaterThan(0);
    expect(fc.foodCostReel).toBeGreaterThan(fc.foodCostTheorique);
    expect(fc.parArticle.map((x: any) => [x.cle, x.quantite])).toEqual([["cappuccino", 2]]);
    expect(fc.sansFiche.articles.map((x: any) => x.cle)).toEqual(["spritz-aperol"]);
    expect(fc.ecartsProduits[0]).toMatchObject({ produitId: "cafe-en-grains", quantite: -50 });
    expect(fc.ouvertureMicro).toBeLessThan(0);

    // ── 4d : agent de factures ──
    expect((await appel("POST", "/api/stock/factures", { etablissementId: "moka" })).statut).toBe(401);
    const cle = (await appel("POST", "/api/admin/stock/cles", { nom: "Agent de factures" }, admin)).corps;
    expect(cle.cle).toMatch(/^mpk_[a-z0-9]{40}$/);
    const agent = { Authorization: `Bearer ${cle.cle}` };
    const facture = {
      etablissementId: "moka",
      fournisseur: "METRO",
      numero: "F-2026-118",
      date: "2026-10-16",
      lignes: [
        { reference: "42", designation: "LAIT ENTIER UHT 6X1L", prixUnitaireHT: 744 },
        { designation: "CREME LIQ 35% 1L", prixUnitaireHT: 395 },
      ],
    };
    expect((await appel("POST", "/api/stock/factures", facture, agent)).corps).toEqual({ rapprochees: 1, aRapprocher: 1, dejaRecues: 0 });
    expect((await appel("POST", "/api/stock/factures", facture, agent)).corps).toEqual({ rapprochees: 0, aRapprocher: 0, dejaRecues: 2 });
    const stock = (await appel("GET", "/api/admin/stock", undefined, admin)).corps;
    const pack = stock.referentiel.articles.find((x: any) => x.produitId === "lait-entier").id;
    expect(stock.prix.find((p: any) => p.articleId === pack)).toMatchObject({ prixHT: 744, source: "facture" });
    // La crème n'est pas encore un article : on le crée, on rapproche ; la facture suivante est reconnue seule.
    await appel("PUT", "/api/admin/stock/produits/creme", { produit: { id: "creme", nom: "Crème 35 %", unite: "L" } }, admin);
    await appel("PUT", "/api/admin/stock/articles/creme-metro", { article: { id: "creme-metro", produitId: "creme", fournisseur: "Metro", conditionnement: "Brique 1 L", quantite: 1000 } }, admin);
    const attente = (await appel("GET", "/api/admin/stock/factures?etab=moka", undefined, admin)).corps.lignes;
    expect(attente.map((l: any) => l.designation)).toEqual(["CREME LIQ 35% 1L"]);
    expect((await appel("POST", `/api/admin/stock/factures/${attente[0].id}/rapprocher`, { articleId: "creme-metro" }, admin)).statut).toBe(200);
    const suivante = await appel("POST", "/api/stock/factures", { ...facture, numero: "F-2026-131", lignes: [{ designation: "Crème liq 35 % 1 L".toUpperCase().replace(/ /g, " "), prixUnitaireHT: 405 }, { designation: "CREME LIQ 35% 1L", prixUnitaireHT: 410 }] }, agent);
    expect(suivante.corps.rapprochees).toBeGreaterThanOrEqual(1);
    expect((await appel("GET", "/api/admin/stock", undefined, admin)).corps.prix.find((p: any) => p.articleId === "creme-metro").prixHT).toBe(410);
    await appel("POST", `/api/admin/stock/cles/${cle.id}/revoquer`, {}, admin);
    expect((await appel("POST", "/api/stock/factures", facture, agent)).statut).toBe(401);
  });
});
