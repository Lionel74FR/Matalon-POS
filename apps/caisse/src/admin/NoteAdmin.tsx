import type { Ticket } from "@matalon/noyau-fiscal";
import { FileDown, Mail } from "lucide-react";
import { useState } from "react";
import { MODE_TEST } from "../fiscal/caisse";
import { noteDepuisTicket, urlNote } from "../note/format";
import { AvecIcone } from "../ui/icones";
import { api, type EtablissementAdmin } from "./api";

/**
 * Duplicata d'une note depuis l'administration (6 novembre 2026, demande de Lionel) : la note
 * dématérialisée, la même que celle du QR code et de l'e-mail de la caisse, s'ouvre prête à être
 * enregistrée en PDF, ou part par e-mail au client (le lien de la note). Le numéro de duplicata suit
 * ceux des appareils ; le serveur le garde et l'action entre au journal de l'administration. L'adresse
 * du client ne sert qu'à l'envoi.
 */
export function ActionsNoteAdmin(props: { e: EtablissementAdmin; ticket: Ticket; nomTable: string }) {
  const { e, ticket: t } = props;
  const [email, setEmail] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [message, setMessage] = useState<{ texte: string; erreur?: boolean } | null>(null);

  const url = (duplicata: number) =>
    urlNote(
      location.origin,
      noteDepuisTicket(t, {
        etablissement: e.identite,
        caisseId: t.caisseId,
        table: props.nomTable,
        serveur: e.utilisateurs.find((u) => u.id === t.operateurId)?.nom ?? t.operateurId ?? "",
        test: MODE_TEST,
        duplicata,
      }),
    );

  const pdf = async () => {
    // Ouverte tout de suite, au geste : sinon le navigateur bloque la fenêtre.
    const fenetre = window.open("", "_blank");
    setMessage(null);
    try {
      const { prochain } = await api.prochainDuplicata(e.id, t.caisseId, t.numero);
      await api.duplicataTicket(e.id, t.caisseId, t.numero, { canal: "pdf" }, prochain);
      const lien = url(prochain).replace("/n#", "/n?pdf=1#");
      if (fenetre) fenetre.location.href = lien;
      else window.open(lien, "_blank");
      setMessage({ texte: `Duplicata n° ${prochain} ouvert dans un nouvel onglet : choisissez « Enregistrer au format PDF ».` });
    } catch (x) {
      fenetre?.close();
      setMessage({ texte: x instanceof Error ? x.message : String(x), erreur: true });
    }
  };

  const envoyer = async () => {
    if (email == null) return;
    setEnCours(true);
    setMessage(null);
    try {
      const { prochain } = await api.prochainDuplicata(e.id, t.caisseId, t.numero);
      await api.duplicataTicket(e.id, t.caisseId, t.numero, { canal: "email", email: email.trim(), url: url(prochain) }, prochain);
      setMessage({ texte: `Duplicata n° ${prochain} envoyé à ${email.trim()}.` });
      setEmail(null);
    } catch (x) {
      setMessage({ texte: x instanceof Error ? x.message : String(x), erreur: true });
    } finally {
      setEnCours(false);
    }
  };

  return (
    <div className="note-admin">
      <div className="note-admin-actions">
        <button className="bouton" onClick={() => void pdf()}>
          <AvecIcone icone={FileDown}>Note en PDF</AvecIcone>
        </button>
        <button className="bouton" aria-expanded={email != null} onClick={() => setEmail((x) => (x == null ? "" : null))}>
          <AvecIcone icone={Mail}>Envoyer par e-mail</AvecIcone>
        </button>
      </div>
      {email != null && (
        <form
          className="note-email"
          onSubmit={(x) => {
            x.preventDefault();
            void envoyer();
          }}
        >
          <input type="email" autoComplete="off" aria-label="E-mail du client" placeholder="client@exemple.fr" value={email} onChange={(x) => setEmail(x.target.value)} autoFocus />
          <button className="bouton principal" disabled={enCours || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())}>
            <AvecIcone icone={Mail}>{enCours ? "Envoi…" : "Envoyer"}</AvecIcone>
          </button>
          <small>Le client reçoit le lien de sa note (duplicata). L'adresse ne sert qu'à cet envoi : elle n'est pas conservée.</small>
        </form>
      )}
      {message && (
        <p className={message.erreur ? "erreur" : "succes"} role="status">
          {message.texte}
        </p>
      )}
    </div>
  );
}
