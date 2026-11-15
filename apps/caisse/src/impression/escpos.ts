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

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

/** Commandes ESC/POS d'un reçu. Une simple ouverture de tiroir ne consomme ni papier ni coupe. */
export function versEscPos(r: Recu, o: { sansAccents: boolean }): Uint8Array {
  const out: number[] = [ESC, 0x40];
  if (!o.sansAccents) out.push(ESC, 0x74, 19);
  const style = (gras: boolean, grand: boolean) => out.push(ESC, 0x45, gras ? 1 : 0, GS, 0x21, grand ? 0x11 : 0x00);
  const ligne = (t: string) => out.push(...encoderPc858(t, o), LF);
  for (const e of r.elements) {
    switch (e.type) {
      case "texte": {
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
    out.push(ESC, 0x64, 3, GS, 0x56, 0);
  }
  return Uint8Array.from(out);
}
