import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Fingerprint, KeyRound, Trash2, X } from "lucide-react";
import { AvecIcone, BoutonIcone } from "../ui/icones";
import { api, type CleAccesAdmin } from "./api";
import { cleAccesDisponible, creerCleAcces, nomAppareil } from "./cleAcces";

const dateHeure = (iso: string | null) => (iso ? new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "jamais");
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Clés de ce compte valables sur l'adresse ouverte (une clé ne vaut que pour le domaine qui l'a créée). */
export function useClesAcces() {
  const [cles, setCles] = useState<CleAccesAdmin[] | null>(null);
  const recharger = useCallback(() => {
    api
      .clesAcces()
      .then((r) => setCles(r.cles))
      .catch(() => setCles(null));
  }, []);
  useEffect(recharger, [recharger]);
  return { cles, setCles, recharger };
}

const CLE_PLUS_TARD = "matalon-admin-cle-plus-tard";

/** Invitation à créer une clé d'accès, tant que ce compte n'en a aucune pour ce domaine. */
export function SuggestionCleAcces(props: { cles: CleAccesAdmin[] | null; onOuvrir: () => void }) {
  const [masquee, setMasquee] = useState(() => {
    try {
      return localStorage.getItem(CLE_PLUS_TARD) === "1";
    } catch {
      return false;
    }
  });
  if (masquee || !cleAccesDisponible() || !props.cles || props.cles.some((c) => c.domaine === location.hostname)) return null;
  return (
    <div className="admin-suggestion" role="note">
      <Fingerprint className="icone" size={26} aria-hidden="true" />
      <p>
        <strong>Connectez-vous sans code.</strong> Une clé d'accès remplace le mot de passe et le code de vérification : Face ID, Touch ID
        ou le code de l'appareil suffit.
      </p>
      <div className="options">
        <button className="bouton principal" onClick={props.onOuvrir}>
          <AvecIcone icone={KeyRound}>Créer une clé d'accès</AvecIcone>
        </button>
        <button
          className="bouton"
          onClick={() => {
            try {
              localStorage.setItem(CLE_PLUS_TARD, "1");
            } catch {
              /* stockage indisponible : l'invitation reviendra */
            }
            setMasquee(true);
          }}
        >
          Plus tard
        </button>
      </div>
    </div>
  );
}

/** Fenêtre « Clés d'accès » : création (code de vérification redemandé), liste, retrait. */
export function FenetreClesAcces(props: { cles: CleAccesAdmin[] | null; onChange: (cles: CleAccesAdmin[]) => void; onFermer: () => void }) {
  const [nom, setNom] = useState(() => `${nomAppareil()}`);
  const [code, setCode] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState("");
  const [succes, setSucces] = useState("");
  const disponible = cleAccesDisponible();

  const creer = (e: FormEvent) => {
    e.preventDefault();
    setEnCours(true);
    setErreur("");
    setSucces("");
    void (async () => {
      try {
        const { options } = await api.optionsCleAcces(code);
        const reponse = await creerCleAcces(options);
        const r = await api.enregistrerCleAcces(nom.trim() || nomAppareil(), reponse);
        props.onChange(r.cles);
        setCode("");
        setSucces(`Clé « ${nom.trim() || nomAppareil()} » créée : à la prochaine connexion, touchez « Se connecter avec une clé d'accès ».`);
      } catch (e) {
        setErreur(message(e));
      } finally {
        setEnCours(false);
      }
    })();
  };

  const retirer = (c: CleAccesAdmin) => {
    if (!window.confirm(`Retirer la clé « ${c.nom} » ? Elle ne permettra plus de se connecter.`)) return;
    setErreur("");
    setSucces("");
    api
      .retirerCleAcces(c.id)
      .then((r) => props.onChange(r.cles))
      .catch((e) => setErreur(message(e)));
  };

  return (
    <div className="voile" onPointerDown={(e) => e.target === e.currentTarget && props.onFermer()}>
      <div className="modale cles-acces" role="dialog" aria-modal="true" aria-label="Clés d'accès">
        <header className="modale-tete">
          <h2 className="titre-icone">
            <AvecIcone icone={KeyRound}>Clés d'accès</AvecIcone>
          </h2>
          <BoutonIcone icone={X} variante="discret" libelle="Fermer" onClick={props.onFermer} />
        </header>
        <div className="modale-corps">
          <p className="explication">
            Une clé d'accès (passkey) ouvre l'administration avec Face ID, Touch ID ou le code de l'appareil, sans mot de passe ni code de
            vérification. Elle est gardée par l'appareil (et le trousseau iCloud ou Google s'il est activé, qui la recopie sur vos autres
            appareils) ; le serveur ne garde que sa partie publique. Le mot de passe et le code restent valables en secours.
          </p>
          {props.cles && props.cles.length > 0 && (
            <ul className="cles-liste">
              {props.cles.map((c) => (
                <li key={c.id}>
                  <div>
                    <strong>{c.nom}</strong>
                    <small>
                      Créée le {dateHeure(c.creeLe)} · dernière connexion : {dateHeure(c.utiliseeLe)}
                      {c.domaine !== location.hostname && ` · pour ${c.domaine}`}
                    </small>
                  </div>
                  <BoutonIcone icone={Trash2} variante="discret" libelle={`Retirer la clé ${c.nom}`} onClick={() => retirer(c)} />
                </li>
              ))}
            </ul>
          )}
          {disponible ? (
            <form onSubmit={creer} className="cles-creation">
              <h3>Créer une clé sur cet appareil</h3>
              <label className="champ">
                <span>Nom de la clé</span>
                <input value={nom} onChange={(e) => setNom(e.target.value)} maxLength={60} required />
              </label>
              <label className="champ">
                <span>
                  Code de l'application d'authentification
                  <small>Redemandé pour créer une clé</small>
                </span>
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                />
              </label>
              <p className="erreur" aria-live="assertive">
                {erreur}
              </p>
              {succes && <p className="succes">{succes}</p>}
              <button className="bouton principal" disabled={enCours || code.length !== 6}>
                <AvecIcone icone={Fingerprint}>{enCours ? "En attente de l'appareil…" : "Créer la clé d'accès"}</AvecIcone>
              </button>
            </form>
          ) : (
            <p className="erreur">Ce navigateur ne prend pas en charge les clés d'accès.</p>
          )}
        </div>
      </div>
    </div>
  );
}
