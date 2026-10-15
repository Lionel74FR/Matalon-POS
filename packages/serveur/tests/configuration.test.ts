import { PGlite } from "@electric-sql/pglite";
import { genererPaireCles } from "@matalon/noyau-fiscal";
import { describe, expect, it } from "vitest";
import { traiter, type Db } from "../src/index.js";
import { _oublierMigration } from "../src/schema.js";
import { codeTotp } from "../src/securite.js";

/**
 * Mise en service : la configuration de la caisse de test (établissement,
 * équipe, carte, stock, commandes, réservations à venir) passe dans une
 * installation neuve, sans aucune vente.
 */

const instant = Date.parse("2026-10-15T20:00:00Z");

function base(): { pg: PGlite; db: Db } {
  const pg = new PGlite();
  return {
    pg,
    db: {
      requete: async (t, p = []) => (await pg.query(t, p)).rows as never,
      lot: async (requetes) => {
        await pg.transaction(async (tx) => {
          for (const r of requetes) await tx.query(r.texte, r.params ?? []);
        });
      },
    },
  };
}

async function appel(db: Db, methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}) {
  const reponse = await traiter(
    new Request(`https://pos.test${chemin}`, {
      method: methode,
      headers: { "Content-Type": "application/json", Origin: "https://pos.test", ...entetes },
      body: corps === undefined ? undefined : JSON.stringify(corps),
    }),
    { db, maintenant: () => new Date(instant), envoiGroupe: true },
  );
  return { statut: reponse.status, corps: (await reponse.json()) as any, cookie: reponse.headers.get("Set-Cookie") };
}

async function administrateur(db: Db) {
  _oublierMigration();
  const init = await appel(db, "POST", "/api/admin/initialiser", { identifiant: "lionel", motDePasse: "un-mot-de-passe-solide" });
  const conf = await appel(db, "POST", "/api/admin/confirmer", { identifiant: "lionel", motDePasse: "un-mot-de-passe-solide", code: await codeTotp(init.corps.secret, instant) });
  return { Cookie: conf.cookie!.split(";")[0]! };
}

