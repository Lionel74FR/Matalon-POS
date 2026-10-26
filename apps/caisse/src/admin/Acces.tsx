import type { AccesAdminApi, InvitationAdminApi } from "@matalon/serveur/partage";
import { Ban, Copy, Fingerprint, Link2, Pencil, Save, UserCog, UserPlus, X } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AvecIcone, BoutonIcone } from "../ui/icones";
import { api, lienInvitation, type EtablissementAdmin } from "./api";
import { cleAccesDisponible, creerCleAcces, nomAppareil } from "./cleAcces";
import { confirmer } from "./Panneau";

/**
 * Accès à l'administration (26 octobre 2026, demande de Lionel) : le propriétaire invite une
 * comptable, qui ne verra que les statistiques et les clôtures des établissements choisis. Le lien
 * d'invitation, à usage unique et valable 7 jours, s'affiche une fois ; il ouvre la création d'une clé
 * d'accès, sans mot de passe ni code. Révoquer ferme ses sessions et retire ses clés.
 */

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const dateHeure = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" }) : "jamais";
const date = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "long" });

const ACTIONS: Record<string, string> = {
  connexion: "Connexion",
  export_csv_etablissement: "Export comptable (CSV)",
  export_comptages: "Comptages de caisse (CSV)",
  export_archive: "Archive d'une clôture (JSON)",
  cle_acces_ajoutee: "Clé d'accès créée",
  connexion_refusee: "Connexion refusée",
};

const periode = (d: Record<string, unknown>) => (typeof d.du === "string" && typeof d.au === "string" ? ` · du ${d.du} au ${d.au}` : "");

/** Cases des établissements ouverts à l'accès. */
function ChoixEtablissements(props: { etablissements: EtablissementAdmin[]; choisis: string[]; onChange: (ids: string[]) => void }) {
  return (
    <fieldset className="acces-etabs">
      <legend>Établissements</legend>
      {props.etablissements.map((e) => (
        <label key={e.id} className="case">
          <input
            type="checkbox"
            checked={props.choisis.includes(e.id)}
            onChange={(ev) => props.onChange(ev.target.checked ? [...props.choisis, e.id] : props.choisis.filter((x) => x !== e.id))}
          />{" "}
          {e.identite.enseigne}
        </label>
      ))}
    </fieldset>
  );
}

/** Lien à transmettre, affiché une seule fois (le serveur n'en garde que l'empreinte). */
function LienAffiche(props: { nom: string; jeton: string; expireLe: string; onFermer: () => void }) {
  const lien = lienInvitation(props.jeton);
  const [copie, setCopie] = useState(false);
  return (
    <div className="acces-lien" role="status">
      <p>
        <strong>Lien pour {props.nom}</strong>, valable jusqu'au {date(props.expireLe)}, une seule fois. Envoyez-le-lui vous-même (e-mail, message) :
        il ne sera plus affiché.
      </p>
      <input readOnly value={lien} aria-label={`Lien d'invitation de ${props.nom}`} onFocus={(e) => e.target.select()} />
      <div className="options">
        <button
          type="button"
          className="bouton principal"
          onClick={() =>
            void navigator.clipboard
              ?.writeText(lien)
              .then(() => setCopie(true))
              .catch(() => setCopie(false))
          }
        >
          <AvecIcone icone={Copy}>{copie ? "Lien copié" : "Copier le lien"}</AvecIcone>
        </button>
        <button type="button" className="bouton" onClick={props.onFermer}>
          C'est envoyé
        </button>
      </div>
    </div>
  );
}

function etat(a: AccesAdminApi): string {
  if (a.revoqueLe) return `Révoqué le ${dateHeure(a.revoqueLe)}`;
  if (a.invitation && a.cles === 0) return `Invitation en attente, jusqu'au ${date(a.invitation.expireLe)}`;
  const base = `Dernière connexion : ${dateHeure(a.derniereConnexion)}`;
  return a.invitation ? `${base} · nouveau lien en attente` : base;
}

