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
let panne: string | null;

async function appel(methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}) {
  const reponse = await traiter(
    new Request(`https://pos.test${chemin}`, {
      method: methode,
      headers: { "Content-Type": "application/json", Origin: "https://pos.test", ...entetes },
      body: corps === undefined ? undefined : JSON.stringify(corps),
    }),
    {
      db,
      maintenant: () => new Date(instant),
      envoyerCourriel: async (c) => {
        if (panne) throw new Error(panne);
        courriels.push(c);
      },
      envoiGroupe: true,
    },
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
  courriels = [];
  panne = null;
  instant = Date.parse("2026-10-15T08:00:00Z");
});

async function preparer() {
  const init = await appel("POST", "/api/admin/initialiser", { identifiant: "lionel", motDePasse: "un-mot-de-passe-solide" });
  const conf = await appel("POST", "/api/admin/confirmer", { identifiant: "lionel", motDePasse: "un-mot-de-passe-solide", code: await codeTotp(init.corps.secret, instant) });
  const admin = { Cookie: conf.cookie!.split(";")[0]! };
  expect((await appel("POST", "/api/admin/etablissements/moka/utilisateurs", { nom: "Léa", role: "responsable", pin: "1234" }, admin)).statut).toBe(200);
  expect((await appel("POST", "/api/admin/etablissements/moka/utilisateurs", { nom: "Tom", role: "serveur", pin: "5678" }, admin)).statut).toBe(200);
  const code = await appel("POST", "/api/admin/etablissements/moka/codes", { nomCaisse: "Bar" }, admin);
  const paire = await genererPaireCles("ipad-0a1b2c3d-k1");
  const r = await appel("POST", "/api/caisse/rattacher", {
    code: code.corps.code.toLowerCase().replace(/(.{4})/, "$1-"),
    caisseId: "ipad-0a1b2c3d",
    cleId: paire.cleId,
    clePubliqueJwk: paire.clePubliqueJwk,
    appareil: "iPad test",
  });
  expect(r.statut).toBe(201);
  const bearer = { Authorization: `Bearer ${r.corps.jeton}` };
  const lea = r.corps.utilisateurs.find((u: any) => u.nom === "Léa").id as string;
  const tom = r.corps.utilisateurs.find((u: any) => u.nom === "Tom").id as string;
  // Deux produits chez Caves du Mont (prix du tarif), un chez Metro.
  const tableau = [
    ["produit", "unite", "famille", "zone", "fournisseur", "reference", "conditionnement", "quantite", "prix_ht"],
    ["Bombay Sapphire", "L", "Spiritueux", "Bar", "Caves du Mont", "25522", "Bouteille 70 cl", "0,7", "20,49"],
    ["Carlsberg pression", "L", "Bières", "Cave", "Caves du Mont", "13", "Fût 30 L", "30", "139,14"],
    ["Prosecco", "L", "Vins", "Cave", "Caves du Mont", "83335", "Bouteille 75 cl", "0,75", "6,29"],
    ["Citron vert", "kg", "Frais", "Froid", "Metro", "", "Au kg", "1", "3,55"],
  ];
  expect((await appel("POST", "/api/admin/stock/import", { etablissementId: "moka", tableau }, admin)).statut).toBe(200);
  const stock = (await appel("GET", "/api/admin/stock", undefined, admin)).corps;
  const article = (produit: string) => stock.referentiel.articles.find((a: any) => a.produitId === produit).id as string;
  return { admin, bearer, lea, tom, gin: article("bombay-sapphire"), fut: article("carlsberg-pression"), citron: article("citron-vert") };
}

const fiche = {
  id: "caves-du-mont",
  nom: "caves du mont",
  courriel: "Commandes@CavesDuMont.test",
  copies: ["johan@cavesdumont.test"],
  contact: "Johan Panisset",
  telephone: "04 50 00 00 00",
  francoHT: 25000,
  livraison: "Mardi et vendredi, commande la veille avant 12 h",
  comptes: [{ etablissementId: "moka", numeroClient: "1411" }],
};

