import { afterEach, describe, expect, it, vi } from "vitest";
import type { Configuration } from "../src/donnees/configuration";
import { demarrerRelais, imprimerParRelais } from "../src/impression/relais";
import { Recu } from "../src/impression/recu";
import type { ClientApi } from "../src/serveur/client";

/** Impression relayée par une dalle (16 novembre 2026, backlog n° 5) : côté iPad et côté dalle. */

const journal: string[] = [];
const port = () => ({
  open: async () => void journal.push("open"),
  close: async () => void journal.push("close"),
  setSignals: async () => undefined,
  writable: new WritableStream<Uint8Array>({ write: (c) => void journal.push(`write ${c.length}`) }),
  getInfo: () => ({}),
});
afterEach(() => {
  delete (globalThis.navigator as unknown as { serial?: unknown }).serial;
  journal.length = 0;
});

const attendreQue = async (condition: () => boolean) => {
  for (let i = 0; i < 200 && !condition(); i++) await new Promise((fin) => setTimeout(fin, 20));
  expect(condition()).toBe(true);
};

describe("dalle relais", () => {
  it("s'inscrit, imprime les reçus des autres appareils sur son imprimante série et rend compte", async () => {
    Object.defineProperty(globalThis.navigator, "serial", { value: { getPorts: async () => [port()] }, configurable: true });
    const appels: string[] = [];
    const notes: string[] = [];
    let tour = 0;
    const client = {
      inscrireRelais: async (actif: boolean) => (appels.push(`inscrire ${actif}`), { relais: [] }),
      impressionsEnAttente: async () => ({
        impressions: tour++ === 0 ? [{ id: "ir-000000000001", titre: "Ticket 12", recu: new Recu().texte("Merci").ouvrirTiroir().elements }] : [],
      }),
      compteRenduImpression: async (id: string, ok: boolean, erreur?: string) => (appels.push(`compte ${id} ${ok}${erreur ? ` ${erreur}` : ""}`), { ok: true as const }),
    } as unknown as ClientApi;
    let config = { etablissementId: "chardon", caisseNom: "Dalle bar", logo: null, imprimanteSerie: { rang: 0, bauds: 115200, sansAccents: false, relais: true } } as unknown as Configuration;
    const arreter = demarrerRelais({ client, config: () => config, notifier: (m) => void notes.push(m), periode: 50 });
    try {
      await attendreQue(() => appels.some((a) => a.startsWith("compte")));
      expect(appels.slice(0, 2)).toEqual(["inscrire true", "compte ir-000000000001 true"]);
      expect(journal[0]).toBe("open");
      expect(journal.at(-1)).toBe("close");

      // Plus d'imprimante série : la dalle le dit à l'iPad et l'affiche chez elle.
      config = { ...config, imprimanteSerie: undefined };
      tour = 0;
      await attendreQue(() => appels.length === 3);
      expect(appels[2]).toBe("compte ir-000000000001 false Dalle bar : Cette dalle n'a plus d'imprimante série.");
      expect(notes[0]).toContain("Ticket 12");
    } finally {
      arreter();
    }
  });
});

describe("iPad qui imprime par une dalle", () => {
  const client = (etats: Array<{ etat: string; erreur?: string }>, depot: () => Promise<{ id: string }> = async () => ({ id: "ir-0000000000aa" })) =>
    ({
      deposerImpression: vi.fn(depot),
      etatImpression: async () => etats.shift() ?? { etat: "prise" },
    }) as unknown as ClientApi;
  const sansPause = async () => undefined;

  it("confie le reçu et ne dit rien quand la dalle l'a imprimé", async () => {
    const c = client([{ etat: "attente" }, { etat: "prise" }, { etat: "faite" }]);
    const surEchec = vi.fn();
    await imprimerParRelais(c, { relaisId: "ipad-0000000d" }, new Recu().texte("Note"), "Note", surEchec, sansPause);
    expect(c.deposerImpression).toHaveBeenCalledWith({ relaisId: "ipad-0000000d", titre: "Note", recu: [expect.objectContaining({ texte: "Note" })] });
    await new Promise((fin) => setTimeout(fin, 10));
    expect(surEchec).not.toHaveBeenCalled();
  });

  it("signale l'échec de la dalle, et rejette tout de suite si elle ne répond pas", async () => {
    const surEchec = vi.fn();
    await imprimerParRelais(client([{ etat: "prise" }, { etat: "echec", erreur: "Port COM occupé." }]), { relaisId: "d" }, new Recu().texte("x"), "Ticket", surEchec, sansPause);
    await vi.waitFor(() => expect(surEchec).toHaveBeenCalledWith("Port COM occupé."));
    const horsLigne = client([], async () => {
      throw new Error("La dalle « Bar » ne répond pas");
    });
    await expect(imprimerParRelais(horsLigne, { relaisId: "d" }, new Recu().texte("x"), "Ticket", surEchec, sansPause)).rejects.toThrow(/ne répond pas/);
  });
});
