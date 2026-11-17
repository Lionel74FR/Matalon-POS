import type { GroupeCommentaires } from "@matalon/catalogue";

/**
 * Commentaires d'un article (17 novembre 2026, Lionel : cuissons des viandes) : choisis en caisse dans les
 * groupes que la carte lie à l'article, affichés sous la ligne et imprimés sur le bon de production. Ni
 * prix, ni ticket : ils ne passent jamais dans le libellé fiscal (`versSaisie`).
 */

/** Choix en cours, par groupe. */
export type SelectionCommentaires = Record<string, string[]>;

/** Choix d'une ligne relus par groupe (commentaires d'un groupe retiré de la carte depuis : oubliés). */
export function selectionDepuis(groupes: GroupeCommentaires[], commentaires: string[] | undefined): SelectionCommentaires {
  return Object.fromEntries(groupes.map((g) => [g.id, g.commentaires.filter((x) => commentaires?.includes(x))]));
}

/** Touche d'un commentaire : un seul par groupe, sauf groupe à choix multiples ; retoucher l'enlève. */
export function basculer(selection: SelectionCommentaires, g: GroupeCommentaires, commentaire: string): SelectionCommentaires {
  const actuels = selection[g.id] ?? [];
  const actif = actuels.includes(commentaire);
  const suivants = actif ? actuels.filter((x) => x !== commentaire) : g.plusieurs ? [...actuels, commentaire] : [commentaire];
  // Ordre du groupe, pour un affichage stable.
  return { ...selection, [g.id]: g.commentaires.filter((x) => suivants.includes(x)) };
}

/** Premier groupe obligatoire sans choix, ou null. */
export function groupeManquant(groupes: GroupeCommentaires[], selection: SelectionCommentaires): GroupeCommentaires | null {
  return groupes.find((g) => g.obligatoire && !(selection[g.id] ?? []).length) ?? null;
}

/** Commentaires retenus, dans l'ordre des groupes ; absent s'il n'y en a aucun. */
export function commentairesChoisis(groupes: GroupeCommentaires[], selection: SelectionCommentaires): string[] | undefined {
  const tous = groupes.flatMap((g) => selection[g.id] ?? []);
  return tous.length ? tous : undefined;
}

/** « Entrecôte (Saignant, Poivre) » : un choix de formule avec ses commentaires. */
export const avecCommentaires = (libelle: string, commentaires: string[] | undefined): string =>
  commentaires?.length ? `${libelle} (${commentaires.join(", ")})` : libelle;

/** Mêmes commentaires (ordre compris) : deux lignes identiques se regroupent. */
export const memesCommentaires = (a: string[] | undefined, b: string[] | undefined): boolean => (a ?? []).join("\u0000") === (b ?? []).join("\u0000");
