import {
  ErreurFiscale,
  type Centimes,
  type LigneTicket,
  type Paiement,
  type SaisieLigne,
  type TauxTVA,
  type VentilationTVA,
  MODES_PAIEMENT,
} from "./types.js";

/** Taux de TVA applicables en France métropolitaine (points de base). */
export const TAUX_TVA_AUTORISES: readonly number[] = [0, 210, 550, 1000, 2000];

export function estCentimes(v: unknown): v is Centimes {
  return typeof v === "number" && Number.isSafeInteger(v);
}

function exigerCentimes(v: unknown, champ: string): void {
  if (!estCentimes(v)) {
    throw new ErreurFiscale("MONTANT_INVALIDE", `${champ} doit être un entier en centimes`);
  }
}

/** Arrondi au plus proche, symétrique autour de zéro (une annulation reflète exactement la vente). */
export function arrondiSymetrique(x: number): number {
  return Math.sign(x) * Math.round(Math.abs(x));
}

/** Base HT d'un montant TTC à un taux donné, arrondie au centime. */
export function baseHT(ttc: Centimes, taux: TauxTVA): Centimes {
  return arrondiSymetrique((ttc * 10000) / (10000 + taux));
}

/** Calcule une ligne de ticket à partir de la saisie (vente). */
export function calculerLigne(saisie: SaisieLigne): LigneTicket {
  if (!saisie.articleId || !saisie.libelle) {
    throw new ErreurFiscale("LIGNE_INVALIDE", "article et libellé obligatoires");
  }
  if (!Number.isSafeInteger(saisie.quantite) || saisie.quantite <= 0) {
    throw new ErreurFiscale("QUANTITE_INVALIDE", `quantité invalide pour ${saisie.libelle}`);
  }
  exigerCentimes(saisie.prixUnitaireTTC, "prixUnitaireTTC");
  if (saisie.prixUnitaireTTC < 0) {
    throw new ErreurFiscale("MONTANT_INVALIDE", "prix unitaire négatif");
  }
  if (!TAUX_TVA_AUTORISES.includes(saisie.tauxTVA)) {
    throw new ErreurFiscale("TVA_INVALIDE", `taux de TVA invalide pour ${saisie.libelle}`);
  }
  const brut = saisie.quantite * saisie.prixUnitaireTTC;
  const remise = saisie.remise?.montantTTC ?? 0;
  exigerCentimes(remise, "remise");
  if (remise < 0 || remise > brut) {
    throw new ErreurFiscale("REMISE_INVALIDE", `remise hors bornes pour ${saisie.libelle}`);
  }
  if (remise > 0 && !saisie.remise?.motif?.trim()) {
    throw new ErreurFiscale("MOTIF_OBLIGATOIRE", "toute remise exige un motif");
  }
  return {
    articleId: saisie.articleId,
    libelle: saisie.libelle,
    quantite: saisie.quantite,
    prixUnitaireTTC: saisie.prixUnitaireTTC,
    tauxTVA: saisie.tauxTVA,
    remiseTTC: remise,
    motifRemise: remise > 0 ? saisie.remise!.motif.trim() : null,
    montantTTC: brut - remise,
  };
}

/** Ligne miroir (annulation) : quantités et montants opposés. */
export function ligneInverse(l: LigneTicket): LigneTicket {
  return {
    ...l,
    quantite: -l.quantite,
    remiseTTC: -l.remiseTTC,
    montantTTC: -l.montantTTC,
  };
}

/** Ventile un ensemble de montants TTC par taux de TVA (calcul sur le total par taux). */
export function ventiler(lignes: Array<{ tauxTVA: TauxTVA; montantTTC: Centimes }>): VentilationTVA[] {
  const parTaux = new Map<TauxTVA, Centimes>();
  for (const l of lignes) {
    parTaux.set(l.tauxTVA, (parTaux.get(l.tauxTVA) ?? 0) + l.montantTTC);
  }
  return [...parTaux.entries()]
    .sort(([a], [b]) => a - b)
    .map(([tauxTVA, montantTTC]) => {
      const ht = baseHT(montantTTC, tauxTVA);
      return { tauxTVA, baseHT: ht, montantTVA: montantTTC - ht, montantTTC };
    });
}

