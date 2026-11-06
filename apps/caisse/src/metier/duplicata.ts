import type { Caisse } from "../fiscal/caisse";

/**
 * Numéro du prochain duplicata d'une note, sur l'appareil qui l'a encaissée : à la suite des duplicatas
 * de son journal (papier, écran, QR code, e-mail ; les factures ont leur propre suite) et, en ligne, de
 * ceux ressortis depuis l'administration (6 novembre 2026), que le serveur connaît. Hors ligne ou sans
 * réponse en 3 secondes, le journal de l'appareil suffit.
 */
export async function prochainDuplicata(caisse: Pick<Caisse, "stockage" | "client">, numero: number): Promise<number> {
  const evts = await caisse.stockage.lister("evenements");
  const locaux = evts
    .filter((e) => e.code === "REIMPRESSION_TICKET" && e.details.ticket === numero && e.details.facture == null)
    .reduce((m, e) => Math.max(m, typeof e.details.duplicata === "number" ? e.details.duplicata : 0), 0);
  const serveur = await Promise.race([
    caisse.client.dernierDuplicata(numero).then(
      (r) => r.dernier,
      () => 0,
    ),
    new Promise<number>((ok) => setTimeout(() => ok(0), 3000)),
  ]);
  return Math.max(locaux, serveur) + 1;
}
