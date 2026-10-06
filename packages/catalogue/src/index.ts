import type { Article, Catalogue, Supplement, Variante } from "./types.js";

export * from "./types.js";
import { CARTE_AUTOMNE_2026 } from "./cartes/automne-2026.js";
export { CARTE_AUTOMNE_2026 };

/** Cartes disponibles, par identifiant. Un établissement référence sa carte par cet identifiant. */
export const CARTES: Record<string, Catalogue> = {
  [CARTE_AUTOMNE_2026.id]: CARTE_AUTOMNE_2026,
};

export function tousLesArticles(c: Catalogue): Array<Article & { categorieId: string }> {
  return c.categories.flatMap((cat) => cat.articles.map((a) => ({ ...a, categorieId: cat.id })));
}

export function trouverArticle(c: Catalogue, id: string): Article | undefined {
  return tousLesArticles(c).find((a) => a.id === id);
}

/** Articles qu'on ne peut pas encore encaisser : prix ou information manquants. */
export function articlesACompleter(c: Catalogue): Array<{ id: string; nom: string; manque: string }> {
  return tousLesArticles(c)
    .filter((a) => a.aCompleter || a.prixTTC == null)
    .map((a) => ({ id: a.id, nom: a.nom, manque: a.aCompleter ?? "prix manquant" }));
}

/** Ligne prête pour le noyau fiscal (forme de `SaisieLigne`), variante incluse. */
export function ligneDepuisArticle(
  article: Article,
  options: { varianteId?: string; quantite?: number } = {},
): { articleId: string; libelle: string; quantite: number; prixUnitaireTTC: number; tauxTVA: number } {
  let variante: Variante | undefined;
  if (article.variantes?.length) {
    variante = article.variantes.find((v) => v.id === options.varianteId);
    if (!variante) throw new Error(`choisir une variante pour ${article.nom}`);
  }
  const prix = variante?.prixTTC ?? article.prixTTC;
  if (prix == null) throw new Error(`${article.nom} n'a pas de prix`);
  const libelle = variante ? (variante.libelle ?? `${article.nom} ${variante.nom}`) : article.nom;
  return {
    articleId: variante ? `${article.id}:${variante.id}` : article.id,
    libelle,
    quantite: options.quantite ?? 1,
    prixUnitaireTTC: prix,
    tauxTVA: article.tauxTVA,
  };
}

/** Ligne de supplément, au taux de l'article qu'il accompagne. */
export function ligneSupplement(article: Article, supplement: Supplement, quantite = 1) {
  return {
    articleId: `${article.id}+${supplement.id}`,
    libelle: `Suppl. ${supplement.nom}`,
    quantite,
    prixUnitaireTTC: supplement.prixTTC,
    tauxTVA: article.tauxTVA,
  };
}

/** Contrôles de cohérence d'une carte avant publication en caisse. */
export function validerCatalogue(c: Catalogue): string[] {
  const erreurs: string[] = [];
  const ids = new Set<string>();
  const categories = new Set(c.categories.map((x) => x.id));
  const articles = tousLesArticles(c);
  for (const a of articles) {
    if (ids.has(a.id)) erreurs.push(`identifiant en double : ${a.id}`);
    ids.add(a.id);
    if (!/^[a-z0-9-]+$/.test(a.id)) erreurs.push(`identifiant non normalisé : ${a.id}`);
    const prix = [a.prixTTC, ...(a.variantes ?? []).map((v) => v.prixTTC), ...(a.supplements ?? []).map((s) => s.prixTTC)];
    for (const p of prix) {
      if (p != null && (!Number.isSafeInteger(p) || p < 0)) erreurs.push(`prix invalide sur ${a.id}`);
    }
    if (![550, 1000, 2000].includes(a.tauxTVA)) erreurs.push(`taux de TVA inattendu sur ${a.id}`);
  }
  for (const a of articles) {
    for (const choix of a.formule ?? []) {
      for (const cat of choix.categories ?? []) {
        if (!categories.has(cat)) erreurs.push(`formule ${a.id} : catégorie inconnue ${cat}`);
      }
      for (const art of choix.articles ?? []) {
        if (!ids.has(art)) erreurs.push(`formule ${a.id} : article inconnu ${art}`);
      }
    }
  }
  return erreurs;
}
