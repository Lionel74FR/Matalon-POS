import { describe, expect, it } from "vitest";
import {
  canonique,
  champsTotaux,
  exporterCloturesCSV,
  totauxTickets,
  ventilerProrata,
  ventilerTranche,
  verifierRegistre,
  VERSION_NOYAU_FISCAL,
  type Ticket,
} from "../src/index.js";
import { CAPPUCCINO, nouveauRegistre, SPRITZ } from "./aide.js";

/**
 * Comptes clients (0.5.0). Besoin : une table qui n'a pas payé à la clôture
 * doit pouvoir être portée au compte d'un client, puis réglée plus tard.
 * La vente compte dans le chiffre du jour ; la TVA d'une vente à consommer
 * sur place n'est exigible qu'à l'encaissement (BOI-TVA-BASE-20-20 § 130).
 */
const MARTIN = { id: "cli-0000abcd", nom: "M. Martin" };

const imputation = (t: Ticket, montantTTC: number, dejaRegleTTC = 0) => ({
  caisseId: t.caisseId,
  numero: t.numero,
  hash: t.hash,
  montantTTC,
  venteTotalTTC: t.totalTTC,
  venteEnCompteTTC: t.paiements.filter((p) => p.mode === "EN_COMPTE").reduce((s, p) => s + p.montant, 0),
  dejaRegleTTC,
  venteVentilationTVA: t.ventilationTVA,
});

describe("ventes en compte", () => {
  it("porte une vente au compte d'un client désigné, sans encaissement", async () => {
    const { registre, stockage, resoudreCle } = await nouveauRegistre();
    await expect(
      registre.enregistrerVente({ lignes: [CAPPUCCINO], paiements: [{ mode: "EN_COMPTE", montant: 400 }], operateurId: "lea" }),
    ).rejects.toMatchObject({ code: "CLIENT_INVALIDE" });
    await expect(
      registre.enregistrerVente({ lignes: [CAPPUCCINO], paiements: [{ mode: "CB", montant: 400 }], operateurId: "lea", client: MARTIN }),
    ).rejects.toMatchObject({ code: "CLIENT_INVALIDE" });
    await expect(
      registre.enregistrerVente({ lignes: [CAPPUCCINO], paiements: [{ mode: "EN_COMPTE", montant: 500 }], operateurId: "lea", client: MARTIN }),
    ).rejects.toMatchObject({ code: "RENDU_IMPOSSIBLE" });

    const t = await registre.enregistrerVente({
      lignes: [CAPPUCCINO],
      paiements: [{ mode: "EN_COMPTE", montant: 400 }],
      operateurId: "lea",
      client: { id: "cli-0000abcd", nom: "  M. Martin " },
    });
    expect(t).toMatchObject({ type: "VENTE", totalTTC: 400, client: MARTIN, versionLogiciel: VERSION_NOYAU_FISCAL });
    expect((await verifierRegistre(stockage, resoudreCle)).integre).toBe(true);
  });

  it("compte la vente dans la Z, mais la TVA n'est exigible que sur la part encaissée", async () => {
    const { registre } = await nouveauRegistre();
    // 15,00 € : 4,00 € à 10 % et 11,00 € à 20 % ; 5,00 € payés par carte, 10,00 € en compte.
    await registre.enregistrerVente({
      lignes: [CAPPUCCINO, SPRITZ],
      paiements: [
        { mode: "CB", montant: 500 },
        { mode: "EN_COMPTE", montant: 1000 },
      ],
      operateurId: "lea",
      client: MARTIN,
    });
    const [z] = await registre.cloturerJournee("lionel");
    expect(z).toMatchObject({ nbVentes: 1, totalTTC: 1500 });
    expect(z!.paiements).toEqual([
      { mode: "CB", montant: 500 },
      { mode: "EN_COMPTE", montant: 1000 },
    ]);
    expect(z!.comptesClients).toMatchObject({ ventesEnCompteTTC: 1000, nbReglements: 0, reglementsTTC: 0 });
    // TVA exigible : 5/15 de la vente, soit 1,33 € à 10 % et 3,67 € à 20 % TTC.
    expect(z!.comptesClients!.ventilationTVAExigible.map((v) => [v.tauxTVA, v.montantTTC])).toEqual([
      [1000, 133],
      [2000, 367],
    ]);
  });
});

