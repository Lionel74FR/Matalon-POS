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
 * Image RGBA (canvas) en points noirs : un pixel est noir s'il est sombre une fois posé sur du papier
 * blanc (la transparence compte comme du blanc).
 */
export function rasterDepuisRgba(rgba: ArrayLike<number>, largeur: number, hauteur: number): LogoRaster {
  const largeurOctets = Math.ceil(largeur / 8);
  const points = new Uint8Array(largeurOctets * hauteur);
  for (let y = 0; y < hauteur; y++) {
    for (let x = 0; x < largeur; x++) {
      const i = (y * largeur + x) * 4;
      const alpha = rgba[i + 3]! / 255;
      const lum = alpha * (0.299 * rgba[i]! + 0.587 * rgba[i + 1]! + 0.114 * rgba[i + 2]!) + (1 - alpha) * 255;
      if (lum < 128) points[y * largeurOctets + (x >> 3)]! |= 0x80 >> (x & 7);
    }
  }
  return { largeurOctets, hauteur, points };
}

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;
/** Lignes vides avancées avant la coupe (distance tête-couteau, plus une marge sous le dernier texte). */
export const LIGNES_AVANT_COUPE = 8;

/** Commandes ESC/POS d'un reçu. Une simple ouverture de tiroir ne consomme ni papier ni coupe. */
export function versEscPos(r: Recu, o: { sansAccents: boolean; logo?: LogoRaster | null }): Uint8Array {
  const out: number[] = [ESC, 0x40];
  if (!o.sansAccents) out.push(ESC, 0x74, 19);
  const style = (gras: boolean, grand: boolean) => out.push(ESC, 0x45, gras ? 1 : 0, GS, 0x21, grand ? 0x11 : 0x00);
  const ligne = (t: string) => out.push(...encoderPc858(t, o), LF);
  for (const e of r.elements) {
    switch (e.type) {
      case "texte": {
        if (e.enseigne && o.logo) {
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
    out.push(GS, 0x56, 0);
  }
  return Uint8Array.from(out);
}