describe("fiches fournisseurs", () => {
  it("s'enregistrent dans le référentiel et donnent leur orthographe aux articles", async () => {
    const { admin } = await preparer();
    expect((await appel("PUT", "/api/admin/stock/fournisseurs/caves-du-mont", { fournisseur: { ...fiche, courriel: "pas-un-email" } }, admin)).statut).toBe(400);
    const r = await appel("PUT", "/api/admin/stock/fournisseurs/caves-du-mont", { fournisseur: { ...fiche, nom: "Caves du Mont" } }, admin);
    expect(r.statut).toBe(200);
    expect(r.corps.referentiel.fournisseurs[0]).toMatchObject({ nom: "Caves du Mont", courriel: "commandes@cavesdumont.test", francoHT: 25000, comptes: [{ etablissementId: "moka", numeroClient: "1411" }] });
    // Renommer la fiche renomme ses articles.
    const r2 = await appel("PUT", "/api/admin/stock/fournisseurs/caves-du-mont", { fournisseur: { ...fiche, nom: "Caves du Mont Annecy" } }, admin);
    expect(r2.corps.referentiel.articles.filter((a: any) => a.fournisseur === "Caves du Mont Annecy")).toHaveLength(3);
    expect(r2.corps.referentiel.articles.filter((a: any) => a.fournisseur === "Caves du Mont")).toHaveLength(0);
    // Deux fiches du même nom : refusé.
    expect((await appel("PUT", "/api/admin/stock/fournisseurs/doublon", { fournisseur: { ...fiche, id: "doublon", nom: "CAVES DU MONT ANNECY" } }, admin)).statut).toBe(400);
  });
});

