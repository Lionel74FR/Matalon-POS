import { afterEach, describe, expect, it, vi } from "vitest";
import { definirLogoMemoire, encoderPc858, rasterDepuisRgba, versEscPos, COUPES_PARTIELLES_ESSAI } from "../src/impression/escpos";
import { Recu } from "../src/impression/recu";
import { delaiVidange, envoyerSerie, serieDisponible } from "../src/impression/serie";

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
    // 8 lignes vides avant la coupe : sinon la fin du ticket sort en haut du suivant (16 novembre).
    expect([...b.slice(-11)]).toEqual([...Array(8).fill(0x0a), 0x1d, 0x56, 0]);
  });

  it("sans accents : pas de page de codes ; ouverture du tiroir seule : ni papier ni coupe", () => {
    expect([...versEscPos(new Recu().texte("é"), { sansAccents: true }).slice(0, 4)]).toEqual([0x1b, 0x40, 0x1b, 0x61]);
    expect([...versEscPos(new Recu().ouvrirTiroir(), { sansAccents: false })]).toEqual([0x1b, 0x40, 0x1b, 0x74, 19, 0x1b, 0x70, 0, 25, 250]);
  });
});

describe("coupe partielle (backlog n° 6)", () => {
  it("coupe totale par défaut (GS V 0), partielle sur demande (GS V 1), toujours après 8 lignes", () => {
    const recu = new Recu().texte("Merci");
    expect([...versEscPos(recu, { sansAccents: false })].slice(-11)).toEqual([...Array(8).fill(0x0a), 0x1d, 0x56, 0]);
    expect([...versEscPos(recu, { sansAccents: false, coupePartielle: true })].slice(-11)).toEqual([...Array(8).fill(0x0a), 0x1d, 0x56, 1]);
  });

  it("essai des coupes : chaque commande essayée termine son ticket, après les 8 lignes (18 novembre 2026)", () => {
    const recu = new Recu().texte("Coupe");
    for (const c of COUPES_PARTIELLES_ESSAI) {
      const octets = [...versEscPos(recu, { sansAccents: false, commandeCoupe: c.octets })];
      expect(octets.slice(-(8 + c.octets.length))).toEqual([...Array(8).fill(0x0a), ...c.octets]);
    }
    expect(COUPES_PARTIELLES_ESSAI.map((c) => c.octets)).toEqual([[0x1d, 0x56, 1], [0x1d, 0x56, 66, 0], [0x1b, 0x6d], [0x1d, 0x56, 49]]);
  });
});

describe("logo en tête du ticket série", () => {
  it("passe l'image en points noirs : sombre et opaque = noir, transparent ou clair = blanc", () => {
    // 10 × 2 pixels : ligne 1 noire opaque, ligne 2 noire transparente sauf le dernier pixel, gris clair au milieu.
    const rgba: number[] = [];
    for (let x = 0; x < 10; x++) rgba.push(0, 0, 0, 255);
    for (let x = 0; x < 10; x++) rgba.push(...(x === 9 ? [0, 0, 0, 255] : x === 4 ? [200, 200, 200, 255] : [0, 0, 0, 0]));
    const r = rasterDepuisRgba(rgba, 10, 2);
    expect([r.largeurOctets, r.hauteur]).toEqual([2, 2]);
    expect([...r.points]).toEqual([0xff, 0xc0, 0x00, 0x40]);
  });

  it("imprime un logo de couleur claire sur fond transparent (le doré du Chardon)", () => {
    // 3 pixels : doré opaque, doré à moitié transparent (bord adouci), transparent.
    const r = rasterDepuisRgba([200, 160, 40, 255, 200, 160, 40, 64, 0, 0, 0, 0], 3, 1);
    expect([...r.points]).toEqual([0x80]);
    // Image toute blanche : rien à imprimer.
    expect([...rasterDepuisRgba([255, 255, 255, 255], 1, 1).points]).toEqual([0]);
  });

  it("enregistre le logo dans l'imprimante (FS q, colonnes) puis l'imprime par FS p sans renvoyer l'image", () => {
    // 16 × 2 points : ligne 0 = 0x80 0x01 (premier et dernier point), ligne 1 = 0x80 0x00.
    const logo = { largeurOctets: 2, hauteur: 2, points: Uint8Array.from([0x80, 0x01, 0x80, 0x00]) };
    const nv = [...definirLogoMemoire(logo)];
    expect(nv.slice(0, 9)).toEqual([0x1b, 0x40, 0x1c, 0x71, 1, 2, 0, 1, 0]);
    // 16 colonnes d'un octet : colonne 0 = points des lignes 0 et 1, colonne 15 = point de la ligne 0.
    const donnees = nv.slice(9);
    expect(donnees).toHaveLength(16);
    expect(donnees[0]).toBe(0xc0);
    expect(donnees[15]).toBe(0x80);
    expect(donnees.slice(1, 15).every((o) => o === 0)).toBe(true);

    const recu = new Recu().texte("Au Chardon", { align: "centre", gras: true, grand: true, enseigne: true }).texte("Merci");
    const b = [...versEscPos(recu, { sansAccents: false, logo: "memoire" })];
    const i = b.indexOf(0x1c);
    expect(b.slice(i - 3, i + 4)).toEqual([0x1b, 0x61, 1, 0x1c, 0x70, 1, 0]);
    expect(b.length).toBeLessThan(60);
  });

  it("remplace l'enseigne par le logo (GS v 0 centré), garde le texte sans logo ou ailleurs qu'en tête", () => {
    const recu = new Recu().texte("Au Chardon", { align: "centre", gras: true, grand: true, enseigne: true }).texte("Merci", { align: "centre", grand: true });
    const logo = { largeurOctets: 2, hauteur: 1, points: Uint8Array.from([0xaa, 0x55]) };
    const avec = [...versEscPos(recu, { sansAccents: false, logo })];
    const debut = avec.indexOf(0x76) - 1;
    expect(avec.slice(debut - 3, debut + 10)).toEqual([0x1b, 0x61, 1, 0x1d, 0x76, 0x30, 0, 2, 0, 1, 0, 0xaa, 0x55]);
    const texte = (o: number[]) => String.fromCharCode(...o.filter((b) => b >= 0x20 && b < 0x7f));
    expect(texte(avec)).not.toContain("Au Chardon");
    expect(texte(avec)).toContain("Merci");
    expect(texte([...versEscPos(recu, { sansAccents: false })])).toContain("Au Chardon");
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

  it("attend que tout soit sorti sur la ligne avant de refermer le port (ticket tronqué au total, 16 novembre)", async () => {
    expect(delaiVidange(2000, 9600)).toBe(2584); // 2 000 octets à 9 600 bauds : 2,08 s + 0,5 s de marge
    expect(delaiVidange(10, 115200)).toBe(501);
    installer([port("COM2")]);
    vi.useFakeTimers();
    try {
      const recu = new Recu();
      for (let i = 0; i < 40; i++) recu.colonnes(`Article ${i}`, "12,50 €");
      const fin = envoyerSerie(recu.colonnes("TOTAL", "500,00 €", { grand: true }), { rang: 0, bauds: 9600, sansAccents: false });
      await vi.advanceTimersByTimeAsync(0);
      const ecrits = Number(journal.find((l) => l.startsWith("COM2 write"))!.split(" ")[2]);
      await vi.advanceTimersByTimeAsync(delaiVidange(ecrits, 9600) - 10);
      expect(journal).not.toContain("COM2 close");
      await vi.advanceTimersByTimeAsync(20);
      await fin;
      expect(journal.at(-1)).toBe("COM2 close");
    } finally {
      vi.useRealTimers();
    }
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