/**
 * Part cumulée `x` (centimes, du signe de `total`) d'une vente de total
 * `total`, répartie entre ses taux de TVA. Méthode du diviseur (Sainte-Laguë) :
 * centime par centime, chaque centime va au taux le plus en retard sur sa
 * part. La répartition ne recule jamais quand `x` augmente, et à `x = total`
 * elle redonne exactement la ventilation de la vente (TTC et HT).
 */
function prorataCumule(ventilation: VentilationTVA[], x: Centimes, total: Centimes): VentilationTVA[] {
  const signe = total < 0 ? -1 : 1;
  const ttc = ventilation.map((v) => Math.abs(v.montantTTC));
  const ht = ventilation.map((v) => Math.abs(v.baseHT));
  const cible = Math.abs(x);
  if (Math.sign(x) === -signe && x !== 0) throw new ErreurFiscale("MONTANT_INVALIDE", "part de signe contraire à la vente");
  if (cible > ttc.reduce((s, t) => s + t, 0)) throw new ErreurFiscale("MONTANT_INVALIDE", "part supérieure à la vente");
  const parts = ttc.map(() => 0);
  for (let c = 0; c < cible; c++) {
    let choisi = -1;
    let meilleur = -1;
    ttc.forEach((t, i) => {
      if (parts[i]! >= t) return;
      const priorite = t / (parts[i]! + 0.5);
      if (priorite > meilleur) {
        meilleur = priorite;
        choisi = i;
      }
    });
    parts[choisi]! += 1;
  }
  return ventilation.map((v, i) => {
    const montantTTC = parts[i]!;
    const baseHT = ttc[i] === 0 ? 0 : Math.round((ht[i]! * montantTTC) / ttc[i]!);
    return { tauxTVA: v.tauxTVA, baseHT: signe * baseHT, montantTVA: signe * (montantTTC - baseHT), montantTTC: signe * montantTTC };
  });
}

/**
 * TVA d'une tranche encaissée d'une vente : de `avant` (déjà encaissé) à
 * `avant + part`. Les tranches successives (part payée à la vente, puis
 * chaque règlement) s'additionnent exactement à la ventilation de la vente :
 * aucun centime ne dérive d'un taux à l'autre, quel que soit le découpage.
 */
export function ventilerTranche(ventilation: VentilationTVA[], avant: Centimes, part: Centimes, total: Centimes): VentilationTVA[] {
  if (part === 0 || ventilation.length === 0) return [];
  if (total === 0) throw new ErreurFiscale("MONTANT_INVALIDE", "prorata d'une vente à zéro");
  const debut = prorataCumule(ventilation, avant, total);
  const fin = prorataCumule(ventilation, avant + part, total);
  return fin
    .map((v, i) => ({
      tauxTVA: v.tauxTVA,
      baseHT: v.baseHT - debut[i]!.baseHT,
      montantTVA: v.montantTVA - debut[i]!.montantTVA,
      montantTTC: v.montantTTC - debut[i]!.montantTTC,
    }))
    .filter((v) => v.montantTTC !== 0 || v.baseHT !== 0 || v.montantTVA !== 0);
}

/** Première tranche d'une vente (part encaissée au moment de la vente). */
export function ventilerProrata(ventilation: VentilationTVA[], part: Centimes, total: Centimes): VentilationTVA[] {
  return ventilerTranche(ventilation, 0, part, total);
}