describe("commandes fournisseurs", () => {
  it("se saisissent, partent par e-mail, se réceptionnent en deux livraisons puis se soldent", async () => {
    const { admin, bearer, lea, tom, gin, fut, citron } = await preparer();
    await appel("PUT", "/api/admin/stock/fournisseurs/caves-du-mont", { fournisseur: { ...fiche, nom: "Caves du Mont" } }, admin);
    await appel("PUT", "/api/admin/stock/commandes/reglages?etab=moka", { expediteur: "commandes@moka.test", email: "bar@moka.test", livraison: "Livraison par la cour, avant 11 h" }, admin);

    // Brouillon depuis l'iPad, par un responsable seulement.
    expect((await appel("POST", "/api/caisse/stock/commandes", { utilisateurId: tom, fournisseur: "Caves du Mont", lignes: [] }, bearer)).statut).toBe(403);
    // Un article d'un autre fournisseur est refusé.
    expect((await appel("POST", "/api/caisse/stock/commandes", { utilisateurId: lea, fournisseur: "Caves du Mont", lignes: [{ articleId: citron, nombre: 1000 }] }, bearer)).statut).toBe(400);
    const cree = await appel("POST", "/api/caisse/stock/commandes", { utilisateurId: lea, fournisseur: "caves du mont", lignes: [{ articleId: gin, nombre: 10_000 }], livraison: "2026-10-20" }, bearer);
    expect(cree.statut).toBe(201);
    let c = cree.corps.commande;
    expect(c).toMatchObject({ numero: 1, fournisseur: "Caves du Mont", statut: "brouillon", version: 1, lignes: [{ articleId: gin, nombre: 10_000, prixHT: 2049 }], creePar: "Bar · Léa" });

    // Modification du brouillon (version) ; une version dépassée est refusée.
    const modif = await appel("PUT", `/api/admin/stock/commandes/${c.id}?etab=moka`, { version: 1, lignes: [{ articleId: gin, nombre: 10_000 }, { articleId: fut, nombre: 2000 }], livraison: "2026-10-20", message: "Merci de livrer avant 11 h." }, admin);
    expect(modif.statut).toBe(200);
    c = modif.corps.commande;
    expect(c.version).toBe(2);
    expect((await appel("PUT", `/api/admin/stock/commandes/${c.id}?etab=moka`, { version: 1, lignes: [] }, admin)).statut).toBe(409);

    // Envoi par e-mail : à l'adresse de la fiche, copies (fiche et établissement), réponses vers l'établissement.
    const envoi = await appel("POST", `/api/caisse/stock/commandes/${c.id}/envoyer`, { utilisateurId: lea, version: 2 }, bearer);
    expect(envoi.statut).toBe(200);
    c = envoi.corps.commande;
    expect(c).toMatchObject({ statut: "envoyee", envoi: { mode: "courriel", a: "commandes@cavesdumont.test", copies: ["johan@cavesdumont.test", "bar@moka.test"], par: "Bar · Léa" } });
    expect(courriels).toHaveLength(1);
    const mail = courriels[0]!;
    expect(mail).toMatchObject({ a: "commandes@cavesdumont.test", copies: ["johan@cavesdumont.test", "bar@moka.test"], de: "commandes@moka.test", repondreA: "bar@moka.test", deNom: "Moka · commandes" });
    expect(mail.sujet).toBe("Commande n° 1 · Moka · client 1411 · livraison souhaitée le mardi 20 octobre 2026");
    expect(mail.html).toContain("25522");
    expect(mail.html).toContain("Merci de livrer avant 11 h.");
    expect(mail.html).toContain("Livraison par la cour, avant 11 h");
    // 10 bouteilles à 20,49 € + 2 fûts à 139,14 € = 483,18 € HT.
    expect(mail.texte).toContain("Total HT indicatif : 483,18 €");
    expect(mail.texte).toContain("- 10 × Bombay Sapphire (Bouteille 70 cl) · réf. 25522 · 204,90 € HT");
    // Plus modifiable ni renvoyable.
    expect((await appel("PUT", `/api/admin/stock/commandes/${c.id}?etab=moka`, { version: c.version, lignes: [] }, admin)).statut).toBe(409);
    expect((await appel("POST", `/api/admin/stock/commandes/${c.id}/envoyer?etab=moka`, { version: c.version }, admin)).statut).toBe(409);

    // Première livraison : 6 bouteilles (prix changé) et les 2 fûts.
    instant += 3600_000;
    const rx1 = await appel(
      "POST",
      "/api/caisse/stock/receptions",
      { utilisateurId: lea, commandeId: c.id, numero: "BL-77", lignes: [{ articleId: gin, nombre: 6000, prixHT: 2100 }, { articleId: fut, nombre: 2000, prixHT: 13914 }] },
      bearer,
    );
    expect(rx1.statut).toBe(201);
    expect(rx1.corps.document.contenu).toMatchObject({ fournisseur: "Caves du Mont", commande: { id: c.id, numero: 1 } });
    // Un article d'un autre fournisseur ne se réceptionne pas contre cette commande.
    expect((await appel("POST", "/api/caisse/stock/receptions", { utilisateurId: lea, commandeId: c.id, lignes: [{ articleId: citron, nombre: 1000, prixHT: 355 }] }, bearer)).statut).toBe(400);
    let liste = (await appel("GET", "/api/caisse/stock/commandes", undefined, bearer)).corps;
    c = liste.commandes[0];
    expect(c.recu).toEqual({ [gin]: 6000, [fut]: 2000 });
    expect(c.receptions).toHaveLength(1);
    expect(liste.envoi).toEqual({ possible: true, expediteur: "commandes@moka.test", email: "bar@moka.test" });
    // Le prix reçu devient le dernier prix ; le stock entre : 6 × 0,7 L + 2 × 30 L.
    const etat = (await appel("GET", "/api/admin/stock/etat?etab=moka", undefined, admin)).corps;
    expect(etat.produits.find((p: any) => p.produitId === "bombay-sapphire").quantite).toBe(4200);
    expect(etat.produits.find((p: any) => p.produitId === "carlsberg-pression").quantite).toBe(60_000);
    // Mouvements du produit sur la caisse : la réception, avec son fournisseur et sa commande.
    const mvt = (await appel("GET", "/api/caisse/stock/mouvements?produit=bombay-sapphire", undefined, bearer)).corps.mouvements;
    expect(mvt[0]).toMatchObject({ type: "reception", quantite: 4200, origine: { fournisseur: "Caves du Mont", numero: "BL-77", commande: 1 } });
    expect((await appel("GET", "/api/caisse/stock/mouvements?produit=Pas%20valide", undefined, bearer)).statut).toBe(400);
    // Annuler une commande en partie reçue : refusé, on la solde.
    expect((await appel("POST", `/api/admin/stock/commandes/${c.id}/annuler?etab=moka`, { version: c.version }, admin)).statut).toBe(409);

    // Seconde livraison : 4 bouteilles ; la commande est reçue en entier.
    instant += 3600_000;
    const rx2 = await appel("POST", "/api/admin/stock/receptions", { etablissementId: "moka", commandeId: c.id, lignes: [{ articleId: gin, nombre: 4000, prixHT: 2100 }] }, admin);
    expect(rx2.statut).toBe(201);
    c = (await appel("GET", `/api/admin/stock/commandes/${c.id}?etab=moka`, undefined, admin)).corps.commande;
    expect(c.recu[gin]).toBe(10_000);
    // Réception annulée : elle ne compte plus.
    expect((await appel("POST", `/api/admin/stock/receptions/${rx2.corps.document.id}/annuler`, { etablissementId: "moka" }, admin)).statut).toBe(200);
    c = (await appel("GET", `/api/admin/stock/commandes/${c.id}?etab=moka`, undefined, admin)).corps.commande;
    expect(c.recu[gin]).toBe(6000);
    expect(c.receptions.map((r: any) => r.annulee)).toEqual([false, true]);

    // Soldée : le reste ne viendra pas ; plus de réception contre elle.
    const solde = await appel("POST", `/api/caisse/stock/commandes/${c.id}/solder`, { utilisateurId: lea, version: c.version }, bearer);
    expect(solde.statut).toBe(200);
    expect(solde.corps.commande.statut).toBe("soldee");
    expect((await appel("POST", "/api/caisse/stock/receptions", { utilisateurId: lea, commandeId: c.id, lignes: [{ articleId: gin, nombre: 1000, prixHT: 2100 }] }, bearer)).statut).toBe(409);
    expect(solde.corps.commande.historique.map((h: any) => h.action)).toEqual([
      "créée",
      "modifiée",
      "envoyée par e-mail à commandes@cavesdumont.test (copie : johan@cavesdumont.test, bar@moka.test)",
      "soldée : le reste ne sera pas livré",
    ]);
  });

  it("redevient brouillon si l'e-mail échoue ; se marque envoyée par téléphone ; s'annule en prévenant le fournisseur", async () => {
    const { admin, gin, citron } = await preparer();
    const nouvelle = async (fournisseur: string, articleId: string) => (await appel("POST", "/api/admin/stock/commandes?etab=moka", { fournisseur, lignes: [{ articleId, nombre: 1000 }] }, admin)).corps.commande;

    // Sans fiche (ou sans e-mail) : pas d'envoi par e-mail, mais « marquer envoyée ».
    const metro = await nouvelle("Metro", citron);
    expect(metro.numero).toBe(1);
    const sansEmail = await appel("POST", `/api/admin/stock/commandes/${metro.id}/envoyer?etab=moka`, { version: 1 }, admin);
    expect(sansEmail.corps.code).toBe("FOURNISSEUR_SANS_EMAIL");
    const manuel = await appel("POST", `/api/admin/stock/commandes/${metro.id}/envoyer?etab=moka`, { version: 1, mode: "manuel" }, admin);
    expect(manuel.corps.commande).toMatchObject({ statut: "envoyee", envoi: { mode: "manuel", par: "administration · lionel" } });
    expect(courriels).toHaveLength(0);

    // E-mail refusé par le service d'envoi : la commande reste à envoyer, l'échec est noté.
    await appel("PUT", "/api/admin/stock/fournisseurs/caves-du-mont", { fournisseur: { ...fiche, nom: "Caves du Mont", copies: [] } }, admin);
    const cdm = await nouvelle("Caves du Mont", gin);
    expect(cdm.numero).toBe(2);
    panne = "Resend 403 : domaine non vérifié";
    const echec = await appel("POST", `/api/admin/stock/commandes/${cdm.id}/envoyer?etab=moka`, { version: 1 }, admin);
    expect(echec.statut).toBe(502);
    expect(echec.corps.message).toBe("La commande n'est pas partie : Resend 403 : domaine non vérifié");
    let c = (await appel("GET", `/api/admin/stock/commandes/${cdm.id}?etab=moka`, undefined, admin)).corps.commande;
    expect(c.statut).toBe("brouillon");
    expect(c.envoi).toBeUndefined();
    expect(c.historique.at(-1).action).toBe("échec de l'envoi : Resend 403 : domaine non vérifié");
    // Sans réglage propre aux commandes ni aux réservations : expéditeur par défaut, aucune copie.
    panne = null;
    const ok = await appel("POST", `/api/admin/stock/commandes/${cdm.id}/envoyer?etab=moka`, { version: c.version }, admin);
    expect(ok.statut).toBe(200);
    expect(courriels[0]).toMatchObject({ a: "commandes@cavesdumont.test" });
    expect(courriels[0]!.copies).toBeUndefined();
    expect(courriels[0]!.de).toBeUndefined();

    // Annulée avec un e-mail au fournisseur.
    c = ok.corps.commande;
    const annulee = await appel("POST", `/api/admin/stock/commandes/${cdm.id}/annuler?etab=moka`, { version: c.version, prevenir: true }, admin);
    expect(annulee.corps.commande.statut).toBe("annulee");
    expect(courriels[1]!.sujet).toBe("Annulation · commande n° 2 · Moka");
    expect(annulee.corps.commande.historique.at(-1).action).toBe("annulation envoyée par e-mail à commandes@cavesdumont.test");
  });

  it("reste propre à son établissement", async () => {
    const { admin, gin } = await preparer();
    expect((await appel("POST", "/api/admin/etablissements", { id: "chardon", identite: { enseigne: "Chardon" }, carteId: "carte-automne-2026", tables: [], seuilNote: 2500 }, admin)).statut).toBe(201);
    const c = (await appel("POST", "/api/admin/stock/commandes?etab=moka", { fournisseur: "Caves du Mont", lignes: [{ articleId: gin, nombre: 1000 }] }, admin)).corps.commande;
    expect((await appel("GET", `/api/admin/stock/commandes/${c.id}?etab=chardon`, undefined, admin)).statut).toBe(404);
    expect((await appel("GET", "/api/admin/stock/commandes?etab=chardon", undefined, admin)).corps.commandes).toEqual([]);
    // Numérotation propre à chaque établissement.
    expect((await appel("POST", "/api/admin/stock/commandes?etab=chardon", { fournisseur: "Caves du Mont", lignes: [] }, admin)).corps.commande.numero).toBe(1);
  });
});

