import type { Table, ZonePlan } from "@matalon/serveur/partage";
import { describe, expect, it } from "vitest";
import { fusionnerCommandes, nouvelleCommande, tablesDeCommande, transfererCommande } from "../src/metier/commande";
import { chaises, chevauchements, dimensions, nomSuivant, placerTables, zonesDuPlan } from "../src/metier/plan";

const salle: ZonePlan = { nom: "Salle", largeur: 40, hauteur: 24, decor: [] };
const table = (id: string, v: Partial<Table> = {}): Table => ({ id, nom: id.replace(/\D/g, ""), zone: "Salle", ...v });

describe("géométrie du plan", () => {
  it("dimensionne le plateau selon la forme, les chaises et la rotation", () => {
    expect(dimensions({ forme: "rond", chaises: 2 })).toEqual({ largeur: 3, hauteur: 3 });
    expect(dimensions({ forme: "rond", chaises: 8 })).toEqual({ largeur: 5, hauteur: 5 });
    expect(dimensions({ forme: "rectangle", chaises: 6 })).toEqual({ largeur: 7, hauteur: 3 });
    expect(dimensions({ forme: "rectangle", chaises: 6, rotation: 90 })).toEqual({ largeur: 3, hauteur: 7 });
  });

  it("place autant de chaises que demandé, hors du plateau", () => {
    for (const forme of ["carre", "rectangle", "rond"] as const) {
      for (const n of [0, 1, 4, 7, 12]) {
        const t = { forme, chaises: n };
        const d = dimensions(t);
        const liste = chaises(t);
        expect(liste).toHaveLength(n);
        for (const c of liste) {
          const dedans = c.x > 0 && c.x < d.largeur && c.y > 0 && c.y < d.hauteur;
          expect(dedans).toBe(false);
        }
      }
    }
  });

  it("place d'office les tables sans position, sans chevauchement, et ignore les tables masquées", () => {
    const tables = [table("t1", { x: 1, y: 1 }), ...Array.from({ length: 11 }, (_, i) => table(`t${i + 2}`)), table("t99", { masquee: true })];
    const placees = placerTables(salle, tables);
    expect(placees).toHaveLength(12);
    expect(placees[0]).toMatchObject({ x: 1, y: 1 });
    expect(chevauchements(placees).size).toBe(0);
    // Même résultat d'un appareil à l'autre.
    expect(placerTables(salle, tables)).toEqual(placees);
  });

  it("signale deux tables trop proches, chaises comprises", () => {
    const placees = placerTables(salle, [table("t1", { x: 2, y: 2 }), table("t2", { x: 6, y: 2 }), table("t3", { x: 20, y: 2 })]);
    expect([...chevauchements(placees)].sort()).toEqual(["t1", "t2"]);
  });

  it("ajoute les zones citées par des tables et propose le numéro suivant", () => {
    const zones = zonesDuPlan([salle], [table("t1"), { id: "ter1", nom: "T1", zone: "Terrasse" }]);
    expect(zones.map((z) => z.nom)).toEqual(["Salle", "Terrasse"]);
    expect(nomSuivant([table("t1"), table("t7"), { id: "ter1", nom: "T1", zone: "Terrasse" }])).toBe("8");
  });
});

describe("tables assemblées", () => {
  it("une commande occupe sa table et ses tables jointes", () => {
    const c = { ...nouvelleCommande("t3", "u1"), jointes: ["t4", "t5"] };
    expect(tablesDeCommande(c)).toEqual(["t3", "t4", "t5"]);
  });

  it("un transfert laisse les tables jointes libres ; une fusion les garde", () => {
    const c = { ...nouvelleCommande("t3", "u1"), jointes: ["t4"] };
    expect(transfererCommande(c, "t9").jointes).toBeUndefined();
    const cible = { ...nouvelleCommande("t8", "u1"), jointes: ["t7"] };
    expect(fusionnerCommandes(cible, c).jointes).toEqual(["t7", "t4"]);
  });
});