/** Fiche d'un accès comptable : établissements, nouveau lien, révocation, dernières actions. */
function FicheAcces(props: {
  a: AccesAdminApi;
  etablissements: EtablissementAdmin[];
  onListe: (acces: AccesAdminApi[]) => void;
  onLien: (l: { nom: string; jeton: string; expireLe: string }) => void;
  onErreur: (m: string) => void;
}) {
  const { a } = props;
  const [edition, setEdition] = useState<string[] | null>(null);
  const noms = (a.etablissements ?? []).map((id) => props.etablissements.find((e) => e.id === id)?.identite.enseigne ?? id).join(", ");
  const enregistrer = () =>
    void api
      .modifierAcces(a.id, { etablissements: edition ?? [] })
      .then((r) => {
        props.onListe(r.acces);
        setEdition(null);
      })
      .catch((e) => props.onErreur(message(e)));
  const lien = () =>
    void api
      .lienAcces(a.id)
      .then(async (l) => {
        props.onLien({ nom: a.nom, jeton: l.jeton, expireLe: l.expireLe });
        props.onListe((await api.acces()).acces);
      })
      .catch((e) => props.onErreur(message(e)));
  const revoquer = async () => {
    const oui = await confirmer({
      titre: `Révoquer l'accès de ${a.nom} ?`,
      message: "Ses sessions se ferment aussitôt et ses clés d'accès sont retirées. Vous pourrez le rétablir en lui envoyant un nouveau lien.",
      confirmer: "Révoquer l'accès",
      danger: true,
    });
    if (!oui) return;
    api
      .revoquerAcces(a.id)
      .then((r) => props.onListe(r.acces))
      .catch((e) => props.onErreur(message(e)));
  };
  return (
    <li className={`acces-fiche${a.revoqueLe ? " revoque" : ""}`}>
      <div className="acces-fiche-tete">
        <div>
          <strong>{a.nom}</strong>
          <small>
            {a.identifiant} · Comptable · {noms || "aucun établissement"}
          </small>
          <small className="acces-etat">{etat(a)}</small>
        </div>
        <div className="options">
          {!a.revoqueLe && edition === null && (
            <BoutonIcone icone={Pencil} variante="discret" libelle={`Établissements de ${a.nom}`} onClick={() => setEdition(a.etablissements ?? [])} />
          )}
          <button type="button" className="bouton" onClick={lien}>
            <AvecIcone icone={Link2}>{a.revoqueLe ? "Rétablir (nouveau lien)" : "Nouveau lien"}</AvecIcone>
          </button>
          {!a.revoqueLe && (
            <button type="button" className="bouton danger" onClick={() => void revoquer()}>
              <AvecIcone icone={Ban}>Révoquer</AvecIcone>
            </button>
          )}
        </div>
      </div>
      {edition !== null && (
        <div className="acces-edition">
          <ChoixEtablissements etablissements={props.etablissements} choisis={edition} onChange={setEdition} />
          <div className="options">
            <button type="button" className="bouton principal" disabled={edition.length === 0} onClick={enregistrer}>
              <AvecIcone icone={Save}>Enregistrer</AvecIcone>
            </button>
            <button type="button" className="bouton" onClick={() => setEdition(null)}>
              Annuler
            </button>
          </div>
        </div>
      )}
      {a.journal.length > 0 && (
        <details className="acces-journal">
          <summary>Dernières actions</summary>
          <ul>
            {a.journal.map((j, i) => (
              <li key={i}>
                {dateHeure(j.horodatage)} · {ACTIONS[j.action] ?? j.action}
                {periode(j.details)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}

/** Fenêtre « Accès à l'administration », ouverte depuis le menu du compte du propriétaire. */
export function FenetreAcces(props: { etablissements: EtablissementAdmin[]; onFermer: () => void }) {
  const [acces, setAcces] = useState<AccesAdminApi[] | null>(null);
  const [erreur, setErreur] = useState("");
  const [lien, setLien] = useState<{ nom: string; jeton: string; expireLe: string } | null>(null);
  const [nom, setNom] = useState("");
  const [email, setEmail] = useState("");
  const [choisis, setChoisis] = useState<string[]>(() => (props.etablissements.length === 1 ? [props.etablissements[0]!.id] : []));
  const [enCours, setEnCours] = useState(false);
  const [formulaire, setFormulaire] = useState(false);
  const charger = useCallback(() => {
    api
      .acces()
      .then((r) => setAcces(r.acces))
      .catch((e) => setErreur(message(e)));
  }, []);
  useEffect(charger, [charger]);
  useEffect(() => {
    const echap = (e: KeyboardEvent) => e.key === "Escape" && !document.querySelector(".a-confirmation") && props.onFermer();
    window.addEventListener("keydown", echap);
    return () => window.removeEventListener("keydown", echap);
  }, [props]);

  const inviter = (e: FormEvent) => {
    e.preventDefault();
    if (choisis.length === 0) return setErreur("Choisissez au moins un établissement.");
    setEnCours(true);
    setErreur("");
    api
      .inviterComptable(nom.trim(), email.trim(), choisis)
      .then((r) => {
        setLien({ nom: nom.trim(), jeton: r.jeton, expireLe: r.expireLe });
        setNom("");
        setEmail("");
        setFormulaire(false);
        charger();
      })
      .catch((e) => setErreur(message(e)))
      .finally(() => setEnCours(false));
  };

  const comptables = (acces ?? []).filter((a) => a.role === "comptable");
  const proprietaire = (acces ?? []).find((a) => a.role === "proprietaire");
  return (
    <div className="voile" onPointerDown={(e) => e.target === e.currentTarget && props.onFermer()}>
      <div className="modale acces-admin" role="dialog" aria-modal="true" aria-label="Accès à l'administration">
        <header className="modale-tete">
          <h2 className="titre-icone">
            <AvecIcone icone={UserCog}>Accès à l'administration</AvecIcone>
          </h2>
          <BoutonIcone icone={X} variante="discret" libelle="Fermer" onClick={props.onFermer} />
        </header>
        <div className="modale-corps">
          <p className="explication">
            Un accès comptable ne voit que les statistiques et les clôtures (exports CSV et archives compris) des établissements choisis, en
            lecture seule : ni tickets, ni équipe, ni réglages. Il s'ouvre par un lien à usage unique, valable 7 jours, qui fait créer une
            clé d'accès (Touch ID, Face ID, Windows Hello) ; pas de mot de passe. Ses connexions et ses exports sont au journal.
          </p>
          {lien && <LienAffiche {...lien} onFermer={() => setLien(null)} />}
          {!acces ? (
            <p>Chargement…</p>
          ) : (
            <ul className="acces-liste">
              {proprietaire && (
                <li className="acces-fiche">
                  <div className="acces-fiche-tete">
                    <div>
                      <strong>{proprietaire.identifiant}</strong>
                      <small>Propriétaire · tous les établissements et toutes les rubriques</small>
                    </div>
                  </div>
                </li>
              )}
              {comptables.map((a) => (
                <FicheAcces key={a.id} a={a} etablissements={props.etablissements} onListe={setAcces} onLien={setLien} onErreur={setErreur} />
              ))}
            </ul>
          )}
          <p className="erreur" aria-live="assertive">
            {erreur}
          </p>
          {formulaire ? (
            <form className="acces-invitation" onSubmit={inviter}>
              <h3>Inviter une comptable</h3>
              <label className="champ">
                <span>Nom</span>
                <input value={nom} onChange={(e) => setNom(e.target.value)} maxLength={80} required autoComplete="off" />
              </label>
              <label className="champ">
                <span>E-mail</span>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} required autoComplete="off" />
              </label>
              <ChoixEtablissements etablissements={props.etablissements} choisis={choisis} onChange={setChoisis} />
              <div className="options">
                <button className="bouton principal" disabled={enCours}>
                  <AvecIcone icone={Link2}>Créer le lien d'invitation</AvecIcone>
                </button>
                <button type="button" className="bouton" onClick={() => setFormulaire(false)}>
                  Annuler
                </button>
              </div>
            </form>
          ) : (
            <button type="button" className="bouton principal" onClick={() => setFormulaire(true)}>
              <AvecIcone icone={UserPlus}>Inviter une comptable</AvecIcone>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Page ouverte par le lien d'invitation : à qui il s'adresse, puis création de la clé d'accès. */
export function AccepterInvitation(props: { jeton: string; onConnecte: () => void }) {
  const [invitation, setInvitation] = useState<InvitationAdminApi | null>(null);
  const [erreur, setErreur] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [nomCle, setNomCle] = useState(() => nomAppareil());
  useEffect(() => {
    api
      .lireInvitation(props.jeton)
      .then((r) => setInvitation(r.invitation))
      .catch((e) => setErreur(message(e)));
  }, [props.jeton]);
  const creer = (e: FormEvent) => {
    e.preventDefault();
    setEnCours(true);
    setErreur("");
    void (async () => {
      try {
        const { options } = await api.optionsInvitation(props.jeton);
        await api.accepterInvitation(props.jeton, nomCle.trim() || nomAppareil(), await creerCleAcces(options));
        props.onConnecte();
      } catch (e) {
        setErreur(message(e));
      } finally {
        setEnCours(false);
      }
    })();
  };
  return (
    <div className="admin-acces">
      <header className="admin-acces-tete">
        <img src="/icone.svg" alt="" width={56} height={56} />
        <div>
          <p className="surtitre">Matalon POS · Administration</p>
          <h1>{invitation ? `Bienvenue, ${invitation.nom}` : "Invitation"}</h1>
        </div>
      </header>
      {invitation ? (
        <form className="admin-carte" onSubmit={creer}>
          <p>
            Cette invitation ouvre un accès en lecture aux <strong>statistiques</strong> et aux <strong>clôtures</strong> (exports comptables
            CSV, comptages de caisse, archives) de {invitation.etablissements.map((e) => e.enseigne).join(", ")}, pour {invitation.identifiant}.
          </p>
          <p className="explication">
            Votre ordinateur ou votre téléphone crée une clé d'accès : Touch ID, Face ID, Windows Hello ou le code de l'appareil suffira pour
            vous connecter, sans mot de passe. Le lien ne sert qu'une fois ; il vaut jusqu'au {date(invitation.expireLe)}.
          </p>
          {cleAccesDisponible() ? (
            <>
              <label className="champ">
                <span>Nom de cet appareil</span>
                <input value={nomCle} onChange={(e) => setNomCle(e.target.value)} maxLength={60} required />
              </label>
              <p className="erreur" aria-live="assertive">
                {erreur}
              </p>
              <button className="bouton principal" disabled={enCours}>
                <AvecIcone icone={Fingerprint}>{enCours ? "En attente de l'appareil…" : "Créer ma clé d'accès"}</AvecIcone>
              </button>
            </>
          ) : (
            <p className="erreur">Ce navigateur ne prend pas en charge les clés d'accès : ouvrez le lien avec Safari, Chrome ou Edge à jour.</p>
          )}
        </form>
      ) : erreur ? (
        <div className="admin-carte">
          <p className="erreur">{erreur}</p>
          <a className="bouton" href="/admin">
            Aller à la connexion
          </a>
        </div>
      ) : (
        <p>Chargement…</p>
      )}
    </div>
  );
}
