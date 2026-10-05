import { useState } from "react";
import { verifierPin, type Utilisateur } from "../../donnees/configuration";
import { Modale, Pave } from "../communs";

/** Saisie du code PIN à 4 chiffres d'un utilisateur ; vérifie dès le 4e chiffre. */
export function SaisiePin(props: { utilisateur: Utilisateur; onValide: (u: Utilisateur) => void }) {
  const [pin, setPin] = useState("");
  const [erreur, setErreur] = useState("");
  const [verification, setVerification] = useState(false);

  const toucher = async (t: string) => {
    if (verification) return;
    setErreur("");
    if (t === "effacer") return setPin((p) => p.slice(0, -1));
    const suivant = (pin + t).slice(0, 4);
    setPin(suivant);
    if (suivant.length === 4) {
      setVerification(true);
      const ok = await verifierPin(props.utilisateur, suivant);
      setVerification(false);
      if (ok) props.onValide(props.utilisateur);
      else {
        setErreur("Code incorrect, réessayez.");
        setPin("");
      }
    }
  };

  return (
    <div className="saisie-pin">
      <div className="pin-points" aria-label={`${pin.length} chiffres saisis sur 4`}>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={i < pin.length ? "plein" : ""} />
        ))}
      </div>
      <p className="erreur" aria-live="assertive">
        {erreur}
      </p>
      <Pave onTouche={(t) => void toucher(t)} />
    </div>
  );
}

/** Validation par un responsable choisi dans la liste. */
export function ModalePin(props: {
  titre: string;
  raison: string;
  utilisateurs: Utilisateur[];
  onValide: (u: Utilisateur) => void;
  onAnnuler: () => void;
}) {
  const actifs = props.utilisateurs.filter((u) => u.actif);
  const [choisi, setChoisi] = useState<Utilisateur | null>(actifs.length === 1 ? actifs[0]! : null);

  return (
    <Modale titre={props.titre} onFermer={props.onAnnuler}>
      <p className="explication">{props.raison}</p>
      <div className="choix-personnes">
        {actifs.map((u) => (
          <button key={u.id} className={`pastille${choisi?.id === u.id ? " active" : ""}`} onClick={() => setChoisi(u)}>
            {u.nom}
          </button>
        ))}
      </div>
      {choisi && <SaisiePin key={choisi.id} utilisateur={choisi} onValide={props.onValide} />}
    </Modale>
  );
}
