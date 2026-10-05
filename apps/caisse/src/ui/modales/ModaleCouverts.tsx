import { useState } from "react";
import { Modale, Pave } from "../communs";

export function ModaleCouverts(props: { valeur: number | null; onValider: (n: number | null) => void; onFermer: () => void }) {
  const [n, setN] = useState(props.valeur ?? 0);
  return (
    <Modale
      titre="Couverts"
      onFermer={props.onFermer}
      pied={
        <button className="bouton principal" onClick={() => props.onValider(n > 0 ? n : null)}>
          Valider {n > 0 ? `${n} couvert${n > 1 ? "s" : ""}` : "sans couverts"}
        </button>
      }
    >
      <div className="afficheur">{n}</div>
      <div className="options">
        {[1, 2, 3, 4, 5, 6].map((x) => (
          <button key={x} className={`option${n === x ? " active" : ""}`} onClick={() => props.onValider(x)}>
            {x}
          </button>
        ))}
      </div>
      <Pave onTouche={(t) => setN((v) => (t === "effacer" ? Math.floor(v / 10) : Math.min(99, v * 10 + Number(t))))} />
    </Modale>
  );
}
