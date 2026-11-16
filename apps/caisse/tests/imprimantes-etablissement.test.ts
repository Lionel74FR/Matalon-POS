import type { ImprimanteEtablissement } from "@matalon/serveur/partage";
import { describe, expect, it } from "vitest";
import { imprimantesRecues, sortieTickets, type Configuration } from "../src/donnees/configuration";
import { imprimantesPortees } from "../src/impression/imprimantes";

/** Imprimantes de l'établissement (16 novembre 2026) : choix sur chaque appareil, reprise des anciens réglages. */
const liste: ImprimanteEtablissement[] = [
  { id: "imp-epson01", nom: "Epson", branchement: { type: "epson", adresse: "192.168.1.50" }, sansAccents: false },
  { id: "imp-oxhoo01", nom: "Oxhoo bar", branchement: { type: "serie", dalleId: "ipad-0000000d" }, sansAccents: false },
  { id: "imp-salle01", nom: "Oxhoo salle", branchement: { type: "reseau", adresse: "192.168.1.248", dalleId: "ipad-0000000d" }, sansAccents: true },
];
const base = (v: Partial<Configuration>) => ({ caisseId: "ipad-0000000e", imprimante: { adresse: "", sansAccents: false }, ...v }) as Configuration;
const appliquer = (c: Configuration) => ({ ...c, ...imprimantesRecues(c, { imprimantes: liste, postesImprimantes: { Bar: "imp-oxhoo01" } }) });

describe("imprimantes de l'établissement sur un appareil", () => {
  it("reprend l'Epson du Moka (celle de l'établissement ou la sienne) sans intervention", () => {
    const c = appliquer(base({ imprimanteEtablissement: { adresse: "192.168.1.50", sansAccents: false } }));
    expect(c.imprimanteTicketsId).toBe("imp-epson01");
    expect(sortieTickets(c)).toEqual({ connexion: "liste", imprimante: liste[0] });
    expect(c.postesImprimantes).toEqual({ Bar: "imp-oxhoo01" });
    // Une Epson absente de la liste : rien n'est choisi, l'ancien réglage sert encore.
    const autre = appliquer(base({ imprimante: { adresse: "10.0.0.9", sansAccents: false } }));
    expect(autre.imprimanteTicketsId).toBeUndefined();
    expect(sortieTickets(autre)).toMatchObject({ connexion: "reseau", adresse: "10.0.0.9" });
  });

  it("reprend la dalle et son port COM, l'iPad relayé et l'Oxhoo des additions", () => {
    const dalle = appliquer(
      base({ caisseId: "ipad-0000000d", imprimanteSerie: { rang: 1, bauds: 9600, sansAccents: false, relais: true, logoMemoire: "c:v1" }, imprimanteAdditions: { adresse: "192.168.1.248", sansAccents: true } }),
    );
    expect([dalle.imprimanteTicketsId, dalle.imprimanteAdditionsId]).toEqual(["imp-oxhoo01", "imp-salle01"]);
    expect(dalle.portsSerie).toEqual({ "imp-oxhoo01": { rang: 1, bauds: 9600, logoMemoire: "c:v1" } });
    expect(imprimantesPortees(dalle).map((i) => i.id)).toEqual(["imp-oxhoo01", "imp-salle01"]);

    const ipad = appliquer(base({ imprimanteRelais: { relaisId: "ipad-0000000d", nom: "Dalle bar" }, imprimanteAdditions: { adresse: "192.168.1.248", sansAccents: true, relaisId: "ipad-0000000d" } }));
    expect([ipad.imprimanteTicketsId, ipad.imprimanteAdditionsId]).toEqual(["imp-oxhoo01", "imp-salle01"]);
    expect(imprimantesPortees(ipad)).toEqual([]);
  });

  it("garde le choix fait sur l'appareil, « aucune » compris ; une imprimante retirée de la liste n'imprime plus", () => {
    const aucune = appliquer(base({ imprimanteTicketsId: null, imprimanteEtablissement: { adresse: "192.168.1.50", sansAccents: false } }));
    expect(aucune.imprimanteTicketsId).toBeNull();
    expect(sortieTickets(aucune)).toBeNull();
    const retiree = { ...appliquer(base({ imprimanteTicketsId: "imp-epson01" })), imprimantes: liste.slice(1) };
    expect(sortieTickets(retiree)).toBeNull();
  });
});
