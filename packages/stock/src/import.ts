import type { ArticleFournisseur, PrixAchat, Produit, Referentiel, UniteStock } from "./types.js";
import { lireDecimal, lireUniteStock } from "./unites.js";
import { identifiantStock, normaliserNom } from "./validation.js";

/**
 * Import des premiers produits depuis un tableur : une ligne par produit et
 * par fournisseur. Un produit déjà connu (même nom, accents et casse
 * ignorés) n'est jamais recréé ; ses articles fournisseurs et ses prix
 * s'ajoutent.
 */
export interface LigneImport {
  /** Numéro de ligne dans le tableur (en-tête = 1). */
  ligne: number;
  produit: string;
  unite: UniteStock;
  famille?: string;
  zone?: string;
  fournisseur?: string;
  reference?: string;
  conditionnement?: string;
  /** Quantité du conditionnement, en unité de base du produit (6 L → 6 000 mL). */
  quantite?: number;
  /** Centimes HT par conditionnement. */
  prixHT?: number;
  /** Poids d'une pièce, en grammes. */
  poidsUnitaire?: number;
}

export interface ErreurImport {
  ligne: number;
  message: string;
}

const COLONNES: Record<string, keyof Omit<LigneImport, "ligne">> = {
  produit: "produit",
  nom: "produit",
  designation: "produit",
  libelle: "produit",
  unite: "unite",
  unite_de_comptage: "unite",
  famille: "famille",
  categorie: "famille",
  zone: "zone",
  zone_de_stockage: "zone",
  stockage: "zone",
  fournisseur: "fournisseur",
  reference: "reference",
  ref: "reference",
  conditionnement: "conditionnement",
  quantite: "quantite",
  qte: "quantite",
  quantite_conditionnement: "quantite",
  prix_ht: "prixHT",
  prix: "prixHT",
  prix_achat_ht: "prixHT",
  poids_unitaire_g: "poidsUnitaire",
  poids_unitaire: "poidsUnitaire",
  poids_piece_g: "poidsUnitaire",
};

const cleColonne = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

/** Lit un CSV ou un collage depuis Excel (tabulations) ; séparateur détecté sur la première ligne. */
export function lireTableau(texte: string): string[][] {
  const contenu = texte.replace(/^﻿/, "");
  const premiere = contenu.split(/\r?\n/, 1)[0] ?? "";
  const sep = premiere.includes("\t") ? "\t" : premiere.split(";").length >= premiere.split(",").length ? ";" : ",";
  const lignes: string[][] = [];
  let ligne: string[] = [];
  let champ = "";
  let guillemets = false;
  for (let i = 0; i < contenu.length; i++) {
    const c = contenu[i]!;
    if (guillemets) {
      if (c === '"' && contenu[i + 1] === '"') {
        champ += '"';
        i++;
      } else if (c === '"') guillemets = false;
      else champ += c;
    } else if (c === '"' && champ === "") guillemets = true;
    else if (c === sep) {
      ligne.push(champ);
      champ = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && contenu[i + 1] === "\n") i++;
      ligne.push(champ);
      lignes.push(ligne);
      ligne = [];
      champ = "";
    } else champ += c;
  }
  if (champ !== "" || ligne.length) {
    ligne.push(champ);
    lignes.push(ligne);
  }
  return lignes.filter((l) => l.some((x) => x.trim() !== ""));
}

/** Prix saisi en euros (« 21,90 », « 21,90 € ») → centimes ; null si illisible. */
function lireEuros(texte: string): number | null {
  const n = lireDecimal(texte.replace(/€|eur(os?)?/gi, ""));
  return n == null || n < 0 ? null : Math.round(n * 100);
}

/** Transforme les lignes du tableur (en-tête compris) en lignes d'import vérifiées. */
export function lireLignesImport(tableau: string[][]): { lignes: LigneImport[]; erreurs: ErreurImport[] } {
  const erreurs: ErreurImport[] = [];
  const [entete, ...corps] = tableau;
  if (!entete) return { lignes: [], erreurs: [{ ligne: 1, message: "Tableau vide." }] };
  const colonnes = entete.map((t) => COLONNES[cleColonne(t)]);
  if (!colonnes.includes("produit") || !colonnes.includes("unite")) {
    return { lignes: [], erreurs: [{ ligne: 1, message: "Colonnes « produit » et « unite » obligatoires dans la première ligne." }] };
  }
  const lignes: LigneImport[] = [];
  corps.forEach((cellules, i) => {
    const n = i + 2;
    const v: Partial<Record<keyof Omit<LigneImport, "ligne">, string>> = {};
    colonnes.forEach((c, j) => {
      if (c && cellules[j]?.trim()) v[c] = cellules[j]!.trim();
    });
    if (!Object.keys(v).length) return;
    const probleme = (message: string) => erreurs.push({ ligne: n, message });
    if (!v.produit) return probleme("nom du produit manquant");
    if (v.produit.length > 120) return probleme("nom du produit trop long (120 caractères au plus)");
    const unite = lireUniteStock(v.unite ?? "");
    if (!unite) return probleme(`« ${v.produit} » : unité « ${v.unite ?? ""} » inconnue (kg, L ou pièce)`);
    const l: LigneImport = { ligne: n, produit: v.produit, unite };
    for (const cle of ["famille", "zone", "fournisseur", "reference", "conditionnement"] as const) if (v[cle]) l[cle] = v[cle]!.slice(0, cle === "conditionnement" || cle === "fournisseur" ? 80 : 60);
    if (v.quantite) {
      const q = lireDecimal(v.quantite);
      if (q == null || q <= 0) return probleme(`« ${v.produit} » : quantité « ${v.quantite} » illisible`);
      l.quantite = Math.round(q * 1000);
    }
    if (v.prixHT) {
      const p = lireEuros(v.prixHT);
      if (p == null) return probleme(`« ${v.produit} » : prix « ${v.prixHT} » illisible`);
      l.prixHT = p;
    }
    if (v.poidsUnitaire) {
      const p = lireDecimal(v.poidsUnitaire);
      if (p == null || p <= 0) return probleme(`« ${v.produit} » : poids unitaire « ${v.poidsUnitaire} » illisible`);
      l.poidsUnitaire = Math.round(p);
    }
    if (l.fournisseur && l.quantite == null) return probleme(`« ${v.produit} » : quantité du conditionnement manquante pour ${l.fournisseur}`);
    if (l.fournisseur && l.prixHT == null) return probleme(`« ${v.produit} » : prix HT manquant pour ${l.fournisseur}`);
    if (!l.fournisseur && (l.prixHT != null || l.reference)) return probleme(`« ${v.produit} » : un prix ou une référence demande un fournisseur`);
    lignes.push(l);
  });
  return { lignes, erreurs };
}