describe("import des fiches techniques", () => {
  it("vérifie puis crée les recettes d'un tableur de cocktails, avec leurs ingrédients importés", async () => {
    const { admin } = await preparer();
    const tableau = [
      ["Cocktail", "Ingrédient", "Quantité", "Unité", "Note"],
      ["Dolce Vita", "Bombay Sapphire", "3", "cl", ""],
      ["Dolce Vita", "Prosecco", "8", "cl", ""],
      ["Citronnade", "Citron vert", "0,05", "kg", ""],
      ["Citronnade", "Sucre", "15", "g", "pas encore importé"],
    ];
    const verif = await appel("POST", "/api/admin/stock/import", { etablissementId: "moka", tableau, simuler: true }, admin);
    expect(verif.corps.rapport).toMatchObject({ recettesCreees: ["Dolce Vita"], erreurs: [{ ligne: 5, message: "« Citronnade » : ingrédient « Sucre » inconnu (importez d'abord les produits)" }] });
    expect(verif.corps.stock).toBeUndefined();
    const fait = await appel("POST", "/api/admin/stock/import", { etablissementId: "moka", tableau }, admin);
    expect(fait.statut).toBe(200);
    const dolce = fait.corps.stock.referentiel.recettes.find((r: any) => r.nom === "Dolce Vita");
    expect(dolce.lignes).toEqual([
      { type: "produit", id: "bombay-sapphire", quantite: { valeur: 30, unite: "mL" } },
      { type: "produit", id: "prosecco", quantite: { valeur: 80, unite: "mL" } },
    ]);
    expect(fait.corps.stock.referentiel.recettes).toHaveLength(1);
  });
});

