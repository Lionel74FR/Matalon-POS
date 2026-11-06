import { describe, expect, it } from "vitest";
import { prochainDuplicata } from "../src/metier/duplicata";

// Duplicatas ressortis depuis l'administration (6 novembre 2026) : la caisse numérote à leur suite.
const evt = (details: Record<string, unknown>) => ({ code: "REIMPRESSION_TICKET", details });
const caisse = (evenements: unknown[], dernier: number | Error | "jamais") =>
  ({
    stockage: { lister: async () => evenements },
    client: {
      dernierDuplicata: () =>
        dernier === "jamais" ? new Promise(() => undefined) : dernier instanceof Error ? Promise.reject(dernier) : Promise.resolve({ dernier }),
    },
  }) as never;

describe("numéro du prochain duplicata sur la caisse", () => {
  const locaux = [evt({ ticket: 7, duplicata: 1, canal: "papier" }), evt({ facture: "F-2", ticket: 7, duplicata: true }), evt({ ticket: 8, duplicata: 1 })];

  it("suit les duplicatas de l'administration connus du serveur", async () => {
    expect(await prochainDuplicata(caisse(locaux, 3), 7)).toBe(4);
  });

  it("hors ligne, suit le journal de l'appareil, sans compter les factures", async () => {
    expect(await prochainDuplicata(caisse(locaux, new Error("hors ligne")), 7)).toBe(2);
  });

  it("n'attend pas plus de 3 secondes une réponse du serveur", async () => {
    const debut = Date.now();
    expect(await prochainDuplicata(caisse(locaux, "jamais"), 7)).toBe(2);
    expect(Date.now() - debut).toBeLessThan(3500);
  }, 5000);
});
