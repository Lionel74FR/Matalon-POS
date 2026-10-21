import { PGlite } from "@electric-sql/pglite";
import { genererPaireCles, Registre, signataireDepuis, StockageMemoire, type Chaine, type SaisieLigne } from "@matalon/noyau-fiscal";
import { beforeEach, describe, expect, it } from "vitest";
import { normaliserTelephone, pointsDuTicket, problemeRegles, reglesParDefaut, type ReglesFidelite } from "../src/fidelite.js";
import { traiter, type Db } from "../src/index.js";
import type { EntreeSynchro, ReponseRattachement } from "../src/partage.js";
import type { Courriel } from "../src/reservations-serveur.js";
import { _oublierMigration } from "../src/schema.js";
import { codeTotp } from "../src/securite.js";

const CAFE: SaisieLigne = { articleId: "cappuccino", libelle: "Cappuccino", quantite: 1, prixUnitaireTTC: 400, tauxTVA: 1000 };
const SPRITZ: SaisieLigne = { articleId: "spritz-aperol", libelle: "Spritz Aperol", quantite: 1, prixUnitaireTTC: 1100, tauxTVA: 2000 };

let pg: PGlite;
let db: Db;
let instant: number;
let courriels: Courriel[];
const env = () => ({ db, maintenant: () => new Date(instant), envoyerCourriel: async (c: Courriel) => void courriels.push(c), envoiGroupe: true });

async function appel(methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}) {
  const r = await traiter(
    new Request(`https://pos.test${chemin}`, {
      method: methode,
      headers: { "Content-Type": "application/json", Origin: "https://pos.test", ...entetes },
      body: corps === undefined ? undefined : JSON.stringify(corps),
    }),
    env(),
  );
  return { statut: r.status, corps: (await r.json()) as any };
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
  courriels = [];
});

async function preparer() {
  const init = await appel("POST", "/api/admin/initialiser", { identifiant: "lionel", motDePasse: "un-mot-de-passe-solide" });
  const conf = await traiter(
    new Request("https://pos.test/api/admin/confirmer", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://pos.test" },
      body: JSON.stringify({ identifiant: "lionel", motDePasse: "un-mot-de-passe-solide", code: await codeTotp(init.corps.secret, instant) }),
    }),
    env(),
  );
  const admin = { Cookie: conf.headers.get("Set-Cookie")!.split(";")[0]! };
  await appel("POST", "/api/admin/etablissements/moka/utilisateurs", { nom: "Léa", role: "responsable", pin: "1234" }, admin);
  const code = await appel("POST", "/api/admin/etablissements/moka/codes", { nomCaisse: "Comptoir" }, admin);
  const paire = await genererPaireCles("ipad-0a1b2c3d-k1");
  const r = await appel("POST", "/api/caisse/rattacher", {
    code: code.corps.code.toLowerCase().replace(/(.{4})/, "$1-"),
    caisseId: "ipad-0a1b2c3d",
    cleId: paire.cleId,
    clePubliqueJwk: paire.clePubliqueJwk,
    appareil: "iPad test",
  });
  const rattachement = r.corps as ReponseRattachement;
  const stockage = new StockageMemoire();
  const registre = new Registre({ stockage, signataire: signataireDepuis(paire), contexte: { etablissementId: "moka", caisseId: "ipad-0a1b2c3d" }, horloge: () => new Date(instant) });
  const bearer = { Authorization: `Bearer ${rattachement.jeton}` };
  const envoyes: Record<Chaine, number> = { tickets: 0, evenements: 0, clotures: 0 };
  const synchro = async () => {
    const lot: EntreeSynchro[] = [];
    for (const chaine of ["tickets", "evenements", "clotures"] as Chaine[]) {
      for (const e of await stockage.lister(chaine, envoyes[chaine] + 1)) lot.push({ chaine, enregistrement: e });
    }
    const s = await appel("POST", "/api/caisse/synchro", { lot }, bearer);
    expect(s.statut).toBe(200);
    for (const e of lot) envoyes[e.chaine] = Math.max(envoyes[e.chaine], e.enregistrement.numero);
  };
  return { admin, registre, bearer, synchro };
}

