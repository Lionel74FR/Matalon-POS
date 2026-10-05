/**
 * Description d'un reçu indépendante de l'imprimante : sert à l'impression
 * Epson (ePOS-Print XML) et à l'aperçu à l'écran.
 */
export type ElementRecu =
  | { type: "texte"; texte: string; align: "gauche" | "centre" | "droite"; gras: boolean; grand: boolean }
  | { type: "colonnes"; gauche: string; droite: string; gras: boolean; grand: boolean }
  | { type: "filet" }
  | { type: "saut"; lignes: number }
  | { type: "tiroir" };

/** Largeur d'une ligne en police A sur papier 80 mm. */
export const LARGEUR = 48;

export class Recu {
  readonly elements: ElementRecu[] = [];

  texte(texte: string, o: { align?: "gauche" | "centre" | "droite"; gras?: boolean; grand?: boolean } = {}): this {
    this.elements.push({ type: "texte", texte, align: o.align ?? "gauche", gras: o.gras ?? false, grand: o.grand ?? false });
    return this;
  }

  colonnes(gauche: string, droite: string, o: { gras?: boolean; grand?: boolean } = {}): this {
    this.elements.push({ type: "colonnes", gauche, droite, gras: o.gras ?? false, grand: o.grand ?? false });
    return this;
  }

  filet(): this {
    this.elements.push({ type: "filet" });
    return this;
  }

  saut(lignes = 1): this {
    this.elements.push({ type: "saut", lignes });
    return this;
  }

  ouvrirTiroir(): this {
    this.elements.push({ type: "tiroir" });
    return this;
  }
}

/** Met deux textes aux extrémités d'une ligne de `largeur` caractères, en coupant la partie gauche si besoin. */
export function aligner(gauche: string, droite: string, largeur: number): string[] {
  const place = largeur - droite.length - 1;
  if (gauche.length <= place) return [gauche + " ".repeat(largeur - gauche.length - droite.length) + droite];
  // Libellé trop long : on le replie sur plusieurs lignes, le montant sur la dernière.
  const mots = gauche.split(" ");
  const lignes: string[] = [];
  let courante = "";
  for (const mot of mots) {
    if ((courante + " " + mot).trim().length > largeur) {
      lignes.push(courante);
      courante = mot;
    } else courante = (courante + " " + mot).trim();
  }
  const derniere = courante.length <= place ? courante : (lignes.push(courante), "");
  lignes.push(derniere + " ".repeat(Math.max(1, largeur - derniere.length - droite.length)) + droite);
  return lignes;
}

/** Rendu texte brut (aperçu, tests). Les caractères larges comptent double. */
export function versTexte(r: Recu): string[] {
  const out: string[] = [];
  for (const e of r.elements) {
    switch (e.type) {
      case "texte": {
        const largeur = e.grand ? LARGEUR / 2 : LARGEUR;
        const t = e.texte.slice(0, largeur);
        const marge = e.align === "centre" ? Math.floor((largeur - t.length) / 2) : e.align === "droite" ? largeur - t.length : 0;
        out.push(" ".repeat(marge) + t);
        break;
      }
      case "colonnes":
        out.push(...aligner(e.gauche, e.droite, e.grand ? LARGEUR / 2 : LARGEUR));
        break;
      case "filet":
        out.push("-".repeat(LARGEUR));
        break;
      case "saut":
        for (let i = 0; i < e.lignes; i++) out.push("");
        break;
      case "tiroir":
        break;
    }
  }
  return out;
}
