import type { Fiche } from "@matalon/stock";
import { TAUX_TVA_AUTORISES, type Article, type Catalogue, type Categorie, type ChoixFormule, type Supplement, type Variante } from "./types.js";

export * from "./types.js";
export { lireCatalogue, LIMITES_CARTE } from "./lecture.js";
import { CARTE_AUTOMNE_2026 } from "./cartes/automne-2026.js";
export { CARTE_AUTOMNE_2026 };

/** Cartes disponibles, par identifiant. Un établissement référence sa carte par cet identifiant. */
export const CARTES: Record<string, Catalogue> = {
  [CARTE_AUTOMNE_2026.id]: CARTE_AUTOMNE_2026,
};

export function tousLesArticles(c: Catalogue): Array<Article & { categorieId: string }> {
  return c.categories.flatMap((cat) => cat.articles.map((a) => ({ ...a, categorieId: cat.id })));
}

/** Un emplacement de fiche technique de la carte : article, variante ou supplément, avec son prix de vente. */
export interface EmplacementFiche {
  /** Clé de vente : « article », « article:variante », « article+supplément » (comme les lignes de ticket). */
  cle: string;
  articleId: string;
  libelle: string;
  categorie: string;
  fiche?: Fiche;
  /** Fiche héritée de l'article (variante sans fiche propre). */
  heritee?: boolean;
  prixTTC: number | null;
  tauxTVA: number;
  /** Formule : ses choix consomment la fiche des articles choisis. */
  formule?: boolean;
}

/** Tous les emplacements de fiche d'une carte, pour la liaison avec le stock et le food cost. */
export function emplacementsFiches(c: Catalogue): EmplacementFiche[] {
  const liste: EmplacementFiche[] = [];
  for (const cat of c.categories) {
    for (const a of cat.articles) {
      const base = { articleId: a.id, categorie: cat.nom, tauxTVA: a.tauxTVA };
      if (a.variantes?.length) {
        for (const v of a.variantes) {
          const fiche = v.fiche ?? a.fiche;
          liste.push({ ...base, cle: `${a.id}:${v.id}`, libelle: v.libelle ?? `${a.nom} ${v.nom}`, prixTTC: v.prixTTC ?? a.prixTTC, ...(fiche ? { fiche } : {}), ...(!v.fiche && a.fiche ? { heritee: true } : {}) });
        }
      } else {
        liste.push({ ...base, cle: a.id, libelle: a.nom, prixTTC: a.prixTTC, ...(a.fiche ? { fiche: a.fiche } : {}), ...(a.formule?.length ? { formule: true } : {}) });
      }
      for (const s of a.supplements ?? []) {
        liste.push({ ...base, cle: `${a.id}+${s.id}`, libelle: `${a.nom} + ${s.nom}`, prixTTC: s.prixTTC, ...(s.fiche ? { fiche: s.fiche } : {}) });
      }
    }
  }
  return liste;
}

/**
 * Fiche technique d'une clé de vente (ligne de ticket) : article, variante
 * (sa fiche, sinon celle de l'article) ou supplément.
 */
export function ficheDeCle(c: Catalogue, cle: string): Fiche | undefined {
  const [base, suite] = cle.split(/([:+].*)/);
  const a = tousLesArticles(c).find((x) => x.id === base);
  if (!a) return undefined;
  if (!suite) return a.fiche;
  if (suite.startsWith(":")) return a.variantes?.find((v) => v.id === suite.slice(1))?.fiche ?? a.fiche;
  return a.supplements?.find((s) => s.id === suite.slice(1))?.fiche;
}

/** Libellés proposés pour un choix de formule (article, ou chaque variante) et leur clé de vente. */
export function optionsLibellees(c: Catalogue, choix: ChoixFormule): Array<{ libelle: string; cle: string; categorieId: string }> {
  // Indisponibles compris : une vente passée a pu choisir un article retiré depuis.
  const proposes = tousLesArticles(c).filter((a) => !a.formule?.length && (choix.articles?.includes(a.id) || choix.categories?.includes(a.categorieId)));
  return proposes.flatMap((a) =>
    a.variantes?.length
      ? a.variantes.map((v) => ({ libelle: v.libelle ?? `${a.nom} ${v.nom}`, cle: `${a.id}:${v.id}`, categorieId: a.categorieId }))
      : [{ libelle: a.nom, cle: a.id, categorieId: a.categorieId }],
  );
}

