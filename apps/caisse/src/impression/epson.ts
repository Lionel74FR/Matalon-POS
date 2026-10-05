import { aligner, LARGEUR, type Recu } from "./recu";

const ENTITES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };
const echapper = (s: string) => s.replace(/[&<>"']/g, (c) => ENTITES[c]!);
const sansAccents = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’‘]/g, "'").replace(/[—–]/g, "-").replace(/€/g, "EUR");

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
  return (
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>' +
    `<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">${parties.join("")}</epos-print>` +
    "</s:Body></s:Envelope>"
  );
}

export class ErreurImpression extends Error {}

/**
 * Envoie un reçu à l'imprimante par le service ePOS-Print intégré.
 * L'app étant servie en HTTPS, l'imprimante doit l'être aussi : ouvrir une
 * fois https://<adresse> dans Safari sur l'iPad et accepter son certificat.
 */
export async function envoyerEpson(adresse: string, r: Recu, options: { sansAccents: boolean }): Promise<void> {
  const url = `https://${adresse}/cgi-bin/epos/service.cgi?devid=local_printer&timeout=10000`;
  const controle = new AbortController();
  const minuterie = setTimeout(() => controle.abort(), 12_000);
  let reponse: Response;
  try {
    reponse = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        "If-Modified-Since": "Thu, 01 Jan 1970 00:00:00 GMT",
        SOAPAction: '""',
      },
      body: versEposXml(r, options),
      signal: controle.signal,
    });
  } catch {
    throw new ErreurImpression(
      `Imprimante injoignable à ${adresse}. Vérifiez qu'elle est allumée, sur le même Wi-Fi, et que son certificat a été accepté dans Safari.`,
    );
  } finally {
    clearTimeout(minuterie);
  }
  const corps = await reponse.text();
  if (!reponse.ok || !/success="true"/.test(corps)) {
    const code = /code="([^"]*)"/.exec(corps)?.[1];
    const motifs: Record<string, string> = {
      EPTR_COVER_OPEN: "capot ouvert",
      EPTR_REC_EMPTY: "plus de papier",
      EX_TIMEOUT: "délai dépassé",
      EPTR_AUTOMATICAL: "erreur de coupe",
    };
    throw new ErreurImpression(`Impression refusée par l'imprimante${code ? ` : ${motifs[code] ?? code}` : ""}.`);
  }
}
