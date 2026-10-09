import { describe, expect, it } from "vitest";
import {
  articlesACompleter,
  emplacementsFiches,
  ficheDeCle,
  clesDeFormule,
  lireCatalogue,
  postesDeLaCarte,
  fusionImpossible,
  fusionnerCategories,
  CARTE_AUTOMNE_2026,
  ligneDepuisArticle,
  ligneSupplement,
  prixCarte,
  tousLesArticles,
  trouverArticle,
  validerCatalogue,
} from "../src/index.js";

describe("carte automne 2026", () => {
  it("est cohérente", () => {
    expect(validerCatalogue(CARTE_AUTOMNE_2026)).toEqual([]);
  });

  it("reprend les prix de la carte", () => {
    const prix = (id: string) => trouverArticle(CARTE_AUTOMNE_2026, id)?.prixTTC;
    expect(prix("espresso")).toBe(250);
    expect(prix("pain-au-chocolat")).toBe(220);
    expect(prix("egg-muffin-moka")).toBe(950);
    expect(prix("moscow-mule")).toBe(1300);
    expect(prix("planche-mer")).toBe(2400);
    expect(prix("dejeuner-moka")).toBe(1900);
  });

  it("applique 20 % aux boissons alcoolisées et 10 % au reste", () => {
    const tva = (id: string) => trouverArticle(CARTE_AUTOMNE_2026, id)?.tauxTVA;
    expect(tva("spritz-aperol")).toBe(2000);
    expect(tva("funambules-ipa")).toBe(2000);
    expect(tva("virgin-martini-spritz")).toBe(1000);
    expect(tva("sundown")).toBe(1000);
    expect(tva("bubble-tea")).toBe(1000);
  });

  it("liste ce qui manque avant la mise en caisse", () => {
    expect(articlesACompleter(CARTE_AUTOMNE_2026).map((a) => a.id)).toEqual([
      "vin-verre",
      "vin-bouteille",
      "biere-artisanale",
    ]);
  });

  it("produit des lignes de ticket avec variante et supplément", () => {
    const bubble = trouverArticle(CARTE_AUTOMNE_2026, "bubble-tea")!;
    expect(() => ligneDepuisArticle(bubble)).toThrow(/variante/);
    expect(ligneDepuisArticle(bubble, { varianteId: "taro" })).toEqual({
      articleId: "bubble-tea:taro",
      libelle: "Bubble tea Taro",
      quantite: 1,
      prixUnitaireTTC: 650,
      tauxTVA: 1000,
    });
    expect(ligneSupplement(bubble, bubble.supplements![1]!)).toMatchObject({ libelle: "Suppl. Perles popping", prixUnitaireTTC: 50 });
    const eau = trouverArticle(CARTE_AUTOMNE_2026, "eau-minerale")!;
    expect(ligneDepuisArticle(eau, { varianteId: "100cl" })).toMatchObject({ libelle: "Eau minérale 100 cl", prixUnitaireTTC: 550 });
    const coca = trouverArticle(CARTE_AUTOMNE_2026, "coca")!;
    expect(ligneDepuisArticle(coca, { varianteId: "zero" }).libelle).toBe("Coca zero");
  });

  it("retrouve le prix de la carte de chaque ligne produite (contrôle des prix vendus)", () => {
    const bubble = trouverArticle(CARTE_AUTOMNE_2026, "bubble-tea")!;
    const lignes = [
      ligneDepuisArticle(bubble, { varianteId: "taro" }),
      ligneSupplement(bubble, bubble.supplements![1]!),
      ...tousLesArticles(CARTE_AUTOMNE_2026)
        .filter((a) => a.prixTTC != null && !a.variantes?.length)
        .map((a) => ligneDepuisArticle(a)),
    ];
    for (const l of lignes) expect(prixCarte(CARTE_AUTOMNE_2026, l.articleId)).toMatchObject({ prixTTC: l.prixUnitaireTTC, tauxTVA: l.tauxTVA });
    expect(prixCarte(CARTE_AUTOMNE_2026, "inconnu")).toBeNull();
    expect(prixCarte(CARTE_AUTOMNE_2026, "bubble-tea:inconnue")).toBeNull();
    expect(prixCarte(CARTE_AUTOMNE_2026, "bubble-tea+inconnu")).toBeNull();
  });

  it("compte les articles de la carte (variantes regroupées)", () => {
    expect(tousLesArticles(CARTE_AUTOMNE_2026).length).toBe(93);
  });
});

