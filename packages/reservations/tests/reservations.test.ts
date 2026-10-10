import { describe, expect, it } from "vitest";
import {
  attribuerTable,
  controler,
  creneauxDuJour,
  joursLibres,
  maintenantParis,
  normaliserTelephone,
  presenceMax,
  prochainesParTable,
  REGLAGES_DEFAUT,
  validerCoordonnees,
  validerReglages,
  type ReglagesReservation,
  type Reservation,
  type TableResa,
} from "../src/index";

// Jeudi 15 octobre 2026 (jour 4), 10 h à Paris (UTC+2).
const MAINTENANT = new Date("2026-10-15T08:00:00Z");
const REGLAGES: ReglagesReservation = {
  ...REGLAGES_DEFAUT,
  actif: true,
  dureeMinutes: 90,
  pasMinutes: 30,
  delaiMinutes: 60,
  horizonJours: 30,
  groupeMax: 8,
  fermetures: ["2026-10-20"],
  services: [
    { id: "dej", nom: "Déjeuner", jours: [2, 3, 4, 5, 6], debut: "12:00", fin: "13:30", couvertsMax: 20, simultanesMax: 12, arriveesMax: 8 },
    { id: "din", nom: "Dîner", jours: [4, 5, 6], debut: "19:00", fin: "21:30", couvertsMax: 40, simultanesMax: null, arriveesMax: null, dureeMinutes: 120 },
  ],
};

let n = 0;
const resa = (heure: string, couverts: number, m: Partial<Reservation> = {}): Reservation => ({
  id: `r${++n}`,
  etablissementId: "moka",
  date: "2026-10-15",
  heure,
  couverts,
  dureeMinutes: 90,
  serviceId: heure < "16:00" ? "dej" : "din",
  prenom: "A",
  nom: "B",
  telephone: "+33600000000",
  statut: "confirmee",
  source: "en_ligne",
  tables: [],
  creeLe: "",
  majLe: "",
  historique: [],
  ...m,
});

const opts = { maintenant: MAINTENANT, enLigne: true };

describe("contrôle d'une demande", () => {
  it("refuse jour fermé, hors service, trop tard, trop tôt et grand groupe", () => {
    expect(controler(REGLAGES, [], { date: "2026-10-20", heure: "12:00", couverts: 2 }, opts)).toBe("FERME");
    expect(controler(REGLAGES, [], { date: "2026-10-19", heure: "12:00", couverts: 2 }, opts)).toBe("HORS_SERVICE"); // lundi
    expect(controler(REGLAGES, [], { date: "2026-10-15", heure: "12:15", couverts: 2 }, opts)).toBe("HORS_SERVICE"); // hors pas
    expect(controler(REGLAGES, [], { date: "2026-10-15", heure: "15:00", couverts: 2 }, opts)).toBe("HORS_SERVICE");
    expect(controler(REGLAGES, [], { date: "2026-10-15", heure: "12:00", couverts: 9 }, opts)).toBe("GROUPE");
    expect(controler(REGLAGES, [], { date: "2026-12-17", heure: "12:00", couverts: 2 }, opts)).toBe("TROP_TOT");
    // 10 h 30 pour 12 h : délai d'une heure tenu ; 11 h 01 pour 12 h : non.
    expect(controler(REGLAGES, [], { date: "2026-10-15", heure: "12:00", couverts: 2 }, opts)).toBeNull();
    expect(controler(REGLAGES, [], { date: "2026-10-15", heure: "12:00", couverts: 2 }, { ...opts, maintenant: new Date("2026-10-15T09:01:00Z") })).toBe("TROP_TARD");
    // L'équipe n'est tenue ni par le délai ni par la taille du groupe.
    expect(controler(REGLAGES, [], { date: "2026-10-15", heure: "19:00", couverts: 9 }, { ...opts, enLigne: false })).toBeNull();
  });

  it("applique le total du service, la présence simultanée et les arrivées par créneau", () => {
    // Arrivées : 8 couverts au plus à 12 h.
    const midi = [resa("12:00", 6)];
    expect(controler(REGLAGES, midi, { date: "2026-10-15", heure: "12:00", couverts: 2 }, opts)).toBeNull();
    expect(controler(REGLAGES, midi, { date: "2026-10-15", heure: "12:00", couverts: 3 }, opts)).toBe("CRENEAU_COMPLET");
    // Présence : 6 à 12 h + 6 à 12 h 30 = 12 présents jusqu'à 13 h 30 ; à 13 h 30 les premiers sont partis.
    const deux = [resa("12:00", 6), resa("12:30", 6)];
    expect(presenceMax(deux, 12 * 60, 13 * 60 + 30)).toBe(12);
    expect(controler(REGLAGES, deux, { date: "2026-10-15", heure: "13:00", couverts: 1 }, opts)).toBe("SALLE_PLEINE");
    expect(controler(REGLAGES, deux, { date: "2026-10-15", heure: "13:30", couverts: 6 }, opts)).toBeNull();
    // Total du service : 20 couverts, annulées et absentes non comptées.
    const plein = [resa("12:00", 8), resa("13:30", 8), resa("13:30", 4, { statut: "annulee" }), resa("12:30", 4, { statut: "absente" })];
    // 4 de plus à 13 h : 12 présents au plus (les premiers partent à 13 h 30), 20 sur le service : tout juste.
    expect(controler(REGLAGES, plein, { date: "2026-10-15", heure: "13:00", couverts: 4 }, opts)).toBeNull();
    expect(controler(REGLAGES, [...plein, resa("13:00", 4)], { date: "2026-10-15", heure: "12:30", couverts: 1 }, { ...opts, enLigne: false })).toBe("SERVICE_COMPLET");
    // Une réservation modifiée ne se compte pas contre elle-même.
    const seule = resa("12:00", 8);
    expect(controler(REGLAGES, [seule], { date: "2026-10-15", heure: "12:00", couverts: 8 }, { ...opts, ignorer: seule.id })).toBeNull();
  });
});

