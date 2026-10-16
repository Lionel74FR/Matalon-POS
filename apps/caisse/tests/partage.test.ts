import { describe, expect, it } from "vitest";
import type { CommandePartagee, ReponseEcritureCommande } from "@matalon/serveur/partage";
import type { Commande, LigneCommande } from "../src/metier/commande";
import { fusionnerCommande } from "../src/metier/fusion";
import { PartageCommandes, type SuiviPartage } from "../src/donnees/partage";

const ligne = (uid: string, quantite = 1, extra: Partial<LigneCommande> = {}): LigneCommande => ({
  uid,
  articleId: uid,
  libelle: uid,
  details: [],
  quantite,
  prixUnitaireTTC: 400,
  tauxTVA: 1000,
  ajouteePar: "u1",
  ajouteeLe: "2026-10-15T10:00:00Z",
  ...extra,
});
const commande = (tableId: string, lignes: LigneCommande[], extra: Partial<Commande> = {}): Commande => ({
  tableId,
  couverts: 2,
  ouverteLe: "2026-10-15T10:00:00Z",
  ouvertePar: "u1",
  lignes,
  additionsImprimees: 0,
  ...extra,
});

describe("fusion de deux versions d'une commande", () => {
  const base = commande("t1", [ligne("cafe"), ligne("the")]);

  it("garde les ajouts des deux appareils et les modifications de chacun", () => {
    const locale = commande("t1", [ligne("cafe", 2), ligne("the"), ligne("croissant")]);
    const distante = commande("t1", [ligne("cafe"), ligne("the", 1, { envoyee: { le: "x", par: "u2" } }), ligne("jus")], { note: "anniversaire" });
    const f = fusionnerCommande(base, locale, distante)!;
    expect(f.lignes.map((l) => `${l.uid}×${l.quantite}${l.envoyee ? " envoyé" : ""}`)).toEqual(["cafe×2", "the×1 envoyé", "jus×1", "croissant×1"]);
    expect(f.note).toBe("anniversaire");
  });

  it("respecte un retrait d'un côté, sauf si l'autre côté a modifié la ligne", () => {
    const locale = commande("t1", [ligne("the")]); // café retiré ici (brouillon)
    const distante = commande("t1", [ligne("cafe"), ligne("the", 3)]);
    expect(fusionnerCommande(base, locale, distante)!.lignes.map((l) => `${l.uid}×${l.quantite}`)).toEqual(["the×3"]);
    const envoyeeAilleurs = commande("t1", [ligne("cafe", 1, { envoyee: { le: "x", par: "u2" } }), ligne("the")]);
    expect(fusionnerCommande(base, locale, envoyeeAilleurs)!.lignes.map((l) => l.uid)).toEqual(["cafe", "the"]);
  });

  it("table fermée d'un côté : seuls les ajouts de l'autre côté survivent", () => {
    expect(fusionnerCommande(base, commande("t1", [ligne("cafe"), ligne("the"), ligne("jus")]), null)!.lignes.map((l) => l.uid)).toEqual(["jus"]);
    expect(fusionnerCommande(base, commande("t1", [ligne("cafe", 5), ligne("the")]), null)).toBeNull();
    expect(fusionnerCommande(base, null, commande("t1", [ligne("cafe"), ligne("the"), ligne("eau")]))!.lignes.map((l) => l.uid)).toEqual(["eau"]);
    expect(fusionnerCommande(base, base, null)).toBeNull();
  });
});

/** Serveur en mémoire, mêmes règles que l'API : écriture conditionnelle par version. */
class Serveur {
  tables = new Map<string, { version: number; commande: Commande | null; par: string }>();
  horsLigne = false;
  acces(par: string) {
    return {
      lister: async (): Promise<CommandePartagee[]> => {
        if (this.horsLigne) throw new Error("hors ligne");
        return [...this.tables]
          .filter(([, t]) => t.commande)
          .map(([tableId, t]) => ({ tableId, version: t.version, commande: structuredClone(t.commande), majLe: "", majPar: t.par }));
      },
      ecrire: async (tableId: string, c: Commande | null, version: number, stricte = false): Promise<ReponseEcritureCommande> => {
        if (this.horsLigne) throw new Error("hors ligne");
        const t = this.tables.get(tableId);
        if (!t || t.version === version || (!t.commande && version === 0)) {
          const v = (t?.version ?? 0) + 1;
          this.tables.set(tableId, { version: v, commande: structuredClone(c), par });
          return { ok: true, version: v };
        }
        if (!c && !t.commande && !stricte) return { ok: true, version: t.version };
        return { ok: false, actuelle: { tableId, version: t.version, commande: structuredClone(t.commande), majLe: "", majPar: t.par } };
      },
    };
  }
}