describe("lecture et édition d'une carte", () => {
  it("relit la carte du Moka à l'identique après un passage en JSON", async () => {
    const { lireCatalogue } = await import("../src/index.js");
    const { catalogue, erreurs } = lireCatalogue(JSON.parse(JSON.stringify(CARTE_AUTOMNE_2026)));
    expect(erreurs).toEqual([]);
    expect(catalogue).toEqual(JSON.parse(JSON.stringify(CARTE_AUTOMNE_2026)));
  });

  it("refuse prix décimaux, TVA inconnue, identifiants libres et choix vides, et retire les champs inconnus", async () => {
    const { lireCatalogue } = await import("../src/index.js");
    const { catalogue, erreurs } = lireCatalogue({
      id: "test",
      nom: "Test",
      categories: [
        {
          id: "cafes",
          nom: "Cafés",
          rayon: "Boissons",
          articles: [
            { id: "Espresso Long", nom: "Espresso", prixTTC: 2.5, tauxTVA: 700 },
            { id: "menu", nom: "Menu", prixTTC: 900, tauxTVA: 1000, formule: [{ id: "x", nom: "Au choix" }] },
          ],
        },
      ],
    });
    expect(catalogue).toBeNull();
    expect(erreurs.join("\n")).toMatch(/identifiant en minuscules/);
    expect(erreurs.join("\n")).toMatch(/prix en centimes/);
    expect(erreurs.join("\n")).toMatch(/taux de TVA/);
    expect(erreurs.join("\n")).toMatch(/aucune catégorie ni article/);
    const propre = lireCatalogue({ id: "t", nom: "T", pirate: 1, categories: [{ id: "c", nom: "C", rayon: "R", articles: [{ id: "a", nom: "A", prixTTC: 100, tauxTVA: 1000, script: "x" }] }] });
    expect(propre.catalogue).toEqual({ id: "t", nom: "T", source: "", etablissementId: "", categories: [{ id: "c", nom: "C", rayon: "R", articles: [{ id: "a", nom: "A", prixTTC: 100, tauxTVA: 1000 }] }] });
  });

  it("forge des identifiants uniques et détecte une formule qui pointe sur un article supprimé", async () => {
    const { identifiantDepuisNom } = await import("../src/index.js");
    expect(identifiantDepuisNom("Œuf cocotte à l'estragon", [])).toBe("oeuf-cocotte-a-l-estragon");
    expect(identifiantDepuisNom("Flat white", ["flat-white", "flat-white-2"])).toBe("flat-white-3");
    const sansJus = structuredClone(CARTE_AUTOMNE_2026);
    for (const c of sansJus.categories) c.articles = c.articles.filter((a) => a.id !== "orange-pressee");
    expect(validerCatalogue(sansJus)).toContain("formule brunch-moka : article inconnu orange-pressee");
  });
});