/** Ventilation d'une vente bien formée : taux autorisés, HT recalculé par taux, somme égale au total. */
export function ventilationValide(ventilation: VentilationTVA[], totalTTC: Centimes): boolean {
  if (!Array.isArray(ventilation) || ventilation.length === 0) return false;
  const taux = new Set<number>();
  for (const v of ventilation) {
    if (!estCentimes(v?.montantTTC) || !estCentimes(v.baseHT) || !estCentimes(v.montantTVA)) return false;
    if (!TAUX_TVA_AUTORISES.includes(v.tauxTVA) || taux.has(v.tauxTVA)) return false;
    taux.add(v.tauxTVA);
    if (v.baseHT !== baseHT(v.montantTTC, v.tauxTVA) || v.montantTVA !== v.montantTTC - v.baseHT) return false;
  }
  return ventilation.reduce((s, v) => s + v.montantTTC, 0) === totalTTC;
}

/** Additionne des ventilations déjà calculées (clôtures) sans recalculer la TVA. */
export function cumulerVentilations(ventilations: VentilationTVA[][]): VentilationTVA[] {
  const parTaux = new Map<TauxTVA, VentilationTVA>();
  for (const v of ventilations.flat()) {
    const acc = parTaux.get(v.tauxTVA) ?? { tauxTVA: v.tauxTVA, baseHT: 0, montantTVA: 0, montantTTC: 0 };
    acc.baseHT += v.baseHT;
    acc.montantTVA += v.montantTVA;
    acc.montantTTC += v.montantTTC;
    parTaux.set(v.tauxTVA, acc);
  }
  return [...parTaux.values()].sort((a, b) => a.tauxTVA - b.tauxTVA);
}

export function cumulerPaiements(listes: Paiement[][]): Paiement[] {
  const parMode = new Map<string, Centimes>();
  for (const p of listes.flat()) {
    parMode.set(p.mode, (parMode.get(p.mode) ?? 0) + p.montant);
  }
  return MODES_PAIEMENT.filter((m) => parMode.has(m)).map((mode) => ({ mode, montant: parMode.get(mode)! }));
}

/**
 * Contrôle les paiements d'une vente et calcule le rendu monnaie.
 * Seules les espèces peuvent dépasser le montant dû ; le rendu ne peut excéder les espèces reçues.
 */
export function controlerPaiements(totalTTC: Centimes, paiements: Paiement[]): { renduMonnaie: Centimes } {
  if (paiements.length === 0 && totalTTC !== 0) {
    throw new ErreurFiscale("PAIEMENT_MANQUANT", "aucun paiement");
  }
  let somme = 0;
  let especes = 0;
  for (const p of paiements) {
    if (!MODES_PAIEMENT.includes(p.mode)) {
      throw new ErreurFiscale("MODE_PAIEMENT_INVALIDE", `mode de paiement inconnu : ${p.mode}`);
    }
    exigerCentimes(p.montant, "paiement");
    if (p.montant <= 0) throw new ErreurFiscale("MONTANT_INVALIDE", "paiement nul ou négatif");
    somme += p.montant;
    if (p.mode === "ESPECES") especes += p.montant;
  }
  const excedent = somme - totalTTC;
  if (excedent < 0) {
    throw new ErreurFiscale("PAIEMENT_INSUFFISANT", `reste à payer : ${-excedent} centimes`);
  }
  if (excedent > especes) {
    throw new ErreurFiscale("RENDU_IMPOSSIBLE", "seules les espèces peuvent donner lieu à un rendu monnaie");
  }
  return { renduMonnaie: excedent };
}

/** Encaissements nets d'un ticket : le rendu monnaie est déduit des espèces. */
export function paiementsNets(paiements: Paiement[], renduMonnaie: Centimes): Paiement[] {
  if (renduMonnaie === 0) return paiements;
  const nets = cumulerPaiements([paiements]).map((p) =>
    p.mode === "ESPECES" ? { ...p, montant: p.montant - renduMonnaie } : p,
  );
  return nets.filter((p) => p.montant !== 0);
}

/** Formatage d'affichage : 1250 → "12,50". */
export function formaterEuros(c: Centimes): string {
  const signe = c < 0 ? "-" : "";
  const abs = Math.abs(c);
  return `${signe}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}
