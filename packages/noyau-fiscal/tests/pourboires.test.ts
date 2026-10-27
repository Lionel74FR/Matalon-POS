import { describe, expect, it } from "vitest";
import { exporterCloturesCSV, paiementsEffectifs, totauxTickets, verifierRegistre, VERSION_NOYAU_FISCAL } from "../src/index.js";
import { CAPPUCCINO, nouveauRegistre, SPRITZ } from "./aide.js";

/**
 * Rendu monnaie sur un excédent de carte (1.1.0). Besoin (Lionel, 27 octobre 2026) : pour une note
 * de 25 €, le client passe 27 € au TPE ; les 2 € de pourboire sont rendus au serveur en espèces,
 * depuis le tiroir. La Z doit donner la CB du TPE (27 €) et des espèces diminuées de 2 €, le CA
 * et la TVA restant ceux de la note (25 €).
 */
describe("rendu en espèces sur un excédent de carte (pourboire)", () => {
  it("scelle la vente à son total, la Z compte la CB du TPE et les espèces sorties", async () => {
    const { registre, stockage, resoudreCle } = await nouveauRegistre();
    // Cappuccino 4 € + Spritz : une note de 15 €, 17 € passés en CB.
    const vente = await registre.enregistrerVente({ lignes: [CAPPUCCINO, SPRITZ], paiements: [{ mode: "CB", montant: 1700 }], operateurId: "lea" });
    expect(vente).toMatchObject({ totalTTC: 1500, paiements: [{ mode: "CB", montant: 1700 }], renduMonnaie: 200, versionLogiciel: VERSION_NOYAU_FISCAL });
    expect(VERSION_NOYAU_FISCAL).toBe("1.1.0");
    // Une vente ordinaire en espèces, même journée.
    await registre.enregistrerVente({ lignes: [CAPPUCCINO], paiements: [{ mode: "ESPECES", montant: 1000 }], operateurId: "lea" });
    const tickets = await stockage.lister("tickets");
    expect(paiementsEffectifs(vente, tickets)).toEqual([
      { mode: "CB", montant: 1700 },
      { mode: "ESPECES", montant: -200 },
    ]);
    const totaux = totauxTickets(tickets);
    expect(totaux).toMatchObject({ nbVentes: 2, totalTTC: 1900 });
    expect(totaux.paiements).toEqual([
      { mode: "CB", montant: 1700 },
      { mode: "ESPECES", montant: 200 },
    ]);
    const z = (await registre.cloturerJournee("lionel"))[0]!;
    expect(z.totalTTC).toBe(1900);
    expect(z.paiements).toEqual(totaux.paiements);
    expect(exporterCloturesCSV([z]).split("\r\n")[1]).toContain(";17,00;2,00;");
    expect((await verifierRegistre(stockage, resoudreCle)).integre).toBe(true);
  });

  it("une vente au pourboire annulée rend la CB et remet les espèces au tiroir", async () => {
    const { registre, stockage, resoudreCle } = await nouveauRegistre();
    const vente = await registre.enregistrerVente({ lignes: [SPRITZ], paiements: [{ mode: "CB", montant: 1300 }], operateurId: "lea" });
    expect(vente.renduMonnaie).toBe(200);
    const annulation = await registre.enregistrerAnnulation({ numeroTicket: vente.numero, motif: "Erreur de saisie", operateurId: "lionel" });
    expect(annulation.paiements).toEqual([
      { mode: "CB", montant: -1300 },
      { mode: "ESPECES", montant: 200 },
    ]);
    const totaux = totauxTickets(await stockage.lister("tickets"));
    expect(totaux.totalTTC).toBe(0);
    expect(totaux.paiements.every((p) => p.montant === 0)).toBe(true);
    expect((await verifierRegistre(stockage, resoudreCle)).integre).toBe(true);
  });

  it("une vente au pourboire se corrige vers des modes exacts, sans rendu", async () => {
    const { registre, stockage, resoudreCle } = await nouveauRegistre();
    const vente = await registre.enregistrerVente({ lignes: [SPRITZ], paiements: [{ mode: "CB", montant: 1300 }], operateurId: "lea" });
    await registre.enregistrerCorrection({ numeroTicket: vente.numero, paiements: [{ mode: "ESPECES", montant: 1100 }], motif: "Erreur de mode de paiement", operateurId: "lionel" });
    expect(paiementsEffectifs(vente, await stockage.lister("tickets"))).toEqual([{ mode: "ESPECES", montant: 1100 }]);
    expect((await verifierRegistre(stockage, resoudreCle)).integre).toBe(true);
  });

  it("refuse le rendu sur un titre-restaurant ou une vente portée en compte", async () => {
    const { registre } = await nouveauRegistre();
    await expect(
      registre.enregistrerVente({ lignes: [CAPPUCCINO], paiements: [{ mode: "TITRE_RESTAURANT_CARTE", montant: 600 }], operateurId: "lea" }),
    ).rejects.toMatchObject({ code: "RENDU_IMPOSSIBLE" });
    await expect(
      registre.enregistrerVente({
        lignes: [CAPPUCCINO, SPRITZ],
        paiements: [{ mode: "EN_COMPTE", montant: 1000 }, { mode: "CB", montant: 700 }],
        operateurId: "lea",
        client: { id: "cli-0000c4b1", nom: "Martin" },
      }),
    ).rejects.toMatchObject({ code: "RENDU_IMPOSSIBLE" });
  });
});
