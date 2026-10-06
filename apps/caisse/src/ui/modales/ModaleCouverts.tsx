import { Check, Minus, Plus, X } from "lucide-react";
import { useState } from "react";
import { AvecIcone } from "../icones";
import { Modale } from "../communs";

const RAPIDES = Array.from({ length: 12 }, (_, i) => i + 1);

/**
 * Nombre de couverts : un toucher suffit de 1 à 12 ; au-delà, plus et moins.
 * Utilisable avant toute commande (table installée, rien commandé encore).
 */
export function ModaleCouverts(props: { valeur: number | null; onValider: (n: number | null) => void; onFermer: () => void }) {
  const [n, setN] = useState(Math.max(props.valeur ?? 13, 13));
  return (
    <Modale
      titre="Couverts"
      onFermer={props.onFermer}
      pied={
        props.valeur != null ? (
          <button className="bouton" onClick={() => props.onValider(null)}>
            <AvecIcone icone={X}>Sans couverts</AvecIcone>
          </button>
        ) : undefined
      }
    >
      <div className="couverts-grille" role="group" aria-label="Nombre de couverts">
        {RAPIDES.map((x) => (
          <button key={x} className={`couverts-choix${props.valeur === x ? " actif" : ""}`} onClick={() => props.onValider(x)}>
            {x}
          </button>
        ))}
      </div>
      <div className="couverts-plus">
        <span>Plus de 12</span>
        <div className="quantite">
          <button className="bouton" onClick={() => setN((v) => Math.max(13, v - 1))} aria-label="Un de moins">
            <Minus className="icone" size={22} aria-hidden="true" />
          </button>
          <span>{n}</span>
          <button className="bouton" onClick={() => setN((v) => Math.min(99, v + 1))} aria-label="Un de plus">
            <Plus className="icone" size={22} aria-hidden="true" />
          </button>
        </div>
        <button className="bouton principal" onClick={() => props.onValider(n)}>
          <AvecIcone icone={Check}>{n} couverts</AvecIcone>
        </button>
      </div>
    </Modale>
  );
}
