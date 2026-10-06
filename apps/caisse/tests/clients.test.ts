import { describe, expect, it } from "vitest";
import { fusionnerReferentiel, type Configuration } from "../src/donnees/configuration";

const base = {
  etablissementId: "moka",
  caisseId: "ipad-00000001",
  caisseNom: "Comptoir",
  installeeLe: "2026-10-15T08:00:00Z",
  etablissement: { enseigne: "Moka" },
  utilisateurs: [],
  tables: [],
  carteId: "carte",
  imprimante: { adresse: "", sansAccents: false },
  seuilNoteAutomatique: 2500,
} as unknown as Configuration;
const etat = (clients?: Array<{ id: string; nom: string; telephone: string; actif: boolean }>) =>
  ({
    caisse: { id: "ipad-00000001", nom: "Comptoir" },
    etablissement: { identite: { enseigne: "Moka" }, tables: [], seuilNote: 2500 },
    utilisateurs: [],
    clients,
  }) as never;

describe("clients des comptes", () => {
  it("garde les clients créés ici tant que le serveur ne les connaît pas, puis adopte sa fiche", () => {
    const local = { id: "cli-0000abcd", nom: "M. Martin", telephone: "", actif: true };
    const config = { ...base, clients: [local] };
    expect((fusionnerReferentiel(config, etat([])) ?? config).clients).toEqual([local]);
    const serveur = { ...local, nom: "Martin Paul", telephone: "06" };
    expect((fusionnerReferentiel(config, etat([serveur])) ?? config).clients).toEqual([serveur]);
    // Serveur d'avant 0.5.0 (sans liste) : rien ne change.
    expect((fusionnerReferentiel(config, etat(undefined)) ?? config).clients).toEqual([local]);
  });
});