describe("règlements de comptes", () => {
  it("encaisse une dette sans nouvelle vente, et rend la TVA exigible au jour du règlement", async () => {
    const { registre, stockage, temps, resoudreCle } = await nouveauRegistre("2026-10-15T20:00:00Z");
    const vente = await registre.enregistrerVente({
      lignes: [CAPPUCCINO, SPRITZ],
      paiements: [{ mode: "EN_COMPTE", montant: 1500 }],
      operateurId: "lea",
      client: MARTIN,
    });
    const [z1] = await registre.cloturerJournee("lionel");
    expect(z1!.comptesClients!.ventilationTVAExigible).toEqual([]);

    temps.aller("2026-10-17T10:00:00Z");
    const reglement = await registre.enregistrerReglement({
      client: MARTIN,
      paiements: [{ mode: "ESPECES", montant: 2000 }],
      imputations: [imputation(vente, 1500)],
      operateurId: "lea",
    });
    expect(reglement).toMatchObject({
      type: "REGLEMENT",
      totalTTC: 0,
      lignes: [],
      renduMonnaie: 500,
      client: MARTIN,
      grandTotalPerpetuel: vente.grandTotalPerpetuel,
    });
    expect(reglement.reglement!.montantTTC).toBe(1500);
    expect(canonique(reglement.reglement!.ventilationTVA)).toBe(canonique(vente.ventilationTVA));

    const [z2] = await registre.cloturerJournee("lionel");
    expect(z2).toMatchObject({ nbVentes: 0, totalTTC: 0, identifiantPeriode: "2026-10-17" });
    expect(z2!.paiements).toEqual([{ mode: "ESPECES", montant: 1500 }]);
    expect(z2!.comptesClients).toMatchObject({ ventesEnCompteTTC: 0, nbReglements: 1, reglementsTTC: 1500 });
    expect(canonique(z2!.comptesClients!.ventilationTVAExigible)).toBe(canonique(vente.ventilationTVA));
    expect((await verifierRegistre(stockage, resoudreCle)).integre).toBe(true);
  });

  it("règle en plusieurs fois et refuse de régler plus que la dette, ou la dette d'un autre", async () => {
    const { registre, stockage, resoudreCle } = await nouveauRegistre();
    const vente = await registre.enregistrerVente({
      lignes: [SPRITZ],
      paiements: [{ mode: "EN_COMPTE", montant: 1100 }],
      operateurId: "lea",
      client: MARTIN,
    });
    const regler = (montant: number, deja = 0, client = MARTIN, mode: "CB" | "EN_COMPTE" = "CB") =>
      registre.enregistrerReglement({ client, paiements: [{ mode, montant }], imputations: [imputation(vente, montant, deja)], operateurId: "lea" });

    await expect(regler(600, 0, { id: "cli-0000dddd", nom: "Mme Durand" })).rejects.toMatchObject({ code: "IMPUTATION_INVALIDE" });
    await expect(regler(600, 0, MARTIN, "EN_COMPTE")).rejects.toMatchObject({ code: "MODE_PAIEMENT_INVALIDE" });
    await regler(600);
    // Solde périmé (déjà réglé ignoré) : refusé ; dépassement du reste dû : refusé.
    await expect(regler(500, 0)).rejects.toMatchObject({ code: "IMPUTATION_INVALIDE" });
    await expect(regler(600, 600)).rejects.toMatchObject({ code: "IMPUTATION_INVALIDE" });
    await regler(500, 600);
    await expect(regler(1, 1100)).rejects.toMatchObject({ code: "IMPUTATION_INVALIDE" });
    await expect(registre.enregistrerAnnulation({ numeroTicket: vente.numero, motif: "Erreur", operateurId: "lionel" })).rejects.toMatchObject({
      code: "VENTE_REGLEE",
    });
    expect((await verifierRegistre(stockage, resoudreCle)).integre).toBe(true);
  });

  it("accepte la vente d'une autre caisse, mais jamais une ventilation que la vérification rejetterait", async () => {
    const { registre, stockage, resoudreCle } = await nouveauRegistre();
    const autre = {
      caisseId: "ipad-2",
      numero: 7,
      hash: "a".repeat(64),
      montantTTC: 400,
      venteTotalTTC: 400,
      venteEnCompteTTC: 400,
      dejaRegleTTC: 0,
      venteVentilationTVA: [{ tauxTVA: 1000, baseHT: 364, montantTVA: 36, montantTTC: 400 }],
    };
    const regler = (i: typeof autre) => registre.enregistrerReglement({ client: MARTIN, paiements: [{ mode: "CB", montant: i.montantTTC }], imputations: [i], operateurId: "lea" });
    await expect(regler({ ...autre, venteVentilationTVA: [] })).rejects.toMatchObject({ code: "IMPUTATION_INVALIDE" });
    await expect(regler({ ...autre, venteVentilationTVA: [{ tauxTVA: 1000, baseHT: 360, montantTVA: 40, montantTTC: 400 }] })).rejects.toMatchObject({
      code: "IMPUTATION_INVALIDE",
    });
    await expect(regler({ ...autre, venteVentilationTVA: [{ tauxTVA: 700, baseHT: 374, montantTVA: 26, montantTTC: 400 }] })).rejects.toMatchObject({
      code: "IMPUTATION_INVALIDE",
    });
    const r = await regler(autre);
    expect(r.reglement!.imputations[0]).toMatchObject({ caisseId: "ipad-2", numero: 7, montantTTC: 400, encaisseAvantTTC: 0 });
    expect((await verifierRegistre(stockage, resoudreCle)).integre).toBe(true);
  });

  it("annule un règlement : la dette renaît, la TVA exigible est reprise, puis la vente redevient annulable", async () => {
    const { registre, stockage, resoudreCle } = await nouveauRegistre();
    const vente = await registre.enregistrerVente({
      lignes: [CAPPUCCINO, SPRITZ],
      paiements: [{ mode: "EN_COMPTE", montant: 1500 }],
      operateurId: "lea",
      client: MARTIN,
    });
    const reglement = await registre.enregistrerReglement({
      client: MARTIN,
      paiements: [{ mode: "ESPECES", montant: 2000 }],
      imputations: [imputation(vente, 1000)],
      operateurId: "lea",
    });
    await expect(registre.enregistrerAnnulation({ numeroTicket: vente.numero, motif: "Erreur", operateurId: "lionel" })).rejects.toMatchObject({
      code: "VENTE_REGLEE",
    });
    const annulation = await registre.enregistrerAnnulation({ numeroTicket: reglement.numero, motif: "Mauvais client", operateurId: "lionel" });
    expect(annulation).toMatchObject({ type: "ANNULATION", totalTTC: 0, client: MARTIN, paiements: [{ mode: "ESPECES", montant: -1000 }] });
    expect(annulation.reglement!.montantTTC).toBe(-1000);
    await expect(registre.enregistrerAnnulation({ numeroTicket: reglement.numero, motif: "Bis", operateurId: "lionel" })).rejects.toMatchObject({
      code: "DEJA_ANNULE",
    });
    // La dette entière peut de nouveau être réglée…
    await registre.enregistrerReglement({ client: MARTIN, paiements: [{ mode: "CB", montant: 1500 }], imputations: [imputation(vente, 1500)], operateurId: "lea" });
    const [z] = await registre.cloturerJournee("lionel");
    expect(z!.comptesClients).toMatchObject({ ventesEnCompteTTC: 1500, nbReglements: 2, reglementsTTC: 1500 });
    expect(canonique(z!.comptesClients!.ventilationTVAExigible)).toBe(canonique(vente.ventilationTVA));
    expect(z!.paiements).toEqual([
      { mode: "CB", montant: 1500 },
      { mode: "ESPECES", montant: 0 },
      { mode: "EN_COMPTE", montant: 1500 },
    ]);
    expect((await verifierRegistre(stockage, resoudreCle)).integre).toBe(true);
  });

  it("la TVA des règlements successifs redonne exactement celle de la vente, sans dériver ni changer de taux", async () => {
    const { registre, stockage, resoudreCle } = await nouveauRegistre();
    // 15,50 € : 10,00 € à 10 % et 5,50 € à 20 % ; 0,50 € payés à la vente, le reste en trois règlements.
    const vente = await registre.enregistrerVente({
      lignes: [
        { ...CAPPUCCINO, quantite: 1, prixUnitaireTTC: 1000 },
        { ...SPRITZ, prixUnitaireTTC: 550 },
      ],
      paiements: [
        { mode: "CB", montant: 50 },
        { mode: "EN_COMPTE", montant: 1500 },
      ],
      operateurId: "lea",
      client: MARTIN,
    });
    let deja = 0;
    for (const m of [517, 517, 466]) {
      await registre.enregistrerReglement({ client: MARTIN, paiements: [{ mode: "CB", montant: m }], imputations: [imputation(vente, m, deja)], operateurId: "lea" });
      deja += m;
    }
    const [z] = await registre.cloturerJournee("lionel");
    expect(canonique(z!.comptesClients!.ventilationTVAExigible)).toBe(canonique(vente.ventilationTVA));
    expect((await verifierRegistre(stockage, resoudreCle)).integre).toBe(true);
  });

  it("annule une vente en compte non réglée : la dette s'annule avec elle", async () => {
    const { registre } = await nouveauRegistre();
    const vente = await registre.enregistrerVente({
      lignes: [CAPPUCCINO],
      paiements: [{ mode: "EN_COMPTE", montant: 400 }],
      operateurId: "lea",
      client: MARTIN,
    });
    const annulation = await registre.enregistrerAnnulation({ numeroTicket: vente.numero, motif: "Erreur", operateurId: "lionel" });
    expect(annulation).toMatchObject({ client: MARTIN, paiements: [{ mode: "EN_COMPTE", montant: -400 }] });
    const [z] = await registre.cloturerJournee("lionel");
    expect(z!.comptesClients!.ventesEnCompteTTC).toBe(0);
  });

  it("détecte un règlement modifié après coup", async () => {
    const { registre, stockage, resoudreCle } = await nouveauRegistre();
    const vente = await registre.enregistrerVente({
      lignes: [CAPPUCCINO],
      paiements: [{ mode: "EN_COMPTE", montant: 400 }],
      operateurId: "lea",
      client: MARTIN,
    });
    await registre.enregistrerReglement({ client: MARTIN, paiements: [{ mode: "CB", montant: 400 }], imputations: [imputation(vente, 400)], operateurId: "lea" });
    stockage._brut("tickets")[1]!.reglement!.montantTTC = 100;
    const rapport = await verifierRegistre(stockage, resoudreCle);
    expect(rapport.anomalies.map((a) => a.code)).toEqual(expect.arrayContaining(["EMPREINTE_INVALIDE", "TOTAUX_INCOHERENTS"]));
  });
});

