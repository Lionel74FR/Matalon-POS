import { useState } from "react";
import type { Utilisateur } from "../donnees/configuration";
import type { Caisse } from "../fiscal/caisse";
import { SaisiePin } from "./modales/ModalePin";

export function Connexion(props: { caisse: Caisse; onConnecte: (u: Utilisateur) => void }) {
  const actifs = props.caisse.config.utilisateurs.filter((u) => u.actif);
  const [choisi, setChoisi] = useState<Utilisateur | null>(null);
  const [heure] = useState(() =>
    new Date().toLocaleString("fr-FR", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }),
  );

  return (
    <div className="ecran-connexion">
      <section className="connexion-marque">
        <img src="/icone.svg" alt="" width={96} height={96} />
        <h1>{props.caisse.config.etablissement.enseigne}</h1>
        <p className="connexion-caisse">Matalon POS · {props.caisse.config.caisseNom}</p>
        <p>{heure}</p>
      </section>
      <section className="connexion-panneau">
        <h2>{choisi ? `Bonjour ${choisi.nom}` : "Qui prend le service ?"}</h2>
        {actifs.length === 0 ? (
          <p className="explication">
            Aucun membre d'équipe pour cet établissement. Ajoutez un responsable dans l'administration : il apparaîtra ici dès
            la prochaine synchronisation.
          </p>
        ) : !choisi ? (
          <div className="grille-personnes">
            {actifs.map((u) => (
              <button key={u.id} className="carte-personne" onClick={() => setChoisi(u)}>
                <span className="initiale">{u.nom.slice(0, 1).toUpperCase()}</span>
                {u.nom}
              </button>
            ))}
          </div>
        ) : (
          <>
            <SaisiePin key={choisi.id} utilisateur={choisi} onValide={props.onConnecte} />
            <button className="bouton discret" onClick={() => setChoisi(null)}>
              Changer de personne
            </button>
          </>
        )}
      </section>
    </div>
  );
}