describe("configuration de mise en service", () => {
  it("passe de la caisse de test à une installation neuve, sans les ventes ; refusée dans une base qui a déjà servi", async () => {
    // ── Caisse de test : équipe, appareil, stock, commande, réservations, une vente décomptée ──
    const test = base();
    const admin = await administrateur(test.db);
    expect((await appel(test.db, "POST", "/api/admin/etablissements/moka/utilisateurs", { nom: "Léa", role: "responsable", pin: "1234" }, admin)).statut).toBe(200);
    const code = await appel(test.db, "POST", "/api/admin/etablissements/moka/codes", { nomCaisse: "Bar" }, admin);
    const paire = await genererPaireCles("ipad-0a1b2c3d-k1");
    const rattache = await appel(test.db, "POST", "/api/caisse/rattacher", {
      code: code.corps.code.toLowerCase().replace(/(.{4})/, "$1-"),
      caisseId: "ipad-0a1b2c3d",
      cleId: paire.cleId,
      clePubliqueJwk: paire.clePubliqueJwk,
      appareil: "iPad test",
    });
    expect(rattache.statut).toBe(201);
    const tableau = [
      ["produit", "unite", "famille", "zone", "fournisseur", "reference", "conditionnement", "quantite", "prix_ht"],
      ["Bombay Sapphire", "L", "Spiritueux", "Bar", "Caves du Mont", "25522", "Bouteille 70 cl", "0,7", "20,49"],
      ["Prosecco", "L", "Vins", "Cave", "Caves du Mont", "83335", "Bouteille 75 cl", "0,75", "6,29"],
    ];
    expect((await appel(test.db, "POST", "/api/admin/stock/import", { etablissementId: "moka", tableau }, admin)).statut).toBe(200);
    const stock = (await appel(test.db, "GET", "/api/admin/stock", undefined, admin)).corps;
    const gin = stock.referentiel.articles.find((a: any) => a.produitId === "bombay-sapphire").id;
    expect((await appel(test.db, "POST", "/api/admin/stock/inventaires", { etablissementId: "moka", zone: "Bar", date: "2026-10-12", lignes: [{ produitId: "bombay-sapphire", compte: 490 }] }, admin)).statut).toBe(201);
    const cmd = (await appel(test.db, "POST", "/api/admin/stock/commandes?etab=moka", { fournisseur: "Caves du Mont", lignes: [{ articleId: gin, nombre: 2000 }] }, admin)).corps.commande;
    await appel(test.db, "POST", `/api/admin/stock/commandes/${cmd.id}/envoyer?etab=moka`, { mode: "manuel", version: cmd.version }, admin);
    expect((await appel(test.db, "POST", "/api/admin/stock/receptions", { etablissementId: "moka", commandeId: cmd.id, lignes: [{ articleId: gin, nombre: 2000, prixHT: 2049 }] }, admin)).statut).toBe(201);
    // Une vente de test décomptée (4 cl) et deux réservations, une passée, une à venir.
    await test.db.requete(
      "insert into stock_mouvements (etablissement_id, produit_id, quantite, type, le, date_comptable, origine, cle, cree_le) values ('moka', 'bombay-sapphire', -40, 'vente', $1, '2026-10-15', '{}', 't:test:1:0:bombay-sapphire', $1)",
      [new Date(instant).toISOString()],
    );
    for (const [id, date] of [["passee", "2026-10-10"], ["a-venir", "2026-10-20"]]) {
      await test.db.requete("insert into reservations (id, etablissement_id, date, contenu, statut, cree_le, maj_le) values ($1, 'moka', $2, '{\"nom\":\"Durand\"}', 'confirmee', $3, $3)", [
        id,
        date,
        new Date(instant).toISOString(),
      ]);
    }
    const carteTest = (await appel(test.db, "GET", "/api/admin/cartes/carte-automne-2026", undefined, admin)).corps;
    const majCarte = await appel(test.db, "PUT", "/api/admin/cartes/carte-automne-2026", { carte: { ...carteTest.carte, nom: "Carte du Moka (test)" }, version: carteTest.version }, admin);
    expect(majCarte.statut).toBe(200);
    const etatTest = (await appel(test.db, "GET", "/api/admin/stock/etat?etab=moka", undefined, admin)).corps;
    expect(etatTest.produits.find((p: any) => p.produitId === "bombay-sapphire").quantite).toBe(490 + 1400 - 40);

    const conf = await appel(test.db, "GET", "/api/admin/configuration", undefined, admin);
    expect(conf.statut).toBe(200);
    expect(conf.corps.format).toBe("matalon-configuration/1");
    expect(conf.corps.tables.stock_mouvements.every((m: any) => m.type !== "vente")).toBe(true);
    expect(conf.corps.tables.reservations.map((r: any) => r.id)).toEqual(["a-venir"]);
    expect(conf.corps.tables).not.toHaveProperty("enregistrements");
    expect(conf.corps.tables).not.toHaveProperty("caisses");
    // Les clés chiffrées restent sur place : chaque installation a sa propre clé maîtresse.
    expect(conf.corps.tables).not.toHaveProperty("secrets_etablissement");

    // ── Installation neuve : un administrateur, l'établissement de départ, rien d'autre ──
    const prod = base();
    const adminProd = await administrateur(prod.db);
    const importe = await appel(prod.db, "POST", "/api/admin/configuration", conf.corps, adminProd);
    expect(importe.statut).toBe(200);
    expect(importe.corps.importe).toMatchObject({ etablissements: 1, utilisateurs: 1, reservations: 1 });

    const etabs = (await appel(prod.db, "GET", "/api/admin/etablissements", undefined, adminProd)).corps.etablissements;
    expect(etabs.map((e: any) => e.id)).toEqual(["moka"]);
    expect(etabs[0].utilisateurs.map((u: any) => u.nom)).toEqual(["Léa"]);
    expect(etabs[0].caisses).toEqual([]);
    const carteProd = (await appel(prod.db, "GET", "/api/admin/cartes/carte-automne-2026", undefined, adminProd)).corps;
    expect(carteProd.version).toBe(carteTest.version + 1);
    expect(carteProd.carte.nom).toBe("Carte du Moka (test)");
    // Stock : inventaire et livraison repris, la vente de test non.
    const etatProd = (await appel(prod.db, "GET", "/api/admin/stock/etat?etab=moka", undefined, adminProd)).corps;
    expect(etatProd.produits.find((p: any) => p.produitId === "bombay-sapphire").quantite).toBe(490 + 1400);
    expect((await appel(prod.db, "GET", "/api/admin/stock/commandes?etab=moka", undefined, adminProd)).corps.commandes.map((c: any) => c.numero)).toEqual([1]);
    expect((await appel(prod.db, "GET", "/api/admin/stock/documents?etab=moka&type=inventaire", undefined, adminProd)).corps.documents).toHaveLength(1);
    // Les séquences suivent : un nouveau prix et une nouvelle réception s'enregistrent après l'import.
    expect((await appel(prod.db, "POST", "/api/admin/stock/receptions", { etablissementId: "moka", fournisseur: "Caves du Mont", lignes: [{ articleId: gin, nombre: 1000, prixHT: 2100 }] }, adminProd)).statut).toBe(201);

    // Un second import, ou un import dans la caisse de test, est refusé.
    const encore = await appel(prod.db, "POST", "/api/admin/configuration", conf.corps, adminProd);
    expect(encore.statut).toBe(409);
    expect(encore.corps.code).toBe("BASE_NON_VIERGE");
    expect((await appel(test.db, "POST", "/api/admin/configuration", conf.corps, admin)).statut).toBe(409);
    expect((await appel(prod.db, "POST", "/api/admin/configuration", { format: "autre" }, adminProd)).statut).toBe(400);
  });
});
