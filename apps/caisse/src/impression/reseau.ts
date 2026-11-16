import type { Configuration } from "../donnees/configuration";
import { ErreurImpression } from "./epson";
import { versEscPos } from "./escpos";
import { logoSerie } from "./logo-serie";
import type { Recu } from "./recu";

/**
 * Imprimante réseau ESC/POS (16 novembre 2026, backlog n° 5 : additions sur l'Oxhoo de la salle du
 * Chardon, 192.168.1.248). Chrome n'ouvre pas de connexion directe vers le port 9100 : sur la dalle,
 * un petit script (public/outils/matalon-imprimante-reseau.ps1, lancé à l'ouverture de session) écoute
 * sur 127.0.0.1:9181 et transmet à l'imprimante le ticket déjà mis en forme ici.
 */
export const SCRIPT_RESEAU = "http://127.0.0.1:9181";
export const URL_SCRIPT_RESEAU = "/outils/matalon-imprimante-reseau.ps1";

/** Version du script lancé sur cet ordinateur, ou null s'il ne répond pas. */
export async function etatScriptReseau(): Promise<number | null> {
  try {
    const r = await fetch(`${SCRIPT_RESEAU}/etat`, { cache: "no-store", signal: AbortSignal.timeout(3000) });
    const j = (await r.json()) as { ok?: boolean; version?: number };
    return r.ok && j.ok ? (j.version ?? 0) : null;
  } catch {
    return null;
  }
}

/** Envoie des octets à l'imprimante réseau par le script local de la dalle. */
export async function envoyerReseau(octets: Uint8Array, adresse: string, port = 9100): Promise<void> {
  let r: Response;
  try {
    r = await fetch(`${SCRIPT_RESEAU}/imprimer?ip=${encodeURIComponent(adresse)}&port=${port}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: new Blob([octets as Uint8Array<ArrayBuffer>]),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new ErreurImpression(
      "Script d'impression réseau injoignable sur cette dalle : installez-le (Réglages › Imprimante des additions) et autorisez Chrome à accéder au réseau local.",
      "injoignable",
    );
  }
  if (!r.ok) {
    const j = (await r.json().catch(() => ({}))) as { erreur?: string };
    throw new ErreurImpression(`Imprimante ${adresse} : ${j.erreur ?? `erreur ${r.status}`}`, "injoignable");
  }
}

/** Imprime un reçu sur une imprimante réseau ESC/POS (logo de l'établissement envoyé avec le ticket). */
export async function imprimerReseau(recu: Recu, o: { adresse: string; sansAccents: boolean }, config: Pick<Configuration, "etablissementId" | "logo">): Promise<void> {
  await envoyerReseau(versEscPos(recu, { sansAccents: o.sansAccents, logo: await logoSerie(config) }), o.adresse);
}
