import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { httpPossible, oublierProtocoles, testerEpson } from "../src/impression/epson";

// Epson jointe en http depuis un ordinateur (17 novembre 2026, Chardon : bandeau « Non sécurisé »
// de Chrome dû au certificat maison de l'imprimante). iPad et iPhone restent en https.

const OK = '<response success="true" code="" status="251658262"/>';
const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";
const IPAD = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

function navigateur(userAgent: string, maxTouchPoints: number, serial: boolean) {
  vi.stubGlobal("navigator", { userAgent, maxTouchPoints, ...(serial ? { serial: {} } : {}) });
}

describe("protocole de l'Epson", () => {
  beforeEach(() => oublierProtocoles());
  afterEach(() => vi.unstubAllGlobals());

  it("http seulement sur un ordinateur avec Chrome (Web Serial), jamais sur iPad ni iPhone", () => {
    expect(httpPossible({ userAgent: WINDOWS, maxTouchPoints: 0, serial: {} })).toBe(true);
    expect(httpPossible({ userAgent: WINDOWS, maxTouchPoints: 0 })).toBe(false);
    expect(httpPossible({ userAgent: IPAD, maxTouchPoints: 5 })).toBe(false);
    expect(httpPossible({ userAgent: IPAD, maxTouchPoints: 5, serial: {} })).toBe(false);
  });

  it("iPad : https directement, comme avant", async () => {
    navigateur(IPAD, 5, false);
    const appels: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => (appels.push(url), new Response(OK)));
    await testerEpson("192.168.1.50");
    expect(appels).toEqual(["https://192.168.1.50/cgi-bin/epos/service.cgi?devid=local_printer&timeout=5000"]);
  });

  it("ordinateur : http d'abord, avec l'accès au réseau local, et retenu pour la suite", async () => {
    navigateur(WINDOWS, 0, true);
    const appels: [string, unknown][] = [];
    vi.stubGlobal("fetch", async (url: string, init: { targetAddressSpace?: string }) => (appels.push([url, init.targetAddressSpace]), new Response(OK)));
    await testerEpson("192.168.1.50");
    await testerEpson("192.168.1.50");
    expect(appels.map(([u, t]) => [u.split("/cgi-bin")[0], t])).toEqual([
      ["http://192.168.1.50", "local"],
      ["http://192.168.1.50", "local"],
    ]);
  });

  it("ordinateur : http refusé d'emblée, alors https, retenu pour la suite", async () => {
    navigateur(WINDOWS, 0, true);
    const appels: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      appels.push(url.split("/cgi-bin")[0]!);
      if (url.startsWith("http:")) throw new TypeError("Failed to fetch");
      return new Response(OK);
    });
    expect((await testerEpson("192.168.1.51")).pret).toBe(true);
    await testerEpson("192.168.1.51");
    expect(appels).toEqual(["http://192.168.1.51", "https://192.168.1.51", "https://192.168.1.51"]);
  });
});
