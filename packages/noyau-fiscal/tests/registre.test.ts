import { describe, expect, it } from "vitest";
import {
  construireArchive,
  ErreurFiscale,
  exporterCloturesCSV,
  HASH_GENESE,
  signataireDepuis,
  verifierArchive,
  verifierRegistre,
  VERSION_NOYAU_FISCAL,
} from "../src/index.js";
import { CAPPUCCINO, nouveauRegistre, SPRITZ } from "./aide.js";

describe("tickets", () => {
  it("numérote, chaîne et signe les ventes", async () => {
    const { registre, resoudreCle, stockage } = await nouveauRegistre();
    const t1 = await registre.enregistrerVente({
      lignes: [CAPPUCCINO],
      paiements: [{ mode: "CB", montant: 400 }],
      operateurId: "lea",
      tableId: "T4",
      couverts: 1,
    });
    const t2 = await registre.enregistrerVente({
      lignes: [SPRITZ, { ...CAPPUCCINO, quantite: 2 }],
      paiements: [{ mode: "ESPECES", montant: 2000 }],
      operateurId: "lea",
    });

    expect(t1.numero).toBe(1);
    expect(t1.hashPrecedent).toBe(HASH_GENESE);
    expect(t2.numero).toBe(2);
    expect(t2.hashPrecedent).toBe(t1.hash);
    expect(t1.versionLogiciel).toBe(VERSION_NOYAU_FISCAL);
    expect(t2.totalTTC).toBe(1900);
    expect(t2.renduMonnaie).toBe(100);
    expect(t2.grandTotalPerpetuel).toBe(2300);
    expect(t2.dateComptable).toBe("2026-10-15");

    const rapport = await verifierRegistre(stockage, resoudreCle);
    expect(rapport.anomalies).toEqual([]);
    expect(rapport.integre).toBe(true);
  });

  it("sérialise les encaissements simultanés sans casser la chaîne", async () => {
    const { registre, resoudreCle, stockage } = await nouveauRegistre();
    await Promise.all(
      Array.from({ length: 20 }, () =>
        registre.enregistrerVente({ lignes: [CAPPUCCINO], paiements: [{ mode: "CB", montant: 400 }], operateurId: "lea" }),
      ),
    );
    const tickets = await stockage.lister("tickets");
    expect(tickets.map((t) => t.numero)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect((await verifierRegistre(stockage, resoudreCle)).integre).toBe(true);
  });

  it("continue après une saisie refusée", async () => {
    const { registre } = await nouveauRegistre();
    await expect(
      registre.enregistrerVente({ lignes: [CAPPUCCINO], paiements: [{ mode: "CB", montant: 100 }], operateurId: "lea" }),
    ).rejects.toThrow(ErreurFiscale);
    const t = await registre.enregistrerVente({
      lignes: [CAPPUCCINO],
      paiements: [{ mode: "CB", montant: 400 }],
      operateurId: "lea",
    });
    expect(t.numero).toBe(1);
  });

  it("journalise les suppressions de lignes et les additions avant encaissement", async () => {
    const { registre, stockage, resoudreCle } = await nouveauRegistre();
    await registre.journaliser("SUPPRESSION_LIGNE", { table: "T4", article: "Spritz Aperol", montantTTC: 1100 }, "lea");
    await registre.journaliser("IMPRESSION_ADDITION", { table: "T4", totalTTC: 400 }, "lea");
    expect((await stockage.lister("evenements")).map((e) => [e.code, e.operateurId])).toEqual([
      ["SUPPRESSION_LIGNE", "lea"],
      ["IMPRESSION_ADDITION", "lea"],
    ]);
    expect((await verifierRegistre(stockage, resoudreCle)).integre).toBe(true);
  });

  it("journalise fond de caisse, comptage, facture et transfert de table (0.4.0)", async () => {
    const { registre, stockage, resoudreCle } = await nouveauRegistre();
    await registre.journaliser("FOND_DE_CAISSE", { montant: 15000 }, "lea");
    await registre.journaliser("TRANSFERT_TABLE", { de: "t4", vers: "t7", fusion: false }, "lea");
    await registre.journaliser("FACTURE", { sequence: 1, numero: "F-ipad-1-000001", ticket: 1 }, "lea");
    await registre.journaliser("COMPTAGE_CAISSE", { especesAttendues: 15400, especesComptees: 15300, ecartEspeces: -100 }, "lea");
    expect((await stockage.lister("evenements")).map((e) => e.code)).toEqual([
      "FOND_DE_CAISSE",
      "TRANSFERT_TABLE",
      "FACTURE",
      "COMPTAGE_CAISSE",
    ]);
    expect((await stockage.dernier("evenements"))?.versionLogiciel).toBe(VERSION_NOYAU_FISCAL);
    expect((await verifierRegistre(stockage, resoudreCle)).integre).toBe(true);
  });

  it("journalise les remises", async () => {
    const { registre, stockage } = await nouveauRegistre();
    await registre.enregistrerVente({
      lignes: [{ ...SPRITZ, remise: { montantTTC: 1100, motif: "Offert patron" } }],
      paiements: [],
      operateurId: "lea",
    });
    const evts = await stockage.lister("evenements");
    expect(evts.map((e) => e.code)).toEqual(["REMISE"]);
    expect(evts[0]?.details).toMatchObject({ ticket: 1, montantTTC: 1100, motifs: "Offert patron" });
  });
});

describe("annulations", () => {
  it("annule par un ticket négatif lié à l'original, sans toucher l'original", async () => {
    const { registre, stockage, resoudreCle } = await nouveauRegistre();
    const vente = await registre.enregistrerVente({
      lignes: [SPRITZ, CAPPUCCINO],
      paiements: [{ mode: "ESPECES", montant: 2000 }],
      operateurId: "lea",
    });
    const annulation = await registre.enregistrerAnnulation({
      numeroTicket: vente.numero,
      motif: "Erreur de table",
      operateurId: "lionel",
    });

    expect(annulation.type).toBe("ANNULATION");
    expect(annulation.totalTTC).toBe(-1500);
    expect(annulation.totalHT).toBe(-vente.totalHT);
    expect(annulation.ticketOrigine).toEqual({ numero: 1, hash: vente.hash });
    expect(annulation.paiements).toEqual([{ mode: "ESPECES", montant: -1500 }]);
    expect(annulation.grandTotalPerpetuel).toBe(0);
    expect(annulation.cumulPerpetuelAbsolu).toBe(3000);
    expect((await stockage.trouver("tickets", 1))?.hash).toBe(vente.hash);
    expect((await stockage.lister("evenements")).map((e) => e.code)).toEqual(["ANNULATION"]);
    expect((await verifierRegistre(stockage, resoudreCle)).integre).toBe(true);
  });

  it("refuse une double annulation, une annulation sans motif ou d'une annulation", async () => {
    const { registre } = await nouveauRegistre();
    await registre.enregistrerVente({ lignes: [CAPPUCCINO], paiements: [{ mode: "CB", montant: 400 }], operateurId: "lea" });
    await expect(registre.enregistrerAnnulation({ numeroTicket: 1, motif: "", operateurId: "lea" })).rejects.toThrow(/motif/);
    await registre.enregistrerAnnulation({ numeroTicket: 1, motif: "Erreur", operateurId: "lea" });
    await expect(registre.enregistrerAnnulation({ numeroTicket: 1, motif: "Erreur", operateurId: "lea" })).rejects.toThrow(
      /déjà annulé/,
    );
    await expect(registre.enregistrerAnnulation({ numeroTicket: 2, motif: "x", operateurId: "lea" })).rejects.toThrow(
      /seule une vente/,
    );
    await expect(registre.enregistrerAnnulation({ numeroTicket: 99, motif: "x", operateurId: "lea" })).rejects.toThrow(
      /introuvable/,
    );
  });
});

describe("détection des altérations", () => {
  it("détecte un ticket modifié après coup", async () => {
    const { registre, stockage, resoudreCle } = await nouveauRegistre();
    for (let i = 0; i < 3; i++) {
      await registre.enregistrerVente({ lignes: [SPRITZ], paiements: [{ mode: "CB", montant: 1100 }], operateurId: "lea" });
    }
    const brut = stockage._brut("tickets");
    brut[1]!.totalTTC = 100;
    const rapport = await verifierRegistre(stockage, resoudreCle);
    expect(rapport.integre).toBe(false);
    expect(rapport.anomalies.map((a) => a.code)).toContain("EMPREINTE_INVALIDE");
  });

  it("détecte un ticket supprimé", async () => {
    const { registre, stockage, resoudreCle } = await nouveauRegistre();
    for (let i = 0; i < 3; i++) {
      await registre.enregistrerVente({ lignes: [SPRITZ], paiements: [{ mode: "CB", montant: 1100 }], operateurId: "lea" });
    }
    stockage._brut("tickets").splice(1, 1);
    const codes = (await verifierRegistre(stockage, resoudreCle)).anomalies.map((a) => a.code);
    expect(codes).toContain("NUMERO_DISCONTINU");
    expect(codes).toContain("CHAINAGE_ROMPU");
  });

  it("détecte un ticket re-scellé avec une autre clé", async () => {
    const { registre, stockage, resoudreCle } = await nouveauRegistre();
    await registre.enregistrerVente({ lignes: [SPRITZ], paiements: [{ mode: "CB", montant: 1100 }], operateurId: "lea" });
    stockage._brut("tickets")[0]!.signature = "AAAA";
    const codes = (await verifierRegistre(stockage, resoudreCle)).anomalies.map((a) => a.code);
    expect(codes).toContain("SIGNATURE_INVALIDE");
  });
});

describe("clôtures", () => {
  it("clôture la journée, y compris les ventes après minuit, puis repart sur une nouvelle journée", async () => {
    const { registre, stockage, temps, resoudreCle } = await nouveauRegistre("2026-10-16T16:00:00Z");
    await registre.enregistrerVente({ lignes: [CAPPUCCINO], paiements: [{ mode: "CB", montant: 400 }], operateurId: "lea" });
    temps.aller("2026-10-16T22:40:00Z"); // 0 h 40 à Paris, samedi
    await registre.enregistrerVente({ lignes: [SPRITZ], paiements: [{ mode: "ESPECES", montant: 2000 }], operateurId: "lea" });
    await registre.enregistrerAnnulation({ numeroTicket: 1, motif: "Erreur", operateurId: "lionel" });

    temps.aller("2026-10-16T23:30:00Z");
    const [z] = await registre.cloturerJournee("lionel");
    expect(z).toMatchObject({
      periode: "JOUR",
      identifiantPeriode: "2026-10-16",
      premierTicket: 1,
      dernierTicket: 3,
      nbVentes: 2,
      nbAnnulations: 1,
      totalTTC: 1100,
      grandTotalPerpetuel: 1100,
    });
    expect(z!.paiements).toEqual([
      { mode: "CB", montant: 0 },
      { mode: "ESPECES", montant: 1100 },
    ]);

    temps.aller("2026-10-17T08:00:00Z");
    await registre.enregistrerVente({ lignes: [CAPPUCCINO], paiements: [{ mode: "CB", montant: 400 }], operateurId: "lea" });
    const x = await registre.lectureX("lea");
    expect(x.totalTTC).toBe(400);
    expect(x.dateComptable).toBe("2026-10-17");

    expect((await verifierRegistre(stockage, resoudreCle)).integre).toBe(true);
  });

  it("produit une clôture par journée oubliée", async () => {
    const { registre, temps } = await nouveauRegistre("2026-10-15T10:00:00Z");
    await registre.enregistrerVente({ lignes: [CAPPUCCINO], paiements: [{ mode: "CB", montant: 400 }], operateurId: "lea" });
    temps.aller("2026-10-16T10:00:00Z");
    await registre.enregistrerVente({ lignes: [SPRITZ], paiements: [{ mode: "CB", montant: 1100 }], operateurId: "lea" });
    const z = await registre.cloturerJournee("lionel");
    expect(z.map((c) => [c.identifiantPeriode, c.totalTTC])).toEqual([
      ["2026-10-15", 400],
      ["2026-10-16", 1100],
    ]);
  });

  it("clôture à zéro une journée sans vente", async () => {
    const { registre } = await nouveauRegistre();
    const [z] = await registre.cloturerJournee("lionel");
    expect(z).toMatchObject({ totalTTC: 0, premierTicket: null, identifiantPeriode: "2026-10-15" });
  });

  it("clôture le mois une fois terminé et toutes les Z faites, puis l'exercice", async () => {
    const { registre, temps, stockage, resoudreCle } = await nouveauRegistre("2026-10-15T10:00:00Z");
    await registre.enregistrerVente({ lignes: [CAPPUCCINO], paiements: [{ mode: "CB", montant: 400 }], operateurId: "lea" });
    await expect(registre.cloturerMois("2026-10", "lionel")).rejects.toThrow(/pas terminé/);

    temps.aller("2026-11-02T10:00:00Z");
    await expect(registre.cloturerMois("2026-10", "lionel")).rejects.toThrow(/clôturés en Z/);
    await registre.cloturerJournee("lionel");
    const mois = await registre.cloturerMois("2026-10", "lionel");
    expect(mois).toMatchObject({ periode: "MOIS", totalTTC: 400, nbVentes: 1, dernierTicket: 1 });
    expect(mois.cloturesAgregees).toEqual([1]);
    await expect(registre.cloturerMois("2026-10", "lionel")).rejects.toThrow(/déjà clôturé/);

    await expect(registre.cloturerExercice("2026", "2026-10", "2026-11", "lionel")).rejects.toThrow(/2026-11/);
    const exercice = await registre.cloturerExercice("2026", "2026-10", "2026-10", "lionel");
    expect(exercice).toMatchObject({ periode: "EXERCICE", totalTTC: 400, cloturesAgregees: [mois.numero] });
    await expect(registre.cloturerExercice("2026-bis", "2026-10", "2026-10", "lionel")).rejects.toThrow(
      /déjà à un exercice/,
    );

    expect((await verifierRegistre(stockage, resoudreCle)).integre).toBe(true);
  });

  it("ne recompte pas les tickets après une Z à zéro (régression B1)", async () => {
    const { registre, temps, stockage, resoudreCle } = await nouveauRegistre("2026-10-15T10:00:00Z");
    await registre.enregistrerVente({ lignes: [CAPPUCCINO], paiements: [{ mode: "CB", montant: 400 }], operateurId: "lea" });
    await registre.cloturerJournee("lionel");
    temps.aller("2026-10-16T20:00:00Z");
    const [zZero] = await registre.cloturerJournee("lionel");
    expect(zZero).toMatchObject({ totalTTC: 0, dernierTicketCouvert: 1 });
    await registre.cloturerJournee("lionel"); // double Z le même soir
    temps.aller("2026-10-17T10:00:00Z");
    expect((await registre.lectureX("lea")).totalTTC).toBe(0);
    const [z] = await registre.cloturerJournee("lionel");
    expect(z).toMatchObject({ totalTTC: 0, identifiantPeriode: "2026-10-17" });
    expect((await verifierRegistre(stockage, resoudreCle)).integre).toBe(true);
  });

  it("garde des dates comptables monotones quand l'horloge recule (régression B2)", async () => {
    const { registre, temps, stockage, resoudreCle } = await nouveauRegistre("2026-10-16T10:00:00Z");
    await registre.enregistrerVente({ lignes: [CAPPUCCINO], paiements: [{ mode: "CB", montant: 400 }], operateurId: "lea" });
    temps.aller("2026-10-15T10:00:00Z"); // l'iPad recule d'un jour
    const t2 = await registre.enregistrerVente({
      lignes: [SPRITZ],
      paiements: [{ mode: "CB", montant: 1100 }],
      operateurId: "lea",
    });
    expect(t2.dateComptable).toBe("2026-10-16");
    const evts = await stockage.lister("evenements");
    expect(evts.at(-1)).toMatchObject({ code: "HORLOGE_INCOHERENTE", details: { dateRetenue: "2026-10-16" } });

    const z = await registre.cloturerJournee("lionel");
    expect(z.map((c) => [c.identifiantPeriode, c.totalTTC, c.dernierTicketCouvert])).toEqual([["2026-10-16", 1500, 2]]);
    expect((await verifierRegistre(stockage, resoudreCle)).integre).toBe(true);
  });

  it("n'impute jamais une vente à un mois déjà clôturé", async () => {
    const { registre, temps } = await nouveauRegistre("2026-10-20T10:00:00Z");
    await registre.cloturerJournee("lionel");
    temps.aller("2026-11-02T10:00:00Z");
    await registre.cloturerMois("2026-10", "lionel");
    temps.aller("2026-10-25T10:00:00Z"); // horloge revenue en octobre
    const t = await registre.enregistrerVente({ lignes: [CAPPUCCINO], paiements: [{ mode: "CB", montant: 400 }], operateurId: "lea" });
    expect(t.dateComptable).toBe("2026-11-01");
  });

  it("garde les Z dans l'ordre et hors des mois clôturés quand l'horloge recule", async () => {
    const { registre, temps, stockage, resoudreCle } = await nouveauRegistre("2026-10-16T10:00:00Z");
    await registre.enregistrerVente({ lignes: [CAPPUCCINO], paiements: [{ mode: "CB", montant: 400 }], operateurId: "lea" });
    await registre.cloturerJournee("lionel");
    temps.aller("2026-10-18T20:00:00Z");
    await registre.cloturerJournee("lionel"); // Z à zéro le 18
    temps.aller("2026-10-17T10:00:00Z"); // l'horloge revient au 17
    const t = await registre.enregistrerVente({ lignes: [SPRITZ], paiements: [{ mode: "CB", montant: 1100 }], operateurId: "lea" });
    expect(t.dateComptable).toBe("2026-10-18");
    const [z] = await registre.cloturerJournee("lionel");
    expect(z!.identifiantPeriode).toBe("2026-10-18");

    temps.aller("2026-11-02T10:00:00Z");
    await registre.cloturerJournee("lionel");
    await registre.cloturerMois("2026-10", "lionel");
    temps.aller("2026-10-20T10:00:00Z"); // retour en octobre, mois clôturé
    const [zZero] = await registre.cloturerJournee("lionel");
    expect(zZero!.identifiantPeriode).toBe("2026-11-02");
    expect((await verifierRegistre(stockage, resoudreCle)).integre).toBe(true);
  });

  it("détecte une clôture mensuelle qui omet une Z", async () => {
    const { registre, temps, stockage } = await nouveauRegistre("2026-10-15T10:00:00Z");
    await registre.enregistrerVente({ lignes: [CAPPUCCINO], paiements: [{ mode: "CB", montant: 400 }], operateurId: "lea" });
    await registre.cloturerJournee("lionel");
    temps.aller("2026-10-16T10:00:00Z");
    await registre.enregistrerVente({ lignes: [SPRITZ], paiements: [{ mode: "CB", montant: 1100 }], operateurId: "lea" });
    await registre.cloturerJournee("lionel");
    temps.aller("2026-11-02T10:00:00Z");
    await registre.cloturerMois("2026-10", "lionel");
    const { verifierClotures, totauxClotures } = await import("../src/index.js");
    const [z1, z2, mois] = await stockage.lister("clotures");
    const incomplet = { ...mois!, ...totauxClotures([z2!]), cloturesAgregees: [z2!.numero] };
    expect(verifierClotures([z1!, z2!, incomplet], await stockage.lister("tickets")).map((a) => a.code)).toContain(
      "AGREGAT_INVALIDE",
    );
  });

  it("n'écrit rien si le stockage refuse le lot (atomicité, régression B4)", async () => {
    const { registre, stockage } = await nouveauRegistre();
    const original = stockage.ajouterLot.bind(stockage);
    stockage.ajouterLot = async () => {
      throw new Error("coupure");
    };
    await expect(
      registre.enregistrerVente({
        lignes: [{ ...SPRITZ, remise: { montantTTC: 100, motif: "Fidélité" } }],
        paiements: [{ mode: "CB", montant: 1000 }],
        operateurId: "lea",
      }),
    ).rejects.toThrow("coupure");
    expect(await stockage.lister("tickets")).toEqual([]);
    expect(await stockage.lister("evenements")).toEqual([]);
    stockage.ajouterLot = original;
    const t = await registre.enregistrerVente({ lignes: [SPRITZ], paiements: [{ mode: "CB", montant: 1100 }], operateurId: "lea" });
    expect(t.numero).toBe(1);
  });

  it("refuse un lot qui ne prolonge pas la chaîne", async () => {
    const { registre, stockage } = await nouveauRegistre();
    const t = await registre.enregistrerVente({ lignes: [SPRITZ], paiements: [{ mode: "CB", montant: 1100 }], operateurId: "lea" });
    await expect(stockage.ajouterLot([{ chaine: "tickets", enregistrement: { ...t, numero: 2 } }])).rejects.toThrow(/refusé/);
  });

  it("détecte une Z falsifiée ou une clôture mensuelle gonflée (régression B3)", async () => {
    const { registre, temps, stockage, resoudreCle } = await nouveauRegistre("2026-10-15T10:00:00Z");
    await registre.enregistrerVente({ lignes: [CAPPUCCINO], paiements: [{ mode: "CB", montant: 400 }], operateurId: "lea" });
    await registre.cloturerJournee("lionel");
    temps.aller("2026-11-02T10:00:00Z");
    await registre.cloturerMois("2026-10", "lionel");
    expect((await verifierRegistre(stockage, resoudreCle)).integre).toBe(true);

    // Une Z recomptant le ticket 1 (cas B1 de l'ancienne version), même correctement signée, est détectée.
    const { verifierClotures } = await import("../src/index.js");
    const clotures = await stockage.lister("clotures");
    const doublon = { ...clotures[0]!, numero: 3, premierTicket: 1 };
    const codes = verifierClotures([...clotures, doublon], await stockage.lister("tickets")).map((a) => a.code);
    expect(codes).toContain("COUVERTURE_Z");

    const gonflee = { ...clotures[1]!, totalTTC: 99999 };
    expect(verifierClotures([clotures[0]!, gonflee], await stockage.lister("tickets")).map((a) => a.code)).toContain(
      "TOTAUX_CLOTURE",
    );
  });
});

describe("archives et export", () => {
  it("archive une clôture de façon vérifiable seule et détecte une archive modifiée", async () => {
    const { registre, stockage, temps, paire, resoudreCle } = await nouveauRegistre();
    await registre.enregistrerVente({ lignes: [CAPPUCCINO], paiements: [{ mode: "CB", montant: 400 }], operateurId: "lea" });
    await registre.cloturerJournee("lionel");
    temps.aller("2026-10-16T09:00:00Z");
    await registre.enregistrerVente({ lignes: [SPRITZ], paiements: [{ mode: "CB", montant: 1100 }], operateurId: "lea" });
    const [z2] = await registre.cloturerJournee("lionel");

    const archive = await construireArchive(stockage, z2!.numero, signataireDepuis(paire), temps.horloge());
    expect(archive.tickets.map((t) => t.numero)).toEqual([2]);
    expect(archive.ancrages.ticketPrecedent?.numero).toBe(1);
    expect((await verifierArchive(archive, resoudreCle)).integre).toBe(true);

    const modifiee = structuredClone(archive);
    modifiee.tickets[0]!.totalTTC = 1;
    expect((await verifierArchive(modifiee, resoudreCle)).integre).toBe(false);
  });

  it("refuse une archive bâtie sur une clôture falsifiée puis re-signée", async () => {
    const { registre, stockage, paire, resoudreCle } = await nouveauRegistre();
    await registre.enregistrerVente({ lignes: [CAPPUCCINO], paiements: [{ mode: "CB", montant: 400 }], operateurId: "lea" });
    const [z] = await registre.cloturerJournee("lionel");
    stockage._brut("clotures")[0]!.totalTTC = 1;
    const archive = await construireArchive(stockage, z!.numero, signataireDepuis(paire));
    const codes = (await verifierArchive(archive, resoudreCle)).anomalies.map((a) => a.code);
    expect(codes).toContain("EMPREINTE_INVALIDE");
    expect(codes).toContain("TOTAUX_CLOTURE");
  });

  it("exporte les clôtures en CSV pour la comptabilité", async () => {
    const { registre, stockage } = await nouveauRegistre();
    await registre.enregistrerVente({
      lignes: [CAPPUCCINO, SPRITZ],
      paiements: [{ mode: "CB", montant: 1500 }],
      operateurId: "lea",
    });
    await registre.cloturerJournee("lionel");
    const csv = exporterCloturesCSV(await stockage.lister("clotures"));
    const [entete, ligne] = csv.trim().split("\r\n");
    expect(entete).toContain("HT 10%;TVA 10%;TTC 10%;HT 20%;TVA 20%;TTC 20%");
    expect(ligne).toContain("JOUR;2026-10-15");
    expect(ligne).toContain("3,64;0,36;4,00;9,17;1,83;11,00;12,81;2,19;15,00;15,00");
  });
});
