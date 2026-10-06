// Utilitaire de recette : écrit l'URL d'une note de démonstration (non exécuté par défaut).
import { writeFileSync } from "node:fs";
import { it } from "vitest";
import { encoderNote, type NoteNumerique } from "../src/note/format";

it.runIf(process.env.GENERER_NOTE)("génère une URL de note", () => {
  const note: NoteNumerique = {
    v: 1, x: true,
    e: ["Moka", "SAS Moka Annecy", "6 rue Vaugelas", "74000 Annecy", "04 56 19 02 68", "12345678900012", "FR12123456789"],
    c: "ipad-4439930e", n: 42, k: "V", o: null, m: null, d: "2026-10-15T10:42:00Z", tb: "Table 4", cv: 2, s: "Léa",
    l: [[2, "Cappuccino", 400, 1000, 0, null], [1, "Brunch Moka (Flat white, Orange pressée, Croissant pur beurre, Avocado toast)", 1600, 1000, 0, null], [1, "Spritz Aperol", 1100, 2000, 1100, "Offert maison"]],
    p: [["ESPECES", 3000]], r: 600, tt: 2400, h: "2136bd8a527817c316b43bce", ver: "0.3.0", dup: 0,
  };
  writeFileSync(process.env.GENERER_NOTE!, encoderNote(note));
});
