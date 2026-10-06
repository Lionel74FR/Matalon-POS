import "fake-indexeddb/auto";
import { PGlite } from "@electric-sql/pglite";
import type { SaisieLigne } from "@matalon/noyau-fiscal";
import { _oublierMigration, codeTotp, traiter, type Db } from "@matalon/serveur";
import { beforeEach, describe, expect, it } from "vitest";
import { ouvrirBase } from "../src/donnees/base";
import { carteATelecharger, carteDe, fusionnerReferentiel } from "../src/donnees/configuration";
import { rattacher } from "../src/fiscal/caisse";
import { ClientApi, ErreurApi } from "../src/serveur/client";
import { blocageEncaissement, Synchroniseur } from "../src/serveur/synchro";

const CAFE: SaisieLigne = { articleId: "cappuccino", libelle: "Cappuccino", quantite: 1, prixUnitaireTTC: 400, tauxTVA: 1000 };

let pg: PGlite;
let decalageServeur = 0;
let horsLigne = false;
let n = 0;

const db: Db = {
  requete: async (t, p = []) => (await pg.query(t, p)).rows as never,
  lot: async (requetes) => {
    await pg.transaction(async (tx) => {
      for (const r of requetes) await tx.query(r.texte, r.params ?? []);
    });
  },
};
const env = { db, maintenant: () => new Date(Date.now() + decalageServeur) };

/** Le « réseau » de test : les requêtes de la caisse arrivent directement à l'API. */
const client = new ClientApi(null, "https://pos.test", async (url, init) => {
  if (horsLigne) throw new TypeError("Failed to fetch");
  return traiter(new Request(url, init), env);
});

async function admin(methode: string, chemin: string, corps?: unknown, cookie = "") {
  const r = await traiter(
    new Request(`https://pos.test${chemin}`, {
      method: methode,
      headers: { "Content-Type": "application/json", Origin: "https://pos.test", Cookie: cookie },
      body: corps === undefined ? undefined : JSON.stringify(corps),
    }),
    env,
  );
  return { corps: (await r.json()) as any, cookie: r.headers.get("Set-Cookie")?.split(";")[0] ?? "" };
}

async function codeDeRattachement(): Promise<{ code: string; cookie: string }> {
  const init = await admin("POST", "/api/admin/initialiser", { identifiant: "lionel", motDePasse: "un-mot-de-passe-solide" });
  const conf = await admin("POST", "/api/admin/confirmer", {
    identifiant: "lionel",
    motDePasse: "un-mot-de-passe-solide",
    code: await codeTotp(init.corps.secret, Date.now()),
  });
  await admin("POST", "/api/admin/etablissements/moka/utilisateurs", { nom: "Léa", role: "responsable", pin: "1234" }, conf.cookie);
  const code = await admin("POST", "/api/admin/etablissements/moka/codes", { nomCaisse: "Comptoir" }, conf.cookie);
  return { code: code.corps.code, cookie: conf.cookie };
}

beforeEach(async () => {
  _oublierMigration();
  pg = new PGlite();
  decalageServeur = 0;
  horsLigne = false;
});

