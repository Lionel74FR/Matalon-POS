import { describe, expect, it } from "vitest";
import { descriptionAppareil, typeDeCetAppareil, typeDepuisDescription } from "../src/donnees/appareil";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

describe("type d'appareil", () => {
  it("reconnaît l'iPhone, l'iPad (qui se présente comme un Mac tactile) et le reste", () => {
    expect(typeDeCetAppareil({ userAgent: IPHONE, maxTouchPoints: 5 })).toBe("iPhone");
    expect(typeDeCetAppareil({ userAgent: MAC, maxTouchPoints: 5 })).toBe("iPad");
    expect(typeDeCetAppareil({ userAgent: MAC, maxTouchPoints: 0 })).toBe("Autre");
  });

  it("relit le type depuis la description envoyée au rattachement, et depuis un ancien user agent brut", () => {
    expect(typeDepuisDescription(descriptionAppareil({ userAgent: IPHONE, maxTouchPoints: 5 }))).toBe("iPhone");
    expect(typeDepuisDescription(descriptionAppareil({ userAgent: MAC, maxTouchPoints: 5 }))).toBe("iPad");
    expect(typeDepuisDescription(MAC)).toBe("iPad");
    expect(typeDepuisDescription(IPHONE)).toBe("iPhone");
    expect(descriptionAppareil({ userAgent: "x".repeat(500), maxTouchPoints: 0 })).toHaveLength(200);
  });
});