export interface RapportImport {
  produitsCrees: string[];
  produitsExistants: string[];
  articlesCrees: number;
  prixEnregistres: number;
  erreurs: ErreurImport[];
}

/**
 * Applique un import au référentiel (sans rien écrire) : rend le nouveau
 * référentiel, les prix à ajouter pour l'établissement et le rapport.
 * `prix` sert à ne pas réenregistrer un prix identique au dernier connu.
 */
export function planifierImport(
  ref: Referentiel,
  prix: PrixAchat[],
  lignes: LigneImport[],
  etablissementId: string,
  le: string,
): { referentiel: Referentiel; prix: PrixAchat[]; rapport: RapportImport } {
  const produits = [...ref.produits];
  const articles = [...ref.articles];
  const nouveauxPrix: PrixAchat[] = [];
  const rapport: RapportImport = { produitsCrees: [], produitsExistants: [], articlesCrees: 0, prixEnregistres: 0, erreurs: [] };
  const parNom = new Map(produits.map((p) => [normaliserNom(p.nom), p]));
  for (const l of lignes) {
    let p = parNom.get(normaliserNom(l.produit));
    if (p && p.unite !== l.unite) {
      rapport.erreurs.push({ ligne: l.ligne, message: `« ${l.produit} » existe déjà, compté en ${p.unite === "piece" ? "pièces" : p.unite}, pas en ${l.unite === "piece" ? "pièces" : l.unite}` });
      continue;
    }
    if (!p) {
      p = {
        id: identifiantStock(l.produit, produits.map((x) => x.id)),
        nom: l.produit,
        unite: l.unite,
        ...(l.famille ? { famille: l.famille } : {}),
        ...(l.zone ? { zone: l.zone } : {}),
        ...(l.poidsUnitaire ? { contenance: { valeur: l.poidsUnitaire, unite: "g" as const } } : {}),
        actif: true,
      } satisfies Produit;
      produits.push(p);
      parNom.set(normaliserNom(p.nom), p);
      rapport.produitsCrees.push(p.nom);
    } else if (!rapport.produitsCrees.includes(p.nom) && !rapport.produitsExistants.includes(p.nom)) {
      rapport.produitsExistants.push(p.nom);
    }
    if (!l.fournisseur || l.quantite == null || l.prixHT == null) continue;
    const produit = p;
    const quantite = l.quantite;
    const memeArticle = (a: ArticleFournisseur) =>
      a.produitId === produit.id &&
      normaliserNom(a.fournisseur) === normaliserNom(l.fournisseur!) &&
      (l.reference ? normaliserNom(a.reference ?? "") === normaliserNom(l.reference) : a.quantite === quantite);
    let a = articles.find(memeArticle);
    if (!a) {
      a = {
        id: identifiantStock(`${produit.id} ${l.fournisseur}`, articles.map((x) => x.id)),
        produitId: produit.id,
        fournisseur: l.fournisseur,
        ...(l.reference ? { reference: l.reference } : {}),
        conditionnement: l.conditionnement ?? "",
        quantite,
        actif: true,
      };
      articles.push(a);
      rapport.articlesCrees++;
    }
    const dernier = [...prix, ...nouveauxPrix]
      .filter((x) => x.articleId === a!.id && x.etablissementId === etablissementId)
      .reduce<PrixAchat | null>((m, x) => (!m || x.le >= m.le ? x : m), null);
    if (dernier?.prixHT === l.prixHT) continue;
    nouveauxPrix.push({ articleId: a.id, etablissementId, prixHT: l.prixHT, le, source: "import" });
    rapport.prixEnregistres++;
  }
  return { referentiel: { produits, articles, recettes: ref.recettes }, prix: nouveauxPrix, rapport };
}
