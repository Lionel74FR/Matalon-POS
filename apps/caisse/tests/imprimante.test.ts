import { describe, expect, it } from "vitest";
import { fusionnerReferentiel, imprimanteDe, type Configuration } from "../src/donnees/configuration";

const base = {
  etablissementId: "moka",
  caisseId: "iphone-00000001",
  caisseNom: "Salle",
  installeeLe: "2026-10-15T08:00:00Z",
  etablissement: { enseigne: "Moka" },
  utilisateurs: [],
  tables: [],
  carteId: "carte",
  imprimante: { adresse: "", sansAccents: false },
  seuilNoteAutomatique: 2500,
} as unknown as Configuration;
const etat = (imprimanteTickets?: { adresse: string; sansAccents: boolean } | null) =>
  ({
    caisse: { id: "iphone-00000001", nom: "Salle" },
    etablissement: { identite: { enseigne: "Moka" }, tables: [], seuilNote: 2500, imprimanteTickets },
    utilisateurs: [],
  }) as never;

describe("imprimante des tickets", () => {
  it("vient de l'établissement à la synchronisation, sauf si l'appareil a la sienne", () => {
    expect(imprimanteDe(base)).toBeNull();
    const recue = fusionnerReferentiel(base, etat({ adresse: "192.168.1.50", sansAccents: true }))!;
    expect(imprimanteDe(recue)).toEqual({ adresse: "192.168.1.50", sansAccents: true, source: "etablissement" });
    const propre = { ...recue, imprimante: { adresse: "192.168.1.80", sansAccents: false } };
    expect(imprimanteDe(propre)).toEqual({ adresse: "192.168.1.80", sansAccents: false, source: "appareil" });
    // Retirée de l'établissement : l'appareil sans imprimante à lui n'imprime plus d'office.
    expect(imprimanteDe(fusionnerReferentiel(recue, etat(null))!)).toBeNull();
    // Serveur d'avant ce réglage (champ absent) : on garde ce qu'on avait.
    expect(fusionnerReferentiel(recue, etat(undefined))).toBeNull();
  });
});
