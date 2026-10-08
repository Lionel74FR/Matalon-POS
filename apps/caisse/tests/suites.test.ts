import type { Catalogue } from "@matalon/catalogue";
import { describe, expect, it } from "vitest";
import {
  ajouterLigne,
  fusionnerCommandes,
  lignesParSuite,
  modifierLigne,
  nouvelleCommande,
  reclamer,
  suitesAReclamer,
  suiviSuites,
  transfererCommande,
  type Commande,
} from "../src/metier/commande";
import { aEnvoyerDans, bonsAEnvoyer, bonsReclame, validerEnvoi } from "../src/metier/production";

const carte: Catalogue = {
  id: "c",
  nom: "Carte",
  source: "test",
  etablissementId: "moka",
  categories: [
    { id: "chauds", nom: "Chauds", rayon: "Boissons", poste: "Bar", articles: [{ id: "cafe", nom: "Espresso", prixTTC: 270, tauxTVA: 1000 }] },
    {
      id: "plats",
      nom: "Plats",
      rayon: "Cuisine",
      poste: "Cuisine",
      articles: [
        { id: "croque", nom: "Croque", prixTTC: 900, tauxTVA: 1000 },
        { id: "tarte", nom: "Tarte", prixTTC: 600, tauxTVA: 1000 },
      ],
    },
  ],
};

const ligne = (articleId: string, libelle: string, prix: number, suite?: 1 | 2 | 3) => ({
  articleId,
  libelle,
  details: [],
  quantite: 1,
  prixUnitaireTTC: prix,
  tauxTVA: 1000,
  ajouteePar: "u1",
  ...(suite ? { suite } : {}),
});
const toutEnvoyer = (c: Commande) => validerEnvoi(c, aEnvoyerDans(c, true), new Set(), "u1");

/** Table type : cafés en direct, croques à suivre 1, tarte à suivre 2. */
function table(): Commande {
  let c = nouvelleCommande("t1", "u1");
  c = ajouterLigne(c, ligne("croque", "Croque", 900, 1));
  c = ajouterLigne(c, ligne("cafe", "Espresso", 270));
  c = ajouterLigne(c, ligne("tarte", "Tarte", 600, 2));
  c = ajouterLigne(c, ligne("croque", "Croque", 900, 1));
  return c;
}

describe("suites (« courses »)", () => {
  it("un article identique ne se regroupe qu'avec la même suite", () => {
    let c = table();
    c = ajouterLigne(c, ligne("croque", "Croque", 900));
    expect(c.lignes.map((l) => [l.libelle, l.quantite, l.suite ?? 0])).toEqual([
      ["Croque", 2, 1],
      ["Espresso", 1, 0],
      ["Tarte", 1, 2],
      ["Croque", 1, 0],
    ]);
    expect(lignesParSuite(c).map((g) => [g.suite, g.lignes.map((l) => l.libelle)])).toEqual([
      [0, ["Espresso", "Croque"]],
      [1, ["Croque"]],
      [2, ["Tarte"]],
    ]);
  });

  it("« Envoyer » fait tout partir, les articles rangés par suite sur chaque bon", () => {
    const bons = bonsAEnvoyer(table(), carte);
    expect(bons.map((b) => [b.poste, b.articles.map((a) => `${a.suite}:${a.libelle}`)])).toEqual([
      ["Cuisine", ["1:Croque", "2:Tarte"]],
      ["Bar", ["0:Espresso"]],
    ]);
  });

  it("réclamer : une réclame par suite, rien pour « En direct », un bon par poste qui tient déjà la suite", () => {
    let c = toutEnvoyer(table());
    expect(suitesAReclamer(c)).toEqual([1, 2]);
    expect(bonsReclame(c, carte, 1).map((b) => [b.poste, b.reclame, b.articles.map((a) => a.libelle)])).toEqual([["Cuisine", 1, ["Croque"]]]);
    c = reclamer(c, 1, "u2", "2026-10-15T12:30:00.000Z");
    expect(reclamer(c, 1, "u3")).toBe(c);
    expect(suitesAReclamer(c)).toEqual([2]);
    expect(c.reclames).toEqual([{ suite: 1, le: "2026-10-15T12:30:00.000Z", par: "u2" }]);
    // Pas encore envoyé : l'article partira avec l'envoi, sans bon de réclame.
    expect(bonsReclame(table(), carte, 1)).toEqual([]);
  });

  it("suivi de salle : prochaine suite et temps depuis le dernier envoi ou la dernière réclame", () => {
    let c = toutEnvoyer(table());
    const envoi = c.lignes[0]!.envoyee!.le;
    expect(suiviSuites(c)).toEqual({ prochaine: 1, derniereReclame: null, dernierMouvement: envoi });
    c = reclamer(reclamer(c, 1, "u1", "2099-01-01T12:00:00.000Z"), 2, "u1", "2099-01-01T12:40:00.000Z");
    expect(suiviSuites(c)).toEqual({
      prochaine: null,
      derniereReclame: { suite: 2, le: "2099-01-01T12:40:00.000Z", par: "u1" },
      dernierMouvement: "2099-01-01T12:40:00.000Z",
    });
  });

  it("une suite dont tout est retiré n'est plus à réclamer ; un supplément garde sa suite", () => {
    let c = toutEnvoyer(table());
    const tarte = c.lignes.find((l) => l.libelle === "Tarte")!;
    c = modifierLigne(c, tarte.uid, null, 1, "u1");
    expect(suitesAReclamer(c)).toEqual([1]);
    const croque = c.lignes.find((l) => l.libelle === "Croque")!;
    c = modifierLigne(c, croque.uid, { ...croque, quantite: 3 }, 0, "u1");
    expect(c.lignes.filter((l) => l.libelle === "Croque").map((l) => [l.quantite, l.suite, !!l.envoyee])).toEqual([
      [2, 1, true],
      [1, 1, false],
    ]);
  });

  it("transfert et regroupement gardent les suites ; une suite reste réclamée si elle l'était partout", () => {
    const a = reclamer(toutEnvoyer(table()), 1, "u1", "2026-10-15T12:30:00.000Z");
    expect(transfererCommande(a, "t9").reclames).toEqual(a.reclames);
    // L'autre table a aussi des articles à suivre 1, pas encore réclamés : la suite redevient à réclamer.
    const b = toutEnvoyer(ajouterLigne(nouvelleCommande("t2", "u1"), ligne("croque", "Croque", 900, 1)));
    const fusion = fusionnerCommandes(a, b);
    expect(fusion.reclames).toBeUndefined();
    expect(suitesAReclamer(fusion)).toEqual([1, 2]);
    // Sans article à suivre 1 de l'autre côté, la réclame tient.
    const c = toutEnvoyer(ajouterLigne(nouvelleCommande("t3", "u1"), ligne("cafe", "Espresso", 270)));
    expect(fusionnerCommandes(a, c).reclames).toEqual(a.reclames);
  });
});
