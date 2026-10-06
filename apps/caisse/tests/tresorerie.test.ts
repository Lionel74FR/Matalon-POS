import { genererPaireCles, Registre, signataireDepuis, StockageMemoire, verifierRegistre } from "@matalon/noyau-fiscal";
import { describe, expect, it } from "vitest";
import { comptageDeLaZ, detailsComptage, etatJournee, rapprocher, totalCoupures } from "../src/metier/tresorerie";

async function caisseDeTest(debut = "2026-10-15T07:00:00Z") {
  const paire = await genererPaireCles("ipad-0000000a-k1");
  const stockage = new StockageMemoire();
  let t = Date.parse(debut);
  const registre = new Registre({
    stockage,
    signataire: signataireDepuis(paire),
    contexte: { etablissementId: "moka", caisseId: "ipad-0000000a" },
    horloge: () => new Date((t += 60_000)),
  });
  return { aller: (iso: string) => (t = Date.parse(iso)), stockage, registre, resoudre: (id: string) => (id === paire.cleId ? paire.clePubliqueJwk : null) };
}

const CAFE = { articleId: "cafe", libelle: "Café", quantite: 1, prixUnitaireTTC: 250, tauxTVA: 1000 };

describe("fond de caisse et comptage", () => {
  it("rapproche espèces, CB et titres, trace le comptage dans la plage de la Z et propose le fond du lendemain", async () => {
    const { stockage, registre, resoudre } = await caisseDeTest();
    expect((await etatJournee(stockage)).fondDeclare).toBeNull();
    await registre.journaliser("FOND_DE_CAISSE", { montant: 15000 }, "u-00000001");
    await registre.enregistrerVente({ lignes: [CAFE, CAFE], paiements: [{ mode: "ESPECES", montant: 1000 }], operateurId: "u-00000001" });
    await registre.enregistrerVente({ lignes: [CAFE], paiements: [{ mode: "CB", montant: 250 }], operateurId: "u-00000001" });
    await registre.enregistrerVente({ lignes: [CAFE], paiements: [{ mode: "TITRE_RESTAURANT_CARTE", montant: 250 }], operateurId: "u-00000001" });

    const etat = await etatJournee(stockage);
    expect(etat.fondDeclare).toBe(15000);
    expect(totalCoupures({ 10000: 1, 5000: 1, 200: 2, 50: 1, 20: 2 })).toBe(15490);
    const saisie = {
      fondInitial: 15000,
      especesComptees: 15490, // 500 attendus en espèces nettes (1000 - 500 rendus) : 10 c de manque
      detail: { 10000: 1, 5000: 1, 200: 2, 50: 1, 20: 2 },
      cbTpe: 250,
      trCarteTpe: 250,
      trPapierComptes: 0,
      fondConserve: 15000,
      motif: "Erreur de rendu",
    };
    const r = rapprocher(etat.totaux, saisie);
    expect(r).toMatchObject({ especesAttendues: 15500, ecartEspeces: -10, ecartCb: 0, ecartTrCarte: 0, remiseEnBanque: 490, avecEcart: true });

    await registre.journaliser("COMPTAGE_CAISSE", detailsComptage(etat.totaux, saisie, etat.dateComptable!), "u-00000001");
    const [z] = await registre.cloturerJournee("u-00000001");
    const comptage = await comptageDeLaZ(stockage, z!);
    expect(comptage?.details).toMatchObject({ ecartEspeces: -10, coupures: "10000x1 5000x1 200x2 50x1 20x2", motif: "Erreur de rendu" });

    // Le lendemain : nouveau fond à déclarer, celui laissé la veille est proposé.
    const demain = await etatJournee(stockage);
    expect(demain).toMatchObject({ fondDeclare: null, fondPropose: 15000, totaux: { nbVentes: 0 } });
    expect((await verifierRegistre(stockage, resoudre)).integre).toBe(true);
  });

  it("rattache le comptage à la dernière Z quand une Z oubliée est rattrapée (régression relecture)", async () => {
    const { stockage, registre, aller } = await caisseDeTest();
    await registre.enregistrerVente({ lignes: [CAFE], paiements: [{ mode: "ESPECES", montant: 250 }], operateurId: "u-00000001" });
    aller("2026-10-16T09:00:00Z");
    await registre.enregistrerVente({ lignes: [CAFE], paiements: [{ mode: "ESPECES", montant: 250 }], operateurId: "u-00000001" });
    const etat = await etatJournee(stockage);
    expect(etat.journees).toEqual(["2026-10-15", "2026-10-16"]);
    const saisie = { fondInitial: 10000, especesComptees: 10500, detail: {}, cbTpe: 0, trCarteTpe: 0, trPapierComptes: 0, fondConserve: 12000, motif: "" };
    await registre.journaliser("COMPTAGE_CAISSE", detailsComptage(etat.totaux, saisie, etat.dateComptable!), "u-00000001");
    const [z15, z16] = await registre.cloturerJournee("u-00000001");
    expect(z15!.identifiantPeriode).toBe("2026-10-15");
    expect(await comptageDeLaZ(stockage, z15!)).toBeNull();
    expect((await comptageDeLaZ(stockage, z16!))?.details).toMatchObject({ journee: "2026-10-16", especesComptees: 10500 });
    expect((await etatJournee(stockage)).fondPropose).toBe(12000);
  });
});
