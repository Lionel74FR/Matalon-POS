import { describe, expect, it } from "vitest";
import {
  couvertures,
  genererPaireCles,
  Registre,
  signataireDepuis,
  StockageMemoire,
  verifierEtablissement,
  verifierRegistre,
  type Cloture,
  type ContexteEtablissement,
  type PaireCles,
} from "../src/index.js";
import { CAPPUCCINO, horlogeFixe, SPRITZ } from "./aide.js";

/**
 * Clôtures d'établissement (0.7.0) : deux caisses (l'iPad du comptoir et
 * l'iPhone de salle) ; la Z, faite sur l'une ou l'autre, couvre les deux.
 */
interface Appareil {
  id: string;
  registre: Registre;
  stockage: StockageMemoire;
  paire: PaireCles;
}

async function etablissement(debut = "2026-10-15T08:00:00Z") {
  const temps = horlogeFixe(debut);
  const appareils: Appareil[] = [];
  for (const id of ["ipad-1111aaaa", "ipad-2222bbbb"]) {
    const paire = await genererPaireCles(`${id}-k1`);
    const stockage = new StockageMemoire();
    const registre = new Registre({ stockage, signataire: signataireDepuis(paire), contexte: { etablissementId: "moka", caisseId: id }, horloge: temps.horloge });
    appareils.push({ id, registre, stockage, paire });
  }
  const cles = Object.fromEntries(appareils.map((a) => [a.paire.cleId, a.paire.clePubliqueJwk]));
  /** Ce que le serveur envoie à `pour` : les clôtures de tous, les tickets non couverts des autres (« synchronisés » jusqu'à `jusqua`). */
  const contexte = async (pour: Appareil, jusqua: Record<string, number> = {}): Promise<ContexteEtablissement> => {
    const clotures: Cloture[] = (await Promise.all(appareils.map((a) => a.stockage.lister("clotures")))).flat();
    const autres = appareils.filter((a) => a !== pour);
    const cov = couvertures(clotures, autres.map((a) => a.id));
    return {
      clotures,
      cles,
      caisses: await Promise.all(
        autres.map(async (a) => {
          const n = cov.get(a.id)!.dernierTicketCouvert;
          return {
            caisseId: a.id,
            ancre: n > 0 ? await a.stockage.trouver("tickets", n) : null,
            tickets: await a.stockage.lister("tickets", n + 1, jusqua[a.id]),
            dernierEvenement: await a.stockage.dernier("evenements"),
          };
        }),
      ),
    };
  };
  const chaines = async () =>
    Promise.all(
      appareils.map(async (a) => ({
        caisseId: a.id,
        clotures: await a.stockage.lister("clotures"),
        tickets: await a.stockage.lister("tickets"),
        evenements: await a.stockage.lister("evenements"),
      })),
    );
  const resoudreCle = (id: string) => cles[id] ?? null;
  return { temps, comptoir: appareils[0]!, salle: appareils[1]!, contexte, chaines, resoudreCle };
}

const vente = (a: Appareil, ligne = CAPPUCCINO, mode: "CB" | "ESPECES" = "CB") =>
  a.registre.enregistrerVente({ lignes: [ligne], paiements: [{ mode, montant: ligne.prixUnitaireTTC }], operateurId: "lea" });

