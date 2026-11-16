import type { Configuration } from "../donnees/configuration";
import { rasterDepuisRgba, type LogoRaster } from "./escpos";

/**
 * Logo de l'établissement pour l'imprimante série (16 novembre 2026, demande de Lionel : le logo en tête
 * du ticket à la place du gros titre). Ramené à 288 × 160 points et 25 600 points au plus (un logo rond
 * de 2 cm) : à 9 600 bauds, il ajoute environ 3 secondes au ticket. Gardé en mémoire et sur l'appareil,
 * par version, pour imprimer hors ligne.
 */
export const LOGO_LARGEUR_MAX = 288;
export const LOGO_HAUTEUR_MAX = 160;
const LOGO_POINTS_MAX = 160 * 160;
/** Format du logo gardé sur l'appareil : changé quand la conversion change, pour la refaire. */
const FORMAT = 2;
const CLE = "matalon-logo-serie";

let cache: { cle: string; raster: LogoRaster } | null = null;

const enBase64 = (o: Uint8Array) => btoa(Array.from(o, (b) => String.fromCharCode(b)).join(""));
const depuisBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Logo prêt à imprimer, ou null (pas de logo, ou illisible : l'enseigne s'imprime en texte). */
export async function logoSerie(config: Pick<Configuration, "etablissementId" | "logo">): Promise<LogoRaster | null> {
  if (!config.logo) return null;
  const cle = `${FORMAT}:${config.etablissementId}:${config.logo}`;
  if (cache?.cle === cle) return cache.raster;
  try {
    const lu = JSON.parse(localStorage.getItem(CLE) ?? "null") as { cle: string; l: number; h: number; d: string } | null;
    if (lu?.cle === cle) {
      cache = { cle, raster: { largeurOctets: lu.l, hauteur: lu.h, points: depuisBase64(lu.d) } };
      return cache.raster;
    }
  } catch {
    // Mémoire de l'appareil illisible : on recharge le logo.
  }
  try {
    const reponse = await fetch(`/api/public/logo/${encodeURIComponent(config.etablissementId)}?v=${encodeURIComponent(config.logo)}`);
    if (!reponse.ok) return null;
    const image = await createImageBitmap(await reponse.blob());
    const e = Math.min(1, LOGO_LARGEUR_MAX / image.width, LOGO_HAUTEUR_MAX / image.height, Math.sqrt(LOGO_POINTS_MAX / (image.width * image.height)));
    const largeur = Math.max(1, Math.round(image.width * e));
    const hauteur = Math.max(1, Math.round(image.height * e));
    const canvas = document.createElement("canvas");
    canvas.width = largeur;
    canvas.height = hauteur;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(image, 0, 0, largeur, hauteur);
    const raster = rasterDepuisRgba(ctx.getImageData(0, 0, largeur, hauteur).data, largeur, hauteur);
    cache = { cle, raster };
    try {
      localStorage.setItem(CLE, JSON.stringify({ cle, l: raster.largeurOctets, h: raster.hauteur, d: enBase64(raster.points) }));
    } catch {
      // Mémoire pleine : le logo reste en mémoire vive.
    }
    return raster;
  } catch {
    return null;
  }
}
