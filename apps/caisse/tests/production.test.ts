import type { Catalogue } from "@matalon/catalogue";
import { describe, expect, it } from "vitest";
import { ajouterLigne, modifierLigne, nouvelleCommande, type Commande } from "../src/metier/commande";
import { aEnvoyerDans, bonsAEnvoyer, nbLignesAEnvoyer, posteArticle, validerEnvoi, type Bon } from "../src/metier/production";

const carte: Catalogue = {
  id: "c",
  nom: "Carte",
  source: "test",
  etablissementId: "moka",
  categories: [
    { id: "chauds", nom: "Chauds", rayon: "Boissons", poste: "Bar", articles: [{ id: "cafe", nom: "Espresso", prixTTC: 270, tauxTVA: 1000 }] },
    { id: "plats", nom: "Plats", rayon: "Cuisine", poste: "Cuisine", articles: [{ id: "croque", nom: "Croque", prixTTC: 900, tauxTVA: 1000 }] },
    { id: "gateaux", nom: "Gâteaux", rayon: "Goûter", articles: [{ id: "cookie", nom: "Cookie", prixTTC: 300, tauxTVA: 1000 }] },
    { id: "formules", nom: "Formules", rayon: "Formules", articles: [{ id: "midi", nom: "Formule midi", prixTTC: 1400, tauxTVA: 1000 }] },
  ],
};

const ligne = (articleId: string, libelle: string, prix: number) => ({
  articleId,
  libelle,
  details: [],
  quantite: 1,
  prixUnitaireTTC: prix,
  tauxTVA: 1000,
  ajouteePar: "u1",
});
const cafe = ligne("cafe", "Espresso", 270);
const croque = ligne("croque", "Croque", 900);

const toutEnvoyer = (c: Commande) => validerEnvoi(c, aEnvoyerDans(c, true), new Set(), "u1");