/** Règles d'essai : 1 point par euro, spritz exclus, un cappuccino à 10 points, 10 € à 30 points, 5 de bienvenue. */
const REGLES: ReglesFidelite = {
  ...reglesParDefaut(),
  categoriesExclues: ["spritz"],
  recompenses: [
    { id: "r-cafe", libelle: "Un cappuccino offert", seuil: 10, type: "ARTICLE", articles: ["cappuccino"] },
    { id: "r-10", libelle: "10 € offerts", seuil: 30, type: "REMISE_EUROS", montant: 1000 },
  ],
  bienvenue: 5,
};

async function programmeActif(admin: Record<string, string>) {
  const cree = await appel("POST", "/api/admin/etablissements/moka/fidelite", { action: "creer" }, admin);
  expect(cree.statut).toBe(201);
  const p = cree.corps.programme;
  const maj = await appel("PUT", `/api/admin/fidelite/${p.id}`, { nom: "Club Moka", actif: true, regles: REGLES, version: p.version }, admin);
  expect(maj.statut).toBe(200);
  return maj.corps.programme;
}

describe("fidélité : règles et téléphone", () => {
  it("ramène les numéros à une forme unique", () => {
    expect(normaliserTelephone("06 12 34 56 78")).toBe("+33612345678");
    expect(normaliserTelephone("+33 6.12.34.56.78")).toBe("+33612345678");
    expect(normaliserTelephone("0033612345678")).toBe("+33612345678");
    expect(normaliserTelephone("+41 79 123 45 67")).toBe("+41791234567");
    expect(normaliserTelephone("1234")).toBeNull();
  });

  it("contrôle les règles et calcule les points d'une vente", () => {
    expect(problemeRegles(REGLES)).toBeNull();
    expect(problemeRegles({ ...REGLES, recompenses: [] })).toBe("Ajoutez au moins une récompense.");
    expect(problemeRegles({ ...REGLES, pointsParEuro: 0 })).toMatch(/Points par euro/);
    expect(problemeRegles({ ...REGLES, recompenses: [{ id: "x", libelle: "Offert", seuil: 5, type: "ARTICLE", articles: [] }] })).toMatch(/article offert/);
    const cat = (a: string) => (a === "spritz-aperol" ? "spritz" : "cafes");
    const lignes = [
      { articleId: "cappuccino", libelle: "", quantite: 2, prixUnitaireTTC: 400, tauxTVA: 1000, remiseTTC: 0, motifRemise: null, montantTTC: 800 },
      { articleId: "cappuccino", libelle: "", quantite: 1, prixUnitaireTTC: 400, tauxTVA: 1000, remiseTTC: 400, motifRemise: "Fidélité", montantTTC: 0 },
      { articleId: "spritz-aperol", libelle: "", quantite: 1, prixUnitaireTTC: 1100, tauxTVA: 2000, remiseTTC: 0, motifRemise: null, montantTTC: 1100 },
    ];
    expect(pointsDuTicket(REGLES, { type: "VENTE", lignes }, cat, null)).toBe(8);
    expect(pointsDuTicket({ ...REGLES, momentsDoubles: ["m-matin"] }, { type: "VENTE", lignes }, cat, "m-matin")).toBe(16);
    expect(pointsDuTicket({ ...REGLES, plafondParTicket: 5 }, { type: "VENTE", lignes }, cat, null)).toBe(5);
    const tampons: ReglesFidelite = { ...REGLES, mode: "TAMPONS", tampon: { par: "ARTICLE", categories: ["cafes"] }, categoriesExclues: [] };
    expect(pointsDuTicket(tampons, { type: "VENTE", lignes }, cat, null)).toBe(2);
    expect(pointsDuTicket({ ...tampons, tampon: { par: "VISITE", montantMin: 1500 } }, { type: "VENTE", lignes }, cat, null)).toBe(1);
  });
});