describe("règles de la relecture du lot 2", () => {
  it("refuse formule sans prix ou à variantes, article sans prix non signalé, texte non imprimable, fourchette inversée", async () => {
    const { lireCatalogue, articleVendable, identifiantDepuisNom } = await import("../src/index.js");
    const carte = (articles: unknown[]) => ({ id: "t", nom: "T", categories: [{ id: "c", nom: "C", rayon: "R", articles }] });
    const choix = [{ id: "x", nom: "Boisson", categories: ["c"] }];
    const cas = [
      [{ id: "menu", nom: "Menu", prixTTC: null, tauxTVA: 1000, variantes: [{ id: "v", nom: "Grand", prixTTC: 900 }], formule: choix }, /formule ne peut pas avoir de variantes/],
      [{ id: "menu", nom: "Menu", prixTTC: null, tauxTVA: 1000, formule: choix }, /formule doit avoir un prix/],
      [{ id: "vin", nom: "Vin", prixTTC: null, tauxTVA: 2000 }, /prix manquant/],
    ] as const;
    for (const [article, attendu] of cas) {
      const lu = lireCatalogue(carte([article]));
      expect(validerCatalogue(lu.catalogue!).join("\n")).toMatch(attendu);
    }
    expect(lireCatalogue(carte([{ id: "a", nom: "Café\nlong", prixTTC: 200, tauxTVA: 1000 }])).erreurs.join()).toMatch(/non imprimable/);
    expect(lireCatalogue(carte([{ id: "a", nom: "A", prixTTC: 200, tauxTVA: 1000, fourchette: { min: 900, max: 500 } }])).erreurs.join()).toMatch(/fourchette inversée/);
    expect(lireCatalogue(carte(Array.from({ length: 201 }, (_, i) => ({ id: `a${i}`, nom: "A", prixTTC: 1, tauxTVA: 1000 })))).erreurs.join()).toMatch(/200 au plus/);
    // Une formule dont un choix n'a plus aucune option disponible ne se vend pas.
    const c = lireCatalogue(carte([{ id: "cafe", nom: "Café", prixTTC: 200, tauxTVA: 1000, indisponible: true }, { id: "menu", nom: "Menu", prixTTC: 900, tauxTVA: 1000, formule: choix }])).catalogue!;
    expect(articleVendable(c, c.categories[0]!.articles[1]!)).toBe(false);
    expect(identifiantDepuisNom("A", [])).toBe("a-1");
    expect(identifiantDepuisNom(`${"x".repeat(49)} y`, [])).toBe("x".repeat(49));
  });
});

describe("fusion de catégories", () => {
  const art = (id: string, tauxTVA: number) => ({ id, nom: id, prixTTC: 300, tauxTVA });
  const carte = {
    id: "c",
    nom: "C",
    categories: [
      { id: "cafes", nom: "Cafés", rayon: "Boissons", articles: [art("espresso", 1000)] },
      { id: "thes", nom: "Thés", rayon: "Boissons", articles: [art("the-vert", 1000)] },
      { id: "vins", nom: "Vins", rayon: "Bar", articles: [art("rouge", 2000)] },
      {
        id: "formules",
        nom: "Formules",
        rayon: "Formules",
        articles: [{ id: "pause", nom: "Pause", prixTTC: 500, tauxTVA: 1000, formule: [{ id: "boisson", nom: "Boisson", categories: ["thes", "cafes"] }] }],
      },
    ],
  };

  it("fusionne deux catégories au même taux et redirige les formules", () => {
    const f = fusionnerCategories(carte as never, "thes", "cafes");
    expect(f.categories.map((c) => c.id)).toEqual(["cafes", "vins", "formules"]);
    expect(f.categories[0]!.articles.map((a) => a.id)).toEqual(["espresso", "the-vert"]);
    expect(f.categories[2]!.articles[0]!.formule![0]!.categories).toEqual(["cafes"]);
    expect(validerCatalogue(f)).toEqual([]);
  });

  it("refuse des taux de TVA différents", () => {
    expect(fusionImpossible(carte.categories[0] as never, carte.categories[2] as never)).toContain("taux de TVA différents");
    expect(() => fusionnerCategories(carte as never, "vins", "cafes")).toThrow(/Fusion impossible/);
  });
});

