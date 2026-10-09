import type { Fiche, PrixAchat, Produit, Quantite, Recette, Referentiel, TypeComposant } from "./types.js";
import { versBase } from "./unites.js";

/**
 * Coûts des fiches techniques, par établissement. Calculés en entiers de
 * micro-euros (millionièmes d'euro) pour que les petites quantités ne
 * s'arrondissent pas à zéro ; affichés en centimes. Ce ne sont pas des
 * montants fiscaux.
 */
export const MICRO_PAR_CENTIME = 10_000;

export interface PrixRetenu {
  articleId: string;
  /** Micro-euros HT par unité de base du produit (g, mL, millième de pièce), en fraction exacte. */
  numerateur: number;
  denominateur: number;
  le: string;
  /** Prix payé par cet établissement, ou emprunté à un autre faute d'achat. */
  source: "etablissement" | "emprunte";
  etablissementId: string;
}

export interface Cout {
  /** Micro-euros HT ; partiel si `manquants` n'est pas vide. */
  micro: number;
  /** Produits sans aucun prix d'achat : leur part manque au coût. */
  manquants: string[];
  /** Produits valorisés au prix d'un autre établissement. */
  emprunts: string[];
  /** Lignes impossibles à convertir (unité), ou composant inconnu. */
  erreurs: string[];
}

const COUT_NUL: Cout = { micro: 0, manquants: [], emprunts: [], erreurs: [] };

const unir = (a: string[], b: string[]) => [...new Set([...a, ...b])];
const ajouter = (a: Cout, b: Cout): Cout => ({
  micro: a.micro + b.micro,
  manquants: unir(a.manquants, b.manquants),
  emprunts: unir(a.emprunts, b.emprunts),
  erreurs: unir(a.erreurs, b.erreurs),
});

/** Dernier prix de chaque article fournisseur, par établissement (le plus récent l'emporte). */
export function derniersPrix(prix: PrixAchat[]): PrixAchat[] {
  const m = new Map<string, PrixAchat>();
  for (const p of prix) {
    const cle = `${p.articleId}|${p.etablissementId}`;
    const actuel = m.get(cle);
    if (!actuel || p.le > actuel.le) m.set(cle, p);
  }
  return [...m.values()];
}

/** Calculateur de coûts d'un établissement sur un référentiel et des prix donnés. */
export class Couts {
  private readonly produits: Map<string, Produit>;
  private readonly recettes: Map<string, Recette>;
  private readonly prixParProduit = new Map<string, PrixRetenu | null>();
  private readonly memo = new Map<string, Cout>();

  constructor(
    private readonly ref: Referentiel,
    private readonly prix: PrixAchat[],
    readonly etablissementId: string,
  ) {
    this.produits = new Map(ref.produits.map((p) => [p.id, p]));
    this.recettes = new Map(ref.recettes.map((r) => [r.id, r]));
  }

  /**
   * Prix retenu pour un produit : le dernier payé par l'établissement (tous
   * ses articles fournisseurs confondus) ; à défaut le dernier payé ailleurs
   * dans le groupe, signalé comme emprunté ; à défaut aucun (jamais zéro).
   */
  prixProduit(produitId: string): PrixRetenu | null {
    if (this.prixParProduit.has(produitId)) return this.prixParProduit.get(produitId)!;
    const articles = new Map(this.ref.articles.filter((a) => a.produitId === produitId && a.quantite > 0).map((a) => [a.id, a]));
    const candidats = this.prix.filter((p) => articles.has(p.articleId));
    const plusRecent = (liste: PrixAchat[]) => liste.reduce<PrixAchat | null>((m, p) => (!m || p.le > m.le ? p : m), null);
    const ici = plusRecent(candidats.filter((p) => p.etablissementId === this.etablissementId));
    const choisi = ici ?? plusRecent(candidats);
    const retenu: PrixRetenu | null = choisi
      ? {
          articleId: choisi.articleId,
          numerateur: choisi.prixHT * MICRO_PAR_CENTIME,
          denominateur: articles.get(choisi.articleId)!.quantite,
          le: choisi.le,
          source: ici ? "etablissement" : "emprunte",
          etablissementId: choisi.etablissementId,
        }
      : null;
    this.prixParProduit.set(produitId, retenu);
    return retenu;
  }