function appareil(serveur: Serveur, nom: string) {
  const commandes = new Map<string, Commande>();
  const suivis = new Map<string, SuiviPartage>();
  const avis: string[] = [];
  const p = new PartageCommandes(
    serveur.acces(nom),
    {
      commandes: async () => [...commandes.values()],
      suivis: async () => [...suivis.values()],
      ecrireCommande: async (t, c) => void (c ? commandes.set(t, c) : commandes.delete(t)),
      ecrireSuivi: async (s) => void ("supprime" in s ? suivis.delete(s.tableId) : suivis.set(s.tableId, s)),
    },
    (t) => `Table ${t.slice(1)}`,
    (m) => avis.push(m),
    () => undefined,
  );
  return { p, commandes, avis };
}

describe("commandes partagées entre appareils", () => {
  it("une table ouverte sur l'iPhone apparaît sur l'iPad, et se ferme partout à l'encaissement", async () => {
    const s = new Serveur();
    const iphone = appareil(s, "iPhone");
    const ipad = appareil(s, "iPad");
    await iphone.p.charger();
    await ipad.p.charger();
    await iphone.p.modifier("t1", commande("t1", [ligne("cafe")]));
    await iphone.p.synchroniser();
    await ipad.p.synchroniser();
    expect(ipad.p.commandes.get("t1")!.lignes.map((l) => l.uid)).toEqual(["cafe"]);

    // L'iPad ajoute ; l'iPhone le voit.
    await ipad.p.modifier("t1", commande("t1", [ligne("cafe"), ligne("the")]));
    await ipad.p.synchroniser();
    await iphone.p.synchroniser();
    expect(iphone.p.commandes.get("t1")!.lignes.map((l) => l.uid)).toEqual(["cafe", "the"]);

    // Encaissée sur l'iPad : réservée, puis fermée ; l'iPhone ne peut plus l'encaisser.
    const surIphone = iphone.p.commandes.get("t1")!;
    expect(await ipad.p.reserver("t1", ipad.p.commandes.get("t1")!)).toEqual({ ok: true });
    await ipad.p.modifier("t1", null);
    expect(await iphone.p.reserver("t1", surIphone)).toMatchObject({ ok: false, raison: "Table 1 a déjà été encaissée sur iPad." });
    await iphone.p.synchroniser();
    expect(iphone.p.commandes.has("t1")).toBe(false);
  });

  it("deux appareils modifient la même table en même temps : rien ne se perd", async () => {
    const s = new Serveur();
    const a = appareil(s, "iPhone");
    const b = appareil(s, "iPad");
    await a.p.charger();
    await b.p.charger();
    await a.p.modifier("t2", commande("t2", [ligne("cafe")]));
    await a.p.synchroniser();
    await b.p.synchroniser();
    // Sans se voir : chacun ajoute un article.
    s.horsLigne = true;
    await a.p.modifier("t2", commande("t2", [ligne("cafe"), ligne("croissant")]));
    await b.p.modifier("t2", commande("t2", [ligne("cafe", 2), ligne("jus")]));
    await a.p.synchroniser();
    await b.p.synchroniser();
    s.horsLigne = false;
    await a.p.synchroniser();
    await b.p.synchroniser();
    await a.p.synchroniser();
    const attendu = ["cafe×2", "croissant×1", "jus×1"];
    const vue = (c: Commande) => c.lignes.map((l) => `${l.uid}×${l.quantite}`);
    expect(vue(s.tables.get("t2")!.commande!)).toEqual(attendu);
    expect(vue(a.p.commandes.get("t2")!)).toEqual(attendu);
    expect(vue(b.p.commandes.get("t2")!)).toEqual(attendu);
    // L'encaissement refuse une commande qui n'est plus celle affichée.
    const ancienne = commande("t2", [ligne("cafe"), ligne("croissant")]);
    expect(await a.p.reserver("t2", ancienne)).toMatchObject({ ok: false });
  });

  it("table encaissée ailleurs pendant un ajout : l'ajout reste ouvert, avec un avertissement", async () => {
    const s = new Serveur();
    const a = appareil(s, "iPhone");
    const b = appareil(s, "iPad");
    await a.p.charger();
    await b.p.charger();
    await a.p.modifier("t3", commande("t3", [ligne("cafe")]));
    await a.p.synchroniser();
    await b.p.synchroniser();
    s.horsLigne = true;
    await a.p.modifier("t3", commande("t3", [ligne("cafe"), ligne("dessert")]));
    s.horsLigne = false;
    expect(await b.p.reserver("t3", b.p.commandes.get("t3")!)).toEqual({ ok: true });
    await b.p.modifier("t3", null);
    await a.p.synchroniser();
    expect(a.p.commandes.get("t3")!.lignes.map((l) => l.uid)).toEqual(["dessert"]);
    expect(a.avis).toEqual(["Table 3 a été fermée sur iPad : vos derniers ajouts restent ouverts sur la table."]);
    expect(s.tables.get("t3")!.commande!.lignes.map((l) => l.uid)).toEqual(["dessert"]);
  });

  it("hors ligne, l'encaissement reste possible ; le comptoir reste sur l'appareil", async () => {
    const s = new Serveur();
    const a = appareil(s, "iPhone");
    await a.p.charger();
    await a.p.modifier("comptoir", commande("comptoir", [ligne("cafe")]));
    await a.p.synchroniser();
    expect(s.tables.has("comptoir")).toBe(false);
    await a.p.modifier("t4", commande("t4", [ligne("cafe")]));
    s.horsLigne = true;
    expect(await a.p.reserver("t4", a.p.commandes.get("t4")!)).toEqual({ ok: true, horsLigne: true });
  });

  it("publie les commandes ouvertes avant la mise à jour", async () => {
    const s = new Serveur();
    const a = appareil(s, "iPhone");
    a.commandes.set("t1", commande("t1", [ligne("cafe")]));
    await a.p.charger();
    await a.p.synchroniser();
    expect(s.tables.get("t1")!.commande!.lignes.map((l) => l.uid)).toEqual(["cafe"]);
  });

  it("encaissement abandonné après réservation : la table se rouvre sur le serveur", async () => {
    const s = new Serveur();
    const a = appareil(s, "iPhone");
    await a.p.charger();
    await a.p.modifier("t5", commande("t5", [ligne("cafe")]));
    await a.p.synchroniser();
    expect(await a.p.reserver("t5", a.p.commandes.get("t5")!)).toEqual({ ok: true });
    expect(s.tables.get("t5")!.commande).toBeNull();
    await a.p.liberer("t5");
    await a.p.synchroniser();
    expect(s.tables.get("t5")!.commande!.lignes.map((l) => l.uid)).toEqual(["cafe"]);
  });
});

