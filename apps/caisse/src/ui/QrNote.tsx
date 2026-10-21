import type { Ticket } from "@matalon/noyau-fiscal";
import QRCode from "qrcode";
import { Mail } from "lucide-react";
import { useEffect, useState } from "react";
import { useCaisse } from "./contexte";
import { AvecIcone } from "./icones";
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

/**
 * Note envoyée par e-mail : le client donne son adresse, il reçoit le lien de sa note (la même
 * que celle du QR code). L'adresse ne sert qu'à cet envoi ; `onEnvoyee` journalise l'envoi.
 */
export function NoteParEmail(props: { ticket: Ticket; url: string; onEnvoyee: () => Promise<unknown> | void; ouvert?: boolean }) {
  const { caisse, notifier } = useCaisse();
  const [ouvert, setOuvert] = useState(props.ouvert ?? false);
  const [email, setEmail] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState("");
  const [envoyee, setEnvoyee] = useState("");
  if (envoyee) return <p className="note-email-ok">Note envoyée à {envoyee}.</p>;
  if (!ouvert)
    return (
      <button type="button" className="bouton" onClick={() => setOuvert(true)}>
        <AvecIcone icone={Mail}>Par e-mail</AvecIcone>
      </button>
    );
  const envoyer = async () => {
    setEnCours(true);
    setErreur("");
    try {
      await caisse.client.envoyerNoteEmail({ email: email.trim(), url: props.url, numero: props.ticket.numero, totalTTC: props.ticket.totalTTC, horodatage: props.ticket.horodatage });
      await props.onEnvoyee();
      setEnvoyee(email.trim());
      notifier(`Note n° ${props.ticket.numero} envoyée par e-mail.`);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setEnCours(false);
    }
  };
  return (
    <form
      className="note-email"
      onSubmit={(e) => {
        e.preventDefault();
        void envoyer();
      }}
    >
      <input type="email" inputMode="email" autoComplete="off" aria-label="E-mail du client" placeholder="client@exemple.fr" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
      <button className="bouton principal" disabled={enCours || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())}>
        <AvecIcone icone={Mail}>{enCours ? "Envoi…" : "Envoyer"}</AvecIcone>
      </button>
      <small>L'adresse ne sert qu'à cet envoi : elle n'est pas conservée.</small>
      {erreur && <p className="erreur">{erreur}</p>}
    </form>
  );
}