describe("bons de production", () => {
  it("regroupe les articles par poste ; une catégorie sans poste n'imprime rien", () => {
    const c = ajouterLigne(ajouterLigne(ajouterLigne(nouvelleCommande("t1", "u1"), cafe), croque), ligne("cookie", "Cookie", 300));
    const bons = bonsAEnvoyer(c, carte);
    expect(bons.map((b) => [b.poste, b.articles.map((a) => a.libelle)])).toEqual([
      ["Bar", ["Espresso"]],
      ["Cuisine", ["Croque"]],
    ]);
    // « Envoyer » valide aussi la ligne sans poste (cookie) : trois lignes, deux bons.
    expect(nbLignesAEnvoyer(c, true)).toBe(3);
  });

  it("une variante ou un supplément suit le poste de son article", () => {
    expect(posteArticle(carte, "cafe:double")).toBe("Bar");
    expect(posteArticle(carte, "croque+oeuf")).toBe("Cuisine");
    expect(posteArticle(carte, "inconnu")).toBeNull();
  });

  it("une formule envoie chaque choix à son poste, les choix sans poste suivant la formule", () => {
    const c = ajouterLigne(nouvelleCommande("t1", "u1"), {
      ...ligne("midi", "Formule midi", 1400),
      details: ["Croque", "Espresso", "Cookie"],
      composants: [
        { libelle: "Croque", categorieId: "plats" },
        { libelle: "Espresso", categorieId: "chauds" },
        { libelle: "Cookie", categorieId: "gateaux" },
      ],
    });
    const bons = bonsAEnvoyer(c, carte);
    expect(bons.map((b) => [b.poste, b.articles[0]!.details])).toEqual([
      ["Cuisine", ["Croque"]],
      ["Bar", ["Espresso"]],
    ]);
  });

  it("une ligne envoyée ne repart pas et ne se regroupe plus avec un nouvel article identique", () => {
    let c = toutEnvoyer(ajouterLigne(nouvelleCommande("t1", "u1"), cafe));
    expect(c.lignes[0]!.envoyee?.par).toBe("u1");
    expect(bonsAEnvoyer(c, carte)).toEqual([]);
    c = ajouterLigne(c, cafe);
    expect(c.lignes).toHaveLength(2);
    expect(bonsAEnvoyer(c, carte).map((b) => b.articles.length)).toEqual([1]);
  });

  it("augmenter la quantité d'une ligne envoyée crée une ligne à envoyer pour la différence", () => {
    let c = toutEnvoyer(ajouterLigne(nouvelleCommande("t1", "u1"), cafe));
    const l = c.lignes[0]!;
    c = modifierLigne(c, l.uid, { ...l, quantite: 3 }, 0, "u2");
    expect(c.lignes.map((x) => [x.quantite, !!x.envoyee])).toEqual([
      [1, true],
      [2, false],
    ]);
    expect(bonsAEnvoyer(c, carte)[0]!.articles[0]!.quantite).toBe(2);
  });

  it("retirer un article envoyé donne un bon d'annulation, une seule fois", () => {
    let c = toutEnvoyer(ajouterLigne(nouvelleCommande("t1", "u1"), { ...cafe, quantite: 3 }));
    const l = c.lignes[0]!;
    c = modifierLigne(c, l.uid, { ...l, quantite: 1 }, 2, "u2");
    const annulations = bonsAEnvoyer(c, carte, { annulationsSeules: true });
    expect(annulations).toHaveLength(1);
    expect(annulations[0]).toMatchObject({ poste: "Bar", annulation: true, articles: [{ quantite: 2, libelle: "Espresso" }] });
    c = validerEnvoi(c, aEnvoyerDans(c, true, { annulationsSeules: true }), new Set(), "u2");
    expect(bonsAEnvoyer(c, carte)).toEqual([]);
  });

  it("avant envoi, la commande est un brouillon : un retrait efface la ligne, sans bon", () => {
    let c = ajouterLigne(nouvelleCommande("t1", "u1"), { ...cafe, quantite: 3 });
    c = modifierLigne(c, c.lignes[0]!.uid, { ...c.lignes[0]!, quantite: 1 }, 2, "u2");
    expect(c.lignes.map((l) => [l.quantite, !!l.retiree])).toEqual([[1, false]]);
    c = modifierLigne(c, c.lignes[0]!.uid, null, 1, "u2");
    expect(c.lignes).toEqual([]);
    expect(bonsAEnvoyer(c, carte)).toEqual([]);
  });

  it("sans imprimante de production, Envoyer valide la commande sans bon", () => {
    const c = ajouterLigne(ajouterLigne(nouvelleCommande("t1", "u1"), cafe), croque);
    expect(nbLignesAEnvoyer(c, false)).toBe(2);
    const suite = validerEnvoi(c, aEnvoyerDans(c, false), new Set(), "u1");
    expect(suite.lignes.every((l) => l.envoyee)).toBe(true);
    // Un retrait après envoi est barré, sans annulation à imprimer.
    const retiree = modifierLigne(suite, suite.lignes[0]!.uid, null, 1, "u1");
    expect(retiree.lignes[0]!.retiree).toBeDefined();
    expect(nbLignesAEnvoyer(retiree, false)).toBe(0);
  });

  it("un bon en échec laisse ses lignes à envoyer, les autres postes sont marqués", () => {
    const c = ajouterLigne(ajouterLigne(nouvelleCommande("t1", "u1"), cafe), croque);
    const bons = bonsAEnvoyer(c, carte);
    const cuisine = bons.find((b) => b.poste === "Cuisine")!;
    const suite = validerEnvoi(c, aEnvoyerDans(c, true), new Set<Bon>([cuisine]), "u1");
    expect(suite.lignes.map((l) => [l.libelle, !!l.envoyee])).toEqual([
      ["Espresso", true],
      ["Croque", false],
    ]);
    expect(bonsAEnvoyer(suite, carte).map((b) => b.poste)).toEqual(["Cuisine"]);
  });

  it("un article ajouté pendant l'impression reste à envoyer", () => {
    const c = ajouterLigne(nouvelleCommande("t1", "u1"), cafe);
    const prevu = aEnvoyerDans(c, true);
    const pendant = ajouterLigne(c, croque);
    const suite = validerEnvoi(pendant, prevu, new Set(), "u1");
    expect(bonsAEnvoyer(suite, carte).map((b) => b.poste)).toEqual(["Cuisine"]);
  });
});
