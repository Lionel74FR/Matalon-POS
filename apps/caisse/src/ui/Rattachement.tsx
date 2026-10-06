import { Link } from "lucide-react";
import { AvecIcone } from "./icones";
import { NOM_APPAREIL } from "../donnees/appareil";
import { normaliserCode } from "@matalon/serveur/partage";
import { useState } from "react";
import type { BaseCaisse, ConnexionServeur } from "../donnees/base";
import { MODE_TEST, rattacher, type Caisse } from "../fiscal/caisse";
import { ErreurApi } from "../serveur/client";

/**
 * Mise en service d'un iPad : il suffit du code de rattachement généré dans
 * l'administration. L'établissement, son équipe et sa carte arrivent du serveur.
 */
export function Rattachement(props: { db: BaseCaisse; onRattachee: (c: Caisse, connexion: ConnexionServeur) => void }) {
  const [saisie, setSaisie] = useState("");
  const [erreur, setErreur] = useState("");
  const [enCours, setEnCours] = useState(false);
  const code = normaliserCode(saisie).slice(0, 8);

  const valider = async () => {
    if (code.length !== 8) return setErreur("Le code compte 8 caractères, par exemple K7PM-3QXA.");
    setEnCours(true);
    setErreur("");
    try {
      const { caisse, connexion } = await rattacher(props.db, code);
      props.onRattachee(caisse, connexion);
    } catch (e) {
      setErreur(e instanceof ErreurApi || e instanceof Error ? e.message : String(e));
      setEnCours(false);
    }
  };

  return (
    <div className="ecran-rattachement">
      <section className="connexion-marque">
        <img src="/icone.svg" alt="" width={96} height={96} />
        <h1>Matalon POS</h1>
        <p>{MODE_TEST ? "Caisse de test" : `Mise en service de l'${NOM_APPAREIL}`}</p>
      </section>
      <section className="rattachement-panneau">
        <h2>Rattacher cet {NOM_APPAREIL} à un établissement</h2>
        <ol className="etapes-rattachement">
          <li>
            Sur un ordinateur, ouvrez <strong>{location.host}/admin</strong> et connectez-vous.
          </li>
          <li>
            Choisissez l'établissement, puis <strong>Rattacher un iPad ou un iPhone</strong>. Un code valable 48 heures s'affiche.
          </li>
          <li>Saisissez ce code ci-dessous. L'{NOM_APPAREIL} reçoit l'établissement, l'équipe et la carte.</li>
        </ol>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void valider();
          }}
        >
          <label className="champ-code">
            <span>Code de rattachement</span>
            <input
              value={code.length > 4 ? `${code.slice(0, 4)}-${code.slice(4)}` : code}
              onChange={(e) => setSaisie(e.target.value)}
              placeholder="XXXX-XXXX"
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              maxLength={9}
              aria-describedby="erreur-rattachement"
            />
          </label>
          <p id="erreur-rattachement" className="erreur" aria-live="assertive">
            {erreur}
          </p>
          <button className="bouton principal grand" disabled={enCours || code.length !== 8}>
            <AvecIcone icone={Link}>{enCours ? "Rattachement…" : `Rattacher l'${NOM_APPAREIL}`}</AvecIcone>
          </button>
        </form>
        <p className="note-rattachement">
          L'{NOM_APPAREIL} crée sa propre clé de signature, qui ne le quitte jamais. Une connexion Internet est nécessaire pour la mise en
          service ; ensuite la caisse encaisse aussi hors ligne.
        </p>
      </section>
    </div>
  );
}
