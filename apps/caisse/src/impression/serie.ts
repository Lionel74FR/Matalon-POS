import { ErreurImpression } from "./epson";
import { versEscPos, type LogoRaster } from "./escpos";
import type { Recu } from "./recu";

/**
 * Imprimante des tickets branchée sur un port série de l'appareil (15 novembre 2026, caisses du
 * Chardon : dalles Windows, PWA Chrome, Oxhoo TP85 en RS232 sur COM2), par l'API Web Serial.
 * Réglages validés sur place : 9600 bauds, 8N1, sans contrôle de flux ; DTR et RTS baissés juste
 * après l'ouverture, sinon rien ne sort. Le port est exclusif : le logiciel de caisse précédent
 * (DominoFR) doit être fermé. Absent sur iPad et iPhone : rien de ce module n'y est appelé.
 */

/** Ce que la caisse utilise de l'API Web Serial (absente des types du DOM de TypeScript). */
interface PortSerie {
  open(o: { baudRate: number; dataBits?: number; stopBits?: number; parity?: "none" | "even" | "odd"; flowControl?: "none" | "hardware" }): Promise<void>;
  close(): Promise<void>;
  setSignals(s: { dataTerminalReady?: boolean; requestToSend?: boolean }): Promise<void>;
  readonly writable: WritableStream<Uint8Array> | null;
  getInfo(): { usbVendorId?: number; usbProductId?: number };
}
interface ApiSerie {
  getPorts(): Promise<PortSerie[]>;
  requestPort(o?: { filters?: unknown[] }): Promise<PortSerie>;
}

export const BAUDS_PAR_DEFAUT = 9600;

function api(): ApiSerie | null {
  return typeof navigator !== "undefined" && "serial" in navigator ? ((navigator as unknown as { serial: ApiSerie }).serial ?? null) : null;
}

/** Vrai dans Chrome ou Edge sur ordinateur ; faux sur iPad, iPhone, Safari et Firefox. */
export function serieDisponible(): boolean {
  return api() !== null;
}

/** Ports déjà autorisés pour la caisse sur cet appareil (Chrome les garde d'une session à l'autre). */
export async function portsAutorises(): Promise<number> {
  return (await api()?.getPorts())?.length ?? 0;
}

/**
 * Fait choisir le port à la personne (fenêtre de Chrome, à ouvrir depuis un geste : un bouton).
 * Renvoie le rang du port parmi ceux autorisés, que la caisse garde pour les impressions suivantes.
 */
export async function choisirPort(): Promise<number> {
  const s = api();
  if (!s) throw new ErreurImpression("Ce navigateur ne sait pas imprimer sur un port série : utilisez Chrome ou Edge sur l'ordinateur de caisse.", "injoignable");
  const choisi = await s.requestPort();
  const ports = await s.getPorts();
  const rang = ports.indexOf(choisi);
  return rang < 0 ? ports.length - 1 : rang;
}

/**
 * Temps d'émission des octets sur la ligne série (10 bits par octet en 8N1), plus une marge, avant de refermer
 * le port : Chrome sous Windows abandonne ce qui n'est pas encore sorti à la fermeture (essai du 16 novembre
 * 2026 sur la dalle du Chardon : ticket tronqué au total).
 */
export function delaiVidange(nbOctets: number, bauds: number): number {
  return Math.ceil((nbOctets * 10 * 1000) / bauds) + 500;
}

/** File des impressions : le port ne s'ouvre qu'une fois à la fois. */
let file: Promise<unknown> = Promise.resolve();

/** Envoie des octets à l'imprimante série (port ouvert, réglé, écrit puis refermé). */
export function envoyerOctets(octets: Uint8Array, o: { rang: number; bauds?: number }): Promise<void> {
  const travail = file.then(() => ecrire(octets, o));
  file = travail.catch(() => undefined);
  return travail;
}

async function ecrire(octets: Uint8Array, o: { rang: number; bauds?: number }): Promise<void> {
  const s = api();
  if (!s) throw new ErreurImpression("Impression série impossible dans ce navigateur.", "injoignable");
  const ports = await s.getPorts();
  const port = ports[o.rang] ?? (ports.length === 1 ? ports[0] : undefined);
  if (!port) {
    throw new ErreurImpression("Port série de l'imprimante non autorisé : Réglages › Imprimante série › Choisir le port.", "injoignable");
  }
  try {
    await port.open({ baudRate: o.bauds ?? BAUDS_PAR_DEFAUT, dataBits: 8, stopBits: 1, parity: "none", flowControl: "none" });
  } catch (e) {
    throw new ErreurImpression(
      `Le port série ne s'ouvre pas (${e instanceof Error ? e.message : String(e)}) : un autre logiciel l'occupe peut-être (DominoFR doit être fermé).`,
      "injoignable",
    );
  }
  try {
    await port.setSignals({ dataTerminalReady: false, requestToSend: false });
    const writer = port.writable!.getWriter();
    try {
      await writer.write(octets);
      await writer.close();
      await new Promise((fin) => setTimeout(fin, delaiVidange(octets.length, o.bauds ?? BAUDS_PAR_DEFAUT)));
    } finally {
      writer.releaseLock();
    }
  } catch (e) {
    throw new ErreurImpression(`Impression série interrompue : ${e instanceof Error ? e.message : String(e)}.`, "refus");
  } finally {
    await port.close().catch(() => undefined);
  }
}

/** Imprime un reçu sur l'imprimante série (commandes ESC/POS, page PC858). */
export function envoyerSerie(r: Recu, o: { rang: number; bauds?: number; sansAccents: boolean; logo?: LogoRaster | null }): Promise<void> {
  return envoyerOctets(versEscPos(r, { sansAccents: o.sansAccents, logo: o.logo ?? null }), o);
}
