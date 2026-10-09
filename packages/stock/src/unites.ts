import type { Quantite, UniteBase, UniteStock } from "./types.js";

/** Dimension (unité de base) d'une unité de comptage. */
export const BASE: Record<UniteStock, UniteBase> = { kg: "g", L: "mL", piece: "piece" };

export const LIBELLE_UNITE: Record<UniteStock, string> = { kg: "kg", L: "L", piece: "pièce" };

/**
 * Convertit une quantité vers l'unité de base d'un composant (produit ou
 * recette). Pièce ↔ poids ou volume passe par la contenance d'une pièce ;
 * poids ↔ volume n'est jamais converti. Renvoie null si c'est impossible.
 */
export function versBase(q: Quantite, cible: { unite: UniteStock; contenance?: Quantite }): number | null {
  const dim = BASE[cible.unite];
  if (q.unite === dim) return q.valeur;
  const c = cible.contenance;
  if (!c || c.valeur <= 0) return null;
  if (q.unite === "piece" && c.unite === dim) return Math.round((q.valeur * c.valeur) / 1000);
  if (dim === "piece" && c.unite === q.unite) return Math.round((q.valeur * 1000) / c.valeur);
  return null;
}

const nombre = (n: number, max = 3) => n.toLocaleString("fr-FR", { maximumFractionDigits: max });

/** « 30 g », « 1,2 kg », « 12 cL », « 2 pièces », « 0,5 pièce ». */
export function formaterQuantite(q: Quantite): string {
  if (q.unite === "piece") {
    const n = q.valeur / 1000;
    return `${nombre(n)} pièce${n >= 2 ? "s" : ""}`;
  }
  if (q.unite === "g") return q.valeur >= 1000 ? `${nombre(q.valeur / 1000)} kg` : `${q.valeur} g`;
  if (q.valeur >= 1000) return `${nombre(q.valeur / 1000)} L`;
  return q.valeur % 10 === 0 ? `${q.valeur / 10} cL` : `${q.valeur} mL`;
}

/** Quantité de base exprimée dans l'unité de comptage : 6 000 mL → « 6 L ». */
export function formaterEnUnite(valeur: number, unite: UniteStock): string {
  return `${nombre(valeur / 1000)} ${unite === "piece" ? (valeur >= 2000 ? "pièces" : "pièce") : unite}`;
}

/** Nombre décimal saisi à la française (« 0,5 », « 1 234,5 », « 12.5 ») ; null si illisible. */
export function lireDecimal(texte: string): number | null {
  const t = texte.trim().replace(/[\s  ]/g, "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

const FACTEURS: Record<string, { unite: UniteBase; facteur: number }> = {
  g: { unite: "g", facteur: 1 },
  gr: { unite: "g", facteur: 1 },
  kg: { unite: "g", facteur: 1000 },
  mg: { unite: "g", facteur: 0.001 },
  ml: { unite: "mL", facteur: 1 },
  cl: { unite: "mL", facteur: 10 },
  dl: { unite: "mL", facteur: 100 },
  l: { unite: "mL", facteur: 1000 },
  piece: { unite: "piece", facteur: 1000 },
  pieces: { unite: "piece", facteur: 1000 },
  pc: { unite: "piece", facteur: 1000 },
  pcs: { unite: "piece", facteur: 1000 },
  u: { unite: "piece", facteur: 1000 },
};

/**
 * Quantité saisie avec son unité : « 30 g », « 0,03 kg », « 12 cl », « 2 pièces ».
 * Sans unité, `parDefaut` s'applique. Arrondi à l'entier de base (g, mL, millième de pièce).
 */
export function lireQuantite(texte: string, parDefaut?: string): Quantite | null {
  const m = /^\s*(-?[\d\s  ]+(?:[.,]\d+)?)\s*([a-zA-Zèé]*)\.?\s*$/.exec(texte);
  if (!m) return null;
  const n = lireDecimal(m[1]!);
  const cle = normaliserUnite(m[2] || parDefaut || "");
  const f = FACTEURS[cle];
  if (n == null || n <= 0 || !f) return null;
  const valeur = Math.round(n * f.facteur);
  return valeur > 0 ? { valeur, unite: f.unite } : null;
}

const normaliserUnite = (u: string) =>
  u
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

/** Unité de comptage lue dans un tableur : kg, L, pièce (et leurs variantes d'écriture). */
export function lireUniteStock(texte: string): UniteStock | null {
  const u = normaliserUnite(texte).replace(/s$/, "");
  if (["kg", "kilo", "kilogramme"].includes(u)) return "kg";
  if (["l", "litre", "lt"].includes(u)) return "L";
  if (["piece", "pc", "u", "unite", "un"].includes(u)) return "piece";
  return null;
}
