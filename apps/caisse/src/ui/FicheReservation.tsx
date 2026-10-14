import type { Reservation, StatutReservation } from "@matalon/reservations";
import { CalendarCheck, Save, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Modale } from "./communs";
import { AvecIcone } from "./icones";

/** Fiche d'une réservation, commune à l'administration et à la caisse. */

export const LIBELLES_STATUT: Record<StatutReservation, string> = { confirmee: "Confirmée", arrivee: "Arrivée", absente: "Absente", annulee: "Annulée" };
export const LIBELLES_SOURCE: Record<Reservation["source"], string> = { en_ligne: "en ligne", telephone: "téléphone", sur_place: "sur place" };

/** Réservations « à venir » : la fenêtre de réservation en ligne, au moins 60 jours. */
export const JOURS_A_VENIR = (r: { horizonJours: number }) => Math.max(60, r.horizonJours);

export const decaler = (jour: string, n: number) => {
  const d = new Date(`${jour}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const dateLongue = (jour: string) =>
  new Date(`${jour}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** Conflit de capacité (409) : l'équipe peut passer outre, en connaissance de cause. */
const estConflit = (e: unknown) => typeof e === "object" && e !== null && (e as { statut?: unknown }).statut === 409;

/**
 * Fiche d'une réservation : date, heure, personnes, durée, coordonnées, note ;
 * annulation (le client est prévenu par e-mail s'il en a laissé un) ou rétablissement ; historique.
 */
export function FicheReservation(props: {
  reservation: Reservation;
  modifier: (corps: Record<string, unknown>) => Promise<void>;
  onFermer: () => void;
  onFaite: () => void;
}) {
  const r = props.reservation;
  const [f, setF] = useState({
    date: r.date,
    heure: r.heure,
    couverts: String(r.couverts),
    dureeMinutes: String(r.dureeMinutes),
    prenom: r.prenom,
    nom: r.nom,
    telephone: r.telephone,
    email: r.email ?? "",
    commentaire: r.commentaire ?? "",
  });
  const [erreur, setErreur] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const maj = (cle: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [cle]: e.target.value }));

  const envoyer = async (corps: Record<string, unknown>) => {
    setEnvoi(true);
    setErreur("");
    try {
      try {
        await props.modifier(corps);
      } catch (e) {
        if (estConflit(e) && window.confirm(message(e))) await props.modifier({ ...corps, forcer: true });
        else throw e;
      }
      props.onFaite();
    } catch (e) {
      setErreur(message(e));
    } finally {
      setEnvoi(false);
    }
  };

  const enregistrer = (e: FormEvent) => {
    e.preventDefault();
    const corps: Record<string, unknown> = {};
    if (f.date !== r.date) corps.date = f.date;
    if (f.heure !== r.heure) corps.heure = f.heure;
    if (Number(f.couverts) !== r.couverts) corps.couverts = Number(f.couverts);
    if (Number(f.dureeMinutes) !== r.dureeMinutes) corps.dureeMinutes = Number(f.dureeMinutes);
    for (const c of ["prenom", "nom", "telephone", "email", "commentaire"] as const) if (f[c].trim() !== (r[c] ?? "")) corps[c] = f[c];
    if (Object.keys(corps).length === 0) return props.onFermer();
    void envoyer(corps);
  };

  const annuler = () => {
    if (!window.confirm(`Annuler la réservation de ${r.prenom} ${r.nom} (${dateLongue(r.date)}, ${r.heure}, ${r.couverts} pers.) ?${r.email ? " Le client est prévenu par e-mail." : ""}`)) return;
    void envoyer({ statut: "annulee" });
  };

  const active = r.statut === "confirmee" || r.statut === "arrivee";
  return (
    <Modale
      titre={`Réservation de ${r.prenom} ${r.nom}`}
      large
      onFermer={props.onFermer}
      pied={
        <>
          {active ? (
            <button className="bouton danger" disabled={envoi} onClick={annuler}>
              <AvecIcone icone={X}>Annuler la réservation</AvecIcone>
            </button>
          ) : (
            <button className="bouton" disabled={envoi} onClick={() => void envoyer({ statut: "confirmee" })}>
              <AvecIcone icone={CalendarCheck}>Rétablir la réservation</AvecIcone>
            </button>
          )}
          <button className="bouton principal" type="submit" form="edition-resa" disabled={envoi}>
            <AvecIcone icone={Save}>Enregistrer</AvecIcone>
          </button>
        </>
      }
    >
      <form id="edition-resa" className="resa-saisie" onSubmit={enregistrer}>
        <label className="champ">
          <span>Date</span>
          <input type="date" value={f.date} onChange={maj("date")} required />
        </label>
        <label className="champ">
          <span>Heure</span>
          <input type="time" step={900} value={f.heure} onChange={maj("heure")} required />
        </label>
        <label className="champ">
          <span>Personnes</span>
          <input type="number" min={1} max={200} value={f.couverts} onChange={maj("couverts")} required />
        </label>
        <label className="champ">
          <span>Durée (min)</span>
          <input type="number" min={15} max={480} step={5} value={f.dureeMinutes} onChange={maj("dureeMinutes")} required />
        </label>
        <label className="champ">
          <span>Prénom</span>
          <input value={f.prenom} onChange={maj("prenom")} required maxLength={60} />
        </label>
        <label className="champ">
          <span>Nom</span>
          <input value={f.nom} onChange={maj("nom")} required maxLength={60} />
        </label>
        <label className="champ">
          <span>Téléphone</span>
          <input type="tel" value={f.telephone} onChange={maj("telephone")} required />
        </label>
        <label className="champ">
          <span>E-mail</span>
          <input type="email" value={f.email} onChange={maj("email")} />
        </label>
        <label className="champ resa-large">
          <span>Note</span>
          <input value={f.commentaire} onChange={maj("commentaire")} maxLength={500} />
        </label>
      </form>
      <p className="explication">
        Statut : {LIBELLES_STATUT[r.statut]} · prise {LIBELLES_SOURCE[r.source]}
        {r.email ? " · un changement de date ou d'heure renvoie la confirmation au client" : ""}.
      </p>
      {erreur && <p className="erreur">{erreur}</p>}
      <details className="resa-historique">
        <summary>Historique</summary>
        <ul>
          {r.historique.map((h, i) => (
            <li key={i}>
              {new Date(h.le).toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" })} · {h.par} · {h.action}
            </li>
          ))}
        </ul>
      </details>
    </Modale>
  );
}
