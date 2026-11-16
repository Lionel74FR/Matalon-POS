import { afterEach, describe, expect, it, vi } from "vitest";
import { envoyerReseau, etatScriptReseau } from "../src/impression/reseau";

/** Imprimante réseau des additions par le script de la dalle (16 novembre 2026, backlog n° 5). */
describe("script d'impression réseau de la dalle", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("envoie les octets au script local avec l'adresse et le port de l'imprimante", async () => {
    const appels: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      appels.push({ url, init });
      return new Response('{"ok":true}', { status: 200 });
    });
    await envoyerReseau(Uint8Array.from([27, 64, 29, 86, 0]), "192.168.1.248");
    expect(appels[0]!.url).toBe("http://127.0.0.1:9181/imprimer?ip=192.168.1.248&port=9100");
    expect(appels[0]!.init.method).toBe("POST");
    expect([...new Uint8Array(await (appels[0]!.init.body as Blob).arrayBuffer())]).toEqual([27, 64, 29, 86, 0]);
  });

  it("dit quand le script ne répond pas, ou quand l'imprimante est injoignable", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(envoyerReseau(Uint8Array.from([1]), "192.168.1.248")).rejects.toThrow(/Script d'impression réseau injoignable/);
    expect(await etatScriptReseau()).toBeNull();
    vi.stubGlobal("fetch", async () => new Response(`{"erreur":"L'imprimante 192.168.1.248 ne repond pas."}`, { status: 502 }));
    await expect(envoyerReseau(Uint8Array.from([1]), "192.168.1.248")).rejects.toThrow("Imprimante 192.168.1.248 : L'imprimante 192.168.1.248 ne repond pas.");
    vi.stubGlobal("fetch", async () => new Response('{"ok":true,"version":1}', { status: 200 }));
    expect(await etatScriptReseau()).toBe(1);
  });
});
