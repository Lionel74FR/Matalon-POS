// Prépare un serveur local vierge par l'API, comme le ferait l'administrateur :
// compte avec double authentification, responsable « Lionel » (PIN 1234), code de rattachement.
import { createHmac } from "node:crypto";

/** Code TOTP (RFC 6238), comme l'application d'authentification du téléphone. */
export function totp(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of secret.replace(/\s/g, "")) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const cle = Buffer.from(bits.match(/.{8}/g).map((o) => parseInt(o, 2)));
  const compteur = Buffer.alloc(8);
  compteur.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const mac = createHmac("sha1", cle).update(compteur).digest();
  const d = mac[19] & 15;
  return String((mac.readUInt32BE(d) & 0x7fffffff) % 1e6).padStart(6, "0");
}

export async function codeDeRattachement(url, nomCaisse = "iPhone") {
  let cookie = "";
  const appel = async (methode, chemin, corps) => {
    const r = await fetch(`${url}/api/admin${chemin}`, {
      method: methode,
      headers: { "Content-Type": "application/json", Origin: url, Cookie: cookie },
      body: corps ? JSON.stringify(corps) : undefined,
    });
    cookie = r.headers.get("set-cookie")?.split(";")[0] ?? cookie;
    const json = await r.json();
    if (!r.ok) throw new Error(`${chemin} : ${json.message}`);
    return json;
  };
  const acces = { identifiant: "lionel", motDePasse: "un-mot-de-passe-solide" };
  const { initialise } = await appel("GET", "/statut");
  if (!initialise) {
    const { secret } = await appel("POST", "/initialiser", acces);
    await appel("POST", "/confirmer", { ...acces, code: totp(secret) });
  } else {
    throw new Error("Serveur déjà initialisé : relancez scripts/serveur-local.mjs pour repartir d'une base vierge.");
  }
  await appel("POST", "/etablissements/moka/utilisateurs", { nom: "Lionel", role: "responsable", pin: "1234", actif: true });
  const { code } = await appel("POST", "/etablissements/moka/codes", { nomCaisse });
  return code;
}