describe("fidélité : programme, inscription, cumul et récompenses", () => {
  it("crée le programme inactif, le règle par version, puis inscrit un client par son téléphone", async () => {
    const { admin, bearer } = await preparer();
    const cree = await appel("POST", "/api/admin/etablissements/moka/fidelite", { action: "creer" }, admin);
    expect(cree.corps.programme).toMatchObject({ nom: "Club Moka", actif: false, version: 1, proprietaire: "moka", membres: 0 });
    expect((await appel("POST", "/api/admin/etablissements/moka/fidelite", { action: "creer" }, admin)).corps.code).toBe("DEJA_PROGRAMME");
    expect((await appel("GET", "/api/caisse/fidelite", undefined, bearer)).corps.code).toBe("PROGRAMME_INACTIF");
    const id = cree.corps.programme.id;
    expect((await appel("PUT", `/api/admin/fidelite/${id}`, { nom: "Club Moka", actif: true, regles: { ...REGLES, recompenses: [] }, version: 1 }, admin)).corps.code).toBe("REGLES_INVALIDES");
    expect((await appel("PUT", `/api/admin/fidelite/${id}`, { nom: "Club Moka", actif: true, regles: REGLES, version: 1 }, admin)).corps.programme.version).toBe(2);
    expect((await appel("PUT", `/api/admin/fidelite/${id}`, { nom: "Club Moka", actif: true, regles: REGLES, version: 1 }, admin)).corps.code).toBe("VERSION");

    const etat = await appel("GET", "/api/caisse/etat", undefined, bearer);
    expect(etat.corps.fidelite).toMatchObject({ id, nom: "Club Moka", actif: true });

    const inscrit = await appel("POST", "/api/caisse/fidelite/membres", { telephone: "06 12 34 56 78", prenom: "Marie", email: "Marie@Exemple.fr", offres: false }, bearer);
    expect(inscrit.statut).toBe(201);
    expect(inscrit.corps.membre).toMatchObject({ telephone: "+33612345678", prenom: "Marie", email: "marie@exemple.fr", offres: false, solde: 5 });
    expect(courriels.map((c) => [c.a, c.sujet])).toEqual([["marie@exemple.fr", "Bienvenue au programme Club Moka"]]);
    expect(courriels[0]!.texte).toMatch(/Votre solde : 5 points\.[\s\S]*Prochaine récompense : Un cappuccino offert, à 10 points\./);
    const encore = await appel("POST", "/api/caisse/fidelite/membres", { telephone: "+33 6 12 34 56 78", prenom: "Marie" }, bearer);
    expect([encore.statut, encore.corps.cree, encore.corps.membre.id]).toEqual([200, false, inscrit.corps.membre.id]);
    expect((await appel("POST", "/api/caisse/fidelite/membres", { telephone: "12", prenom: "X" }, bearer)).corps.code).toBe("TELEPHONE_INVALIDE");
    const lu = await appel("GET", "/api/caisse/fidelite?telephone=0612345678", undefined, bearer);
    expect(lu.corps.membre).toMatchObject({ prenom: "Marie", solde: 5 });
    expect((await appel("GET", "/api/caisse/fidelite?telephone=0699999999", undefined, bearer)).corps.membre).toBeNull();
  });

  it("crédite les ventes reçues (lien avant ou après le ticket), applique une récompense réservée et la reprend si la vente est annulée", async () => {
    const { admin, registre, bearer, synchro } = await preparer();
    await programmeActif(admin);
    const marie = (await appel("POST", "/api/caisse/fidelite/membres", { telephone: "0612345678", prenom: "Marie", email: "marie@exemple.fr" }, bearer)).corps.membre;
    courriels = [];

    // Vente 1 : deux cappuccinos et un spritz (exclu) → 8 points ; le lien suit le ticket.
    await registre.enregistrerVente({ lignes: [{ ...CAFE, quantite: 2 }, SPRITZ], paiements: [{ mode: "CB", montant: 1900 }], operateurId: "u-lea" });
    await synchro();
    expect((await appel("POST", "/api/caisse/fidelite/liens", { liens: [{ caisseId: "ipad-0a1b2c3d", numero: 1, membreId: marie.id, utilisations: [] }] }, bearer)).corps.acceptes).toBe(1);
    const solde = async () => (await appel("GET", "/api/caisse/fidelite?telephone=0612345678", undefined, bearer)).corps.membre.solde;
    expect(await solde()).toBe(13);
    expect(courriels.map((c) => c.sujet)).toEqual(["Une récompense vous attend chez Moka"]);
    expect(courriels[0]!.texte).toMatch(/13 points : « Un cappuccino offert » vous attend/);

    // Vente 2, hors ligne : le lien (par téléphone) part avant le ticket ; le gain vient à la synchronisation.
    await registre.enregistrerVente({ lignes: [CAFE], paiements: [{ mode: "ESPECES", montant: 400 }], operateurId: "u-lea" });
    await appel("POST", "/api/caisse/fidelite/liens", { liens: [{ caisseId: "ipad-0a1b2c3d", numero: 2, telephone: "06 12 34 56 78", utilisations: [] }] }, bearer);
    expect(await solde()).toBe(13);
    await synchro();
    expect(await solde()).toBe(17);
    // Un lien renvoyé (coupure réseau) ne compte pas deux fois.
    await appel("POST", "/api/caisse/fidelite/liens", { liens: [{ caisseId: "ipad-0a1b2c3d", numero: 2, membreId: marie.id, utilisations: [] }] }, bearer);
    await synchro();
    expect(await solde()).toBe(17);

    // Récompense : réservée en ligne (le solde baisse), puis appliquée en remise « Fidélité ».
    const u = await appel("POST", "/api/caisse/fidelite/utilisations", { membreId: marie.id, recompenseId: "r-cafe" }, bearer);
    expect(u.statut).toBe(201);
    expect(u.corps).toMatchObject({ solde: 7, utilisation: { recompenseId: "r-cafe", libelle: "Un cappuccino offert", points: 10 } });
    expect((await appel("POST", "/api/caisse/fidelite/utilisations", { membreId: marie.id, recompenseId: "r-10" }, bearer)).corps.code).toBe("SOLDE_INSUFFISANT");
    await registre.enregistrerVente({ lignes: [CAFE, { ...CAFE, remise: { montantTTC: 400, motif: "Fidélité" } }], paiements: [{ mode: "CB", montant: 400 }], operateurId: "u-lea" });
    await synchro();
    await appel("POST", "/api/caisse/fidelite/liens", { liens: [{ caisseId: "ipad-0a1b2c3d", numero: 3, membreId: marie.id, utilisations: [u.corps.utilisation.id] }] }, bearer);
    expect(await solde()).toBe(11); // le cappuccino offert ne rapporte rien
    expect((await appel("POST", `/api/caisse/fidelite/utilisations/${u.corps.utilisation.id}/rendre`, {}, bearer)).corps.code).toBe("DEJA_UTILISEE");

    // Annulation de la vente 3 : gain retiré, récompense rendue.
    await registre.enregistrerAnnulation({ numeroTicket: 3, motif: "Erreur de saisie", operateurId: "u-lea" });
    await synchro();
    expect(await solde()).toBe(17);

    // Une récompense retirée de la commande est rendue tout de suite.
    const v = await appel("POST", "/api/caisse/fidelite/utilisations", { membreId: marie.id, recompenseId: "r-cafe" }, bearer);
    expect(v.corps.solde).toBe(7);
    expect((await appel("POST", `/api/caisse/fidelite/utilisations/${v.corps.utilisation.id}/rendre`, {}, bearer)).corps.solde).toBe(17);

    // Historique dans l'administration.
    const prog = (await appel("GET", "/api/admin/etablissements/moka/fidelite", undefined, admin)).corps.programme;
    expect(prog.membres).toBe(1);
    const fiche = await appel("GET", `/api/admin/fidelite/${prog.id}/membres/${marie.id}`, undefined, admin);
    expect(fiche.corps.membre.solde).toBe(17);
    expect(fiche.corps.mouvements.map((x: { nature: string; points: number }) => `${x.nature} ${x.points}`).reverse()).toEqual([
      "BIENVENUE 5",
      "GAIN 8",
      "GAIN 4",
      "UTILISATION -10",
      "GAIN 4",
      "ANNULATION -4",
      "RENDU 10",
      "UTILISATION -10",
      "RENDU 10",
    ]);

    // Statistiques : ventes 1 et 2 gardées (la 3 est annulée).
    const stats = await appel("GET", "/api/admin/etablissements/moka/statistiques?du=2026-10-15&au=2026-10-15", undefined, admin);
    expect(stats.corps.fidelite).toEqual({ membres: 1, inscriptions: 1, membresVenus: 1, tickets: 2, ttc: 2300, recompenses: 0, valeurRecompenses: 0, points: 12 });
  });

  it("rend une récompense réservée et oubliée, rattache un ticket du jour une seule fois, fait expirer les points, ajuste et efface", async () => {
    const { admin, registre, bearer, synchro } = await preparer();
    const prog = await programmeActif(admin);
    const marie = (await appel("POST", "/api/caisse/fidelite/membres", { telephone: "0612345678", prenom: "Marie" }, bearer)).corps.membre;
    const solde = async () => (await appel("GET", `/api/admin/fidelite/${prog.id}/membres/${marie.id}`, undefined, admin)).corps.membre.solde;

    // Client qui avait oublié sa carte : rattachement d'un ticket du jour depuis l'écran Tickets.
    await registre.enregistrerVente({ lignes: [{ ...CAFE, quantite: 3 }], paiements: [{ mode: "CB", montant: 1200 }], operateurId: "u-lea" });
    const tropTot = await appel("POST", "/api/caisse/fidelite/rattachement", { caisseId: "ipad-0a1b2c3d", numero: 1, telephone: "0612345678" }, bearer);
    expect(tropTot.corps.code).toBe("TICKET_INCONNU");
    await synchro();
    const r = await appel("POST", "/api/caisse/fidelite/rattachement", { caisseId: "ipad-0a1b2c3d", numero: 1, telephone: "06 12 34 56 78" }, bearer);
    expect(r.corps).toMatchObject({ points: 12, membre: { solde: 17 } });
    expect((await appel("POST", "/api/caisse/fidelite/rattachement", { caisseId: "ipad-0a1b2c3d", numero: 1, telephone: "0612345678" }, bearer)).corps.code).toBe("DEJA_RATTACHE");
    expect((await appel("POST", "/api/caisse/fidelite/rattachement", { caisseId: "ipad-0a1b2c3d", numero: 1, telephone: "0699999999" }, bearer)).corps.code).toBe("DEJA_RATTACHE");

    // Ajustement motivé, refusé sous zéro.
    expect((await appel("POST", `/api/admin/fidelite/${prog.id}/membres/${marie.id}/ajustement`, { points: 3, motif: "" }, admin)).corps.code).toBe("MOTIF_OBLIGATOIRE");
    expect((await appel("POST", `/api/admin/fidelite/${prog.id}/membres/${marie.id}/ajustement`, { points: -50, motif: "Erreur" }, admin)).corps.code).toBe("SOLDE_NEGATIF");
    expect((await appel("POST", `/api/admin/fidelite/${prog.id}/membres/${marie.id}/ajustement`, { points: 3, motif: "Geste après un oubli" }, admin)).corps.membre.solde).toBe(20);

    // Réservée puis oubliée (commande abandonnée) : rendue d'office après 48 h.
    await appel("POST", "/api/caisse/fidelite/utilisations", { membreId: marie.id, recompenseId: "r-cafe" }, bearer);
    expect(await solde()).toBe(10);
    instant += 49 * 3600_000;
    expect((await appel("GET", "/api/caisse/fidelite?telephone=0612345678", undefined, bearer)).corps.membre.solde).toBe(20);
    expect((await appel("POST", "/api/caisse/fidelite/rattachement", { caisseId: "ipad-0a1b2c3d", numero: 1, telephone: "0612345678" }, bearer)).corps.code).toBe("TICKET_ANCIEN");

    // Douze mois sans visite : points perdus à la lecture suivante.
    instant = Date.parse("2027-10-16T09:00:00Z");
    expect((await appel("GET", "/api/caisse/fidelite?telephone=0612345678", undefined, bearer)).corps.membre.solde).toBe(0);
    instant = Date.parse("2026-10-15T12:00:00Z"); // session d'administration encore valable
    expect((await appel("GET", `/api/admin/fidelite/${prog.id}/membres?q=marie`, undefined, admin)).corps.membres).toHaveLength(1);
    expect((await appel("GET", `/api/admin/fidelite/${prog.id}/membres?q=06 12`, undefined, admin)).corps.membres).toHaveLength(1);

    // Effacement : coordonnées ôtées, le numéro redevient libre ; le registre reste.
    expect((await appel("POST", `/api/admin/fidelite/${prog.id}/membres/${marie.id}/effacement`, {}, admin)).statut).toBe(200);
    expect((await appel("GET", "/api/caisse/fidelite?telephone=0612345678", undefined, bearer)).corps.membre).toBeNull();
    const fiche = (await appel("GET", `/api/admin/fidelite/${prog.id}/membres/${marie.id}`, undefined, admin)).corps;
    expect(fiche.membre).toMatchObject({ prenom: "Membre effacé", telephone: "", email: "", supprime: true });
    expect(fiche.mouvements.length).toBeGreaterThan(3);
    expect((await appel("GET", `/api/admin/fidelite/${prog.id}/membres`, undefined, admin)).corps.membres).toHaveLength(0);
  });

  it("partage un programme avec un autre établissement, qui ne peut être quitté par son propriétaire tant qu'il est partagé", async () => {
    const { admin } = await preparer();
    const prog = await programmeActif(admin);
    expect((await appel("POST", "/api/admin/etablissements", { id: "chardon", identite: { enseigne: "Chardon" }, carteId: "carte-automne-2026", tables: [], seuilNote: 2500 }, admin)).statut).toBe(201);
    const vu = await appel("GET", "/api/admin/etablissements/chardon/fidelite", undefined, admin);
    expect(vu.corps).toMatchObject({ programme: null, autres: [{ id: prog.id, nom: "Club Moka", enseigne: "Moka" }] });
    const rejoint = await appel("POST", "/api/admin/etablissements/chardon/fidelite", { action: "rejoindre", programmeId: prog.id }, admin);
    expect(rejoint.corps.programme.etablissements.map((e: { id: string }) => e.id).sort()).toEqual(["chardon", "moka"]);
    expect((await appel("POST", "/api/admin/etablissements/moka/fidelite", { action: "quitter" }, admin)).corps.code).toBe("PROGRAMME_PARTAGE");
    expect((await appel("POST", "/api/admin/etablissements/chardon/fidelite", { action: "quitter" }, admin)).corps.programme).toBeNull();
    expect((await appel("POST", "/api/admin/etablissements/moka/fidelite", { action: "quitter" }, admin)).corps.programme).toBeNull();
  });
});

