import { genererPaireCles, Registre, signataireDepuis, StockageMemoire } from "@matalon/noyau-fiscal";
import { describe, expect, it } from "vitest";
import { FILTRES_VIDES, filtrerTickets, lireMontant, nombreFiltres, totaliser, type FiltresTickets } from "../src/metier/filtres-tickets";

const CAFE = { articleId: "cafe", libelle: "Cappuccino", quantite: 1, prixUnitaireTTC: 400, tauxTVA: 1000 };
const PLAT = { articleId: "plat", libelle: "Croque", quantite: 1, prixUnitaireTTC: 1250, tauxTVA: 1000 };

async function journee() {
  const paire = await genererPaireCles("ipad-1de068f6-k1");
  const stockage = new StockageMemoire();
  const registre = new Registre({ stockage, signataire: signataireDepuis(paire), contexte: { etablissementId: "moka", caisseId: "ipad-1de068f6" } });
  const t1 = await registre.enregistrerVente({ lignes: [CAFE], paiements: [{ mode: "CB", montant: 400 }], operateurId: "u-lea" });
  // Espèces avec rendu : seul le net compte (20 € donnés, 7,50 € rendus).
  const t2 = await registre.enregistrerVente({ lignes: [PLAT], paiements: [{ mode: "ESPECES", montant: 2000 }], operateurId: "u-tom", tableId: "t5" });
  const t3 = await registre.enregistrerVente({ lignes: [PLAT, CAFE], paiements: [{ mode: "CB", montant: 1650 }], operateurId: "u-lea", tableId: "t2" });
  // t3 payé en espèces en réalité : corrigé.
  const c = await registre.enregistrerCorrection({ numeroTicket: t3.numero, paiements: [{ mode: "ESPECES", montant: 1650 }], motif: "Erreur de mode", operateurId: "u-lea" });
  const a = await registre.enregistrerAnnulation({ numeroTicket: t1.numero, motif: "Erreur de saisie", operateurId: "u-lea" });
  const tous = (await stockage.lister("tickets")).reverse();
  return { t1, t2, t3, c, a, tous };
}

const f = (m: Partial<FiltresTickets>): FiltresTickets => ({ ...FILTRES_VIDES, ...m });

describe("filtres de l'écran Tickets", () => {
  it("filtre par montant, moyen de paiement corrigé, nature, lieu et personne", async () => {
    const { t1, t2, t3, c, a, tous } = await journee();
    const ctx = { tous, texte: (t: { tableId: string | null }) => (t.tableId === "t5" ? "Table Terrasse 5" : "Comptoir") };
    const numeros = (m: Partial<FiltresTickets>) => filtrerTickets(tous, f(m), ctx).map((t) => t.numero);
    expect(numeros({})).toHaveLength(5);
    // Montant en valeur absolue : l'annulation de 4 € entre dans « jusqu'à 5 € ».
    expect(numeros({ montantMax: 500 })).toEqual([a.numero, c.numero, t1.numero]);
    expect(numeros({ montantMin: 1000, montantMax: 1300 })).toEqual([t2.numero]);
    // t3 a été corrigé de CB en espèces : il sort des CB, entre dans les espèces.
    expect(numeros({ modes: ["CB"] })).toEqual([a.numero, c.numero, t1.numero]);
    expect(numeros({ modes: ["ESPECES"] })).toEqual([c.numero, t3.numero, t2.numero]);
    expect(numeros({ natures: ["VENTE"] })).toEqual([t3.numero, t2.numero]);
    expect(numeros({ natures: ["VENTE_ANNULEE", "ANNULATION"] })).toEqual([a.numero, t1.numero]);
    expect(numeros({ lieu: "table" })).toEqual([t3.numero, t2.numero]);
    expect(numeros({ lieu: "comptoir" })).toEqual([a.numero, t1.numero]);
    expect(numeros({ operateurs: ["u-tom"] })).toEqual([t2.numero]);
    // Recherche : n° de ticket, montant, texte sans accents ni casse, motif.
    expect(numeros({ recherche: String(t2.numero) })).toEqual([t2.numero]);
    expect(numeros({ recherche: "12,50" })).toEqual([t2.numero]);
    expect(numeros({ recherche: "terrasse" })).toEqual([t2.numero]);
    expect(numeros({ recherche: "saisie" })).toEqual([a.numero]);
    expect(nombreFiltres(f({ modes: ["CB"], montantMin: 100, recherche: "x" }))).toBe(2);
  });

  it("totalise les ventes et l'encaissé par moyen de paiement, corrections comprises", async () => {
    const { tous } = await journee();
    const t = totaliser(tous, tous);
    expect(t.nombre).toBe(5);
    // 4 + 12,50 + 16,50 − 4 (annulation).
    expect(t.ventesTTC).toBe(2900);
    // CB : 4 € puis remboursés ; espèces : 12,50 net du rendu + 16,50 corrigés.
    expect(t.parMode).toEqual({ CB: 0, ESPECES: 2900 });
  });

  it("lit un montant saisi", () => {
    expect(lireMontant("12,5")).toBe(1250);
    expect(lireMontant("12.05 €")).toBe(1205);
    expect(lireMontant("douze")).toBeNull();
  });
});