  /** Coût d'une quantité (unité de base du composant) d'un produit ou d'une recette. */
  cout(type: TypeComposant, id: string, quantiteBase: number): Cout {
    if (type === "produit") {
      const p = this.produits.get(id);
      if (!p) return { ...COUT_NUL, erreurs: [`produit inconnu (${id})`] };
      const prix = this.prixProduit(id);
      if (!prix) return { ...COUT_NUL, manquants: [p.nom] };
      return {
        micro: Math.round((prix.numerateur * quantiteBase) / prix.denominateur),
        manquants: [],
        emprunts: prix.source === "emprunte" ? [p.nom] : [],
        erreurs: [],
      };
    }
    const r = this.recettes.get(id);
    if (!r) return { ...COUT_NUL, erreurs: [`recette inconnue (${id})`] };
    const total = this.coutRecette(r, []);
    return { ...total, micro: r.rendement > 0 ? Math.round((total.micro * quantiteBase) / r.rendement) : 0 };
  }

  /** Coût d'une recette pour son rendement entier (une sauce par lot de 1,2 L, un plat à la pièce). */
  coutRecette(r: Recette, pile: string[] = []): Cout {
    const deja = this.memo.get(r.id);
    if (deja) return deja;
    if (pile.includes(r.id)) return { ...COUT_NUL, erreurs: [`« ${r.nom} » se contient elle-même`] };
    let total = COUT_NUL;
    for (const l of r.lignes) {
      const composant = l.type === "produit" ? this.produits.get(l.id) : this.recettes.get(l.id);
      if (!composant) {
        total = ajouter(total, { ...COUT_NUL, erreurs: [`${r.nom} : composant inconnu (${l.id})`] });
        continue;
      }
      const nette = versBase(l.quantite, composant);
      if (nette == null) {
        total = ajouter(total, { ...COUT_NUL, erreurs: [`${r.nom} : « ${composant.nom} » ne se convertit pas dans cette unité`] });
        continue;
      }
      const brute = quantiteBrute(nette, l.perte);
      if (l.type === "produit") total = ajouter(total, this.cout("produit", l.id, brute));
      else {
        const sous = composant as Recette;
        const s = this.coutRecette(sous, [...pile, r.id]);
        total = ajouter(total, { ...s, micro: sous.rendement > 0 ? Math.round((s.micro * brute) / sous.rendement) : 0 });
      }
    }
    this.memo.set(r.id, total);
    return total;
  }

  /** Coût de ce que consomme un article de la carte. */
  coutFiche(f: Fiche): Cout {
    const composant = f.type === "produit" ? this.produits.get(f.id) : this.recettes.get(f.id);
    if (!composant) return { ...COUT_NUL, erreurs: [`${f.type === "produit" ? "produit" : "recette"} inconnu(e) (${f.id})`] };
    const q = versBase(f.quantite, composant);
    if (q == null) return { ...COUT_NUL, erreurs: [`« ${composant.nom} » ne se convertit pas dans cette unité`] };
    return this.cout(f.type, f.id, q);
  }
}

/** Quantité consommée pour une quantité nette et une perte matière (points de base). */
export function quantiteBrute(nette: number, perte?: number): number {
  if (!perte || perte <= 0) return nette;
  return Math.round((nette * 10_000) / (10_000 - perte));
}

/** Prix HT en centimes d'un prix TTC (arrondi au centime). */
export function prixHT(prixTTC: number, tauxTVA: number): number {
  return Math.round((prixTTC * 10_000) / (10_000 + tauxTVA));
}

/** Food cost théorique en points de base (2 850 = 28,5 %) : coût HT / prix de vente HT. Null sans prix. */
export function foodCost(coutMicro: number, prixTTC: number | null | undefined, tauxTVA: number): number | null {
  if (prixTTC == null || prixTTC <= 0) return null;
  const ht = prixHT(prixTTC, tauxTVA);
  return ht > 0 ? Math.round(coutMicro / ht) : null;
}

/** Centimes d'un coût en micro-euros (pour l'affichage). */
export const centimes = (micro: number) => Math.round(micro / MICRO_PAR_CENTIME);

/** Quantité affichée par défaut pour une fiche nouvelle : une pièce, ou rien. */
export function quantiteParDefaut(unite: "kg" | "L" | "piece"): Quantite {
  return unite === "piece" ? { valeur: 1000, unite: "piece" } : unite === "kg" ? { valeur: 100, unite: "g" } : { valeur: 100, unite: "mL" };
}
