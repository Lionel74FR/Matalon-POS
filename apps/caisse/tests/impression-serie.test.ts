import { afterEach, describe, expect, it } from "vitest";
import { encoderPc858, versEscPos } from "../src/impression/escpos";
import { Recu } from "../src/impression/recu";
import { envoyerSerie, serieDisponible } from "../src/impression/serie";

// Impression série des caisses du Chardon (15 novembre 2026) : Oxhoo TP85, RS232, ESC/POS PC858.
const octets = (...n: number[]) => Uint8Array.from(n);
const contient = (tout: Uint8Array, partie: Uint8Array) => Buffer.from(tout).includes(Buffer.from(partie));

describe("commandes ESC/POS", () => {
  it("encode l'euro et les accents en PC858, et remplace ce qui n'y est pas", () => {
    expect(encoderPc858("é è à ç ô €", { sansAccents: false })).toEqual([0x82, 0x20, 0x8a, 0x20, 0x85, 0x20, 0x87, 0x20, 0x93, 0x20, 0xd5]);
    expect(encoderPc858("Œuf — 1 250,00 €", { sansAccents: false })).toEqual([...Buffer.from("OEuf - 1 250,00 "), 0xd5]);
    expect(Buffer.from(encoderPc858("Crème brûlée 12,50 €", { sansAccents: true })).toString("latin1")).toBe("Creme brulee 12,50 EUR");
  });

  it("initialise, choisit PC858, aligne, met en gras et en grand, coupe à la fin", () => {
    const r = new Recu().texte("Moka", { align: "centre", gras: true, grand: true }).colonnes("Cappuccino", "4,00").filet().saut(2);
    const b = versEscPos(r, { sansAccents: false });
    expect([...b.slice(0, 5)]).toEqual([0x1b, 0x40, 0x1b, 0x74, 19]);
    expect(contient(b, octets(0x1b, 0x61, 1, 0x1b, 0x45, 1, 0x1d, 0x21, 0x11, ...Buffer.from("Moka"), 0x0a))).toBe(true);
    expect(contient(b, Buffer.from(`Cappuccino${" ".repeat(34)}4,00\n`))).toBe(true);
    expect(contient(b, Buffer.from(`${"-".repeat(48)}\n`))).toBe(true);
    expect(contient(b, octets(0x1b, 0x64, 2))).toBe(true);
    expect([...b.slice(-6)]).toEqual([0x1b, 0x64, 3, 0x1d, 0x56, 0]);
  });

  it("sans accents : pas de page de codes ; ouverture du tiroir seule : ni papier ni coupe", () => {
    expect([...versEscPos(new Recu().texte("é"), { sansAccents: true }).slice(0, 4)]).toEqual([0x1b, 0x40, 0x1b, 0x61]);
    expect([...versEscPos(new Recu().ouvrirTiroir(), { sansAccents: false })]).toEqual([0x1b, 0x40, 0x1b, 0x74, 19, 0x1b, 0x70, 0, 25, 250]);
  });
});

describe("pilote Web Serial", () => {
  const journal: string[] = [];
  const port = (nom: string, echecOuverture = false) => ({
    async open(o: unknown) {
      if (echecOuverture) throw new Error("Failed to open serial port");
      journal.push(`${nom} open ${JSON.stringify(o)}`);
    },
    async close() {
      journal.push(`${nom} close`);
    },
    async setSignals(s: unknown) {
      journal.push(`${nom} signals ${JSON.stringify(s)}`);
    },
    writable: new WritableStream<Uint8Array>({ write: (c) => void journal.push(`${nom} write ${c.length}`) }),
    getInfo: () => ({}),
  });
  const installer = (ports: unknown[]) => Object.defineProperty(globalThis.navigator, "serial", { value: { getPorts: async () => ports, requestPort: async () => ports[0] }, configurable: true });
  afterEach(() => {
    delete (globalThis.navigator as unknown as { serial?: unknown }).serial;
    journal.length = 0;
  });

  it("n'existe pas sans navigator.serial (iPad, iPhone)", () => {
    expect(serieDisponible()).toBe(false);
  });

  it("ouvre en 9600 8N1 sans contrôle de flux, baisse DTR et RTS aussitôt, écrit puis referme", async () => {
    installer([port("COM2")]);
    expect(serieDisponible()).toBe(true);
    await envoyerSerie(new Recu().texte("Test"), { rang: 0, bauds: 9600, sansAccents: false });
    expect(journal).toEqual([
      'COM2 open {"baudRate":9600,"dataBits":8,"stopBits":1,"parity":"none","flowControl":"none"}',
      'COM2 signals {"dataTerminalReady":false,"requestToSend":false}',
      expect.stringMatching(/^COM2 write \d+$/),
      "COM2 close",
    ]);
  });

  it("utilise le port gardé parmi plusieurs autorisés, et dit quand le port est occupé ou absent", async () => {
    installer([port("COM1"), port("COM2")]);
    await envoyerSerie(new Recu().ouvrirTiroir(), { rang: 1, sansAccents: false });
    expect(journal[0]).toMatch(/^COM2 open/);
    installer([port("COM2", true)]);
    await expect(envoyerSerie(new Recu().texte("x"), { rang: 0, sansAccents: false })).rejects.toThrow(/DominoFR doit être fermé/);
    installer([]);
    await expect(envoyerSerie(new Recu().texte("x"), { rang: 0, sansAccents: false })).rejects.toThrow(/non autorisé/);
  });
});
