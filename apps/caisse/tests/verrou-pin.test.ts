import { describe, expect, it } from "vitest";
import { BLOCAGE_PIN_MS, effacerEchecsPin, lireEtatPin, noterEchecPin } from "../src/donnees/verrou-pin";

function memoire() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

describe("blocage du code PIN", () => {
  it("bloque 5 minutes au 5e code faux, puis rend les 5 essais", () => {
    const r = memoire();
    const t0 = Date.parse("2026-10-15T08:00:00Z");
    for (let i = 1; i <= 4; i++) expect(noterEchecPin("u-1", t0, r)).toMatchObject({ echecs: i, bloque: false });
    expect(noterEchecPin("u-1", t0, r)).toMatchObject({ echecs: 5, bloque: true, bloqueJusqua: t0 + BLOCAGE_PIN_MS });
    expect(lireEtatPin("u-1", t0 + BLOCAGE_PIN_MS - 1, r).bloqueJusqua).toBe(t0 + BLOCAGE_PIN_MS);
    // Les autres personnes ne sont pas touchées.
    expect(lireEtatPin("u-2", t0, r)).toEqual({ echecs: 0, bloqueJusqua: null });
    expect(lireEtatPin("u-1", t0 + BLOCAGE_PIN_MS, r)).toEqual({ echecs: 0, bloqueJusqua: null });
    expect(noterEchecPin("u-1", t0 + BLOCAGE_PIN_MS, r)).toMatchObject({ echecs: 1, bloque: false });
  });

  it("un code juste remet le compteur à zéro", () => {
    const r = memoire();
    noterEchecPin("u-1", 0, r);
    noterEchecPin("u-1", 0, r);
    effacerEchecsPin("u-1", r);
    expect(lireEtatPin("u-1", 0, r).echecs).toBe(0);
  });
});