describe("postes de production", () => {
  it("lit le poste d'une catégorie et liste les postes de la carte", () => {
    const carte = {
      id: "c",
      nom: "C",
      categories: [
        { id: "cafes", nom: "Cafés", rayon: "Boissons", poste: "Bar", articles: [] },
        { id: "plats", nom: "Plats", rayon: "Cuisine", poste: "Cuisine", articles: [] },
        { id: "vins", nom: "Vins", rayon: "Bar", poste: "Bar", articles: [] },
        { id: "goodies", nom: "Goodies", rayon: "Boutique", articles: [] },
      ],
    };
    const lu = lireCatalogue(carte);
    expect(lu.erreurs).toEqual([]);
    expect(lu.catalogue!.categories[0]!.poste).toBe("Bar");
    expect(lu.catalogue!.categories[3]).not.toHaveProperty("poste");
    expect(postesDeLaCarte(lu.catalogue!)).toEqual(["Bar", "Cuisine"]);
    expect(lireCatalogue({ ...carte, categories: [{ ...carte.categories[0], poste: "x".repeat(31) }] }).erreurs.length).toBe(1);
  });

  it("lit les fiches techniques et liste leurs emplacements", () => {
    const fiche = { type: "recette", id: "burger", quantite: { valeur: 1000, unite: "piece" } };
    const { catalogue, erreurs } = lireCatalogue({
      id: "c",
      nom: "C",
      categories: [
        {
          id: "plats",
          nom: "Plats",
          rayon: "Cuisine",
          articles: [
            { id: "burger", nom: "Burger", prixTTC: 1650, tauxTVA: 1000, fiche, supplements: [{ id: "cheddar", nom: "Cheddar", prixTTC: 150, fiche: { type: "produit", id: "cheddar", quantite: { valeur: 1000, unite: "piece" } } }] },
            { id: "biere", nom: "Bière", prixTTC: null, tauxTVA: 2000, fiche: { type: "produit", id: "biere", quantite: { valeur: 250, unite: "mL" } }, variantes: [{ id: "50", nom: "50 cl", prixTTC: 800, fiche: { type: "produit", id: "biere", quantite: { valeur: 500, unite: "mL" } } }, { id: "25", nom: "25 cl", prixTTC: 450 }] },
          ],
        },
      ],
    });
    expect(erreurs).toEqual([]);
    expect(catalogue!.categories[0]!.articles[0]!.fiche).toEqual(fiche);
    expect(emplacementsFiches(catalogue!).map((e) => [e.cle, e.fiche?.quantite.valeur, e.heritee ?? false, e.prixTTC])).toEqual([
      ["burger", 1000, false, 1650],
      ["burger+cheddar", 1000, false, 150],
      ["biere:50", 500, false, 800],
      ["biere:25", 250, true, 450],
    ]);
    expect(lireCatalogue({ id: "c", nom: "C", categories: [{ id: "p", nom: "P", rayon: "R", articles: [{ id: "a", nom: "A", prixTTC: 100, tauxTVA: 1000, fiche: { type: "plat", id: "x", quantite: { valeur: 1, unite: "g" } } }] }] }).erreurs[0]).toMatch(/fiche technique : produit ou recette/);
  });

  it("retrouve la fiche d'une clé de vente et les choix d'une formule", () => {
    const fiche = (id: string) => ({ type: "recette" as const, id, quantite: { valeur: 1000, unite: "piece" as const } });
    const carte = {
      id: "c",
      nom: "C",
      source: "",
      etablissementId: "",
      categories: [
        { id: "cafes", nom: "Cafés", rayon: "Boissons", articles: [{ id: "latte", nom: "Latte", prixTTC: 500, tauxTVA: 1000, fiche: fiche("latte"), variantes: [{ id: "xl", nom: "XL", prixTTC: 600, fiche: fiche("latte-xl") }, { id: "s", nom: "S", prixTTC: 450 }], supplements: [{ id: "sirop", nom: "Sirop", prixTTC: 50, fiche: fiche("sirop") }] }] },
        { id: "plats", nom: "Plats", rayon: "Cuisine", articles: [{ id: "croque", nom: "Croque, maison", prixTTC: 900, tauxTVA: 1000, fiche: fiche("croque") }] },
        { id: "formules", nom: "Formules", rayon: "Formules", articles: [{ id: "midi", nom: "Midi", prixTTC: 1400, tauxTVA: 1000, formule: [{ id: "p", nom: "Plat", categories: ["plats"] }, { id: "b", nom: "Boisson", categories: ["cafes"] }] }] },
      ],
    };
    expect(ficheDeCle(carte, "latte")?.id).toBe("latte");
    expect(ficheDeCle(carte, "latte:xl")?.id).toBe("latte-xl");
    expect(ficheDeCle(carte, "latte:s")?.id).toBe("latte");
    expect(ficheDeCle(carte, "latte+sirop")?.id).toBe("sirop");
    expect(ficheDeCle(carte, "inconnu")).toBeUndefined();
    // Un nom de choix peut contenir une virgule : on retrouve quand même le découpage.
    expect(clesDeFormule(carte, "midi", "Midi (Croque, maison, Latte XL)")).toEqual(["croque", "latte:xl"]);
    expect(clesDeFormule(carte, "midi", "Midi (Pizza, Latte XL)")).toBeNull();
    expect(clesDeFormule(carte, "latte", "Latte")).toBeNull();
  });
});