describe("partie d'une table payée (articles, acompte)", () => {
  const acompte = { id: "a1", mode: "CB" as const, montant: 400, le: "x", par: "u1", caisseId: "ipad" };

  it("en ligne : la commande restante est écrite sans fusion, puis l'autre appareil la reçoit", async () => {
    const s = new Serveur();
    const a = appareil(s, "iPad");
    const b = appareil(s, "iPhone");
    await a.p.charger();
    await b.p.charger();
    await a.p.modifier("t6", commande("t6", [ligne("cafe"), ligne("the")]));
    await a.p.synchroniser();
    await b.p.synchroniser();
    const affichee = a.p.commandes.get("t6")!;
    const restante = { ...affichee, acomptes: [acompte] };
    expect(await a.p.engager("t6", affichee, restante)).toEqual({ ok: true });
    expect(s.tables.get("t6")!.commande!.acomptes).toEqual([acompte]);
    await a.p.modifier("t6", restante);
    await b.p.synchroniser();
    expect(b.p.commandes.get("t6")!.acomptes).toEqual([acompte]);
  });

  it("refusé si la table a changé ailleurs ; hors ligne, rien n'est écrit", async () => {
    const s = new Serveur();
    const a = appareil(s, "iPad");
    const b = appareil(s, "iPhone");
    await a.p.charger();
    await b.p.charger();
    await a.p.modifier("t7", commande("t7", [ligne("cafe")]));
    await a.p.synchroniser();
    await b.p.synchroniser();
    const vueIpad = a.p.commandes.get("t7")!;
    await b.p.modifier("t7", commande("t7", [ligne("cafe"), ligne("dessert")]));
    await b.p.synchroniser();
    expect(await a.p.engager("t7", vueIpad, { ...vueIpad, acomptes: [acompte] })).toMatchObject({
      ok: false,
      raison: "Table 7 vient d'être modifiée sur iPhone : vérifiez la commande puis recommencez.",
    });
    // L'iPad voit maintenant le dessert.
    expect(a.p.commandes.get("t7")!.lignes.map((l) => l.uid)).toEqual(["cafe", "dessert"]);
    s.horsLigne = true;
    const vue = a.p.commandes.get("t7")!;
    expect(await a.p.engager("t7", vue, { ...vue, acomptes: [acompte] })).toEqual({ ok: true, horsLigne: true });
    expect(s.tables.get("t7")!.commande!.acomptes).toBeUndefined();
  });

  it("ticket impossible après l'écriture : la commande affichée revient sur le serveur", async () => {
    const s = new Serveur();
    const a = appareil(s, "iPad");
    await a.p.charger();
    await a.p.modifier("t8", commande("t8", [ligne("cafe"), ligne("the")]));
    await a.p.synchroniser();
    const affichee = a.p.commandes.get("t8")!;
    const restante = { ...affichee, lignes: [affichee.lignes[0]!, { ...affichee.lignes[1]!, reglee: { le: "x", par: "u1", caisseId: "ipad" } }] };
    expect(await a.p.engager("t8", affichee, restante)).toEqual({ ok: true });
    await a.p.liberer("t8");
    await a.p.synchroniser();
    expect(s.tables.get("t8")!.commande!.lignes.some((l) => l.reglee)).toBe(false);
  });
});
