/** Identifiant d'un client créé sur cet appareil, même hors ligne : le serveur l'apprend par le ticket en compte. */
export function nouvelIdClient(): string {
  const octets = crypto.getRandomValues(new Uint8Array(4));
  return `cli-${[...octets].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}
