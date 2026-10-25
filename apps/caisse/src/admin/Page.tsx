import { Info } from "lucide-react";
import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from "react";

/**
 * Modèle de page unique de l'administration (refonte du 25 octobre 2026) : même en-tête partout
 * (surtitre, titre, portée, action principale à droite), puis les sous-pages en onglets soulignés.
 */
export function EntetePage(props: { surtitre?: string; titre: string; portee?: string; actions?: ReactNode; aide?: ReactNode; children?: ReactNode }) {
  const [aide, setAide] = useState(false);
  const id = useId();
  return (
    <div className="a-page">
      <div className="a-page-tete">
        <div className="a-page-titres">
          {props.surtitre && <p className="a-page-surtitre">{props.surtitre}</p>}
          <div className="a-page-titre-ligne">
            <h1 className="a-page-titre">{props.titre}</h1>
            {props.portee && <span className="a-portee">{props.portee}</span>}
            {props.aide && <BoutonAide titre={props.titre} ouverte={aide} controle={id} onBasculer={() => setAide((a) => !a)} />}
          </div>
        </div>
        {props.actions && <div className="a-page-actions">{props.actions}</div>}
      </div>
      {props.aide && aide && (
        <div id={id} className="a-aide-texte" role="note">
          {props.aide}
        </div>
      )}
      {props.children}
    </div>
  );
}

function BoutonAide(props: { titre?: string; ouverte: boolean; controle: string; onBasculer: () => void }) {
  return (
    <button
      type="button"
      className="a-aide-bouton"
      aria-expanded={props.ouverte}
      aria-controls={props.controle}
      aria-label={props.titre ? `Aide : ${props.titre}` : "Aide"}
      title={props.ouverte ? "Masquer l'aide" : "Afficher l'aide"}
      onClick={props.onBasculer}
    >
      <Info size={18} aria-hidden="true" />
    </button>
  );
}

export interface DefOnglet<T extends string> {
  id: T;
  libelle: string;
  compteur?: number;
}

/**
 * Onglets soulignés d'une page, en groupes séparés par un filet (Stock : opérations, référentiel,
 * analyse). Chaque onglet est un lien vers sa sous-page (#/moka/stock/inventaire).
 */
export function Onglets<T extends string>(props: { libelle: string; groupes: Array<Array<DefOnglet<T>>>; actif: T; adresse: (id: T) => string; onChoisir: (id: T) => void }) {
  const barre = useRef<HTMLDivElement>(null);
  // Sur iPhone, l'onglet choisi reste visible dans la barre qui défile.
  useEffect(() => {
    const b = barre.current;
    const choisi = b?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (b && choisi && (choisi.offsetLeft < b.scrollLeft || choisi.offsetLeft + choisi.offsetWidth > b.scrollLeft + b.clientWidth)) {
      b.scrollLeft = choisi.offsetLeft - 16;
    }
  }, [props.actif]);
  return (
    <div ref={barre} className="a-onglets" role="tablist" aria-label={props.libelle}>
      {props.groupes.map((g, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="a-onglets-filet" aria-hidden="true" />}
          {g.map((o) => (
            <a
              key={o.id}
              href={props.adresse(o.id)}
              role="tab"
              aria-selected={props.actif === o.id}
              className="a-onglet"
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                e.preventDefault();
                props.onChoisir(o.id);
              }}
            >
              {o.libelle}
              {o.compteur != null && <span className="a-onglet-compteur">{o.compteur}</span>}
            </a>
          ))}
        </Fragment>
      ))}
    </div>
  );
}

/**
 * Titre de section suivi d'une aide repliée derrière une icône (i) : la page reste lisible,
 * l'explication est à un clic.
 */
export function TitreAvecAide(props: { titre: ReactNode; nom?: string; niveau?: 2 | 3; actions?: ReactNode; children?: ReactNode }) {
  const [ouverte, setOuverte] = useState(false);
  const id = useId();
  const Balise = props.niveau === 3 ? "h3" : "h2";
  return (
    <>
      <div className="a-section-tete">
        <Balise className="a-section-titre">{props.titre}</Balise>
        {props.children != null && <BoutonAide titre={props.nom} ouverte={ouverte} controle={id} onBasculer={() => setOuverte((o) => !o)} />}
        {props.actions && <div className="a-section-actions">{props.actions}</div>}
      </div>
      {props.children != null && ouverte && (
        <div id={id} className="a-aide-texte" role="note">
          {props.children}
        </div>
      )}
    </>
  );
}
