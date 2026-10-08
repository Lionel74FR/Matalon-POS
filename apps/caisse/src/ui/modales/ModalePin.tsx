import { useEffect, useState } from "react";
import { verifierPin, type Utilisateur } from "../../donnees/configuration";
import type { Caisse } from "../../fiscal/caisse";
import { BLOCAGE_PIN_MS, ESSAIS_PIN, effacerEchecsPin, lireEtatPin, noterEchecPin } from "../../donnees/verrou-pin";
import { Modale, Pave } from "../communs";

/** Blocage tracé au journal (événement ANOMALIE) : il remonte en alerte dans l'administration. */
export function journaliserBlocagePin(caisse: Caisse, u: Utilisateur, contexte: "connexion" | "validation") {
  return caisse.registre
    .journaliser("ANOMALIE", { type: "PIN_BLOQUE", utilisateur: u.id, nom: u.nom, contexte, minutes: BLOCAGE_PIN_MS / 60_000 }, null)
    .catch(() => undefined);
}

const heure = (ms: number) => new Date(ms).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

/**
 * Saisie du code PIN à 4 chiffres d'un utilisateur ; vérifie dès le 4e
 * chiffre. Au 5e code faux de suite, la personne est bloquée 5 minutes sur
 * cet appareil (`onBloque` : le blocage est tracé au journal).
 */
export function SaisiePin(props: { utilisateur: Utilisateur; onValide: (u: Utilisateur, pin: string) => void; onBloque?: (u: Utilisateur) => void }) {
  const [pin, setPin] = useState("");
  const [erreur, setErreur] = useState("");
  const [verification, setVerification] = useState(false);
  const [bloqueJusqua, setBloqueJusqua] = useState(() => lireEtatPin(props.utilisateur.id).bloqueJusqua);

  // Fin du blocage : le pavé se rouvre de lui-même.
  useEffect(() => {
    if (bloqueJusqua == null) return;
    const t = setTimeout(() => {
      setBloqueJusqua(null);
      setErreur("");
    }, Math.max(0, bloqueJusqua - Date.now()) + 200);
    return () => clearTimeout(t);
  }, [bloqueJusqua]);

  const toucher = async (t: string) => {
    if (verification || bloqueJusqua != null) return;
    setErreur("");
    if (t === "effacer") return setPin((p) => p.slice(0, -1));
    const suivant = (pin + t).slice(0, 4);
    setPin(suivant);
    if (suivant.length === 4) {
      setVerification(true);
      const ok = await verifierPin(props.utilisateur, suivant);
      setVerification(false);
      setPin("");
      if (ok) {
        effacerEchecsPin(props.utilisateur.id);
        props.onValide(props.utilisateur, suivant);
        return;
      }
      const e = noterEchecPin(props.utilisateur.id);
      if (e.bloque) {
        setBloqueJusqua(e.bloqueJusqua);
        props.onBloque?.(props.utilisateur);
      } else {
        const restants = ESSAIS_PIN - e.echecs;
        setErreur(`Code incorrect. ${restants} essai${restants > 1 ? "s" : ""} avant blocage.`);
      }
    }
  };

  return (
    <div className={`saisie-pin${bloqueJusqua != null ? " bloquee" : ""}`}>
      <div className="pin-points" aria-label={`${pin.length} chiffres saisis sur 4`}>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={i < pin.length ? "plein" : ""} />
        ))}
      </div>
      <p className="erreur" aria-live="assertive">
        {bloqueJusqua != null ? `${ESSAIS_PIN} codes faux : ${props.utilisateur.nom} est bloqué jusqu'à ${heure(bloqueJusqua)}.` : erreur}
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
  onValide: (u: Utilisateur, pin: string) => void;
  onBloque?: (u: Utilisateur) => void;
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
      {choisi && <SaisiePin key={choisi.id} utilisateur={choisi} onValide={props.onValide} {...(props.onBloque ? { onBloque: props.onBloque } : {})} />}
    </Modale>
  );
}