describe("note envoyée par e-mail", () => {
  it("envoie le lien de la note au client avec l'expéditeur de l'établissement, sans garder l'adresse", async () => {
    const { bearer } = await preparer();
    const lien = "https://pos.test/n#abc123";
    const r = await appel("POST", "/api/caisse/note-email", { email: " Client@Exemple.FR ", url: lien, numero: 12, totalTTC: 2350, horodatage: "2026-10-15T08:00:00Z" }, bearer);
    expect(r.statut).toBe(200);
    expect(courriels).toHaveLength(1);
    const c = courriels[0]!;
    expect([c.a, c.sujet, c.deNom]).toEqual(["client@exemple.fr", "Votre note Moka · n° 12", "Moka"]);
    expect(c.texte).toMatch(/ticket n° 12 du 15 octobre 2026 à 10:00, 23,50 € TTC/);
    expect(c.texte).toMatch(/https:\/\/pos\.test\/n#abc123/);
    expect(c.html).toContain('href="https://pos.test/n#abc123"');
    expect(c.texte).toMatch(/n'est pas conservée/);
    const dump = JSON.stringify(await db.requete("select contenu from enregistrements union all select to_jsonb(j) from journal_admin j"));
    expect(dump).not.toContain("client@exemple.fr");
  });

  it("refuse une adresse invalide, un lien d'un autre site, et dit quand l'envoi n'est pas réglé", async () => {
    const { bearer } = await preparer();
    const corps = { email: "client@exemple.fr", url: "https://pos.test/n#abc", numero: 1, totalTTC: 400 };
    expect((await appel("POST", "/api/caisse/note-email", { ...corps, email: "pas-une-adresse" }, bearer)).corps.code).toBe("EMAIL_INVALIDE");
    expect((await appel("POST", "/api/caisse/note-email", { ...corps, url: "https://ailleurs.test/n#abc" }, bearer)).corps.code).toBe("NOTE_INVALIDE");
    expect((await appel("POST", "/api/caisse/note-email", corps)).statut).toBe(401);
    const sansEnvoi = await traiter(
      new Request("https://pos.test/api/caisse/note-email", { method: "POST", headers: { "Content-Type": "application/json", ...bearer }, body: JSON.stringify(corps) }),
      { db, maintenant: () => new Date(instant) },
    );
    expect([sansEnvoi.status, ((await sansEnvoi.json()) as { code: string }).code]).toEqual([503, "ENVOI_NON_CONFIGURE"]);
  });
});

describe("information des clients sur leurs données", () => {
  it("publie la page de l'établissement : responsable, ventes en compte (six ans), réservations, fidélité si le programme existe", async () => {
    const { admin } = await preparer();
    const page = async (chemin: string) => {
      const r = await traiter(new Request(`https://pos.test${chemin}`), env());
      return { statut: r.status, type: r.headers.get("Content-Type"), html: await r.text() };
    };
    let p = await page("/donnees/moka");
    expect([p.statut, p.type]).toEqual([200, "text/html; charset=utf-8"]);
    expect(p.html).toContain("<h1>Vos données personnelles</h1>");
    expect(p.html).toMatch(/conserver six ans \(livre des procédures fiscales, article L102 B\)/);
    expect(p.html).toMatch(/effacées un an après la date de la réservation/);
    expect(p.html).toMatch(/note par e-mail, votre adresse sert uniquement à cet envoi/);
    expect(p.html).not.toContain("Carte de fidélité");
    await programmeActif(admin);
    p = await page("/api/public/donnees/moka");
    expect(p.html).toContain("Carte de fidélité · Club Moka");
    expect(p.html).toMatch(/d'office après 3 ans sans visite/);
    expect((await page("/donnees/inconnu")).statut).toBe(404);
  });
});

describe("logo de l'établissement", () => {
  const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  it("se dépose dans l'administration, se sert en public avec sa version, figure en tête des e-mails, et se retire", async () => {
    const { admin, bearer } = await preparer();
    expect((await appel("PUT", "/api/admin/etablissements/moka/logo", { png: "R0lGODlhAQABAAAAACw=" }, admin)).corps.code).toBe("LOGO_INVALIDE");
    const r = await appel("PUT", "/api/admin/etablissements/moka/logo", { png: `data:image/png;base64,${PNG}` }, admin);
    expect(r.statut).toBe(200);
    const version = r.corps.etablissement.logo as string;
    expect(version).toMatch(/^[0-9a-f]{12}$/);
    expect((await appel("GET", "/api/caisse/etat", undefined, bearer)).corps.etablissement.logo).toBe(version);
    const image = await traiter(new Request(`https://pos.test/logo/moka?v=${version}`), env());
    expect([image.status, image.headers.get("Content-Type")]).toEqual([200, "image/png"]);
    expect(Buffer.from(await image.arrayBuffer()).toString("base64")).toBe(PNG);
    await appel("POST", "/api/caisse/note-email", { email: "client@exemple.fr", url: "https://pos.test/n#abc", numero: 1, totalTTC: 400 }, bearer);
    expect(courriels.at(-1)!.html).toContain(`<img src="https://pos.test/logo/moka?v=${version}" alt="Moka"`);
    expect((await appel("PUT", "/api/admin/etablissements/moka/logo", { png: null }, admin)).corps.etablissement.logo).toBeNull();
    expect((await traiter(new Request("https://pos.test/logo/moka"), env())).status).toBe(404);
    await appel("POST", "/api/caisse/note-email", { email: "client@exemple.fr", url: "https://pos.test/n#abc", numero: 1, totalTTC: 400 }, bearer);
    expect(courriels.at(-1)!.html).not.toContain("<img");
  });
});
