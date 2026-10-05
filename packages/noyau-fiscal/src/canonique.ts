/**
 * Sérialisation canonique : clés triées, aucun espace, valeurs JSON strictes.
 * Deux enregistrements identiques produisent toujours la même chaîne, donc la même empreinte.
 */
export function canonique(valeur: unknown): string {
  if (valeur === null) return "null";
  switch (typeof valeur) {
    case "number":
      if (!Number.isFinite(valeur)) throw new Error("nombre non fini dans un enregistrement fiscal");
      return JSON.stringify(valeur);
    case "string":
    case "boolean":
      return JSON.stringify(valeur);
    case "object": {
      if (Array.isArray(valeur)) return `[${valeur.map(canonique).join(",")}]`;
      const obj = valeur as Record<string, unknown>;
      const cles = Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort();
      return `{${cles.map((k) => `${JSON.stringify(k)}:${canonique(obj[k])}`).join(",")}}`;
    }
    default:
      throw new Error(`type non sérialisable : ${typeof valeur}`);
  }
}

/** Contenu scellé d'un enregistrement : tout sauf `hash` et `signature`. */
export function contenuScelle<T extends { hash?: string; signature?: string }>(
  e: T,
): Omit<T, "hash" | "signature"> {
  const { hash: _h, signature: _s, ...reste } = e;
  return reste;
}