describe("clôtures d'établissement", () => {
  it("une Z faite sur un appareil couvre les tickets de toutes les caisses", async () => {
    const { temps, comptoir, salle, contexte, chaines, resoudreCle } = await etablissement();
    await vente(comptoir);
    await vente(comptoir, SPRITZ, "ESPECES");
    await vente(salle);
    await salle.registre.enregistrerAnnulation({ numeroTicket: 1, motif: "Erreur", operateurId: "lionel" });

    const x = await salle.registre.lectureX("lionel", await contexte(salle));
    expect(x.totalTTC).toBe(1500);

    temps.aller("2026-10-15T20:00:00Z");
    const [z] = await salle.registre.cloturerJournee("lionel", await contexte(salle));
    expect(z).toMatchObject({ caisseId: salle.id, identifiantPeriode: "2026-10-15", totalTTC: 1500, nbVentes: 3, nbAnnulations: 1, grandTotalPerpetuel: 1500 });
    expect(z!.etablissement?.caisses.map((c) => [c.caisseId, c.premierTicket, c.dernierTicketCouvert])).toEqual([
      [comptoir.id, 1, 2],
      [salle.id, 1, 2],
    ]);
    expect(z!.etablissement?.precedente).toBeNull();

    // Le lendemain, le comptoir clôture : seuls ses nouveaux tickets, à la suite de la Z de la salle.
    temps.aller("2026-10-16T09:00:00Z");
    await vente(comptoir);
    const [z2] = await comptoir.registre.cloturerJournee("lionel", await contexte(comptoir));
    expect(z2).toMatchObject({ totalTTC: 400, premierTicket: 3, dernierTicketCouvert: 3, grandTotalPerpetuel: 1900 });
    expect(z2!.etablissement?.precedente).toMatchObject({ caisseId: salle.id, numero: z!.numero });
    expect(z2!.etablissement?.caisses.find((c) => c.caisseId === salle.id)).toMatchObject({ premierTicket: null, dernierTicketCouvert: 2 });

    expect(verifierEtablissement(await chaines())).toEqual([]);
    expect((await verifierRegistre(comptoir.stockage, resoudreCle)).anomalies).toEqual([]);
    expect((await verifierRegistre(salle.stockage, resoudreCle)).anomalies).toEqual([]);
  });

  it("refuse des données du serveur altérées ou mal ancrées", async () => {
    const { comptoir, salle, contexte } = await etablissement();
    await vente(comptoir);
    await vente(comptoir);
    const ctx = await contexte(salle);
    const altere = structuredClone(ctx);
    altere.caisses[0]!.tickets[1]!.totalTTC = 1;
    await expect(salle.registre.cloturerJournee("lionel", altere)).rejects.toThrow(/données du serveur refusées/);
    const tronque = structuredClone(ctx);
    tronque.caisses[0]!.tickets.shift();
    await expect(salle.registre.cloturerJournee("lionel", tronque)).rejects.toThrow(/refusées/);
    const sansCle = { ...structuredClone(ctx), cles: {} };
    await expect(salle.registre.lectureX("lionel", sansCle)).rejects.toThrow(/refusées/);
    expect(await salle.stockage.lister("clotures")).toEqual([]);
  });

  it("un ticket pas encore reçu par le serveur entre dans la Z suivante, même daté d'une journée clôturée", async () => {
    const { temps, comptoir, salle, contexte, chaines } = await etablissement();
    await vente(comptoir);
    await vente(salle);
    await vente(salle, SPRITZ);
    temps.aller("2026-10-15T21:00:00Z");
    // L'iPhone n'a synchronisé que son premier ticket.
    const [z1] = await comptoir.registre.cloturerJournee("lionel", await contexte(comptoir, { [salle.id]: 1 }));
    expect(z1!.totalTTC).toBe(800);

    temps.aller("2026-10-16T10:00:00Z");
    await vente(comptoir);
    const z = await comptoir.registre.cloturerJournee("lionel", await contexte(comptoir));
    // Le spritz du 15 rejoint une seconde Z du 15 (la journée du ticket), le café du 16 sa propre Z.
    expect(z.map((c) => [c.identifiantPeriode, c.totalTTC])).toEqual([
      ["2026-10-15", 1100],
      ["2026-10-16", 400],
    ]);
    expect(verifierEtablissement(await chaines())).toEqual([]);
  });

  it("refuse la correction d'une vente couverte par une Z faite sur un autre appareil", async () => {
    const { comptoir, salle, contexte } = await etablissement();
    const t = await vente(comptoir);
    await salle.registre.cloturerJournee("lionel", await contexte(salle));
    const saisie = { numeroTicket: t.numero, paiements: [{ mode: "ESPECES" as const, montant: 400 }], motif: "Erreur", operateurId: "lionel" };
    await expect(comptoir.registre.enregistrerCorrection(saisie, await contexte(comptoir))).rejects.toThrow(/déjà clôturé/);
  });

  it("clôture le mois et l'exercice de l'établissement depuis n'importe quel appareil", async () => {
    const { temps, comptoir, salle, contexte, chaines } = await etablissement();
    await vente(comptoir);
    await salle.registre.cloturerJournee("lionel", await contexte(salle));
    temps.aller("2026-10-16T10:00:00Z");
    await vente(salle, SPRITZ);
    await comptoir.registre.cloturerJournee("lionel", await contexte(comptoir));
    temps.aller("2026-11-02T10:00:00Z");
    await vente(salle);
    await expect(comptoir.registre.cloturerMois("2026-10", "lionel", await contexte(comptoir))).resolves.toMatchObject({ totalTTC: 1500, nbVentes: 2 });
    const mois = (await comptoir.stockage.lister("clotures")).at(-1)!;
    expect(mois.etablissement?.agregees.map((r) => r.caisseId)).toEqual([salle.id, comptoir.id]);
    await expect(salle.registre.cloturerMois("2026-10", "lionel", await contexte(salle))).rejects.toThrow(/déjà clôturé/);

    const exercice = await salle.registre.cloturerExercice("2026", "2026-10", "2026-10", "lionel", await contexte(salle));
    expect(exercice).toMatchObject({ totalTTC: 1500, etablissement: { agregees: [{ caisseId: comptoir.id, numero: mois.numero }] } });
    expect(verifierEtablissement(await chaines())).toEqual([]);
  });

  it("refuse une clôture mensuelle si une Z du mois manque au contexte", async () => {
    const { temps, comptoir, salle, contexte } = await etablissement();
    await salle.registre.cloturerJournee("lionel", await contexte(salle));
    temps.aller("2026-10-16T10:00:00Z");
    await comptoir.registre.cloturerJournee("lionel", await contexte(comptoir));
    temps.aller("2026-10-17T10:00:00Z");
    await salle.registre.cloturerJournee("lionel", await contexte(salle));
    temps.aller("2026-11-02T10:00:00Z");
    const ctx = await contexte(salle);
    ctx.clotures = ctx.clotures.filter((c) => c.caisseId !== comptoir.id);
    await expect(salle.registre.cloturerMois("2026-10", "lionel", ctx)).rejects.toThrow(/manque/);
  });

  it("signale deux Z faites en même temps depuis la même précédente", async () => {
    const { comptoir, salle, contexte, chaines } = await etablissement();
    await vente(comptoir);
    await vente(salle);
    const ctxComptoir = await contexte(comptoir);
    const ctxSalle = await contexte(salle);
    await comptoir.registre.cloturerJournee("lionel", ctxComptoir);
    await salle.registre.cloturerJournee("lionel", ctxSalle);
    const codes = verifierEtablissement(await chaines()).map((a) => a.code);
    expect(codes).toContain("CHAINAGE_CLOTURES");
    expect(codes).toContain("COUVERTURE_Z");
  });

  it("détecte une Z d'établissement dont la couverture d'une caisse a été falsifiée", async () => {
    const { comptoir, salle, contexte, chaines } = await etablissement();
    await vente(comptoir);
    await vente(comptoir);
    await salle.registre.cloturerJournee("lionel", await contexte(salle, { [comptoir.id]: 1 }));
    const c = await chaines();
    const z = c[1]!.clotures[0]!;
    z.etablissement!.caisses[0]!.dernierTicketCouvert = 2;
    const codes = verifierEtablissement(c).map((a) => a.code);
    expect(codes).toContain("CLOTURE_DETACHEE");
  });
});
