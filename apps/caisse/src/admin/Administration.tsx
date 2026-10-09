import { afficherCode, ID_ETABLISSEMENT_VALIDE, PIN_VALIDE, type IdentiteEtablissement, type Role, type UtilisateurApi } from "@matalon/serveur/partage";
import QRCode from "qrcode";
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { genererTables } from "../donnees/configuration";
import type { ClientApi, PostesProduction, ReponseComptes, ResumeCarte } from "@matalon/serveur/partage";
import { postesDeLaCarte } from "@matalon/catalogue";
import { EditeurPostes } from "../ui/EditeurPostes";
import { EditeurPlan } from "../ui/EditeurPlan";
import { nouvelIdClient } from "../donnees/clients";
import type { AlerteApi } from "@matalon/serveur/partage";
import { api, ErreurAdmin, type CaisseAdmin, type EtablissementAdmin, type RapportVerification, type ResumeCloture } from "./api";
import { EditeurCarte, ListeCartes } from "./EditeurCarte";
import { Stock } from "./Stock";
import {
  Archive,
  Ban,
  Bell,
  Check,
  History,
  BookOpen,
  FileJson,
  FileSpreadsheet,
  KeyRound,
  LayoutGrid,
  NotebookPen,
  Package,
  Pencil,
  LogIn,
  LogOut,
  Plus,
  Printer,
  RotateCw,
  Save,
  ShieldCheck,
  Smartphone,
  Store,
  Tablet,
  TabletSmartphone,
  TriangleAlert,
  UserCheck,
  UserPlus,
  Users,
  UserX,
  type LucideIcon,
} from "lucide-react";
import { typeDepuisDescription, type TypeAppareil } from "../donnees/appareil";
import { AvecIcone, BoutonIcone } from "../ui/icones";

const ICONE_APPAREIL: Record<TypeAppareil, LucideIcon> = { iPad: Tablet, iPhone: Smartphone, Autre: Tablet };
/** L'iPad est dessiné à l'horizontale, comme posé sur le comptoir, pour ne pas le confondre avec l'iPhone. */
const CLASSE_APPAREIL: Record<TypeAppareil, string | undefined> = { iPad: "paysage", iPhone: undefined, Autre: "paysage" };

