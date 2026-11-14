import { describe, expect, it } from "vitest";
import { positionInitiale } from "../src/metier/position-carte";

// La carte rouvre sur le rayon et la catégorie de la commande précédente (14 novembre 2026).
describe("position de la carte à l'ouverture d'une commande", () => {
  const rayons = ["Boissons", "Cocktails", "Cuisine"];
  it("reprend le rayon et la catégorie gardés", () => {
    expect(positionInitiale(rayons, { rayon: "Cuisine", categorieId: "desserts" })).toEqual({ rayon: "Cuisine", categorieId: "desserts" });
  });
  it("revient au premier rayon s'il n'y a rien de gardé ou si le rayon a quitté la carte", () => {
    expect(positionInitiale(rayons, null)).toEqual({ rayon: "Boissons", categorieId: null });
    expect(positionInitiale(rayons, { rayon: "Goûter", categorieId: "crepes" })).toEqual({ rayon: "Boissons", categorieId: null });
  });
});