/**
 * Choix d'une formule retrouvés dans le libellé de la ligne de ticket
 * (« Formule midi (Croque, Espresso) ») : la clé de vente de chacun, dans
 * l'ordre des choix. Null si le libellé ne se relit pas avec cette carte.
 */
export function clesDeFormule(c: Catalogue, articleId: string, libelleLigne: string): string[] | null {
  const a = tousLesArticles(c).find((x) => x.id === articleId);
  if (!a?.formule?.length) return null;
  const debut = `${a.nom} (`;
  if (!libelleLigne.startsWith(debut) || !libelleLigne.endsWith(")")) return null;
  let reste = libelleLigne.slice(debut.length, -1);
  const cles: string[] = [];
  for (const [i, choix] of a.formule.entries()) {
    const dernier = i === a.formule.length - 1;
    const options = optionsLibellees(c, choix).sort((x, y) => y.libelle.length - x.libelle.length);
    const o = options.find((x) => (dernier ? reste === x.libelle : reste.startsWith(`${x.libelle}, `)));
    if (!o) return null;
    cles.push(o.cle);
    reste = reste.slice(o.libelle.length + (dernier ? 0 : 2));
  }
  return cles;
}

export function trouverArticle(c: Catalogue, id: string): Article | undefined {
  return tousLesArticles(c).find((a) => a.id === id);
}

/**
 * Prix et taux de la carte pour l'identifiant d'une ligne de ticket : article
 * (« a »), variante (« a:v ») ou supplément (« a+s »), comme les forment
 * `ligneDepuisArticle` et `ligneSupplement`. Null si l'article n'y est pas ou
 * n'a pas de prix.
 */
export function prixCarte(c: Catalogue, articleId: string): { prixTTC: number; tauxTVA: number; nom: string } | null {
  const plus = articleId.indexOf("+");
  const deux = articleId.indexOf(":");
  const coupe = plus >= 0 ? plus : deux;
  const a = trouverArticle(c, coupe >= 0 ? articleId.slice(0, coupe) : articleId);
  if (!a) return null;
  if (plus >= 0) {
    const s = a.supplements?.find((x) => x.id === articleId.slice(plus + 1));
    return s ? { prixTTC: s.prixTTC, tauxTVA: a.tauxTVA, nom: `${a.nom} + ${s.nom}` } : null;
  }
  if (deux >= 0) {
    const v = a.variantes?.find((x) => x.id === articleId.slice(deux + 1));
    const prix = v?.prixTTC ?? a.prixTTC;
    return v && prix != null ? { prixTTC: prix, tauxTVA: a.tauxTVA, nom: v.libelle ?? `${a.nom} ${v.nom}` } : null;
  }
  return a.prixTTC == null ? null : { prixTTC: a.prixTTC, tauxTVA: a.tauxTVA, nom: a.nom };
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
  const categories = new Set<string>();
  for (const cat of c.categories) {
    if (categories.has(cat.id)) erreurs.push(`catégorie en double : ${cat.id}`);
    categories.add(cat.id);
    if (!cat.rayon?.trim()) erreurs.push(`catégorie ${cat.nom} : rayon manquant`);
  }
  const articles = tousLesArticles(c);
  for (const a of articles) {
    if (ids.has(a.id)) erreurs.push(`identifiant en double : ${a.id}`);
    ids.add(a.id);
    if (!/^[a-z0-9-]+$/.test(a.id)) erreurs.push(`identifiant non normalisé : ${a.id}`);
    const prix = [a.prixTTC, ...(a.variantes ?? []).map((v) => v.prixTTC), ...(a.supplements ?? []).map((s) => s.prixTTC)];
    for (const p of prix) {
      if (p != null && (!Number.isSafeInteger(p) || p < 0)) erreurs.push(`prix invalide sur ${a.id}`);
    }
    if (!(TAUX_TVA_AUTORISES as readonly number[]).includes(a.tauxTVA)) erreurs.push(`taux de TVA inattendu sur ${a.id}`);
    for (const [nom, liste] of [
      ["variante", a.variantes ?? []],
      ["supplément", a.supplements ?? []],
      ["choix", a.formule ?? []],
    ] as const) {
      const vus = new Set<string>();
      for (const x of liste) {
        if (vus.has(x.id)) erreurs.push(`${nom} en double sur ${a.id} : ${x.id}`);
        vus.add(x.id);
      }
    }
    if (a.variantes?.length && a.prixTTC == null && a.variantes.some((v) => v.prixTTC == null) && !a.aCompleter) {
      erreurs.push(`${a.id} : une variante sans prix demande un prix d'article`);
    }
    if (a.formule?.length) {
      if (a.variantes?.length) erreurs.push(`${a.id} : une formule ne peut pas avoir de variantes`);
      if (a.prixTTC == null && !a.aCompleter) erreurs.push(`${a.id} : une formule doit avoir un prix`);
    }
    const sansPrix = a.prixTTC == null && !(a.variantes ?? []).some((v) => v.prixTTC != null);
    if (sansPrix && !a.aCompleter) erreurs.push(`${a.id} : prix manquant (ou indiquer ce qui reste à compléter)`);
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

/** Nombre d'articles d'une carte. */
export const nombreArticles = (c: Catalogue) => c.categories.reduce((n, cat) => n + cat.articles.length, 0);

/** Identifiant lisible et unique tiré d'un nom (« Flat white » → « flat-white », « flat-white-2 »…). */
export function identifiantDepuisNom(nom: string, existants: Iterable<string>): string {
  const base =
    nom
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/œ/g, "oe")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50)
      .replace(/-+$/, "") || "article";
  const pris = new Set(existants);
  if (base.length < 2) return identifiantDepuisNom(`${base}-1`, pris);
  if (!pris.has(base)) return base;
  for (let n = 2; ; n++) if (!pris.has(`${base}-${n}`)) return `${base}-${n}`;
}

