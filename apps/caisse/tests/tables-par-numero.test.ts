import { describe, expect, it } from "vitest";
import { tablesParNumero } from "../src/metier/plan";

// Vue en liste de la salle (Lionel, 18 novembre 2026) : tables par numéro, du plus petit au plus grand.
describe("tables par numéro", () => {
  it("range 2 avant 10 avant 100, puis les noms sans numéro, sans toucher à la liste d'origine", () => {
    const tables = ["100", "10", "Bar", "2", "Table 11", "Table 3", "60", "1", "Terrasse"].map((nom) => ({ nom }));
    expect(tablesParNumero(tables).map((t) => t.nom)).toEqual(["1", "2", "10", "60", "100", "Bar", "Table 3", "Table 11", "Terrasse"]);
    expect(tables[0]!.nom).toBe("100");
  });
});
