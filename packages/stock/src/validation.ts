import type { ArticleFournisseur, Fiche, Fournisseur, LigneRecette, Produit, Quantite, Recette, Referentiel, TypeComposant, UniteBase, UniteStock } from "./types.js";
import { versBase } from "./unites.js";

/** Plafonds : un établissement reste loin de ces volumes. */
export const LIMITES_STOCK = { produits: 5000, articles: 10000, recettes: 3000, lignes: 60, fournisseurs: 500 } as const;

/** Adresse e-mail simple (un @, un domaine à point, sans espace). */
export const COURRIEL = /^[^\s@<>"]{1,64}@[^\s@<>"]+\.[^\s@<>"]{2,}$/;

/** Nom comparable : sans accents, sans casse, sans ponctuation (« Crème 35 % » = « creme 35% »). */
export function normaliserNom(nom: string): string {
  return nom
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Identifiant lisible tiré d'un nom, unique parmi `existants`. */
export function identifiantStock(nom: string, existants: Iterable<string>, prefixe = ""): string {
  const base = `${prefixe}${normaliserNom(nom).replace(/ /g, "-").slice(0, 50).replace(/-+$/, "")}` || `${prefixe}x`;
  const pris = new Set(existants);
  if (!pris.has(base)) return base;
  for (let n = 2; ; n++) if (!pris.has(`${base}-${n}`)) return `${base}-${n}`;
}

const UNITES: UniteStock[] = ["kg", "L", "piece"];
const BASES: UniteBase[] = ["g", "mL", "piece"];
const ID = /^[a-z0-9][a-z0-9-]{0,79}$/;

/** Lecteur strict : seuls les champs connus, au bon type ; erreurs en français. */
class Lecteur {
  readonly erreurs: string[] = [];
  objet(x: unknown, ou: string): Record<string, unknown> {
    if (typeof x !== "object" || x === null || Array.isArray(x)) {
      this.erreurs.push(`${ou} : objet attendu`);
      return {};
    }
    return x as Record<string, unknown>;
  }
  texte(x: unknown, ou: string, max = 120, requis = true): string {
    if ((x === undefined || x === null || x === "") && !requis) return "";
    if (typeof x !== "string" || (requis && !x.trim())) {
      this.erreurs.push(`${ou} : texte obligatoire`);
      return "";
    }
    if (x.length > max) this.erreurs.push(`${ou} : ${max} caractères au plus`);
    if (/[\u0000-\u001f\u007f]/.test(x)) this.erreurs.push(`${ou} : caractère non imprimable`);
    return x.trim();
  }
  id(x: unknown, ou: string): string {
    if (typeof x !== "string" || !ID.test(x)) {
      this.erreurs.push(`${ou} : identifiant invalide`);
      return "";
    }
    return x;
  }
  entier(x: unknown, ou: string, min: number, max: number): number {
    if (typeof x !== "number" || !Number.isSafeInteger(x) || x < min || x > max) {
      this.erreurs.push(`${ou} : entier entre ${min} et ${max} attendu`);
      return min;
    }
    return x;
  }
  quantite(x: unknown, ou: string): Quantite {
    const o = this.objet(x, ou);
    if (!BASES.includes(o.unite as UniteBase)) this.erreurs.push(`${ou} : unité g, mL ou pièce`);
    return { valeur: this.entier(o.valeur, `${ou} : quantité`, 1, 100_000_000), unite: o.unite as UniteBase };
  }
  unite(x: unknown, ou: string): UniteStock {
    if (!UNITES.includes(x as UniteStock)) this.erreurs.push(`${ou} : unité kg, L ou pièce`);
    return x as UniteStock;
  }
  type(x: unknown, ou: string): TypeComposant {
    if (x !== "produit" && x !== "recette") this.erreurs.push(`${ou} : produit ou recette`);
    return x as TypeComposant;
  }
}

const optionnels = <T extends object>(o: T): T => {
  for (const [k, v] of Object.entries(o)) if (v === "" || v === undefined) delete (o as Record<string, unknown>)[k];
  return o;
};

export function lireProduit(v: unknown): { produit: Produit | null; erreurs: string[] } {
  const l = new Lecteur();
  const o = l.objet(v, "produit");
  const nom = l.texte(o.nom, "produit : nom", 120);
  const ou = `produit « ${nom || "?"} »`;
  const produit: Produit = optionnels({
    id: l.id(o.id, `${ou} : identifiant`),
    nom,
    unite: l.unite(o.unite, ou),
    famille: l.texte(o.famille, `${ou} : famille`, 60, false),
    zone: l.texte(o.zone, `${ou} : zone`, 60, false),
    actif: o.actif !== false,
  });
  if (o.contenance !== undefined && o.contenance !== null) {
    produit.contenance = l.quantite(o.contenance, `${ou} : poids ou volume d'une pièce`);
    if (produit.contenance.unite === "piece") l.erreurs.push(`${ou} : le poids ou volume d'une pièce est en g ou en mL`);
  }
  return { produit: l.erreurs.length ? null : produit, erreurs: l.erreurs };
}

export function lireArticleFournisseur(v: unknown): { article: ArticleFournisseur | null; erreurs: string[] } {
  const l = new Lecteur();
  const o = l.objet(v, "article fournisseur");
  const fournisseur = l.texte(o.fournisseur, "article fournisseur : fournisseur", 80);
  const ou = `article de « ${fournisseur || "?"} »`;
  const article: ArticleFournisseur = optionnels({
    id: l.id(o.id, `${ou} : identifiant`),
    produitId: l.id(o.produitId, `${ou} : produit`),
    fournisseur,
    reference: l.texte(o.reference, `${ou} : référence`, 60, false),
    conditionnement: l.texte(o.conditionnement, `${ou} : conditionnement`, 80, false),
    quantite: l.entier(o.quantite, `${ou} : quantité du conditionnement`, 1, 100_000_000),
    actif: o.actif !== false,
  });
  article.conditionnement ??= "";
  if (Array.isArray(o.designations) && o.designations.length) {
    article.designations = o.designations.slice(0, 20).map((d, i) => l.texte(d, `${ou} : libellé de facture ${i + 1}`, 200));
  }
  return { article: l.erreurs.length ? null : article, erreurs: l.erreurs };
}

export function lireFournisseur(v: unknown): { fournisseur: Fournisseur | null; erreurs: string[] } {
  const l = new Lecteur();
  const o = l.objet(v, "fournisseur");
  const nom = l.texte(o.nom, "fournisseur : nom", 80);
  const ou = `fournisseur « ${nom || "?"} »`;
  const courriel = (x: unknown, quoi: string) => {
    const t = l.texte(x, `${ou} : ${quoi}`, 120, false);
    if (t && !COURRIEL.test(t)) l.erreurs.push(`${ou} : ${quoi} « ${t} » invalide`);
    return t.toLowerCase();
  };
  const f: Fournisseur = optionnels({
    id: l.id(o.id, `${ou} : identifiant`),
    nom,
    courriel: courriel(o.courriel, "e-mail de commande"),
    contact: l.texte(o.contact, `${ou} : contact`, 80, false),
    telephone: l.texte(o.telephone, `${ou} : téléphone`, 30, false),
    livraison: l.texte(o.livraison, `${ou} : livraison`, 200, false),
    note: l.texte(o.note, `${ou} : note`, 1000, false),
    actif: o.actif !== false,
  });
  if (Array.isArray(o.copies)) {
    if (o.copies.length > 3) l.erreurs.push(`${ou} : 3 adresses en copie au plus`);
    const copies = o.copies.slice(0, 3).map((x) => courriel(x, "e-mail en copie")).filter(Boolean);
    if (copies.length) f.copies = [...new Set(copies)];
  }
  if (o.francoHT !== undefined && o.francoHT !== null && o.francoHT !== 0) f.francoHT = l.entier(o.francoHT, `${ou} : franco`, 0, 10_000_000);
  if (Array.isArray(o.comptes)) {
    const comptes = o.comptes.slice(0, 50).map((x, i) => {
      const c = l.objet(x, `${ou} : compte ${i + 1}`);
      return { etablissementId: l.id(c.etablissementId, `${ou} : compte ${i + 1}`), numeroClient: l.texte(c.numeroClient, `${ou} : numéro de client`, 40, false) };
    });
    const utiles = comptes.filter((c) => c.numeroClient);
    if (new Set(utiles.map((c) => c.etablissementId)).size !== utiles.length) l.erreurs.push(`${ou} : un seul numéro de client par établissement`);
    if (utiles.length) f.comptes = utiles;
  }
  return { fournisseur: l.erreurs.length ? null : f, erreurs: l.erreurs };
}

/** Fiche d'un fournisseur nommé par ses articles (casse et accents ignorés). */
export function ficheFournisseur(ref: Referentiel, nom: string): Fournisseur | undefined {
  const n = normaliserNom(nom);
  return (ref.fournisseurs ?? []).find((f) => normaliserNom(f.nom) === n);
}

/**
 * Enregistre une fiche fournisseur : ses articles prennent l'orthographe de la
 * fiche, y compris après un renommage (l'ancien nom disparaît des articles).
 */
export function enregistrerFournisseur(ref: Referentiel, f: Fournisseur): Referentiel {
  const fiches = ref.fournisseurs ?? [];
  const ancien = fiches.find((x) => x.id === f.id);
  const noms = new Set([normaliserNom(f.nom), ...(ancien ? [normaliserNom(ancien.nom)] : [])]);
  return {
    ...ref,
    fournisseurs: ancien ? fiches.map((x) => (x.id === f.id ? f : x)) : [...fiches, f],
    articles: ref.articles.map((a) => (noms.has(normaliserNom(a.fournisseur)) && a.fournisseur !== f.nom ? { ...a, fournisseur: f.nom } : a)),
  };
}

/** Fournisseurs connus : fiches et noms portés par des articles, sans doublon, triés. */
export function nomsFournisseurs(ref: Referentiel, actifsSeulement = true): string[] {
  const noms = new Map<string, string>();
  for (const f of ref.fournisseurs ?? []) if (f.actif || !actifsSeulement) noms.set(normaliserNom(f.nom), f.nom);
  for (const a of ref.articles) {
    if (!a.actif && actifsSeulement) continue;
    if (!noms.has(normaliserNom(a.fournisseur))) noms.set(normaliserNom(a.fournisseur), a.fournisseur);
  }
  return [...noms.values()].sort((a, b) => a.localeCompare(b, "fr"));
}

export function lireFiche(v: unknown, ou = "fiche"): { fiche: Fiche | null; erreurs: string[] } {
  const l = new Lecteur();
  const o = l.objet(v, ou);
  const fiche: Fiche = { type: l.type(o.type, ou), id: l.id(o.id, `${ou} : composant`), quantite: l.quantite(o.quantite, ou) };
  return { fiche: l.erreurs.length ? null : fiche, erreurs: l.erreurs };
}

export function lireRecette(v: unknown): { recette: Recette | null; erreurs: string[] } {
  const l = new Lecteur();
  const o = l.objet(v, "recette");
  const nom = l.texte(o.nom, "recette : nom", 120);
  const ou = `recette « ${nom || "?"} »`;
  const brutes = Array.isArray(o.lignes) ? o.lignes : (l.erreurs.push(`${ou} : lignes attendues`), []);
  if (brutes.length > LIMITES_STOCK.lignes) l.erreurs.push(`${ou} : ${LIMITES_STOCK.lignes} lignes au plus`);
  const lignes: LigneRecette[] = brutes.slice(0, LIMITES_STOCK.lignes).map((x, i) => {
    const lo = l.objet(x, `${ou}, ligne ${i + 1}`);
    const ligne: LigneRecette = { type: l.type(lo.type, `${ou}, ligne ${i + 1}`), id: l.id(lo.id, `${ou}, ligne ${i + 1}`), quantite: l.quantite(lo.quantite, `${ou}, ligne ${i + 1}`) };
    if (lo.perte !== undefined && lo.perte !== null && lo.perte !== 0) ligne.perte = l.entier(lo.perte, `${ou}, ligne ${i + 1} : perte`, 0, 9000);
    return ligne;
  });
  const recette: Recette = optionnels({
    id: l.id(o.id, `${ou} : identifiant`),
    nom,
    unite: l.unite(o.unite, ou),
    rendement: l.entier(o.rendement, `${ou} : rendement`, 1, 100_000_000),
    famille: l.texte(o.famille, `${ou} : famille`, 60, false),
    note: l.texte(o.note, `${ou} : note`, 1000, false),
    lignes,
    actif: o.actif !== false,
  });
  if (o.contenance !== undefined && o.contenance !== null) {
    recette.contenance = l.quantite(o.contenance, `${ou} : poids ou volume d'une pièce`);
    if (recette.contenance.unite === "piece") l.erreurs.push(`${ou} : le poids ou volume d'une pièce est en g ou en mL`);
  }
  return { recette: l.erreurs.length ? null : recette, erreurs: l.erreurs };
}

/**
 * Cohérence du référentiel entier : noms uniques (un doublon couperait stock
 * et coût en deux), références existantes, unités convertibles, pas de
 * recette qui se contient elle-même.
 */
export function validerReferentiel(ref: Referentiel): string[] {
  const erreurs: string[] = [];
  if (ref.produits.length > LIMITES_STOCK.produits) erreurs.push(`${LIMITES_STOCK.produits} produits au plus`);
  if (ref.articles.length > LIMITES_STOCK.articles) erreurs.push(`${LIMITES_STOCK.articles} articles fournisseurs au plus`);
  if (ref.recettes.length > LIMITES_STOCK.recettes) erreurs.push(`${LIMITES_STOCK.recettes} recettes au plus`);
  const doublons = (noms: Array<{ id: string; nom: string }>, quoi: string) => {
    const vus = new Map<string, string>();
    const ids = new Set<string>();
    for (const x of noms) {
      if (ids.has(x.id)) erreurs.push(`${quoi} : identifiant ${x.id} en double`);
      ids.add(x.id);
      const n = normaliserNom(x.nom);
      const autre = vus.get(n);
      if (autre !== undefined) erreurs.push(`${quoi} « ${x.nom} » : existe déjà (« ${autre} »)`);
      else vus.set(n, x.nom);
    }
  };
  if ((ref.fournisseurs ?? []).length > LIMITES_STOCK.fournisseurs) erreurs.push(`${LIMITES_STOCK.fournisseurs} fournisseurs au plus`);
  doublons(ref.produits, "produit");
  doublons(ref.recettes, "recette");
  doublons(ref.fournisseurs ?? [], "fournisseur");
  doublons(ref.articles.map((a) => ({ id: a.id, nom: `${a.produitId} ${a.fournisseur} ${a.reference ?? ""} ${a.conditionnement}` })), "article fournisseur");
  const produits = new Map(ref.produits.map((p) => [p.id, p]));
  const recettes = new Map(ref.recettes.map((r) => [r.id, r]));
  for (const a of ref.articles) if (!produits.has(a.produitId)) erreurs.push(`article de « ${a.fournisseur} » : produit inconnu (${a.produitId})`);
  for (const r of ref.recettes) {
    for (const l of r.lignes) {
      const c = l.type === "produit" ? produits.get(l.id) : recettes.get(l.id);
      if (!c) erreurs.push(`recette « ${r.nom} » : ${l.type} inconnu(e) (${l.id})`);
      else if (versBase(l.quantite, c) == null) erreurs.push(`recette « ${r.nom} » : « ${c.nom} » est compté(e) en ${c.unite === "piece" ? "pièces" : c.unite} ; indiquez son poids ou volume par pièce, ou saisissez la quantité dans cette unité`);
    }
  }
  // Cycles : parcours en profondeur des sous-recettes.
  const etat = new Map<string, "en-cours" | "fait">();
  const visiter = (r: Recette, chemin: string[]) => {
    if (etat.get(r.id) === "fait") return;
    if (etat.get(r.id) === "en-cours") {
      erreurs.push(`recette « ${r.nom} » : se contient elle-même (${[...chemin, r.nom].join(" › ")})`);
      return;
    }
    etat.set(r.id, "en-cours");
    for (const l of r.lignes) if (l.type === "recette" && recettes.has(l.id)) visiter(recettes.get(l.id)!, [...chemin, r.nom]);
    etat.set(r.id, "fait");
  };
  for (const r of ref.recettes) visiter(r, []);
  return [...new Set(erreurs)];
}

/** Recettes qui utilisent un produit ou une recette (avant d'archiver). */
export function utilisations(ref: Referentiel, type: TypeComposant, id: string): Recette[] {
  return ref.recettes.filter((r) => r.lignes.some((l) => l.type === type && l.id === id));
}
