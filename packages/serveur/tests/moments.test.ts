import { describe, expect, it } from "vitest";
import { momentDe, problemeMoments, type MomentJournee } from "../src/partage.js";

const m = (id: string, debut: string, fin: string, nom = id): MomentJournee => ({ id, nom, debut, fin });
const h = (hh: number, mm = 0) => hh * 60 + mm;

describe("moments de la journée", () => {
  const journee = [m("matin", "08:00", "12:00", "Matin"), m("midi", "12:00", "14:30", "Midi"), m("soir", "18:00", "03:00", "Soir")];

  it("range une heure dans son moment, minuit passé compris ; la fin est exclue", () => {
    expect(momentDe(journee, h(8))?.id).toBe("matin");
    expect(momentDe(journee, h(11, 59))?.id).toBe("matin");
    expect(momentDe(journee, h(12))?.id).toBe("midi");
    expect(momentDe(journee, h(15))).toBeNull();
    expect(momentDe(journee, h(23, 30))?.id).toBe("soir");
    expect(momentDe(journee, h(2, 59))?.id).toBe("soir");
    expect(momentDe(journee, h(3))).toBeNull();
    expect(momentDe([m("tard", "20:00", "00:00")], h(23, 59))?.id).toBe("tard");
  });

  it("refuse les chevauchements, y compris par-dessus minuit, et les moments mal formés", () => {
    expect(problemeMoments(journee)).toBeNull();
    expect(problemeMoments([...journee, m("nuit", "02:00", "05:00", "Nuit")])).toBe("« Soir » et « Nuit » se chevauchent.");
    expect(problemeMoments([m("a", "10:00", "11:00", "Brunch"), m("b", "10:30", "12:00", "brunch")])).toBe("Deux moments s'appellent « brunch ».");
    expect(problemeMoments([m("a", "10:00", "10:00", "Café")])).toBe("« Café » : le début et la fin sont à la même heure.");
    expect(problemeMoments([m("a", "8h", "12:00", "Matin")])).toBe("« Matin » : heures au format 08:00.");
    expect(problemeMoments([m("a", "08:00", "12:00", " ")])).toBe("Chaque moment a un nom de 1 à 30 caractères.");
    expect(problemeMoments(Array.from({ length: 9 }, (_, i) => m(`m${i}`, `${String(i).padStart(2, "0")}:00`, `${String(i).padStart(2, "0")}:30`)))).toBe("8 moments au plus.");
    // Bout à bout : pas de chevauchement.
    expect(problemeMoments([m("a", "18:00", "03:00"), m("b", "03:00", "08:00")])).toBeNull();
  });
});
