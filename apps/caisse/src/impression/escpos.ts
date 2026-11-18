import { aligner, LARGEUR, type Recu } from "./recu";

/**
 * Traduction d'un reçu en commandes ESC/POS brutes, pour une imprimante branchée sur un port série
 * (Oxhoo TP85 des caisses du Chardon, 15 novembre 2026). Réglages validés sur place : ESC @ en tête,
 * page de codes PC858 (ESC t 19) pour l'euro et les accents, GS V 0 pour la coupe. Le ticket Epson
 * (ePOS-Print XML, réseau) ne passe jamais par ici.
 */

/** Caractères 0x80 à 0xFF de la page de codes PC858 (PC850 avec l'euro en 0xD5). */
const PC858_HAUT =
  "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈ€ÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´­±‗¾¶§÷¸°¨·¹³²■ ";
const PC858 = new Map<string, number>([...PC858_HAUT].map((c, i) => [c, 0x80 + i]));

/** Remplacements des caractères absents de la page de codes (typographie française, espaces fines). */
const REMPLACEMENTS: Record<string, string> = {
  "’": "'",
  "‘": "'",
  "“": '"',
  "”": '"',
  "—": "-",
  "–": "-",
  "…": "...",
  "œ": "oe",
  "Œ": "OE",
  " ": " ",
  " ": " ",
  " ": " ",
};

const sansAccents = (s: string) =>
  [...s]
    .map((c) => REMPLACEMENTS[c] ?? c)
    .join("")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/€/g, "EUR");

/** Texte en octets PC858 ; un caractère inconnu perd ses accents, sinon devient « ? ». */
export function encoderPc858(texte: string, o: { sansAccents: boolean }): number[] {
  const source = o.sansAccents ? sansAccents(texte) : [...texte].map((c) => REMPLACEMENTS[c] ?? c).join("");
  const octets: number[] = [];
  for (const c of source) {
    const code = c.codePointAt(0)!;
    if (code >= 0x20 && code < 0x7f) octets.push(code);
    else if (PC858.has(c)) octets.push(PC858.get(c)!);
    else {
      const simple = c.normalize("NFD").replace(/[̀-ͯ]/g, "");
      octets.push(...(simple.length && simple.codePointAt(0)! < 0x7f ? [...simple].map((x) => x.codePointAt(0)!) : [0x3f]));
    }
  }
  return octets;
}

/** Image noir et blanc pour la commande GS v 0 : `points` ligne par ligne, 8 points par octet, bit fort à gauche. */
export interface LogoRaster {
  largeurOctets: number;
  hauteur: number;
  points: Uint8Array;
}

/**
 * Image RGBA (canvas) en points noirs. Chaque pixel est posé sur du papier blanc (la transparence compte
 * comme du blanc) ; le seuil est à mi-chemin entre le pixel le plus foncé et le blanc, pour qu'un logo
 * de couleur claire (le doré du Chardon, 16 novembre) s'imprime aussi bien qu'un logo noir.
 */
export function rasterDepuisRgba(rgba: ArrayLike<number>, largeur: number, hauteur: number): LogoRaster {
  const largeurOctets = Math.ceil(largeur / 8);
  const points = new Uint8Array(largeurOctets * hauteur);
  const lum = new Float32Array(largeur * hauteur);
  let min = 255;
  for (let p = 0; p < lum.length; p++) {
    const alpha = rgba[p * 4 + 3]! / 255;
    lum[p] = alpha * (0.299 * rgba[p * 4]! + 0.587 * rgba[p * 4 + 1]! + 0.114 * rgba[p * 4 + 2]!) + (1 - alpha) * 255;
    if (lum[p]! < min) min = lum[p]!;
  }
  if (min > 245) return { largeurOctets, hauteur, points };
  const seuil = (min + 255) / 2;
  for (let y = 0; y < hauteur; y++) {
    for (let x = 0; x < largeur; x++) {
      if (lum[y * largeur + x]! < seuil) points[y * largeurOctets + (x >> 3)]! |= 0x80 >> (x & 7);
    }
  }
  return { largeurOctets, hauteur, points };
}

/**
 * Enregistre le logo dans la mémoire de l'imprimante (FS q, image n° 1), pour qu'un ticket n'envoie plus
 * que FS p (16 novembre 2026 : à 9 600 bauds, le logo ralentissait chaque ticket de 3 secondes). Format
 * en colonnes : pour chaque colonne de points, de haut en bas, 8 points par octet, bit fort en haut ;
 * hauteur complétée à un multiple de 8.
 */
