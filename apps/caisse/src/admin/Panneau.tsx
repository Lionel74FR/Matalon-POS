import { TriangleAlert, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

/**
 * Panneau latéral de l'administration (refonte du 25 octobre 2026) : créer ou modifier une
 * personne, un client, un appareil… sans quitter la liste. Il remplace les formulaires collés en
 * tête de liste et les fenêtres du navigateur (prompt). Tant qu'il y a des changements non
 * enregistrés, la barre du bas le dit, et le fermer demande de les abandonner.
 */
export function Panneau(props: {
  titre: string;
  surtitre?: string;
  onFermer: () => void;
  /** Envoi du formulaire (Entrée ou bouton principal). */
  onEnregistrer?: (e: FormEvent) => void;
  libelleEnregistrer?: string;
  enCours?: boolean;
  modifie?: boolean;
  erreur?: string;
  /** Message de réussite, à la place du pied (code généré, enregistré…). */
  succes?: ReactNode;
  children: ReactNode;
  /** Actions secondaires à gauche du pied (désactiver, supprimer). */
  autresActions?: ReactNode;
}) {
  const [abandon, setAbandon] = useState(false);
  const panneau = useRef<HTMLFormElement>(null);
  const precedent = useRef<Element | null>(null);
  const fermer = () => (props.modifie ? setAbandon(true) : props.onFermer());
  const fermerRef = useRef(fermer);
  fermerRef.current = fermer;
  useEffect(() => {
    precedent.current = document.activeElement;
    // Le premier champ reçoit le focus ; à la fermeture, il revient au bouton qui a ouvert le panneau.
    const champ = panneau.current?.querySelector<HTMLElement>("input:not([type=hidden]), select, textarea, button");
    champ?.focus();
    const echap = (e: KeyboardEvent) => e.key === "Escape" && fermerRef.current();
    window.addEventListener("keydown", echap);
    return () => {
      window.removeEventListener("keydown", echap);
      if (precedent.current instanceof HTMLElement) precedent.current.focus();
    };
  }, []);
  return (
    <div className="a-panneau-voile" onPointerDown={(e) => e.target === e.currentTarget && fermer()}>
      <form
        ref={panneau}
        className="a-panneau"
        role="dialog"
        aria-modal="true"
        aria-label={props.titre}
        onSubmit={(e) => {
          e.preventDefault();
          props.onEnregistrer?.(e);
        }}
      >
        <header className="a-panneau-tete">
          <div>
            {props.surtitre && <p className="a-page-surtitre">{props.surtitre}</p>}
            <h2>{props.titre}</h2>
          </div>
          <button type="button" className="a-panneau-fermer" aria-label="Fermer le panneau" title="Fermer" onClick={fermer}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="a-panneau-corps">{props.children}</div>
        {abandon ? (
          <footer className="a-panneau-pied abandon" role="alertdialog" aria-label="Modifications non enregistrées">
            <span className="a-panneau-etat">
              <TriangleAlert size={18} aria-hidden="true" /> Abandonner les modifications ?
            </span>
            <button type="button" className="bouton" onClick={() => setAbandon(false)}>
              Continuer
            </button>
            <button type="button" className="bouton danger" onClick={props.onFermer}>
              Abandonner
            </button>
          </footer>
        ) : (
          <footer className="a-panneau-pied">
            {props.erreur ? (
              <span className="a-panneau-etat erreur" role="alert">
                {props.erreur}
              </span>
            ) : props.succes ? (
              <span className="a-panneau-etat succes" role="status">
                {props.succes}
              </span>
            ) : props.modifie ? (
              <span className="a-panneau-etat modifie">Modifié, non enregistré</span>
            ) : (
              <span className="a-panneau-etat" />
            )}
            {props.autresActions}
            <button type="button" className="bouton" onClick={fermer}>
              {props.onEnregistrer && props.modifie ? "Annuler" : "Fermer"}
            </button>
            {props.onEnregistrer && (
              <button className="bouton principal" disabled={props.enCours}>
                {props.libelleEnregistrer ?? "Enregistrer"}
              </button>
            )}
          </footer>
        )}
      </form>
    </div>
  );
}

export interface OptionsConfirmation {
  titre: string;
  message?: ReactNode;
  /** Libellé du bouton qui confirme (« Révoquer », « Supprimer »). */
  confirmer: string;
  /** Action qui détruit ou qu'on ne peut pas défaire : bouton rouge. */
  danger?: boolean;
  /** Libellé du bouton qui renonce ; null : une simple information, un seul bouton. */
  annuler?: string | null;
}

function Confirmation(props: OptionsConfirmation & { onRepondre: (oui: boolean) => void }) {
  const non = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    non.current?.focus();
    const echap = (e: KeyboardEvent) => e.key === "Escape" && props.onRepondre(false);
    window.addEventListener("keydown", echap);
    return () => window.removeEventListener("keydown", echap);
  }, [props]);
  return (
    <div className="voile a-confirmation-voile" onPointerDown={(e) => e.target === e.currentTarget && props.onRepondre(false)}>
      <div className="modale a-confirmation" role="alertdialog" aria-modal="true" aria-label={props.titre}>
        <header className="modale-tete">
          <h2>{props.titre}</h2>
        </header>
        {props.message && <div className="modale-corps">{props.message}</div>}
        <footer className="modale-pied">
          {props.annuler !== null && (
            <button ref={non} type="button" className="bouton" onClick={() => props.onRepondre(false)}>
              {props.annuler ?? "Annuler"}
            </button>
          )}
          <button
            ref={props.annuler === null ? non : undefined}
            type="button"
            className={`bouton ${props.danger ? "danger" : "principal"}`}
            onClick={() => props.onRepondre(true)}
          >
            {props.confirmer}
          </button>
        </footer>
      </div>
    </div>
  );
}

/**
 * Demande une confirmation dans la page, à la place de window.confirm : même usage
 * (`if (!(await confirmer({...}))) return;`), mais au thème, accessible au clavier, avec un
 * bouton qui dit ce qu'il fait.
 */
export function confirmer(options: OptionsConfirmation): Promise<boolean> {
  return new Promise((resoudre) => {
    const hote = document.createElement("div");
    document.body.appendChild(hote);
    const racine = createRoot(hote);
    const precedent = document.activeElement;
    const repondre = (oui: boolean) => {
      racine.unmount();
      hote.remove();
      if (precedent instanceof HTMLElement) precedent.focus();
      resoudre(oui);
    };
    racine.render(<Confirmation {...options} onRepondre={repondre} />);
  });
}

/** Information à lire (une erreur, un refus), à la place de window.alert. */
export function informer(titre: string, message?: ReactNode): Promise<void> {
  return confirmer({ titre, message, confirmer: "Compris", annuler: null }).then(() => undefined);
}