/** Articles proposés pour un choix de formule : ceux des catégories et articles visés, disponibles, hors formules. */
export function optionsChoix(c: Catalogue, choix: ChoixFormule): Array<Article & { categorieId: string }> {
  return tousLesArticles(c).filter(
    (a) => !a.indisponible && !a.formule?.length && (choix.articles?.includes(a.id) || choix.categories?.includes(a.categorieId)),
  );
}

/** Un article se vend s'il est disponible et si chaque choix de sa formule a au moins une option. */
export function articleVendable(c: Catalogue, a: Article): boolean {
  return !a.indisponible && (a.formule ?? []).every((choix) => optionsChoix(c, choix).length > 0);
}

/** Taux de TVA des articles d'une catégorie (une catégorie vide n'en a aucun). */
export function tauxDeCategorie(c: Categorie): number[] {
  return [...new Set(c.articles.map((a) => a.tauxTVA))].sort((a, b) => a - b);
}

/**
 * Pourquoi deux catégories ne peuvent pas être fusionnées, ou `null` si elles
 * le peuvent : il faut qu'elles n'aient qu'un seul et même taux de TVA.
 */
export function fusionImpossible(source: Categorie, cible: Categorie): string | null {
  if (source.id === cible.id) return "une catégorie ne se fusionne pas avec elle-même";
  const taux = [...new Set([...tauxDeCategorie(source), ...tauxDeCategorie(cible)])];
  if (taux.length > 1) return `taux de TVA différents (${taux.map((t) => `${t / 100} %`).join(" et ")})`;
  return null;
}

/**
 * Fusionne `sourceId` dans `cibleId` : les articles de la source passent à la
 * suite de ceux de la cible, les formules qui proposaient la source proposent
 * la cible, puis la source disparaît. La cible garde son nom et son rayon.
 */
export function fusionnerCategories(c: Catalogue, sourceId: string, cibleId: string): Catalogue {
  const source = c.categories.find((x) => x.id === sourceId);
  const cible = c.categories.find((x) => x.id === cibleId);
  if (!source || !cible) throw new Error("Catégorie introuvable.");
  const raison = fusionImpossible(source, cible);
  if (raison) throw new Error(`Fusion impossible : ${raison}.`);
  const redirige = (ids?: string[]) => (ids ? [...new Set(ids.map((x) => (x === sourceId ? cibleId : x)))] : ids);
  return {
    ...c,
    categories: c.categories
      .filter((x) => x.id !== sourceId)
      .map((x) => (x.id === cibleId ? { ...x, articles: [...x.articles, ...source.articles] } : x))
      .map((x) => ({
        ...x,
        articles: x.articles.map((a) =>
          a.formule ? { ...a, formule: a.formule.map((ch) => (ch.categories ? { ...ch, categories: redirige(ch.categories) } : ch)) } : a,
        ),
      })),
  };
}

/** Postes de production cités par la carte, dans l'ordre d'apparition. */
export function postesDeLaCarte(c: Catalogue): string[] {
  return [...new Set(c.categories.map((x) => x.poste).filter((x): x is string => !!x))];
}