/** Titre de section précédé de son icône. */
function Titre(props: { icone: LucideIcon; children: ReactNode }) {
  return (
    <h2 className="titre-icone">
      <AvecIcone icone={props.icone} taille={22}>
        {props.children}
      </AvecIcone>
    </h2>
  );
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const dateHeure = (iso: string | null) => (iso ? new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "—");
const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? "s" : ""}`;
const euros = (c: number) => (c / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });

const CHAMPS_IDENTITE: Array<[keyof IdentiteEtablissement, string, string?]> = [
  ["enseigne", "Enseigne"],
  ["raisonSociale", "Raison sociale", "Société qui exploite l'établissement"],
  ["adresse", "Adresse"],
  ["codePostalVille", "Code postal et ville"],
  ["telephone", "Téléphone"],
  ["siret", "SIRET", "14 chiffres"],
  ["tvaIntracom", "N° de TVA intracommunautaire"],
  ["mentionsLegales", "Mentions des factures", "Forme juridique, capital, RCS — ex. SAS au capital de 10 000 € · RCS Annecy 123 456 789"],
];

/** Petit formulaire avec gestion de l'envoi et de l'erreur. */
function useEnvoi() {
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState("");
  const envoyer = useCallback(async (action: () => Promise<void>) => {
    setEnCours(true);
    setErreur("");
    try {
      await action();
    } catch (e) {
      setErreur(message(e));
    } finally {
      setEnCours(false);
    }
  }, []);
  return { enCours, erreur, setErreur, envoyer };
}

function Champ(props: { libelle: string; aide?: string; children: ReactNode }) {
  return (
    <label className="champ">
      <span>
        {props.libelle}
        {props.aide && <small>{props.aide}</small>}
      </span>
      {props.children}
    </label>
  );
}

// ───────── Accès ─────────

export function Administration() {
  const [statut, setStatut] = useState<{ initialise: boolean; connecte: boolean; identifiant: string | null } | null>(null);
  const [erreur, setErreur] = useState("");

  const charger = useCallback(() => {
    api
      .statut()
      .then(setStatut)
      .catch((e) => setErreur(message(e)));
  }, []);
  useEffect(charger, [charger]);

  if (erreur) {
    return (
      <div className="admin-acces">
        <h1>Administration indisponible</h1>
        <p className="erreur">{erreur}</p>
        <button className="bouton" onClick={() => location.reload()}>
          <AvecIcone icone={RotateCw}>Réessayer</AvecIcone>
        </button>
      </div>
    );
  }
  if (!statut) return <div className="admin-acces">Chargement…</div>;
  if (!statut.initialise) return <Initialisation onTermine={charger} />;
  if (!statut.connecte) return <ConnexionAdmin onConnecte={charger} />;
  return <Tableau identifiant={statut.identifiant ?? ""} onDeconnecte={charger} />;
}

function EnteteAcces(props: { titre: string; children?: ReactNode }) {
  return (
    <header className="admin-acces-tete">
      <img src="/icone.svg" alt="" width={56} height={56} />
      <div>
        <p className="surtitre">Matalon POS · Administration</p>
        <h1>{props.titre}</h1>
      </div>
      {props.children}
    </header>
  );
}

/** Premier accès : création du compte administrateur, puis activation de la double authentification. */
function Initialisation(props: { onTermine: () => void }) {
  const [identifiant, setIdentifiant] = useState("");
  const [motDePasse, setMotDePasse] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [secret, setSecret] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState("");
  const { enCours, erreur, setErreur, envoyer } = useEnvoi();

  const creer = (e: FormEvent) => {
    e.preventDefault();
    if (motDePasse.length < 12) return setErreur("Le mot de passe doit compter au moins 12 caractères.");
    if (motDePasse !== confirmation) return setErreur("Les deux mots de passe sont différents.");
    void envoyer(async () => {
      const r = await api.initialiser(identifiant.trim(), motDePasse);
      setSecret({ secret: r.secret, qr: await QRCode.toDataURL(r.otpauth, { margin: 1, width: 220 }) });
    });
  };

  const activer = (e: FormEvent) => {
    e.preventDefault();
    void envoyer(async () => {
      await api.confirmer(identifiant.trim(), motDePasse, code);
      props.onTermine();
    });
  };

  return (
    <div className="admin-acces">
      <EnteteAcces titre="Créer le compte administrateur" />
      {!secret ? (
        <form className="admin-carte" onSubmit={creer}>
          <p>
            Ce compte gère les établissements, les équipes et les caisses (iPad et iPhone) du groupe. Il est protégé par un mot de passe et un
            code à usage unique (application d'authentification).
          </p>
          <Champ libelle="Identifiant">
            <input value={identifiant} onChange={(e) => setIdentifiant(e.target.value)} autoComplete="username" required minLength={3} />
          </Champ>
          <Champ libelle="Mot de passe" aide="12 caractères minimum">
            <input type="password" value={motDePasse} onChange={(e) => setMotDePasse(e.target.value)} autoComplete="new-password" required />
          </Champ>
          <Champ libelle="Confirmer le mot de passe">
            <input type="password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} autoComplete="new-password" required />
          </Champ>
          <p className="erreur" aria-live="assertive">
            {erreur}
          </p>
          <button className="bouton principal" disabled={enCours}>
            <AvecIcone icone={ShieldCheck}>Continuer</AvecIcone>
          </button>
        </form>
      ) : (
        <form className="admin-carte" onSubmit={activer}>
          <p>
            Scannez ce QR code avec votre application d'authentification (Google Authenticator, 1Password, Authy…), puis
            saisissez le code à 6 chiffres qu'elle affiche.
          </p>
          <div className="admin-totp">
            <img src={secret.qr} alt="QR code de la double authentification" width={220} height={220} />
            <div>
              <small>Ou saisissez la clé à la main :</small>
              <code>{secret.secret.replace(/(.{4})/g, "$1 ").trim()}</code>
            </div>
          </div>
          <Champ libelle="Code à 6 chiffres">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              required
            />
          </Champ>
          <p className="erreur" aria-live="assertive">
            {erreur}
          </p>
          <button className="bouton principal" disabled={enCours || code.length !== 6}>
            <AvecIcone icone={LogIn}>Activer et se connecter</AvecIcone>
          </button>
        </form>
      )}
    </div>
  );
}

function ConnexionAdmin(props: { onConnecte: () => void }) {
  const [identifiant, setIdentifiant] = useState("");
  const [motDePasse, setMotDePasse] = useState("");
  const [code, setCode] = useState("");
  const { enCours, erreur, envoyer } = useEnvoi();
  const valider = (e: FormEvent) => {
    e.preventDefault();
    void envoyer(async () => {
      await api.connexion(identifiant.trim(), motDePasse, code);
      props.onConnecte();
    });
  };
  return (
    <div className="admin-acces">
      <EnteteAcces titre="Connexion" />
      <form className="admin-carte" onSubmit={valider}>
        <Champ libelle="Identifiant">
          <input value={identifiant} onChange={(e) => setIdentifiant(e.target.value)} autoComplete="username" required />
        </Champ>
        <Champ libelle="Mot de passe">
          <input type="password" value={motDePasse} onChange={(e) => setMotDePasse(e.target.value)} autoComplete="current-password" required />
        </Champ>
        <Champ libelle="Code de l'application d'authentification">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            required
          />
        </Champ>
        <p className="erreur" aria-live="assertive">
          {erreur}
        </p>
        <button className="bouton principal" disabled={enCours || code.length !== 6}>
          <AvecIcone icone={LogIn}>Se connecter</AvecIcone>
        </button>
      </form>
    </div>
  );
}

// ───────── Tableau de bord ─────────

function Tableau(props: { identifiant: string; onDeconnecte: () => void }) {
  const [donnees, setDonnees] = useState<Awaited<ReturnType<typeof api.etablissements>> | null>(null);
  const [cartes, setCartes] = useState<ResumeCarte[]>([]);
  /** Vue courante : établissement (id ou « nouveau »), liste des cartes, ou une carte en édition. */
  const [choisi, setChoisi] = useState<string | null>(null);
  const [carteOuverte, setCarteOuverte] = useState<string | null>(null);
  const [carteModifiee, setCarteModifiee] = useState(false);
  /** Changer de vue avec une carte modifiée non enregistrée demande confirmation. */
  const aller = (vue: string, carte: string | null = null) => {
    if (carteModifiee && !window.confirm("La carte a des modifications non enregistrées. Les abandonner ?")) return;
    setCarteModifiee(false);
    setChoisi(vue);
    setCarteOuverte(carte);
  };
  const [erreur, setErreur] = useState("");

  const recharger = useCallback(async () => {
    try {
      const [d, c] = await Promise.all([api.etablissements(), api.cartes()]);
      setDonnees(d);
      setCartes(c.cartes);
      setChoisi((x) => x ?? d.etablissements[0]?.id ?? "nouveau");
    } catch (e) {
      if (e instanceof ErreurAdmin && e.statut === 401) return props.onDeconnecte();
      setErreur(message(e));
    }
  }, [props]);
  useEffect(() => {
    void recharger();
  }, [recharger]);

  const etablissement = donnees?.etablissements.find((e) => e.id === choisi);

  return (
    <div className="admin">
      <header className="admin-barre">
        <div className="barre-marque">
          <img src="/icone.svg" alt="" width={34} height={34} />
          <span>Matalon POS</span>
          <small>Administration</small>
        </div>
        <div className="admin-barre-droite">
          <span className="admin-identifiant">{props.identifiant}</span>
          <BoutonIcone
            icone={LogOut}
            libelle={`Se déconnecter (${props.identifiant})`}
            variante="discret"
            onClick={() => void api.deconnexion().finally(props.onDeconnecte)}
          />
        </div>
      </header>
      <div className="admin-corps">
        <nav className="admin-liste" aria-label="Établissements">
          <h2>Établissements</h2>
          {donnees?.etablissements.map((e) => {
            const actives = e.caisses.filter((c) => !c.revoqueeLe).length;
            const personnes = e.utilisateurs.filter((u) => u.actif).length;
            const divergence = e.caisses.some((c) => c.divergence && !c.revoqueeLe);
            return (
              <button
                key={e.id}
                className={`admin-lien${e.id === choisi ? " actif" : ""}`}
                onClick={() => aller(e.id)}
                aria-label={`${e.identite.enseigne} : ${pluriel(actives, "caisse")}, ${pluriel(personnes, "personne")}${divergence ? ", divergence" : ""}${e.alertesNonVues ? `, ${pluriel(e.alertesNonVues, "alerte")}` : ""}`}
              >
                <strong>
                  <AvecIcone icone={Store}>{e.identite.enseigne}</AvecIcone>
                </strong>
                <small className="admin-compteurs" aria-hidden="true">
                  <span title="Caisses en service">
                    <AvecIcone icone={Tablet} taille={16} classe="paysage">{actives}</AvecIcone>
                  </span>
                  <span title="Personnes actives">
                    <AvecIcone icone={Users} taille={16}>{personnes}</AvecIcone>
                  </span>
                  {e.alertesNonVues > 0 && (
                    <span className="erreur" title="Alertes à lire">
                      <AvecIcone icone={Bell} taille={16}>{e.alertesNonVues}</AvecIcone>
                    </span>
                  )}
                  {divergence && (
                    <span className="erreur" title="Divergence de synchronisation">
                      <AvecIcone icone={TriangleAlert} taille={16} />
                    </span>
                  )}
                </small>
              </button>
            );
          })}
          <button className={`admin-lien${choisi === "nouveau" ? " actif" : ""}`} onClick={() => aller("nouveau")}>
            <strong>
              <AvecIcone icone={Plus}>Établissement</AvecIcone>
            </strong>
          </button>
          <h2 className="admin-liste-titre">Cartes</h2>
          <button
            className={`admin-lien${choisi === "cartes" ? " actif" : ""}`}
            onClick={() => aller("cartes")}
            aria-label={`Cartes et prix : ${pluriel(cartes.length, "carte")}`}
          >
            <strong>
              <AvecIcone icone={BookOpen}>Cartes et prix</AvecIcone>
            </strong>
            <small aria-hidden="true">{pluriel(cartes.length, "carte")}</small>
          </button>
          <button className={`admin-lien${choisi === "stock" ? " actif" : ""}`} onClick={() => aller("stock")}>
            <strong>
              <AvecIcone icone={Package}>Stock et recettes</AvecIcone>
            </strong>
            <small aria-hidden="true">Produits, fournisseurs, fiches</small>
          </button>
        </nav>
        <main className="admin-contenu">
          {erreur && <p className="erreur">{erreur}</p>}
          {!donnees ? (
            <p>Chargement…</p>
          ) : choisi === "stock" ? (
            <Stock />
          ) : choisi === "cartes" ? (
            carteOuverte ? (
              <EditeurCarte
                key={carteOuverte}
                id={carteOuverte}
                onRetour={() => aller("cartes")}
                onEnregistre={() => void recharger()}
                onModifiee={setCarteModifiee}
              />
            ) : (
              <ListeCartes
                cartes={cartes}
                onOuvrir={setCarteOuverte}
                onCree={(id) => {
                  void recharger();
                  setCarteOuverte(id);
                }}
              />
            )
          ) : choisi === "nouveau" || !etablissement ? (
            <NouvelEtablissement
              cartes={donnees.cartes}
              onCree={(id) => {
                setChoisi(id);
                void recharger();
              }}
            />
          ) : (
            <FicheEtablissement key={etablissement.id} e={etablissement} cartes={donnees.cartes} onChange={recharger} />
          )}
        </main>
      </div>
    </div>
  );
}

function NouvelEtablissement(props: { cartes: Array<{ id: string; nom: string }>; onCree: (id: string) => void }) {
  const [enseigne, setEnseigne] = useState("");
  const [id, setId] = useState("");
  const [idModifie, setIdModifie] = useState(false);
  const [carteId, setCarteId] = useState(props.cartes[0]?.id ?? "");
  const { enCours, erreur, setErreur, envoyer } = useEnvoi();
  const identifiantAuto = enseigne
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const ident = idModifie ? id : identifiantAuto;

  const creer = (e: FormEvent) => {
    e.preventDefault();
    if (!ID_ETABLISSEMENT_VALIDE.test(ident)) return setErreur("Identifiant : minuscules, chiffres et tirets, 2 caractères minimum.");
    void envoyer(async () => {
      await api.creerEtablissement({ id: ident, identite: { enseigne: enseigne.trim() }, carteId, tables: genererTables(10), seuilNote: 2500 });
      props.onCree(ident);
    });
  };

  return (
    <form className="admin-section" onSubmit={creer}>
      <h1 className="titre-icone">
        <AvecIcone icone={Store} taille={26}>Nouvel établissement</AvecIcone>
      </h1>
      <p className="explication">
        L'identifiant figure dans chaque ticket de ses caisses : il ne pourra plus changer. Le reste (identité légale, salle,
        équipe) se complète ensuite.
      </p>
      <Champ libelle="Enseigne">
        <input value={enseigne} onChange={(e) => setEnseigne(e.target.value)} required />
      </Champ>
      <Champ libelle="Identifiant" aide="Minuscules, chiffres et tirets">
        <input
          value={ident}
          onChange={(e) => {
            setIdModifie(true);
            setId(e.target.value.toLowerCase());
          }}
          required
        />
      </Champ>
      <Champ libelle="Carte">
        <select value={carteId} onChange={(e) => setCarteId(e.target.value)}>
          {props.cartes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nom}
            </option>
          ))}
        </select>
      </Champ>
      <p className="erreur" aria-live="assertive">
        {erreur}
      </p>
      <button className="bouton principal" disabled={enCours}>
        <AvecIcone icone={Plus}>Créer l'établissement</AvecIcone>
      </button>
    </form>
  );
}

// ───────── Fiche établissement ─────────

function FicheEtablissement(props: { e: EtablissementAdmin; cartes: Array<{ id: string; nom: string }>; onChange: () => Promise<void> }) {
  const { e } = props;
  const responsable = e.utilisateurs.some((u) => u.role === "responsable" && u.actif);
  const identiteIncomplete = !e.identite.raisonSociale || !e.identite.siret || !e.identite.tvaIntracom || !e.identite.adresse || !e.identite.mentionsLegales;
  return (
    <>
      <header className="admin-fiche-tete">
        <div>
          <p className="surtitre">{e.id}</p>
          <h1>{e.identite.enseigne}</h1>
        </div>
      </header>
      {identiteIncomplete && (
        <p className="admin-alerte">
          <TriangleAlert className="icone" size={20} aria-hidden="true" /> Identité légale incomplète : raison sociale, adresse, SIRET et n° de TVA figurent sur chaque note client ; forme juridique, capital et RCS sont exigés pour émettre des factures.
        </p>
      )}
      <Alertes e={e} onChange={props.onChange} />
      <Rattacher e={e} responsable={responsable} onChange={props.onChange} />
      <Caisses e={e} caisses={e.caisses} onChange={props.onChange} />
      <Equipe e={e} onChange={props.onChange} />
      <PlanDeSalle e={e} onChange={props.onChange} />
      <ImprimantesProduction e={e} onChange={props.onChange} />
      <ComptesClients etablissementId={e.id} />
      <Identite e={e} cartes={props.cartes} onChange={props.onChange} />
    </>
  );
}

const LIBELLES_ALERTE: Record<AlerteApi["type"], string> = {
  PRIX_DIFFERENT: "Prix différent de la carte",
  ARTICLE_HORS_CARTE: "Article hors carte",
  PIN_BLOQUE: "Code PIN bloqué",
};

/**
 * Alertes de l'établissement : ventes à un autre prix que la carte, articles
 * hors carte, codes PIN bloqués. Elles ne bloquent rien ; on les marque vues.
 */
function Alertes(props: { e: EtablissementAdmin; onChange: () => Promise<void> }) {
  const [toutes, setToutes] = useState(false);
  const [alertes, setAlertes] = useState<AlerteApi[] | string | null>(null);
  const charger = useCallback(async () => {
    try {
      setAlertes((await api.alertes(props.e.id, toutes)).alertes);
    } catch (e) {
      setAlertes(message(e));
    }
  }, [props.e.id, toutes]);
  useEffect(() => void charger(), [charger, props.e.alertesNonVues]);
  const vue = async (a: AlerteApi) => {
    try {
      await api.marquerAlerteVue(a.id);
      await props.onChange();
      await charger();
    } catch (e) {
      setAlertes(message(e));
    }
  };
  const nom = (id: string | null) => props.e.caisses.find((c) => c.id === id)?.nom ?? id ?? "Serveur";
  return (
    <section className="admin-section">
      <Titre icone={Bell}>Alertes{props.e.alertesNonVues ? ` (${props.e.alertesNonVues})` : ""}</Titre>
      {typeof alertes === "string" ? (
        <p className="erreur">{alertes}</p>
      ) : !alertes ? (
        <p className="explication">Chargement…</p>
      ) : alertes.length === 0 ? (
        <p className="explication">{toutes ? "Aucune alerte." : "Aucune alerte à lire : prix conformes à la carte, aucun code PIN bloqué."}</p>
      ) : (
        <table className="tableau admin-tableau admin-alertes">
          <tbody>
            {alertes.map((a) => (
              <tr key={a.id} className={a.vueLe ? "annule" : ""}>
                <td>
                  <strong>{LIBELLES_ALERTE[a.type] ?? a.type}</strong>
                  <br />
                  <small>
                    {dateHeure(a.creeLe)} · {nom(a.caisseId)}
                    {a.vueLe ? ` · vue le ${dateHeure(a.vueLe)} par ${a.vuePar}` : ""}
                  </small>
                </td>
                <td>{a.message}</td>
                <td className="nombre">
                  {!a.vueLe && (
                    <button className="bouton discret" onClick={() => void vue(a)}>
                      <AvecIcone icone={Check}>Vu</AvecIcone>
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="admin-actions">
        <button className="bouton discret" aria-pressed={toutes} onClick={() => setToutes((t) => !t)}>
          <AvecIcone icone={History}>{toutes ? "Seulement les alertes à lire" : "Voir aussi les alertes vues"}</AvecIcone>
        </button>
      </div>
    </section>
  );
}

function Rattacher(props: { e: EtablissementAdmin; responsable: boolean; onChange: () => Promise<void> }) {
  const [type, setType] = useState<"iPad" | "iPhone">("iPad");
  const [nom, setNom] = useState("");
  const [nouveau, setNouveau] = useState<{ code: string; expireLe: string; nomCaisse: string } | null>(null);
  const { enCours, erreur, envoyer } = useEnvoi();
  const generer = (ev: FormEvent) => {
    ev.preventDefault();
    void envoyer(async () => {
      setNouveau(await api.genererCode(props.e.id, nom.trim() || type));
      setNom("");
      await props.onChange();
    });
  };
  return (
    <section className="admin-section">
      <Titre icone={Plus}>Rattacher un iPad ou un iPhone</Titre>
      {!props.responsable ? (
        <p className="explication">Ajoutez d'abord un responsable à l'équipe : sans lui, personne ne pourrait ouvrir la caisse.</p>
      ) : (
        <>
          <div className="options" role="radiogroup" aria-label="Appareil à rattacher">
            {(["iPad", "iPhone"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={type === t}
                className={`option${type === t ? " active" : ""}`}
                onClick={() => setType(t)}
              >
                <AvecIcone icone={ICONE_APPAREIL[t]} classe={CLASSE_APPAREIL[t]}>{t}</AvecIcone>
              </button>
            ))}
          </div>
          <p className="explication">
            Sur l'{type}, ouvrez {location.host} dans Safari, ajoutez-le à l'écran d'accueil (Partager › Sur l'écran d'accueil),
            ouvrez-le depuis cette icône, puis saisissez le code. Un code sert une seule fois et expire au bout de 48 heures.
          </p>
          <form className="admin-ligne" onSubmit={generer}>
            <input
              value={nom}
              onChange={(ev) => setNom(ev.target.value)}
              placeholder={type === "iPad" ? "Nom de l'iPad (Comptoir, Terrasse…)" : "Nom de l'iPhone (Salle, Lionel…)"}
              aria-label={`Nom de l'${type}`}
              maxLength={40}
            />
            <button className="bouton principal" disabled={enCours}>
              <AvecIcone icone={KeyRound}>Générer un code</AvecIcone>
            </button>
          </form>
          {erreur && <p className="erreur">{erreur}</p>}
          {nouveau && (
            <div className="admin-code" role="status">
              <span>{afficherCode(nouveau.code)}</span>
              <small>
                {nouveau.nomCaisse} · valable jusqu'au {dateHeure(nouveau.expireLe)}
              </small>
            </div>
          )}
          {props.e.codes.filter((c) => c.code !== nouveau?.code).length > 0 && (
            <p className="explication">
              Codes encore valables :{" "}
              {props.e.codes
                .filter((c) => c.code !== nouveau?.code)
                .map((c) => `${afficherCode(c.code)} (${c.nomCaisse}, jusqu'au ${dateHeure(c.expireLe)})`)
                .join(" · ")}
            </p>
          )}
        </>
      )}
    </section>
  );
}