describe("non-régression : périodes sans compte client", () => {
  it("garde la structure des totaux d'avant 0.5.0 et agrège un mois mêlant les deux", async () => {
    const { registre, stockage, temps, resoudreCle } = await nouveauRegistre("2026-10-15T10:00:00Z");
    await registre.enregistrerVente({ lignes: [CAPPUCCINO], paiements: [{ mode: "CB", montant: 400 }], operateurId: "lea" });
    const [z1] = await registre.cloturerJournee("lionel");
    expect(z1).not.toHaveProperty("comptesClients");
    expect(Object.keys(champsTotaux(z1!)).sort()).toEqual(
      ["nbAnnulations", "nbVentes", "paiements", "totalHT", "totalRemisesTTC", "totalTTC", "totalTVA", "ventilationTVA"].sort(),
    );

    temps.aller("2026-10-16T10:00:00Z");
    await registre.enregistrerVente({
      lignes: [SPRITZ],
      paiements: [{ mode: "EN_COMPTE", montant: 1100 }],
      operateurId: "lea",
      client: MARTIN,
    });
    await registre.cloturerJournee("lionel");
    temps.aller("2026-11-02T10:00:00Z");
    const mois = await registre.cloturerMois("2026-10", "lionel");
    expect(mois.totalTTC).toBe(1500);
    // TVA exigible du mois : la Z du 15 (sans compte, tout encaissé) + rien le 16.
    expect(mois.comptesClients!.ventilationTVAExigible.map((v) => [v.tauxTVA, v.montantTTC])).toEqual([[1000, 400]]);
    expect((await verifierRegistre(stockage, resoudreCle)).integre).toBe(true);
    expect(totauxTickets([])).not.toHaveProperty("comptesClients");

    const csv = exporterCloturesCSV(await stockage.lister("clotures"));
    expect(csv.split("\r\n")[0]).toContain("Ventes en compte");
    expect(csv.split("\r\n")[0]).toContain("Reglements comptes clients TTC;TVA exigible");
  });

  it("découpe une vente centime par centime sans dérive, sans tranche négative, et la recompose exactement", () => {
    const vente = [
      { tauxTVA: 0, baseHT: 1, montantTVA: 0, montantTTC: 1 },
      { tauxTVA: 550, baseHT: 95, montantTVA: 5, montantTTC: 100 },
      { tauxTVA: 1000, baseHT: 909, montantTVA: 91, montantTTC: 1000 },
      { tauxTVA: 2000, baseHT: 458, montantTVA: 92, montantTTC: 550 },
    ];
    const total = 1651;
    const tranches: ReturnType<typeof ventilerTranche>[] = [];
    for (let deja = 0; deja < total; deja++) tranches.push(ventilerTranche(vente, deja, 1, total));
    expect(tranches.flat().every((v) => v.montantTTC >= 0 && v.baseHT >= 0 && v.montantTVA >= 0)).toBe(true);
    const somme = (taux: number, champ: "montantTTC" | "baseHT" | "montantTVA") =>
      tranches.flat().filter((v) => v.tauxTVA === taux).reduce((s, v) => s + v[champ], 0);
    for (const v of vente) {
      expect([somme(v.tauxTVA, "montantTTC"), somme(v.tauxTVA, "baseHT"), somme(v.tauxTVA, "montantTVA")]).toEqual([v.montantTTC, v.baseHT, v.montantTVA]);
    }
    expect(ventilerProrata(vente, total, total)).toEqual(vente);
    // Annulation : même découpe, signes opposés.
    const negative = vente.map((v) => ({ ...v, baseHT: -v.baseHT, montantTVA: -v.montantTVA, montantTTC: -v.montantTTC }));
    expect(ventilerTranche(negative, -100, -200, -total)).toEqual(ventilerTranche(vente, 100, 200, total).map((v) => ({ ...v, baseHT: -v.baseHT, montantTVA: -v.montantTVA, montantTTC: -v.montantTTC })));
  });
});
