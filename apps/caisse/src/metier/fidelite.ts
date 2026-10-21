import type { Catalogue } from "@matalon/catalogue";
import { MOTIF_FIDELITE, type LienFidelite, type RecompenseFidelite, type UtilisationFidelite } from "@matalon/serveur/fidelite";
import { ajouterLigne, lignesDues, montantRemise, type Commande, type FideliteCommande, type LigneCommande } from "./commande";

/** Auteur des remises de fidélité : la règle du programme les autorise, sans code de responsable. */
export const ACCORD_FIDELITE = "fidelite";

const brut = (l: LigneCommande) => l.quantite * l.prixUnitaireTTC;

/** Lignes qui peuvent recevoir une remise de fidélité : dues, sans remise, d'un montant positif. */
const remisables = (c: Commande) => lignesDues(c).filter((l) => !l.remise && brut(l) > 0);

/** Valeur TTC qu'une récompense retirerait de la commande telle qu'elle est (article : son prix). */
export function valeurSurCommande(c: Commande, r: RecompenseFidelite, prixArticle = 0): number {
  if (r.type === "ARTICLE") return prixArticle;
  const lignes = remisables(c);
  if (r.type === "REMISE_EUROS") return Math.min(r.montant ?? 0, lignes.reduce((s, l) => s + brut(l), 0));
  return lignes.reduce((s, l) => s + montantRemise(brut(l), r.pourcentage ?? 0), 0);
}

/**
 * Applique une récompense réservée : article offert ajouté (une unité, remise 100 %),
 * ou remise « Fidélité » sur les lignes sans remise (en euros : des plus chères aux moins
 * chères, jusqu'au montant ; en pourcentage : sur chacune).
 */
export function appliquerRecompense(c: Commande, r: RecompenseFidelite, u: UtilisationFidelite, par: string, carte: Catalogue | null, articleId?: string): Commande {
  const remise = (montantTTC: number, pourcentage: number) => ({ pourcentage, montantTTC, motif: MOTIF_FIDELITE, accordeePar: ACCORD_FIDELITE });
  const avecUtilisation = (x: Commande): Commande => ({ ...x, fidelite: { ...x.fidelite!, utilisations: [...(x.fidelite?.utilisations ?? []), u] } });
  if (r.type === "ARTICLE") {
    const a = carte?.categories.flatMap((cat) => cat.articles).find((x) => x.id === articleId);
    if (!a || a.prixTTC == null) throw new Error("Article offert introuvable dans la carte.");
    const avant = new Set(c.lignes.map((l) => l.uid));
    const ajoutee = ajouterLigne(c, {
      articleId: a.id,
      libelle: a.nom,
      details: [],
      quantite: 1,
      prixUnitaireTTC: a.prixTTC,
      tauxTVA: a.tauxTVA,
      remise: remise(a.prixTTC, 100),
      ajouteePar: par,
    });
    return avecUtilisation({ ...ajoutee, lignes: ajoutee.lignes.map((l) => (avant.has(l.uid) ? l : { ...l, fidelite: u.id })) });
  }
  const cibles = new Map<string, { montant: number; pourcentage: number }>();
  if (r.type === "REMISE_EUROS") {
    let restant = r.montant ?? 0;
    for (const l of [...remisables(c)].sort((a, b) => brut(b) - brut(a))) {
      if (restant <= 0) break;
      const m = Math.min(restant, brut(l));
      cibles.set(l.uid, { montant: m, pourcentage: m === brut(l) ? 100 : (m * 100) / brut(l) });
      restant -= m;
    }
  } else {
    for (const l of remisables(c)) cibles.set(l.uid, { montant: montantRemise(brut(l), r.pourcentage ?? 0), pourcentage: r.pourcentage ?? 0 });
  }
  if (![...cibles.values()].some((x) => x.montant > 0)) throw new Error("Rien à remiser sur cette commande : ajoutez d'abord des articles sans remise.");
  return avecUtilisation({
    ...c,
    lignes: c.lignes.map((l) => {
      const x = cibles.get(l.uid);
      return x && x.montant > 0 ? { ...l, remise: remise(x.montant, x.pourcentage), fidelite: u.id } : l;
    }),
  });
}

/** Retire une récompense : les remises qu'elle portait disparaissent (un article offert reste, à son prix). */
export function retirerRecompense(c: Commande, utilisationId: string): Commande {
  const lignes = c.lignes.map((l) => {
    if (l.fidelite !== utilisationId || l.reglee) return l;
    const { fidelite: _, remise: __, ...reste } = l;
    return reste;
  });
  return { ...c, lignes, ...(c.fidelite ? { fidelite: { ...c.fidelite, utilisations: c.fidelite.utilisations.filter((u) => u.id !== utilisationId) } } : {}) };
}

/** Récompenses réservées qui ne sont plus sur aucune ligne (ligne modifiée ou retirée) : à rendre. */
export function utilisationsOrphelines(c: Commande): UtilisationFidelite[] {
  const surLignes = new Set(c.lignes.filter((l) => !l.retiree && l.remise?.motif === MOTIF_FIDELITE).map((l) => l.fidelite));
  return (c.fidelite?.utilisations ?? []).filter((u) => !surLignes.has(u.id));
}

/** Lien du ticket avec la carte : les récompenses appliquées sur ses lignes. */
export function lienDuTicket(f: FideliteCommande, caisseId: string, numero: number, lignes: LigneCommande[]): LienFidelite {
  const utilisations = [...new Set(lignes.filter((l) => l.remise?.motif === MOTIF_FIDELITE && l.fidelite).map((l) => l.fidelite!))];
  return { caisseId, numero, ...(f.membreId ? { membreId: f.membreId } : { telephone: f.telephone }), utilisations };
}