/** Résumé d'un rapport de vérification. */
function ResumeRapport({ rapport, objet }: { rapport: RapportVerification | string; objet: string }) {
  return (
    <p className={typeof rapport !== "string" && !rapport.integre ? "erreur" : "admin-ok"}>
      {typeof rapport === "string"
        ? rapport
        : rapport.integre
          ? `${objet} intègre : ${pluriel(rapport.compteurs.tickets ?? 0, "ticket")}, ${pluriel(rapport.compteurs.evenements ?? 0, "événement")}, ${pluriel(rapport.compteurs.clotures ?? 0, "clôture")}.`
          : `${pluriel(rapport.anomalies.length, "anomalie")} : ${rapport.anomalies
              .slice(0, 3)
              .map((x) => `${x.chaine ?? ""} n°${x.numero ?? "?"} ${x.code}${x.detail ? ` (${x.detail})` : ""}`)
              .join(", ")}`}
    </p>
  );
}

function Caisses(props: { e: EtablissementAdmin; caisses: CaisseAdmin[]; onChange: () => Promise<void> }) {
  const [rapports, setRapports] = useState<Record<string, RapportVerification | string>>({});
  const [rapportEtablissement, setRapportEtablissement] = useState<RapportVerification | string | null>(null);
  /** Clôtures, chaînage entre appareils et totaux de toutes les caisses ensemble. */
  const verifierEtablissement = async () => {
    setRapportEtablissement("Vérification…");
    try {
      setRapportEtablissement(await api.verifierEtablissement(props.e.id));
    } catch (e) {
      setRapportEtablissement(message(e));
    }
  };
  const [clotures, setClotures] = useState<Record<string, ResumeCloture[] | undefined>>({});
  const basculerClotures = async (id: string) => {
    if (clotures[id]) return setClotures((x) => ({ ...x, [id]: undefined }));
    try {
      const r = await api.clotures(id);
      setClotures((x) => ({ ...x, [id]: r.clotures }));
    } catch (e) {
      setRapports((r) => ({ ...r, [id]: message(e) }));
    }
  };
  const verifier = async (id: string) => {
    setRapports((r) => ({ ...r, [id]: "Vérification…" }));
    try {
      const rapport = await api.verifier(id);
      setRapports((r) => ({ ...r, [id]: rapport }));
    } catch (e) {
      setRapports((r) => ({ ...r, [id]: message(e) }));
    }
  };
  const revoquer = async (c: CaisseAdmin) => {
    if (!window.confirm(`Révoquer « ${c.nom} » ? Cet appareil ne pourra plus encaisser ni se synchroniser. C'est définitif.`)) return;
    try {
      await api.revoquer(c.id);
      await props.onChange();
    } catch (e) {
      window.alert(message(e));
    }
  };
  return (
    <section className="admin-section">
      <Titre icone={TabletSmartphone}>Appareils rattachés</Titre>
      <p className="explication">
        Les clôtures (Z, mois, exercice) valent pour tout l'établissement, quel que soit l'appareil qui les a faites. Le contrôle
        d'établissement vérifie qu'elles couvrent chaque caisse sans trou ni double compte.
      </p>
      {props.e.anomalieCloture && <p className="erreur">Clôtures : {props.e.anomalieCloture}</p>}
      {rapportEtablissement && <ResumeRapport rapport={rapportEtablissement} objet="Établissement" />}
      {props.caisses.length > 0 && (
        <div className="admin-actions">
          <button className="bouton" onClick={() => void verifierEtablissement()} title="Vérifier les clôtures de tout l'établissement">
            <AvecIcone icone={ShieldCheck}>Vérifier l'établissement</AvecIcone>
          </button>
        </div>
      )}
      {props.caisses.length === 0 ? (
        <p className="explication">Aucun iPad ni iPhone pour l'instant.</p>
      ) : (
        <div className="admin-caisses">
          {props.caisses.map((c) => {
            const rapport = rapports[c.id];
            const type = typeDepuisDescription(c.appareil);
            return (
              <article key={c.id} className={`admin-caisse${c.revoqueeLe ? " revoquee" : ""}`}>
                <header>
                  <strong>
                    <AvecIcone icone={ICONE_APPAREIL[type]} classe={CLASSE_APPAREIL[type]}>{c.nom}</AvecIcone>
                  </strong>
                  <small>{type === "Autre" ? c.id : `${type} · ${c.id}`}</small>
                  <span className={c.divergence && !c.revoqueeLe ? "erreur" : "etat"}>
                    {c.revoqueeLe ? `Révoqué le ${dateHeure(c.revoqueeLe)}` : c.divergence ? "Divergence" : "En service"}
                  </span>
                </header>
                <p className="admin-meta">
                  Clé {c.empreinteCle.slice(0, 32)} · rattaché le {dateHeure(c.rattacheeLe)} · dernière synchronisation {dateHeure(c.derniereSynchro)} ·{" "}
                  {pluriel(c.derniers.tickets?.numero ?? 0, "ticket")} · {pluriel(c.derniers.clotures?.numero ?? 0, "clôture")}
                </p>
                {c.divergence && !c.revoqueeLe && <p className="erreur">{c.divergence}</p>}
                {clotures[c.id] && (
                  <div className="admin-clotures">
                    {clotures[c.id]!.length === 0 ? (
                      <p className="explication">Aucune clôture reçue.</p>
                    ) : (
                      <table className="tableau admin-tableau">
                        <tbody>
                          {clotures[c.id]!.map((z) => (
                            <tr key={z.numero}>
                              <td>
                                {z.periode === "JOUR" ? "Z" : z.periode === "MOIS" ? "Mois" : "Exercice"} {z.identifiantPeriode}
                                <br />
                                <small>n° {z.numero} · {pluriel(z.nbVentes, "vente")}</small>
                              </td>
                              <td className="nombre">{euros(z.totalTTC)}</td>
                              <td>
                                <a
                                  className="bouton bouton-icone discret"
                                  href={api.urlArchive(c.id, z.numero)}
                                  aria-label={`Télécharger l'archive de la clôture n° ${z.numero} (JSON)`}
                                  title="Télécharger l'archive (JSON)"
                                >
                                  <AvecIcone icone={Archive} />
                                </a>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
                {rapport && <ResumeRapport rapport={rapport} objet="Chaîne" />}
                <div className="admin-actions">
                  <button className="bouton" onClick={() => void verifier(c.id)} title="Vérifier la chaîne fiscale">
                    <AvecIcone icone={ShieldCheck}>Vérifier</AvecIcone>
                  </button>
                  <button className="bouton" aria-expanded={!!clotures[c.id]} onClick={() => void basculerClotures(c.id)} title="Clôtures et archives">
                    <AvecIcone icone={Archive}>Clôtures</AvecIcone>
                  </button>
                  <a className="bouton" href={api.urlCsv(c.id)} title="Télécharger les clôtures (CSV)">
                    <AvecIcone icone={FileSpreadsheet}>CSV</AvecIcone>
                  </a>
                  <a className="bouton" href={api.urlJournal(c.id)} title="Télécharger le journal complet (JSON)">
                    <AvecIcone icone={FileJson}>Journal</AvecIcone>
                  </a>
                  {!c.revoqueeLe && (
                    <button className="bouton danger" onClick={() => void revoquer(c)} title="Révoquer cet appareil">
                      <AvecIcone icone={Ban}>Révoquer</AvecIcone>
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function Equipe(props: { e: EtablissementAdmin; onChange: () => Promise<void> }) {
  const [nom, setNom] = useState("");
  const [role, setRole] = useState<Role>(props.e.utilisateurs.length ? "serveur" : "responsable");
  const [pin, setPin] = useState("");
  const { enCours, erreur, setErreur, envoyer } = useEnvoi();

  const ajouter = (ev: FormEvent) => {
    ev.preventDefault();
    if (!PIN_VALIDE.test(pin)) return setErreur("Le code PIN compte 4 chiffres.");
    void envoyer(async () => {
      await api.enregistrerUtilisateur(props.e.id, { nom: nom.trim(), role, pin, actif: true });
      setNom("");
      setPin("");
      setRole("serveur");
      await props.onChange();
    });
  };
  const modifier = (u: UtilisateurApi, maj: Partial<{ role: Role; actif: boolean; pin: string }>) =>
    envoyer(async () => {
      await api.enregistrerUtilisateur(props.e.id, { id: u.id, nom: u.nom, role: maj.role ?? u.role, actif: maj.actif ?? u.actif, pin: maj.pin });
      await props.onChange();
    });
  const changerPin = (u: UtilisateurApi) => {
    const p = window.prompt(`Nouveau code PIN à 4 chiffres pour ${u.nom}`);
    if (p == null) return;
    if (!PIN_VALIDE.test(p)) return setErreur("Le code PIN compte 4 chiffres.");
    void modifier(u, { pin: p });
  };

  return (
    <section className="admin-section">
      <Titre icone={Users}>Équipe</Titre>
      <p className="explication">
        Chaque personne se connecte en caisse avec son code PIN. Les responsables valident annulations et clôtures. Les
        changements arrivent sur les iPad et iPhone à la synchronisation suivante (une minute au plus en ligne).
      </p>
      {props.e.utilisateurs.length > 0 && (
        <table className="tableau admin-tableau">
          <tbody>
            {props.e.utilisateurs.map((u) => (
              <tr key={u.id} className={u.actif ? "" : "annule"}>
                <td>{u.nom}</td>
                <td>
                  <select value={u.role} disabled={enCours} onChange={(ev) => void modifier(u, { role: ev.target.value as Role })}>
                    <option value="serveur">Serveur</option>
                    <option value="responsable">Responsable</option>
                  </select>
                </td>
                <td className="admin-boutons">
                  <BoutonIcone icone={KeyRound} libelle={`Changer le code PIN de ${u.nom}`} variante="discret" disabled={enCours} onClick={() => changerPin(u)} />
                  <BoutonIcone
                    icone={u.actif ? UserX : UserCheck}
                    libelle={`${u.actif ? "Désactiver" : "Réactiver"} ${u.nom}`}
                    variante="discret"
                    disabled={enCours}
                    onClick={() => void modifier(u, { actif: !u.actif })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <form className="admin-ligne" onSubmit={ajouter}>
        <input placeholder="Prénom" value={nom} onChange={(ev) => setNom(ev.target.value)} required maxLength={60} />
        <select value={role} onChange={(ev) => setRole(ev.target.value as Role)}>
          <option value="serveur">Serveur</option>
          <option value="responsable">Responsable</option>
        </select>
        <input
          placeholder="Code PIN"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={4}
          value={pin}
          onChange={(ev) => setPin(ev.target.value.replace(/\D/g, ""))}
        />
        <button className="bouton" disabled={enCours}>
          <AvecIcone icone={UserPlus}>Ajouter</AvecIcone>
        </button>
      </form>
      {props.e.utilisateurs.length === 0 && <p className="explication">Commencez par un responsable.</p>}
      {erreur && <p className="erreur">{erreur}</p>}
    </section>
  );
}

/** Comptes clients (ardoises) : soldes recalculés par le serveur sur toutes les caisses, fiches clients. */
/** Plan de salle : tables (forme, chaises, place) et repères, zone par zone. */
function PlanDeSalle(props: { e: EtablissementAdmin; onChange: () => Promise<void> }) {
  const { e } = props;
  const plan = useMemo(() => ({ zones: e.zones ?? [], tables: e.tables, version: e.planVersion ?? 0 }), [e.zones, e.tables, e.planVersion]);
  const [ok, setOk] = useState(false);
  return (
    <section className="admin-section">
      <Titre icone={LayoutGrid}>Plan de salle</Titre>
      <p className="explication">
        Ajoutez les tables (carré, rectangle, rond), réglez leurs chaises et glissez-les à leur place ; bar, porte et murs servent de
        repères. Grille de 25 cm. Un responsable peut aussi modifier le plan depuis l'iPad. {ok && <span className="admin-ok">Plan enregistré.</span>}
      </p>
      <EditeurPlan
        plan={plan}
        onEnregistrer={async (p) => {
          await api.enregistrerPlan(e.id, p);
          setOk(true);
          await props.onChange();
        }}
      />
    </section>
  );
}

/** Postes de production de la carte de l'établissement → imprimantes de son réseau. */
function ImprimantesProduction(props: { e: EtablissementAdmin; onChange: () => Promise<void> }) {
  const [postesCarte, setPostesCarte] = useState<string[] | null>(null);
  const { erreur, envoyer } = useEnvoi();
  useEffect(() => {
    void envoyer(async () => setPostesCarte(postesDeLaCarte((await api.carte(props.e.carteId)).carte)));
  }, [envoyer, props.e.carteId, props.e.carteVersion]);
  const enregistrer = async (postes: PostesProduction) => {
    await api.enregistrerPostes(props.e.id, postes);
    await props.onChange();
  };
  return (
    <section className="admin-section">
      <Titre icone={Printer}>Imprimantes de production</Titre>
      <p className="explication">
        Les catégories de la carte désignent leur poste (bar, cuisine) ; indiquez ici l'adresse IP de l'imprimante de chaque poste sur
        le réseau de l'établissement. Le bon d'essai s'imprime depuis les Réglages d'une caisse, sur place.
      </p>
      {erreur && <p className="erreur">{erreur}</p>}
      {postesCarte && <EditeurPostes postesCarte={postesCarte} valeur={props.e.postesProduction ?? {}} onEnregistrer={enregistrer} />}
    </section>
  );
}

function ComptesClients(props: { etablissementId: string }) {
  const [donnees, setDonnees] = useState<ReponseComptes | null>(null);
  const [edition, setEdition] = useState<ClientApi | null>(null);
  const { enCours, erreur, envoyer } = useEnvoi();
  const charger = useCallback(() => envoyer(async () => setDonnees(await api.comptes(props.etablissementId))), [envoyer, props.etablissementId]);
  useEffect(() => void charger(), [charger]);
  const enregistrer = (ev: FormEvent) => {
    ev.preventDefault();
    if (!edition) return;
    void envoyer(async () => {
      await api.enregistrerClient(props.etablissementId, {
        ...edition,
        nom: edition.nom.trim(),
        telephone: edition.telephone.trim(),
        email: (edition.email ?? "").trim().toLowerCase(),
      });
      setEdition(null);
      setDonnees(await api.comptes(props.etablissementId));
    });
  };
  const du = donnees?.comptes.reduce((s, c) => s + c.soldeTTC, 0) ?? 0;
  return (
    <section className="admin-section">
      <Titre icone={NotebookPen}>Comptes clients</Titre>
      <p className="explication">
        Ventes portées en compte et réglées plus tard, sur n'importe quel appareil. La vente compte dans le chiffre du jour ; la TVA
        devient exigible au règlement. {donnees && <strong>Total dû : {euros(du)}.</strong>}
      </p>
      {donnees && donnees.anomalies.length > 0 && (
        <div className="admin-alerte">
          <strong>À vérifier :</strong>
          <ul>
            {donnees.anomalies.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      )}
      {donnees && donnees.comptes.length > 0 && (
        <table className="tableau admin-tableau">
          <tbody>
            {donnees.comptes.map((c) => (
              <tr key={c.client.id} className={c.client.actif ? "" : "annule"}>
                <td>
                  {c.client.nom}
                  <br />
                  <small>{[c.client.telephone, c.client.email, c.client.id].filter(Boolean).join(" · ")}</small>
                </td>
                <td>{c.ventes.length ? pluriel(c.ventes.length, "note due") : "—"}</td>
                <td className="nombre">{euros(c.soldeTTC)}</td>
                <td className="admin-boutons">
                  <BoutonIcone icone={Pencil} variante="discret" libelle={`Modifier la fiche de ${c.client.nom}`} onClick={() => setEdition({ ...c.client })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {donnees && donnees.comptes.length === 0 && <p className="explication">Aucun client pour l'instant : ils se créent en caisse (Encaisser › En compte) ou ici.</p>}
      {edition ? (
        <form className="admin-ligne" onSubmit={enregistrer}>
          <input value={edition.nom} onChange={(ev) => setEdition({ ...edition, nom: ev.target.value })} placeholder="Nom du client" required maxLength={80} />
          <input value={edition.telephone} onChange={(ev) => setEdition({ ...edition, telephone: ev.target.value })} placeholder="Téléphone" maxLength={30} />
          <input value={edition.email ?? ""} onChange={(ev) => setEdition({ ...edition, email: ev.target.value })} placeholder="E-mail" type="email" maxLength={254} />
          <label className="case">
            <input type="checkbox" checked={edition.actif} onChange={(ev) => setEdition({ ...edition, actif: ev.target.checked })} />
            Actif
          </label>
          <button className="bouton principal" disabled={enCours}>
            <AvecIcone icone={Save}>Enregistrer</AvecIcone>
          </button>
          <button type="button" className="bouton" onClick={() => setEdition(null)}>
            Annuler
          </button>
        </form>
      ) : (
        <div className="admin-ligne">
          <button className="bouton" onClick={() => setEdition({ id: nouvelIdClient(), nom: "", telephone: "", email: "", actif: true })}>
            <AvecIcone icone={UserPlus}>Nouveau client</AvecIcone>
          </button>
          <button className="bouton" disabled={enCours} onClick={() => void charger()}>
            <AvecIcone icone={RotateCw}>Actualiser</AvecIcone>
          </button>
        </div>
      )}
      {erreur && <p className="erreur">{erreur}</p>}
    </section>
  );
}

function Identite(props: { e: EtablissementAdmin; cartes: Array<{ id: string; nom: string }>; onChange: () => Promise<void> }) {
  const { e } = props;
  const [identite, setIdentite] = useState(e.identite);
  const [carteId, setCarteId] = useState(e.carteId);
  const [seuil, setSeuil] = useState(e.seuilNote / 100);
  const [enregistre, setEnregistre] = useState(false);
  const { enCours, erreur, envoyer } = useEnvoi();

  const enregistrer = (ev: FormEvent) => {
    ev.preventDefault();
    setEnregistre(false);
    void envoyer(async () => {
      await api.modifierEtablissement(e.id, {
        identite: { ...identite, siret: identite.siret.replace(/\s/g, "") },
        carteId,
        seuilNote: Math.round(seuil * 100),
      });
      setEnregistre(true);
      await props.onChange();
    });
  };

  return (
    <form className="admin-section" onSubmit={enregistrer}>
      <Titre icone={Store}>Identité et carte</Titre>
      <div className="formulaire-colonnes">
        <div>
          {CHAMPS_IDENTITE.map(([cle, libelle, aide]) => (
            <Champ key={cle} libelle={libelle} aide={aide}>
              <input value={identite[cle] ?? ""} onChange={(ev) => setIdentite({ ...identite, [cle]: ev.target.value })} required={cle === "enseigne"} />
            </Champ>
          ))}
        </div>
        <div>
          <Champ libelle="Carte">
            <select value={carteId} onChange={(ev) => setCarteId(ev.target.value)}>
              {props.cartes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nom}
                </option>
              ))}
            </select>
          </Champ>
          <Champ libelle="Note imprimée d'office à partir de (€)" aide={`Actuellement ${euros(e.seuilNote)}`}>
            <input type="number" min={0} step={1} value={seuil} onChange={(ev) => setSeuil(Number(ev.target.value))} />
          </Champ>
        </div>
      </div>
      <div className="admin-ligne">
        <button className="bouton principal" disabled={enCours}>
          <AvecIcone icone={Save}>Enregistrer</AvecIcone>
        </button>
        {enregistre && <span className="admin-ok">Enregistré. Les iPad et iPhone le recevront à la prochaine synchronisation.</span>}
        {erreur && <span className="erreur">{erreur}</span>}
      </div>
    </form>
  );
}
