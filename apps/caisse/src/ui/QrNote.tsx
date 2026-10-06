import type { Ticket } from "@matalon/noyau-fiscal";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import type { Configuration } from "../donnees/configuration";
import { MODE_TEST } from "../fiscal/caisse";
import { nomTable, nomUtilisateur } from "../impression/gabarits";
import { noteDepuisTicket, urlNote } from "../note/format";

export function urlNoteTicket(ticket: Ticket, config: Configuration, duplicata = 0): string {
  return urlNote(
    location.origin,
    noteDepuisTicket(ticket, {
      etablissement: config.etablissement,
      caisseId: config.caisseId,
      table: nomTable(config, ticket.tableId),
      serveur: nomUtilisateur(config, ticket.operateurId),
      test: MODE_TEST,
      duplicata,
    }),
  );
}

/** QR code de la note, généré sur l'iPad (aucun réseau nécessaire). */
export function QrNote(props: { url: string; legende?: string }) {
  const [svg, setSvg] = useState("");
  useEffect(() => {
    let actif = true;
    void QRCode.toString(props.url, {
      type: "svg",
      errorCorrectionLevel: props.url.length > 1200 ? "L" : "M",
      margin: 2,
      color: { dark: "#2b1e18", light: "#ffffff" },
    }).then((s) => actif && setSvg(s));
    return () => {
      actif = false;
    };
  }, [props.url]);
  return (
    <figure className="qr-note">
      <div className="qr" role="img" aria-label="QR code de la note client" dangerouslySetInnerHTML={{ __html: svg }} />
      <figcaption>{props.legende ?? "Le client scanne pour récupérer sa note"}</figcaption>
    </figure>
  );
}