describe("créneaux et jours libres", () => {
  it("propose les créneaux du jour par service, complets signalés, passés retirés", () => {
    const c = creneauxDuJour(REGLAGES, [resa("12:00", 8)], "2026-10-15", 2, MAINTENANT);
    expect(c.map((s) => s.nom)).toEqual(["Déjeuner", "Dîner"]);
    expect(c[0]!.creneaux).toEqual([
      { heure: "12:00", libre: false },
      { heure: "12:30", libre: true },
      { heure: "13:00", libre: true },
      { heure: "13:30", libre: true },
    ]);
    expect(c[1]!.creneaux.map((x) => x.heure)).toEqual(["19:00", "19:30", "20:00", "20:30", "21:00", "21:30"]);
    // À 12 h 45, il ne reste que le dîner (13 h 30 est à moins d'une heure).
    const tard = creneauxDuJour(REGLAGES, [], "2026-10-15", 2, new Date("2026-10-15T10:45:00Z"));
    expect(tard.map((s) => s.nom)).toEqual(["Dîner"]);
    expect(joursLibres(REGLAGES, [], "2026-10-18", "2026-10-21", 2, MAINTENANT)).toEqual(["2026-10-21"]); // dim., lun. fermés au service, 20 fermé
  });

  it("lit l'heure de Paris, été comme hiver", () => {
    expect(maintenantParis(new Date("2026-10-15T08:00:00Z"))).toEqual({ jour: "2026-10-15", minute: 600 });
    expect(maintenantParis(new Date("2026-12-31T23:30:00Z"))).toEqual({ jour: "2027-01-01", minute: 30 });
  });
});

describe("tables", () => {
  const tables: TableResa[] = [
    { id: "t1", nom: "1", zone: "Salle", chaises: 2 },
    { id: "t2", nom: "2", zone: "Salle", chaises: 4 },
    { id: "t3", nom: "3", zone: "Terrasse", chaises: 4 },
    { id: "t4", nom: "4", zone: "Salle", chaises: 6 },
    { id: "t5", nom: "5", zone: "Salle", chaises: 8, masquee: true },
  ];
  it("attribue la plus petite table libre, de préférence dans la zone souhaitée", () => {
    expect(attribuerTable(tables, [], resa("12:00", 2))).toEqual(["t1"]);
    expect(attribuerTable(tables, [], resa("12:00", 3))).toEqual(["t2"]);
    expect(attribuerTable(tables, [], resa("12:00", 3, { zoneSouhaitee: "Terrasse" }))).toEqual(["t3"]);
    // t2 prise de 12 h à 13 h 30 : à 13 h, on passe à t3 ; à 13 h 30, t2 est de nouveau libre.
    const prises = [resa("12:00", 4, { tables: ["t2"] })];
    expect(attribuerTable(tables, prises, resa("13:00", 3))).toEqual(["t3"]);
    expect(attribuerTable(tables, prises, resa("13:30", 3))).toEqual(["t2"]);
    // Aucune table de 8 visible : à placer par l'équipe.
    expect(attribuerTable(tables, [], resa("12:00", 8))).toEqual([]);
  });

  it("donne la prochaine réservation de chaque table pour le plan", () => {
    const a = resa("12:00", 2, { tables: ["t1"] });
    const b = resa("19:30", 2, { tables: ["t1"] });
    const c = resa("20:00", 4, { tables: ["t2"], statut: "annulee" });
    const p = prochainesParTable([b, a, c], "2026-10-15", 13 * 60);
    expect(p.get("t1")?.id).toBe(a.id); // en cours jusqu'à 13 h 30
    expect(prochainesParTable([b, a, c], "2026-10-15", 14 * 60).get("t1")?.id).toBe(b.id);
    expect(p.has("t2")).toBe(false);
  });
});

describe("validation", () => {
  it("contrôle les réglages", () => {
    expect(validerReglages(REGLAGES)).toEqual([]);
    const chevauchement = { ...REGLAGES, services: [...REGLAGES.services, { ...REGLAGES.services[0]!, id: "brunch", nom: "Brunch", debut: "11:00", fin: "12:00" }] };
    expect(validerReglages(chevauchement)).toEqual(["Brunch et Déjeuner se chevauchent un même jour."]);
    expect(validerReglages({ ...REGLAGES, dureeMinutes: 7, services: [] }).length).toBe(2);
  });

  it("nettoie les coordonnées du client", () => {
    expect(normaliserTelephone("06 12 34 56 78")).toBe("+33612345678");
    expect(normaliserTelephone("0041 79 123 45 67")).toBe("+41791234567");
    expect(normaliserTelephone("12")).toBeNull();
    expect(validerCoordonnees({ prenom: " Léa ", nom: "Martin", telephone: "06.12.34.56.78", email: "LEA@Exemple.fr" }, { emailObligatoire: true })).toEqual({
      ok: { prenom: "Léa", nom: "Martin", telephone: "+33612345678", email: "lea@exemple.fr" },
    });
    expect(validerCoordonnees({ prenom: "", nom: "M", telephone: "x" }, { emailObligatoire: true })).toEqual({
      erreurs: ["Prénom obligatoire (60 caractères au plus).", "Numéro de téléphone invalide.", "Adresse e-mail obligatoire."],
    });
  });
});
