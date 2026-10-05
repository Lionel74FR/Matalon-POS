import { formaterEuros } from "./montants.js";
import type { Cloture, ModePaiement } from "./types.js";
import { MODES_PAIEMENT } from "./types.js";

const LIBELLES_MODES: Record<ModePaiement, string> = {
  CB: "CB",
  ESPECES: "Especes",
  TITRE_RESTAURANT_PAPIER: "Titres-restaurant papier",
  TITRE_RESTAURANT_CARTE: "Titres-restaurant carte",
  AUTRE: "Autre",
};

function cellule(v: string | number): string {
  const s = String(v);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Export comptable des clôtures au format CSV (séparateur « ; », décimales à
 * la virgule, une ligne par clôture). Les taux de TVA présents deviennent des
 * colonnes HT / TVA / TTC.
 */
export function exporterCloturesCSV(clotures: Cloture[]): string {
  const taux = [...new Set(clotures.flatMap((c) => c.ventilationTVA.map((v) => v.tauxTVA)))].sort((a, b) => a - b);
  const pct = (t: number) => `${(t / 100).toString().replace(".", ",")}%`;
  const entetes = [
    "Etablissement",
    "Caisse",
    "Periode",
    "Identifiant",
    "Cloture n°",
    "Horodatage",
    "Tickets",
    "Ventes",
    "Annulations",
    ...taux.flatMap((t) => [`HT ${pct(t)}`, `TVA ${pct(t)}`, `TTC ${pct(t)}`]),
    "Total HT",
    "Total TVA",
    "Total TTC",
    ...MODES_PAIEMENT.map((m) => LIBELLES_MODES[m]),
    "Remises TTC",
    "Grand total perpetuel",
    "Empreinte",
  ];
  const lignes = clotures.map((c) => {
    const v = new Map(c.ventilationTVA.map((x) => [x.tauxTVA, x]));
    const p = new Map(c.paiements.map((x) => [x.mode, x.montant]));
    const plage = c.premierTicket == null ? "" : `${c.premierTicket}-${c.dernierTicket}`;
    return [
      c.etablissementId,
      c.caisseId,
      c.periode,
      c.identifiantPeriode,
      c.numero,
      c.horodatage,
      plage,
      c.nbVentes,
      c.nbAnnulations,
      ...taux.flatMap((t) => {
        const x = v.get(t);
        return [formaterEuros(x?.baseHT ?? 0), formaterEuros(x?.montantTVA ?? 0), formaterEuros(x?.montantTTC ?? 0)];
      }),
      formaterEuros(c.totalHT),
      formaterEuros(c.totalTVA),
      formaterEuros(c.totalTTC),
      ...MODES_PAIEMENT.map((m) => formaterEuros(p.get(m) ?? 0)),
      formaterEuros(c.totalRemisesTTC),
      formaterEuros(c.grandTotalPerpetuel),
      c.hash,
    ]
      .map(cellule)
      .join(";");
  });
  return [entetes.map(cellule).join(";"), ...lignes].join("\r\n") + "\r\n";
}