describe("rattachement et synchronisation de la caisse", () => {
  it("rattache l'iPad par code, encaisse hors ligne et rattrape en plusieurs lots", async () => {
    const { code, cookie } = await codeDeRattachement();
    const base = await ouvrirBase(`synchro-${++n}`);

    const { caisse, connexion } = await rattacher(base, code.toLowerCase(), client);
    expect(caisse.config).toMatchObject({ etablissementId: "moka", caisseNom: "Comptoir", carteId: "carte-automne-2026" });
    expect(caisse.config.utilisateurs.map((u) => u.nom)).toEqual(["Léa"]);
    expect(caisse.config.tables).toHaveLength(12);
    // Code à usage unique.
    await expect(rattacher(await ouvrirBase(`synchro-${++n}`), code, client)).rejects.toMatchObject({ code: "CODE_INVALIDE" });

    const referentiels: string[] = [];
    const s = new Synchroniseur(
      { db: base, stockage: caisse.stockage, client: caisse.client, surReferentiel: (e) => void referentiels.push(e.caisse.nom) },
      connexion,
    );
    const lea = caisse.config.utilisateurs[0]!.id;
    await caisse.registre.enregistrerVente({ lignes: [CAFE], paiements: [{ mode: "CB", montant: 400 }], operateurId: lea });
    await s.synchroniser();
    expect(s.etat).toMatchObject({ statut: "synchronise", enAttente: 0, decalageHorloge: expect.any(Number) });
    expect(referentiels).toEqual(["Comptoir"]);

    // Coupure réseau pendant le service : la caisse continue.
    horsLigne = true;
    for (let i = 0; i < 230; i++) {
      await caisse.registre.enregistrerVente({ lignes: [CAFE], paiements: [{ mode: "ESPECES", montant: 500 }], operateurId: lea });
    }
    await caisse.registre.cloturerJournee(lea);
    await s.synchroniser();
    expect(s.etat.statut).toBe("hors_ligne");
    expect(s.etat.enAttente).toBeGreaterThan(230);
    expect(blocageEncaissement(s.etat)).toBeNull();

    horsLigne = false;
    await s.synchroniser();
    expect(s.etat).toMatchObject({ statut: "synchronise", enAttente: 0 });
    const enBase = await pg.query<{ chaine: string; n: number }>(
      "select chaine, count(*)::int as n from enregistrements group by chaine order by chaine",
    );
    expect(Object.fromEntries(enBase.rows.map((r) => [r.chaine, r.n]))).toMatchObject({ tickets: 231, clotures: 1 });
    const verif = await admin("GET", `/api/admin/caisses/${caisse.config.caisseId}/verification`, undefined, cookie);
    expect(verif.corps.integre).toBe(true);
    s.arreter();
  });

  it("bloque l'encaissement si l'horloge de l'iPad dérive, puis après révocation", async () => {
    const { code, cookie } = await codeDeRattachement();
    const base = await ouvrirBase(`synchro-${++n}`);
    const { caisse, connexion } = await rattacher(base, code, client);
    const s = new Synchroniseur({ db: base, stockage: caisse.stockage, client: caisse.client }, connexion);

    decalageServeur = 12 * 60_000; // l'iPad retarde de 12 minutes
    await s.synchroniser();
    expect(blocageEncaissement(s.etat)).toMatch(/retarde de 12 min/);
    decalageServeur = 0;
    await s.synchroniser();
    expect(blocageEncaissement(s.etat)).toBeNull();

    await admin("POST", `/api/admin/caisses/${caisse.config.caisseId}/revoquer`, {}, cookie);
    await s.synchroniser();
    expect(s.etat.statut).toBe("revoquee");
    expect(blocageEncaissement(s.etat)).toMatch(/révoquée/);
    // La révocation est retenue même hors ligne, après redémarrage.
    expect((await base.get("serveur", "connexion"))?.revoquee).toBe(true);
    s.arreter();
  });

  it("applique l'équipe et l'établissement modifiés ailleurs", async () => {
    const { code, cookie } = await codeDeRattachement();
    const base = await ouvrirBase(`synchro-${++n}`);
    const { caisse } = await rattacher(base, code, client);
    await admin("POST", "/api/admin/etablissements/moka/utilisateurs", { nom: "Tom", role: "serveur", pin: "4321" }, cookie);
    const etat = await caisse.client.etat();
    const config = fusionnerReferentiel(caisse.config, etat);
    expect(config?.utilisateurs.map((u) => u.nom)).toEqual(["Léa", "Tom"]);
    expect(fusionnerReferentiel(config!, etat)).toBeNull();

    // Carte reçue au rattachement, puis nouvelle version publiée dans l'administration.
    expect(caisse.config.carteVersion).toBe(1);
    expect(carteATelecharger(caisse.config, etat)).toBe(false);
    const lue = await admin("GET", "/api/admin/cartes/carte-automne-2026", undefined, cookie);
    lue.corps.carte.categories[0].articles[0].indisponible = true;
    await admin("PUT", "/api/admin/cartes/carte-automne-2026", { carte: lue.corps.carte, version: 1 }, cookie);
    const etat2 = await caisse.client.etat();
    expect(carteATelecharger(caisse.config, etat2)).toBe(true);
    const { carte, version } = await caisse.client.carte();
    const avecCarte = { ...caisse.config, carte, carteVersion: version };
    expect(carteDe(avecCarte)?.categories[0]?.articles[0]?.indisponible).toBe(true);
    expect(carteATelecharger(avecCarte, etat2)).toBe(false);

    // Modification depuis la caisse : refusée hors ligne, avec un message clair.
    horsLigne = true;
    await expect(caisse.client.enregistrerEquipe([])).rejects.toBeInstanceOf(ErreurApi);
  });
});
