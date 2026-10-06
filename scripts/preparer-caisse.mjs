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
  return (await preparerServeur(url, nomCaisse)).code;
}

/** Serveur vierge prêt à l'emploi : renvoie le code de rattachement et le cookie de session administrateur. */
export async function preparerServeur(url, nomCaisse = "iPad") {
  let cookie = "";
  const appel = async (methode, chemin, corps) => {
    const r = await fetch(`${url}/api/admin${chemin}`, {
      method: methode,
      headers: { "Content-Type": "application/json", Origin: url, Cookie: cookie },
      body: corps ? JSON.stringify(corps) : undefined,
    });
    cookie = r.headers.get("set-cookie")?.split(";")[0] ?? cookie;
    const json = (r.headers.get("content-type") ?? "").includes("json") ? await r.json() : await r.text();
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
  await appel("PUT", "/etablissements/moka", {
    identite: {
      enseigne: "Moka",
      raisonSociale: "SAS Moka Annecy",
      adresse: "6 rue Vaugelas",
      codePostalVille: "74000 Annecy",
      telephone: "04 56 19 02 68",
      siret: "12345678900012",
      tvaIntracom: "FR12123456789",
      mentionsLegales: "SAS au capital de 10 000 € · RCS Annecy 123 456 789",
    },
    tables: Array.from({ length: 12 }, (_, i) => ({ id: `t${i + 1}`, nom: String(i + 1), zone: "Salle" })),
    seuilNote: 2500,
  });
  await appel("POST", "/etablissements/moka/utilisateurs", { nom: "Lionel", role: "responsable", pin: "1234", actif: true });
  const { code } = await appel("POST", "/etablissements/moka/codes", { nomCaisse });
  return { code, cookie, appel };
}
