import type { GroupeCommentaires } from "@matalon/catalogue";
import { basculer, type SelectionCommentaires } from "../../metier/commentaires";

/** Commentaires proposés pour un article (cuisson, sauce…), groupe par groupe ; `pour` : choix de formule concerné. */
export function ChoixCommentaires(props: {
  groupes: GroupeCommentaires[];
  selection: SelectionCommentaires;
  onChange: (s: SelectionCommentaires) => void;
  pour?: string;
}) {
  return (
    <>
      {props.groupes.map((g) => {
        const titre = props.pour ? `${g.nom} · ${props.pour}` : g.nom;
        return (
          <section key={g.id} className="groupe-choix groupe-commentaires">
            <h3>
              {titre}
              <small>{g.obligatoire ? (g.plusieurs ? " obligatoire, plusieurs possibles" : " obligatoire") : g.plusieurs ? " facultatif, plusieurs possibles" : " facultatif"}</small>
            </h3>
            <div className="options compactes" role={g.plusieurs ? "group" : "radiogroup"} aria-label={titre}>
              {g.commentaires.map((c) => {
                const actif = (props.selection[g.id] ?? []).includes(c);
                return (
                  <button
                    key={c}
                    role={g.plusieurs ? undefined : "radio"}
                    aria-checked={g.plusieurs ? undefined : actif}
                    aria-pressed={g.plusieurs ? actif : undefined}
                    className={`option${actif ? " active" : ""}`}
                    onClick={() => props.onChange(basculer(props.selection, g, c))}
                  >
                    {c}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </>
  );
}
