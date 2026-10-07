import { describe, expect, it } from "vitest";
import { paiementsEffectifs, totauxTickets, verifierCorrections, verifierRegistre, VERSION_NOYAU_FISCAL } from "../src/index.js";
import { CAPPUCCINO, nouveauRegistre, SPRITZ } from "./aide.js";

/**
 * Correction des moyens de paiement (0.6.0). Besoin : une vente encaissée en
 * « carte » alors que le client a payé en espèces fausse le rapprochement de
 * la Z. Le ticket scellé ne se réécrit pas : un ticket CORRECTION de total nul
 * porte l'écart entre modes, avant la Z de la journée.
 */
describe("correction des moyens de paiement", () => {
  it("corrige carte → espèces par un ticket de total nul ; la Z compte les bons modes", async () => {
    const { registre, stockage, resoudreCle } = await nouveauRegistre();
    const vente = await registre.enregistrerVente({ lignes: [CAPPUCCINO, SPRITZ], paiements: [{ mode: "CB", montant: 1500 }], operateurId: "lea" });
    const c = await registre.enregistrerCorrection({
      numeroTicket: vente.numero,
      paiements: [{ mode: "ESPECES", montant: 1000 }, { mode: "CB", montant: 500 }],
      motif: "Erreur de mode de paiement",
      operateurId: "lionel",
    });
    expect(c).toMatchObject({
      type: "CORRECTION",
      totalTTC: 0,
      lignes: [],
      ticketOrigine: { numero: vente.numero, hash: vente.hash },
      paiements: [
        { mode: "CB", montant: -1000 },
        { mode: "ESPECES", montant: 1000 },
      ],
      grandTotalPerpetuel: vente.grandTotalPerpetuel,
      cumulPerpetuelAbsolu: vente.cumulPerpetuelAbsolu,
      versionLogiciel: VERSION_NOYAU_FISCAL,
    });
    const tickets = await stockage.lister("tickets");
    expect(paiementsEffectifs(vente, tickets)).toEqual([
      { mode: "CB", montant: 500 },
      { mode: "ESPECES", montant: 1000 },
    ]);
    const totaux = totauxTickets(tickets);
    expect(totaux).toMatchObject({ nbVentes: 1, nbAnnulations: 0, totalTTC: 1500 });
    expect(totaux.paiements).toEqual([
      { mode: "CB", montant: 500 },
      { mode: "ESPECES", montant: 1000 },
    ]);
    const evenement = (await stockage.lister("evenements")).at(-1)!;
    expect(evenement).toMatchObject({ code: "CORRECTION_PAIEMENT", details: { ticketOrigine: vente.numero, avant: "CB 1500" } });
    const z = (await registre.cloturerJournee("lionel"))[0]!;
    expect(z.paiements).toEqual(totaux.paiements);
    expect((await verifierRegistre(stockage, resoudreCle)).integre).toBe(true);
  });

  it("une vente corrigée puis annulée rembourse les modes corrigés", async () => {
    const { registre, stockage } = await nouveauRegistre();
    const vente = await registre.enregistrerVente({ lignes: [CAPPUCCINO], paiements: [{ mode: "ESPECES", montant: 1000 }], operateurId: "lea" });
    expect(vente.renduMonnaie).toBe(600);
    await registre.enregistrerCorrection({ numeroTicket: vente.numero, paiements: [{ mode: "CB", montant: 400 }], motif: "Erreur", operateurId: "lionel" });
    const annulation = await registre.enregistrerAnnulation({ numeroTicket: vente.numero, motif: "Client parti", operateurId: "lionel" });
    expect(annulation.paiements).toEqual([{ mode: "CB", montant: -400 }]);
    expect(totauxTickets(await stockage.lister("tickets")).paiements).toEqual([
      { mode: "CB", montant: 0 },
      { mode: "ESPECES", montant: 0 },
    ]);
  });

  it("refuse après la Z, sur une vente en compte, une annulée, un montant faux, une correction vide ou sans motif", async () => {
    const { registre, temps } = await nouveauRegistre();
    const corriger = (numeroTicket: number, paiements: Array<{ mode: "CB" | "ESPECES" | "EN_COMPTE"; montant: number }>, motif = "Erreur") =>
      registre.enregistrerCorrection({ numeroTicket, paiements, motif, operateurId: "lionel" });
    const cloturee = await registre.enregistrerVente({ lignes: [CAPPUCCINO], paiements: [{ mode: "CB", montant: 400 }], operateurId: "lea" });
    await registre.cloturerJournee("lionel");
    temps.avancer(60 * 24);
    await expect(corriger(cloturee.numero, [{ mode: "ESPECES", montant: 400 }])).rejects.toMatchObject({ code: "CORRECTION_INTERDITE" });

    const enCompte = await registre.enregistrerVente({
      lignes: [CAPPUCCINO],
      paiements: [{ mode: "EN_COMPTE", montant: 400 }],
      operateurId: "lea",
      client: { id: "cli-0000abcd", nom: "M. Martin" },
    });
    await expect(corriger(enCompte.numero, [{ mode: "CB", montant: 400 }])).rejects.toMatchObject({ code: "CORRECTION_INTERDITE" });
    const vente = await registre.enregistrerVente({ lignes: [CAPPUCCINO], paiements: [{ mode: "CB", montant: 400 }], operateurId: "lea" });
    await expect(corriger(vente.numero, [{ mode: "EN_COMPTE", montant: 400 }])).rejects.toMatchObject({ code: "CORRECTION_INTERDITE" });
    await expect(corriger(vente.numero, [{ mode: "ESPECES", montant: 500 }])).rejects.toMatchObject({ code: "MONTANT_INVALIDE" });
    await expect(corriger(vente.numero, [{ mode: "ESPECES", montant: 300 }])).rejects.toMatchObject({ code: "PAIEMENT_INSUFFISANT" });
    await expect(corriger(vente.numero, [{ mode: "CB", montant: 400 }])).rejects.toMatchObject({ code: "CORRECTION_VIDE" });
    await expect(corriger(vente.numero, [{ mode: "ESPECES", montant: 400 }], " ")).rejects.toMatchObject({ code: "MOTIF_OBLIGATOIRE" });
    const c = await corriger(vente.numero, [{ mode: "ESPECES", montant: 400 }]);
    await expect(corriger(c.numero, [{ mode: "CB", montant: 400 }])).rejects.toMatchObject({ code: "CORRECTION_INTERDITE" });
    await expect(registre.enregistrerAnnulation({ numeroTicket: c.numero, motif: "x", operateurId: "lionel" })).rejects.toMatchObject({
      code: "ANNULATION_INTERDITE",
    });
    await registre.enregistrerAnnulation({ numeroTicket: vente.numero, motif: "x", operateurId: "lionel" });
    await expect(corriger(vente.numero, [{ mode: "CB", montant: 400 }])).rejects.toMatchObject({ code: "DEJA_ANNULE" });
  });

  it("démasque une correction altérée ou détachée de sa vente", async () => {
    const { registre, stockage, resoudreCle } = await nouveauRegistre();
    const vente = await registre.enregistrerVente({ lignes: [CAPPUCCINO], paiements: [{ mode: "CB", montant: 400 }], operateurId: "lea" });
    await registre.enregistrerCorrection({ numeroTicket: vente.numero, paiements: [{ mode: "ESPECES", montant: 400 }], motif: "Erreur", operateurId: "lionel" });
    const tickets = await stockage.lister("tickets");
    expect(verifierCorrections(tickets)).toEqual([]);
    // Écart déséquilibré : la somme n'est plus nulle.
    stockage._brut("tickets")[1]!.paiements[1]!.montant = 900;
    expect((await verifierRegistre(stockage, resoudreCle)).anomalies.map((a) => a.code)).toContain("TOTAUX_INCOHERENTS");
    // Correction qui retirerait plus de carte que la vente n'en a reçu.
    const forgee = structuredClone(tickets);
    forgee[1]!.paiements = [
      { mode: "CB", montant: -800 },
      { mode: "ESPECES", montant: 800 },
    ];
    expect(verifierCorrections(forgee).map((a) => a.numero)).toEqual([2]);
  });
});