export function definirLogoMemoire(logo: LogoRaster): Uint8Array {
  const x = logo.largeurOctets;
  const y = Math.ceil(logo.hauteur / 8);
  const out: number[] = [0x1b, 0x40, 0x1c, 0x71, 1, x & 0xff, x >> 8, y & 0xff, y >> 8];
  for (let col = 0; col < x * 8; col++) {
    for (let bloc = 0; bloc < y; bloc++) {
      let octet = 0;
      for (let b = 0; b < 8; b++) {
        const ligne = bloc * 8 + b;
        if (ligne < logo.hauteur && logo.points[ligne * x + (col >> 3)]! & (0x80 >> (col & 7))) octet |= 0x80 >> b;
      }
      out.push(octet);
    }
  }
  return Uint8Array.from(out);
}

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;
/** Lignes vides avancées avant la coupe (distance tête-couteau, plus une marge sous le dernier texte). */
export const LIGNES_AVANT_COUPE = 8;

/** Commandes ESC/POS d'un reçu. Une simple ouverture de tiroir ne consomme ni papier ni coupe. */
/** Logo du ticket : l'image à envoyer, « memoire » s'il est enregistré dans l'imprimante, null : aucun. */
export type LogoTicket = LogoRaster | "memoire" | null;

/**
 * Commandes de coupe partielle essayées sur une imprimante (18 novembre 2026 : l'Oxhoo du Chardon coupe
 * entièrement malgré GS V 1 ; DominoFR, sur la même imprimante, laisse le ticket accroché).
 */
export const COUPES_PARTIELLES_ESSAI: ReadonlyArray<{ nom: string; octets: number[] }> = [
  { nom: "A · GS V 1", octets: [GS, 0x56, 1] },
  { nom: "B · GS V 66 0", octets: [GS, 0x56, 66, 0] },
  { nom: "C · ESC m", octets: [ESC, 0x6d] },
  { nom: "D · GS V 49", octets: [GS, 0x56, 49] },
];

export function versEscPos(r: Recu, o: { sansAccents: boolean; logo?: LogoTicket; coupePartielle?: boolean; commandeCoupe?: number[] }): Uint8Array {
  const out: number[] = [ESC, 0x40];
  if (!o.sansAccents) out.push(ESC, 0x74, 19);
  const style = (gras: boolean, grand: boolean) => out.push(ESC, 0x45, gras ? 1 : 0, GS, 0x21, grand ? 0x11 : 0x00);
  const ligne = (t: string) => out.push(...encoderPc858(t, o), LF);
  for (const e of r.elements) {
    switch (e.type) {
      case "texte": {
        if (e.enseigne && o.logo === "memoire") {
          // Logo enregistré dans l'imprimante (FS p 1 0), centré.
          out.push(ESC, 0x61, 1, 0x1c, 0x70, 1, 0, LF, ESC, 0x61, 0);
          break;
        }
        if (e.enseigne && o.logo && o.logo !== "memoire") {
          // Logo centré à la place de l'enseigne (GS v 0, densité normale).
          const { largeurOctets: l, hauteur: h, points } = o.logo;
          out.push(ESC, 0x61, 1, GS, 0x76, 0x30, 0, l & 0xff, l >> 8, h & 0xff, h >> 8);
          for (const b of points) out.push(b);
          out.push(LF, ESC, 0x61, 0);
          break;
        }
        out.push(ESC, 0x61, e.align === "centre" ? 1 : e.align === "droite" ? 2 : 0);
        style(e.gras, e.grand);
        ligne(e.texte);
        out.push(ESC, 0x61, 0);
        break;
      }
      case "colonnes":
        style(e.gras, e.grand);
        for (const l of aligner(e.gauche, e.droite, e.grand ? LARGEUR / 2 : LARGEUR)) ligne(l);
        break;
      case "filet":
        style(false, false);
        ligne("-".repeat(LARGEUR));
        break;
      case "saut":
        out.push(ESC, 0x64, Math.max(0, Math.min(255, e.lignes)));
        break;
      case "tiroir":
        // Impulsion sur la broche 2 du tiroir : 50 ms, puis 500 ms de repos.
        out.push(ESC, 0x70, 0, 25, 250);
        break;
    }
  }
  if (r.elements.some((e) => e.type !== "tiroir")) {
    style(false, false);
    // Le couteau est au-dessus de la tête : sans avance suffisante, la fin du ticket reste sous la coupe
    // et sort en haut du ticket suivant (Oxhoo du Chardon, 16 novembre). Lignes vides en LF simples,
    // comprises par toutes les imprimantes, puis coupe.
    for (let i = 0; i < LIGNES_AVANT_COUPE; i++) out.push(LF);
    // GS V 0 : coupe totale ; GS V 1 : coupe partielle, le ticket reste accroché par un point (backlog n° 6).
    if (o.commandeCoupe) out.push(...o.commandeCoupe);
    else out.push(GS, 0x56, o.coupePartielle ? 1 : 0);
  }
  return Uint8Array.from(out);
}
