import { versTexte, type Recu } from "../../impression/recu";
import { Modale } from "../communs";

/** Aperçu d'un reçu à l'écran : sans imprimante configurée, ou quand l'impression a échoué. */
export function ModaleApercu(props: { recu: Recu; titre: string; erreur?: string; onFermer: () => void }) {
  return (
    <Modale titre={props.titre} onFermer={props.onFermer} pied={<button className="bouton" onClick={props.onFermer}>Fermer</button>}>
      {props.erreur ? (
        <p className="erreur">{props.erreur}</p>
      ) : (
        <p className="explication">Aucune imprimante configurée : aperçu à l'écran.</p>
      )}
      <pre className="apercu-recu">{versTexte(props.recu).join("\n")}</pre>
    </Modale>
  );
}
