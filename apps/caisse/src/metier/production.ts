import type { Catalogue } from "@matalon/catalogue";
import type { Commande, LigneCommande } from "./commande";

/**
 * Bons de production : chaque catégorie de la carte peut désigner un poste
 * (« Bar », « Cuisine ») ; l'établissement associe à chaque poste une
 * imprimante. « Envoyer » imprime, poste par poste, les articles pas encore
 * envoyés ; ce qui reste part d'office à l'encaissement. Une ligne envoyée
 * puis retirée donne un bon d'annulation. Rien de tout cela n'est fiscal.
 */
export interface ArticleBon {
  quantite: number;
  libelle: string;
  details: string[];
  note?: string;
}

export interface Bon {
  poste: string;
  annulation: boolean;
  articles: ArticleBon[];
  /** Lignes de la commande que ce bon couvre (une formule peut en couvrir plusieurs postes). */
  ligneUids: string[];
}

/** Poste d'un article de la carte ; une variante (« a:v ») ou un supplément (« a+s ») suit son article. */
export function posteArticle(carte: Catalogue, articleId: string): string | null {
  const base = articleId.split(/[:+]/)[0];
  return carte.categories.find((c) => c.articles.some((a) => a.id === base))?.poste ?? null;
}

const posteCategorie = (carte: Catalogue, id: string) => carte.categories.find((c) => c.id === id)?.poste ?? null;

/** Ce qu'une ligne donne à chaque poste : une formule répartit ses choix entre les postes. */
function repartir(l: LigneCommande, carte: Catalogue): Array<{ poste: string; article: ArticleBon }> {
  const posteLigne = posteArticle(carte, l.articleId);
  const note = l.note ? { note: l.note } : {};
  if (l.composants?.length) {
    const parPoste = new Map<string, string[]>();
    for (const c of l.composants) {
      // Choix d'une catégorie sans poste : il suit la formule.
      const poste = posteCategorie(carte, c.categorieId) ?? posteLigne;
      if (poste) parPoste.set(poste, [...(parPoste.get(poste) ?? []), c.libelle]);
    }
    return [...parPoste].map(([poste, details]) => ({ poste, article: { quantite: l.quantite, libelle: l.libelle, details, ...note } }));
  }
  return posteLigne ? [{ poste: posteLigne, article: { quantite: l.quantite, libelle: l.libelle, details: l.details, ...note } }] : [];
}

const aEnvoyer = (l: LigneCommande) => !l.retiree && !l.envoyee;
const aAnnuler = (l: LigneCommande) => !!l.retiree && !!l.envoyee && !l.annulationEnvoyee;

/** Bons à imprimer pour une commande, annulations d'abord ; `annulationsSeules` après un retrait. */
export function bonsAEnvoyer(c: Commande, carte: Catalogue, o: { annulationsSeules?: boolean } = {}): Bon[] {
  const bons = new Map<string, Bon>();
  for (const annulation of [true, false]) {
    if (!annulation && o.annulationsSeules) break;
    for (const l of c.lignes) {
      if (annulation ? !aAnnuler(l) : !aEnvoyer(l)) continue;
      for (const { poste, article } of repartir(l, carte)) {
        const cle = `${annulation}|${poste}`;
        const bon = bons.get(cle) ?? { poste, annulation, articles: [], ligneUids: [] };
        bon.articles.push(article);
        if (!bon.ligneUids.includes(l.uid)) bon.ligneUids.push(l.uid);
        bons.set(cle, bon);
      }
    }
  }
  return [...bons.values()];
}

/** Nombre de lignes qu'« Envoyer » ferait partir (envois et annulations). */
export function nbLignesAEnvoyer(c: Commande, carte: Catalogue): number {
  return new Set(bonsAEnvoyer(c, carte).flatMap((b) => b.ligneUids)).size;
}

/**
 * Marque les lignes dont tous les bons sont partis. Une ligne dont un bon a
 * échoué reste à envoyer en entier : mieux vaut un doublon en cuisine qu'un oubli.
 */
export function marquerEnvoyees(c: Commande, bons: Bon[], echecs: ReadonlySet<Bon>, par: string): Commande {
  const bloquees = new Set([...echecs].flatMap((b) => b.ligneUids));
  const ok = (annulation: boolean) =>
    new Set(bons.filter((b) => b.annulation === annulation).flatMap((b) => b.ligneUids).filter((u) => !bloquees.has(u)));
  const envoyees = ok(false);
  const annulees = ok(true);
  const le = new Date().toISOString();
  return {
    ...c,
    lignes: c.lignes.map((l) => {
      if (annulees.has(l.uid) && l.envoyee) return { ...l, annulationEnvoyee: true };
      // Ligne retirée pendant l'impression : elle est partie, son annulation partira au prochain envoi.
      if (envoyees.has(l.uid) && !l.envoyee) return { ...l, envoyee: { le, par } };
      return l;
    }),
  };
}
