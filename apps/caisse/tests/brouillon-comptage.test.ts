import { describe, expect, it } from "vitest";
import { appliquerTouche } from "../src/metier/brouillon-comptage";

/** Pavé du comptage (28 octobre 2026) : montants et nombres de pièces saisis sans le clavier d'iOS. */
describe("pavé du comptage", () => {
  const saisir = (touches: string[], o: { entier: boolean }, depart = "") =>
    touches.reduce((v, t, i) => appliquerTouche(v, t, { ...o, neuf: i === 0 }), depart);

  it("saisit un montant en euros, deux décimales au plus", () => {
    expect(saisir(["1", "5", "2", ",", "3", "0", "9"], { entier: false })).toBe("152,30");
    expect(saisir([",", "5"], { entier: false })).toBe("0,5");
    expect(saisir(["0", "7"], { entier: false })).toBe("7");
    expect(saisir(["1", ",", ",", "2"], { entier: false })).toBe("1,2");
  });

  it("la première touche remplace la valeur affichée, l'effacement retire un chiffre", () => {
    expect(saisir(["4"], { entier: false }, "150,00")).toBe("4");
    expect(saisir(["effacer"], { entier: false }, "150,00")).toBe("");
    expect(appliquerTouche("150,00", "effacer", { entier: false, neuf: false })).toBe("150,0");
  });

  it("compte les pièces en entiers, sans virgule, quatre chiffres au plus", () => {
    expect(saisir(["0", "1", "2"], { entier: true })).toBe("12");
    expect(saisir(["1", ",", "2"], { entier: true })).toBe("12");
    expect(saisir(["9", "9", "9", "9", "9"], { entier: true })).toBe("9999");
  });
});
