import { useState, type FormEvent } from "react";
import { LockKeyhole, X } from "lucide-react";
import { AvecIcone, BoutonIcone } from "../ui/icones";
import { api } from "./api";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Nouveau mot de passe du propriétaire (15 novembre 2026, mot de passe oublié) : connecté par sa clé
 * d'accès, il le remplace avec le code de son application d'authentification ; l'ancien n'est pas
 * demandé. Les autres sessions ouvertes sont fermées. Le mot de passe et le code restent le secours
 * quand la clé d'accès n'est pas disponible.
 */
export function FenetreMotDePasse(props: { onFermer: () => void }) {
  const [nouveau, setNouveau] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [code, setCode] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState("");
  const [fait, setFait] = useState(false);
  const probleme =
    nouveau && nouveau.length < 12 ? "Au moins 12 caractères." : confirmation && confirmation !== nouveau ? "Les deux saisies diffèrent." : "";

  const changer = (e: FormEvent) => {
    e.preventDefault();
    if (probleme || nouveau.length < 12 || nouveau !== confirmation) return;
    setEnCours(true);
    setErreur("");
    void api
      .changerMotDePasse(code, nouveau)
      .then(() => {
        setFait(true);
        setNouveau("");
        setConfirmation("");
        setCode("");
      })
      .catch((x) => setErreur(message(x)))
      .finally(() => setEnCours(false));
  };

  return (
    <div className="voile" onPointerDown={(e) => e.target === e.currentTarget && props.onFermer()}>
      <div className="modale cles-acces" role="dialog" aria-modal="true" aria-label="Mot de passe">
        <header className="modale-tete">
          <h2 className="titre-icone">
            <AvecIcone icone={LockKeyhole}>Mot de passe</AvecIcone>
          </h2>
          <BoutonIcone icone={X} variante="discret" libelle="Fermer" onClick={props.onFermer} />
        </header>
        <div className="modale-corps">
          <p className="explication">
            Le mot de passe et le code de l'application d'authentification ouvrent l'administration quand la clé d'accès n'est pas disponible
            (autre appareil, adresse de test). L'ancien mot de passe n'est pas demandé : le code suffit. Les autres sessions ouvertes sont
            fermées.
          </p>
          {fait ? (
            <p className="succes" role="status">
              Mot de passe changé. Gardez-le dans votre gestionnaire de mots de passe.
            </p>
          ) : (
            <form onSubmit={changer} className="cles-creation">
              <label className="champ">
                <span>
                  Nouveau mot de passe
                  <small>12 caractères au moins</small>
                </span>
                <input type="password" autoComplete="new-password" value={nouveau} onChange={(e) => setNouveau(e.target.value)} required />
              </label>
              <label className="champ">
                <span>Confirmation</span>
                <input type="password" autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} required />
              </label>
              <label className="champ">
                <span>Code de l'application d'authentification</span>
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                />
              </label>
              <p className="erreur" aria-live="assertive">
                {probleme || erreur}
              </p>
              <button className="bouton principal" disabled={enCours || !!probleme || nouveau.length < 12 || nouveau !== confirmation || code.length !== 6}>
                <AvecIcone icone={LockKeyhole}>{enCours ? "Enregistrement…" : "Changer le mot de passe"}</AvecIcone>
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
