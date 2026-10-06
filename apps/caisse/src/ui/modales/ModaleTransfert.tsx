import { useState } from "react";
import { ID_COMPTOIR } from "../../donnees/configuration";
import { Modale } from "../communs";
import { useCaisse } from "../contexte";

/** Choix de la table d'arrivée : une table libre reçoit la commande, une table ouverte la fusionne. */
export function ModaleTransfert(props: { depuis: string; tablesOuvertes: Set<string>; onChoisir: (tableId: string) => void; onFermer: () => void }) {
  const { config } = useCaisse();
  const [fusion, setFusion] = useState<string | null>(null);
  const zones = [...new Set(config.tables.map((t) => t.zone))];
  const nom = (id: string) => (id === ID_COMPTOIR ? "Comptoir" : `Table ${config.tables.find((t) => t.id === id)?.nom ?? id}`);

  if (fusion) {
    return (
      <Modale
        titre="Regrouper les commandes"
        onFermer={() => setFusion(null)}
        pied={
          <>
            <button className="bouton" onClick={() => setFusion(null)}>
              Choisir une autre table
            </button>
            <button className="bouton principal" onClick={() => props.onChoisir(fusion)}>
              Regrouper sur {nom(fusion)}
            </button>
          </>
        }
      >
        <p className="explication">
          {nom(fusion)} a déjà une commande ouverte. Les articles de {nom(props.depuis)} s'y ajoutent et les couverts s'additionnent ;{" "}
          {nom(props.depuis)} redevient libre.
        </p>
      </Modale>
    );
  }

  return (
    <Modale titre={`Transférer ${nom(props.depuis)}`} large onFermer={props.onFermer}>
      <p className="explication">Touchez la table d'arrivée. Une table occupée regroupe les deux commandes.</p>
      {zones.map((zone) => (
        <section key={zone} className="zone">
          <h3>{zone}</h3>
          <div className="grille-tables compacte">
            {config.tables
              .filter((t) => t.zone === zone && t.id !== props.depuis)
              .map((t) => {
                const occupee = props.tablesOuvertes.has(t.id);
                return (
                  <button key={t.id} className={`table${occupee ? " occupee" : ""}`} onClick={() => (occupee ? setFusion(t.id) : props.onChoisir(t.id))}>
                    <span className="table-nom">{t.nom}</span>
                    <span className="table-libre">{occupee ? "Occupée" : "Libre"}</span>
                  </button>
                );
              })}
          </div>
        </section>
      ))}
    </Modale>
  );
}

const NOTES_RAPIDES = ["Anniversaire", "Client pressé", "Allergie à signaler", "Servir ensemble"];

export function ModaleNoteCommande(props: { note: string; onValider: (note: string) => void; onFermer: () => void }) {
  const [note, setNote] = useState(props.note);
  return (
    <Modale
      titre="Note sur la commande"
      onFermer={props.onFermer}
      pied={
        <button className="bouton principal" onClick={() => props.onValider(note)}>
          Enregistrer
        </button>
      }
    >
      <div className="options">
        {NOTES_RAPIDES.map((n) => (
          <button key={n} className="option" onClick={() => setNote((x) => (x ? `${x}, ${n}` : n))}>
            {n}
          </button>
        ))}
      </div>
      <textarea className="saisie-note" rows={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Visible par toute l'équipe sur cette table" />
    </Modale>
  );
}