describe("inventaire d'un comptage passé", () => {
  it("se compare au stock de ce jour-là ; les livraisons d'après s'y ajoutent ; se liste dans l'onglet Inventaire", async () => {
    const { admin, bearer, lea, gin } = await preparer();
    const stock = (await appel("GET", "/api/admin/stock", undefined, admin)).corps;
    const prosecco = stock.referentiel.articles.find((a: any) => a.produitId === "prosecco").id as string;
    // Une bouteille de prosecco livrée le 10, deux de gin livrées aujourd'hui (15 octobre).
    expect((await appel("POST", "/api/caisse/stock/receptions", { utilisateurId: lea, fournisseur: "Caves du Mont", date: "2026-10-10", lignes: [{ articleId: prosecco, nombre: 1000, prixHT: 629 }] }, bearer)).statut).toBe(201);
    expect((await appel("POST", "/api/caisse/stock/receptions", { utilisateurId: lea, fournisseur: "Caves du Mont", lignes: [{ articleId: gin, nombre: 2000, prixHT: 2049 }] }, bearer)).statut).toBe(201);

    // Comptage du 12 : 0,7 bouteille de gin, 1,5 de prosecco.
    const inv = await appel(
      "POST",
      "/api/caisse/stock/inventaires",
      { utilisateurId: lea, zone: "Bar", date: "2026-10-12", lignes: [{ produitId: "bombay-sapphire", compte: 490 }, { produitId: "prosecco", compte: 1125 }] },
      bearer,
    );
    expect(inv.statut).toBe(201);
    expect(inv.corps.document.le).toBe("2026-10-12T12:00:00.000Z");
    expect(inv.corps.document.contenu.date).toBe("2026-10-12");
    const ligne = (d: any, p: string) => d.contenu.lignes.find((l: any) => l.produitId === p);
    // Le gin livré le 15 n'est pas dans le théorique du 12 ; le prosecco du 10, si.
    expect(ligne(inv.corps.document, "bombay-sapphire")).toMatchObject({ compte: 490, theorique: 0, ecart: 490, ouverture: true });
    expect(ligne(inv.corps.document, "prosecco")).toMatchObject({ compte: 1125, theorique: 750, ecart: 375, ouverture: true });
    const q = (etat: any, p: string) => etat.produits.find((x: any) => x.produitId === p).quantite;
    expect(q(inv.corps.etat, "bombay-sapphire")).toBe(490 + 1400);
    expect(q(inv.corps.etat, "prosecco")).toBe(1125);
    const mvt = (await appel("GET", "/api/admin/stock/mouvements?etab=moka&produit=bombay-sapphire", undefined, admin)).corps.mouvements.find((m: any) => m.type === "inventaire");
    expect(mvt).toMatchObject({ le: "2026-10-12T12:00:00.000Z", dateComptable: "2026-10-12", quantite: 490 });

    // Inventaire du jour ensuite : comparé au stock actuel, ce n'est plus l'ouverture.
    instant += 60_000;
    const jour = await appel("POST", "/api/caisse/stock/inventaires", { utilisateurId: lea, zone: "Bar", lignes: [{ produitId: "bombay-sapphire", compte: 1800 }] }, bearer);
    expect(ligne(jour.corps.document, "bombay-sapphire")).toMatchObject({ theorique: 1890, ecart: -90 });
    expect(ligne(jour.corps.document, "bombay-sapphire").ouverture).toBeUndefined();
    expect(jour.corps.document.contenu.date).toBe("2026-10-15");

    // Un comptage plus ancien ne s'insère plus avant un inventaire déjà fait.
    const avant = await appel("POST", "/api/caisse/stock/inventaires", { utilisateurId: lea, date: "2026-10-13", lignes: [{ produitId: "bombay-sapphire", compte: 700 }] }, bearer);
    expect(avant.statut).toBe(409);
    expect(avant.corps.code).toBe("INVENTAIRE_POSTERIEUR");
    // Ni dans le futur, ni au-delà de 92 jours.
    expect((await appel("POST", "/api/caisse/stock/inventaires", { utilisateurId: lea, date: "2026-10-16", lignes: [{ produitId: "prosecco", compte: 0 }] }, bearer)).statut).toBe(400);
    expect((await appel("POST", "/api/caisse/stock/inventaires", { utilisateurId: lea, date: "2026-06-01", lignes: [{ produitId: "prosecco", compte: 0 }] }, bearer)).statut).toBe(400);
    expect((await appel("POST", "/api/caisse/stock/inventaires", { utilisateurId: lea, date: "2026-13-45", lignes: [{ produitId: "prosecco", compte: 0 }] }, bearer)).statut).toBe(400);

    // Liste de l'onglet Inventaire (caisse et administration), la plus récente d'abord.
    const liste = await appel("GET", "/api/caisse/stock/documents?type=inventaire", undefined, bearer);
    expect(liste.corps.documents.map((d: any) => d.contenu.date)).toEqual(["2026-10-15", "2026-10-12"]);
    expect((await appel("GET", "/api/caisse/stock/documents?type=autre", undefined, bearer)).statut).toBe(400);
    expect((await appel("GET", "/api/admin/stock/documents?etab=moka&type=inventaire", undefined, admin)).corps.documents).toHaveLength(2);
  });
});
