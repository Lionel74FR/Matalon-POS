import { aligner, LARGEUR, type Recu } from "./recu";

const ENTITES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };
const echapper = (s: string) => s.replace(/[&<>"']/g, (c) => ENTITES[c]!);
const sansAccents = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’‘]/g, "'").replace(/[—–]/g, "-").replace(/€/g, "EUR");

const enveloppe = (contenu: string) =>
  '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>' +
  `<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">${contenu}</epos-print>` +
  "</s:Body></s:Envelope>";

/** Traduit un reçu en document ePOS-Print XML (imprimantes Epson TM, dont la TM-m30III). */
export function versEposXml(r: Recu, options: { sansAccents: boolean }): string {
  const t = (s: string) => echapper(options.sansAccents ? sansAccents(s) : s.replace(/[’‘]/g, "'"));
  const parties: string[] = ['<text lang="en" smooth="true"/>'];
  const style = (gras: boolean, grand: boolean) =>
    `<text em="${gras}" dw="${grand}" dh="${grand}"/>`;
  for (const e of r.elements) {
    switch (e.type) {
      case "texte": {
        const align = e.align === "centre" ? "center" : e.align === "droite" ? "right" : "left";
        parties.push(`<text align="${align}"/>`, style(e.gras, e.grand), `<text>${t(e.texte)}&#10;</text>`, '<text align="left"/>');
        break;
      }
      case "colonnes":
        parties.push(style(e.gras, e.grand));
        for (const l of aligner(e.gauche, e.droite, e.grand ? LARGEUR / 2 : LARGEUR)) parties.push(`<text>${t(l)}&#10;</text>`);
        break;
      case "filet":
        parties.push(style(false, false), `<text>${"-".repeat(LARGEUR)}&#10;</text>`);
        break;
      case "saut":
        parties.push(`<feed line="${e.lignes}"/>`);
        break;
      case "tiroir":
        parties.push('<pulse drawer="drawer_1" time="pulse_100"/>');
        break;
    }
  }
  // Une simple ouverture de tiroir ne consomme pas de papier.
  if (r.elements.some((e) => e.type !== "tiroir")) parties.push(style(false, false), '<feed line="3"/>', '<cut type="feed"/>');
  return enveloppe(parties.join(""));
}

/** Cause d'un échec de communication, pour orienter le diagnostic. */
export type CauseEchec =
  /** Refus immédiat du navigateur : certificat de l'imprimante pas encore accepté (le plus fréquent). */
  | "certificat"
  /** Aucune réponse : mauvaise adresse, imprimante éteinte ou sur un autre réseau. */
  | "injoignable"
  /** L'imprimante a répondu mais refusé (capot ouvert, papier…). */
  | "refus";

export class ErreurImpression extends Error {
  constructor(
    message: string,
    readonly cause_: CauseEchec,
  ) {
    super(message);
  }
}

export const ADRESSE_IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;


/** Bits d'état renvoyés par ePOS-Print (champ `status`). */
const ETATS: Array<[number, string]> = [
  [0x00000008, "imprimante hors ligne"],
  [0x00000020, "capot ouvert"],
  [0x00080000, "plus de papier"],
  [0x00000400, "erreur mécanique"],
  [0x00000800, "erreur du massicot"],
  [0x00002000, "erreur à redémarrer (éteindre puis rallumer)"],
];
const PAPIER_BIENTOT_FINI = 0x00020000;

export interface EtatImprimante {
  pret: boolean;
  problemes: string[];
  papierBientotFini: boolean;
}

/** Interprète la réponse XML d'ePOS-Print. */
export function lireReponse(xml: string): EtatImprimante & { succes: boolean; code: string } {
  const succes = /success="true"/.test(xml);
  const code = /code="([^"]*)"/.exec(xml)?.[1] ?? "";
  const status = Number(/status="(\d+)"/.exec(xml)?.[1] ?? 0);
  const problemes = ETATS.filter(([bit]) => (status & bit) !== 0).map(([, libelle]) => libelle);
  const motifs: Record<string, string> = {
    EPTR_COVER_OPEN: "capot ouvert",
    EPTR_REC_EMPTY: "plus de papier",
    EPTR_AUTOMATICAL: "erreur de coupe",
    EX_TIMEOUT: "délai dépassé",
    DeviceNotFound: "service d'impression introuvable sur l'imprimante",
  };
  if (!succes && code && !problemes.length) problemes.push(motifs[code] ?? code);
  return { succes, code, pret: succes && problemes.length === 0, problemes, papierBientotFini: (status & PAPIER_BIENTOT_FINI) !== 0 };
}

async function poster(adresse: string, corps: string, delaiMs = 10_000): Promise<string> {
  const url = `https://${adresse}/cgi-bin/epos/service.cgi?devid=local_printer&timeout=${delaiMs}`;
  const controle = new AbortController();
  const minuterie = setTimeout(() => controle.abort(), delaiMs + 2_000);
  const debut = Date.now();
  try {
    const reponse = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        "If-Modified-Since": "Thu, 01 Jan 1970 00:00:00 GMT",
        SOAPAction: '""',
      },
      body: corps,
      signal: controle.signal,
    });
    return await reponse.text();
  } catch {
    // Un refus en moins de 3 secondes vient du navigateur (certificat), pas du réseau.
    const rapide = Date.now() - debut < 3_000 && !controle.signal.aborted;
    throw rapide
      ? new ErreurImpression(
          `L'iPad refuse la connexion sécurisée à l'imprimante (${adresse}) : son certificat n'a pas encore été accepté.`,
          "certificat",
        )
      : new ErreurImpression(
          `Imprimante injoignable à ${adresse}. Vérifiez qu'elle est allumée et sur le même réseau que l'iPad.`,
          "injoignable",
        );
  } finally {
    clearTimeout(minuterie);
  }
}

/** Interroge l'imprimante sans rien imprimer. */
export async function testerEpson(adresse: string): Promise<EtatImprimante> {
  const etat = lireReponse(await poster(adresse, enveloppe(""), 5_000));
  return etat;
}

/**
 * Envoie un reçu à l'imprimante par le service ePOS-Print intégré.
 * L'app étant servie en HTTPS, l'imprimante doit l'être aussi : son
 * certificat est accepté une fois, avec l'assistant de connexion.
 */
export async function envoyerEpson(adresse: string, r: Recu, options: { sansAccents: boolean }): Promise<void> {
  const etat = lireReponse(await poster(adresse, versEposXml(r, options)));
  if (!etat.succes || etat.problemes.length) {
    throw new ErreurImpression(`Impression refusée par l'imprimante : ${etat.problemes.join(", ") || "motif inconnu"}.`, "refus");
  }
}
