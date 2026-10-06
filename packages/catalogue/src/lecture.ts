import { TAUX_TVA_AUTORISES, type Article, type Catalogue, type Categorie, type ChoixFormule, type Supplement, type Variante } from "./types.js";

/**
 * Lecture stricte d'une carte venue de l'extérieur (administration, réseau) :
 * seuls les champs connus sont repris, au bon type. Renvoie la carte
 * reconstruite et la liste des erreurs, en français, lisibles par un humain.
 */
/** Plafonds : une carte de restaurant reste loin de ces volumes, servis à chaque iPad. */
export const LIMITES_CARTE = { categories: 100, articlesParCategorie: 200, articles: 1500, options: 40, choixFormule: 12 } as const;

export function lireCatalogue(v: unknown): { catalogue: Catalogue | null; erreurs: string[] } {
  const erreurs: string[] = [];
  const objet = (x: unknown, ou: string): Record<string, unknown> => {
    if (typeof x !== "object" || x === null || Array.isArray(x)) {
      erreurs.push(`${ou} : objet attendu`);
      return {};
    }
    return x as Record<string, unknown>;
  };
  const liste = (x: unknown, ou: string, max: number = LIMITES_CARTE.options): unknown[] => {
    if (x === undefined) return [];
    if (!Array.isArray(x)) {
      erreurs.push(`${ou} : liste attendue`);
      return [];
    }
    if (x.length > max) {
      erreurs.push(`${ou} : ${max} au plus`);
      return x.slice(0, max);
    }
    return x;
  };
  const texte = (x: unknown, ou: string, max = 120, requis = true): string => {
    if (x === undefined && !requis) return "";
    if (typeof x !== "string" || (requis && !x.trim())) {
      erreurs.push(`${ou} : texte obligatoire`);
      return "";
    }
    if (x.length > max) erreurs.push(`${ou} : ${max} caractères au plus`);
    // Ni retour à la ligne ni caractère de contrôle : le texte finit dans les tickets signés et les impressions.
    if (/[\u0000-\u001f\u007f]/.test(x)) erreurs.push(`${ou} : caractère non imprimable`);
    return x.trim();
  };
  const ident = (x: unknown, ou: string): string => {
    const s = texte(x, ou, 60);
    if (s && !/^[a-z0-9-]+$/.test(s)) erreurs.push(`${ou} : identifiant en minuscules, chiffres et tirets`);
    return s;
  };
  const prix = (x: unknown, ou: string, nullable: boolean): number | null => {
    if (x === null && nullable) return null;
    if (typeof x !== "number" || !Number.isSafeInteger(x) || x < 0 || x > 10_000_00) {
      erreurs.push(`${ou} : prix en centimes entier entre 0 et 10 000 €`);
      return nullable ? null : 0;
    }
    return x;
  };
  const optionnel = <T>(x: unknown, f: () => T): T | undefined => (x === undefined || x === null || x === "" ? undefined : f());

  const o = objet(v, "carte");
  const categories: Categorie[] = liste(o.categories, "catégories", LIMITES_CARTE.categories).map((c, i) => {
    const co = objet(c, `catégorie ${i + 1}`);
    const nomCat = texte(co.nom, `catégorie ${i + 1} : nom`);
    const ouCat = `catégorie « ${nomCat || i + 1} »`;
    const poste = optionnel(co.poste, () => texte(co.poste, `${ouCat} : poste de production`, 30));
    return {
      id: ident(co.id, `${ouCat} : identifiant`),
      nom: nomCat,
      rayon: texte(co.rayon, `${ouCat} : rayon`, 40),
      ...(poste ? { poste } : {}),
      articles: liste(co.articles, `${ouCat} : articles`, LIMITES_CARTE.articlesParCategorie).map((a, j): Article => {
        const ao = objet(a, `${ouCat}, article ${j + 1}`);
        const nom = texte(ao.nom, `${ouCat}, article ${j + 1} : nom`);
        const ou = `article « ${nom || j + 1} »`;
        const tauxTVA = ao.tauxTVA;
        if (!TAUX_TVA_AUTORISES.includes(tauxTVA as never)) erreurs.push(`${ou} : taux de TVA 5,5 %, 10 % ou 20 %`);
        const article: Article = {
          id: ident(ao.id, `${ou} : identifiant`),
          nom,
          prixTTC: prix(ao.prixTTC ?? null, `${ou} : prix`, true),
          tauxTVA: tauxTVA as number,
        };
        const description = optionnel(ao.description, () => texte(ao.description, `${ou} : description`, 200));
        if (description) article.description = description;
        const variantes = liste(ao.variantes, `${ou} : variantes`).map((x, k): Variante => {
          const vo = objet(x, `${ou}, variante ${k + 1}`);
          const variante: Variante = { id: ident(vo.id, `${ou}, variante ${k + 1} : identifiant`), nom: texte(vo.nom, `${ou}, variante ${k + 1} : nom`, 60) };
          const libelle = optionnel(vo.libelle, () => texte(vo.libelle, `${ou}, variante : libellé`, 120));
          if (libelle) variante.libelle = libelle;
          const p = optionnel(vo.prixTTC, () => prix(vo.prixTTC, `${ou}, variante « ${variante.nom} » : prix`, false));
          if (p != null) variante.prixTTC = p;
          return variante;
        });
        if (variantes.length) article.variantes = variantes;
        const supplements = liste(ao.supplements, `${ou} : suppléments`).map((x, k): Supplement => {
          const so = objet(x, `${ou}, supplément ${k + 1}`);
          return {
            id: ident(so.id, `${ou}, supplément ${k + 1} : identifiant`),
            nom: texte(so.nom, `${ou}, supplément ${k + 1} : nom`, 60),
            prixTTC: prix(so.prixTTC, `${ou}, supplément ${k + 1} : prix`, false)!,
          };
        });
        if (supplements.length) article.supplements = supplements;
        const formule = liste(ao.formule, `${ou} : formule`, LIMITES_CARTE.choixFormule).map((x, k): ChoixFormule => {
          const fo = objet(x, `${ou}, choix ${k + 1}`);
          const choix: ChoixFormule = { id: ident(fo.id, `${ou}, choix ${k + 1} : identifiant`), nom: texte(fo.nom, `${ou}, choix ${k + 1} : nom`, 60) };
          const cats = liste(fo.categories, `${ou}, choix : catégories`).map((c2) => ident(c2, `${ou}, choix : catégorie`));
          const arts = liste(fo.articles, `${ou}, choix : articles`).map((a2) => ident(a2, `${ou}, choix : article`));
          if (cats.length) choix.categories = cats;
          if (arts.length) choix.articles = arts;
          if (!cats.length && !arts.length) erreurs.push(`${ou}, choix « ${choix.nom} » : aucune catégorie ni article proposé`);
          return choix;
        });
        if (formule.length) article.formule = formule;
        if (ao.fourchette !== undefined && ao.fourchette !== null) {
          const fo = objet(ao.fourchette, `${ou} : fourchette`);
          article.fourchette = { min: prix(fo.min, `${ou} : fourchette`, false)!, max: prix(fo.max, `${ou} : fourchette`, false)! };
          if (article.fourchette.min > article.fourchette.max) erreurs.push(`${ou} : fourchette inversée`);
        }
        const aCompleter = optionnel(ao.aCompleter, () => texte(ao.aCompleter, `${ou} : à compléter`, 200));
        if (aCompleter) article.aCompleter = aCompleter;
        if (ao.indisponible === true) article.indisponible = true;
        return article;
      }),
    };
  });
  const total = categories.reduce((n, c) => n + c.articles.length, 0);
  if (total > LIMITES_CARTE.articles) erreurs.push(`carte : ${LIMITES_CARTE.articles} articles au plus`);
  const catalogue: Catalogue = {
    id: ident(o.id, "carte : identifiant"),
    nom: texte(o.nom, "carte : nom", 80),
    source: texte(o.source ?? "", "carte : source", 120, false),
    etablissementId: texte(o.etablissementId ?? "", "carte : établissement", 60, false),
    categories,
  };
  return { catalogue: erreurs.length ? null : catalogue, erreurs };
}
