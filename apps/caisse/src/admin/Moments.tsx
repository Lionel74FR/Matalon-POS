import { MOMENTS_MAX, problemeMoments, type MomentJournee } from "@matalon/serveur/partage";
import { Plus, Save, Trash2 } from "lucide-react";
import { useState } from "react";
import { Modale } from "../ui/communs";
import { AvecIcone, BoutonIcone } from "../ui/icones";
import { api } from "./api";

/** Proposition de départ, à ajuster : la journée de service va de 8 h à 3 h du matin. */
const PROPOSITION: Array<Omit<MomentJournee, "id">> = [
  { nom: "Matin", debut: "08:00", fin: "12:00" },
  { nom: "Après-midi", debut: "12:00", fin: "18:00" },
  { nom: "Soir", debut: "18:00", fin: "03:00" },
];

/**
 * Moments de la journée d'un établissement (matin, midi, soir…) : une plage horaire chacun,
 * qui peut passer minuit, sans chevauchement. Ils regroupent le CA dans les statistiques,
 * ventes passées comprises (le regroupement se calcule à la lecture).
 */
export function ModaleMoments(props: { etablissementId: string; moments: MomentJournee[]; onEnregistre: () => Promise<void> | void; onFermer: () => void }) {
  const proposition = props.moments.length === 0;
  const [moments, setMoments] = useState<MomentJournee[]>(() =>
    proposition ? PROPOSITION.map((m) => ({ ...m, id: crypto.randomUUID() })) : props.moments.map((m) => ({ ...m })),
  );
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const probleme = problemeMoments(moments);
  const maj = (id: string, champ: "nom" | "debut" | "fin", valeur: string) => setMoments((l) => l.map((m) => (m.id === id ? { ...m, [champ]: valeur } : m)));

  const enregistrer = async () => {
    setEnCours(true);
    try {
      await api.majMoments(props.etablissementId, moments.map((m) => ({ ...m, nom: m.nom.trim() })));
      await props.onEnregistre();
      props.onFermer();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setEnCours(false);
    }
  };

  return (
    <Modale
      titre="Moments de la journée"
      large
      onFermer={props.onFermer}
      pied={
        <>
          <button className="bouton" onClick={props.onFermer}>
            Annuler
          </button>
          <button className="bouton principal" disabled={!!probleme || enCours} onClick={() => void enregistrer()}>
            <AvecIcone icone={Save}>{enCours ? "Enregistrement…" : "Enregistrer les moments"}</AvecIcone>
          </button>
        </>
      }
    >
      <p className="explication">
        Chaque moment regroupe le CA encaissé entre son début et sa fin (heure de Paris, fin exclue). Un moment peut passer minuit
        (Soir de 18:00 à 03:00) ; deux moments ne se chevauchent pas. Les statistiques les appliquent aussi aux ventes déjà faites ; une
        vente hors de tout moment apparaît sous « Hors moments ».
      </p>
      {proposition && <p className="admin-ok">Proposition de départ : ajustez les noms et les horaires, puis enregistrez.</p>}
      <ul className="moments-liste" role="list">
        {moments.map((m) => (
          <li key={m.id} className="moments-ligne">
            <label className="champ">
              <span>Nom</span>
              <input value={m.nom} maxLength={30} onChange={(e) => maj(m.id, "nom", e.target.value)} aria-label="Nom du moment" />
            </label>
            <label className="champ">
              <span>De</span>
              <input type="time" step={300} value={m.debut} onChange={(e) => maj(m.id, "debut", e.target.value)} aria-label={`${m.nom || "Moment"} : début`} />
            </label>
            <label className="champ">
              <span>À</span>
              <input type="time" step={300} value={m.fin} onChange={(e) => maj(m.id, "fin", e.target.value)} aria-label={`${m.nom || "Moment"} : fin`} />
            </label>
            <BoutonIcone icone={Trash2} variante="discret" libelle={`Retirer ${m.nom || "ce moment"}`} onClick={() => setMoments((l) => l.filter((x) => x.id !== m.id))} />
          </li>
        ))}
      </ul>
      <button
        className="bouton"
        disabled={moments.length >= MOMENTS_MAX}
        onClick={() => setMoments((l) => [...l, { id: crypto.randomUUID(), nom: "", debut: l.at(-1)?.fin ?? "08:00", fin: "" }])}
      >
        <AvecIcone icone={Plus}>Ajouter un moment</AvecIcone>
      </button>
      {probleme && moments.length > 0 && <p className="erreur">{probleme}</p>}
      {erreur && <p className="erreur">{erreur}</p>}
    </Modale>
  );
}
