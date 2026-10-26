import { afficherCode, ID_ETABLISSEMENT_VALIDE, PIN_VALIDE, type IdentiteEtablissement, type Role, type UtilisateurApi } from "@matalon/serveur/partage";
import QRCode from "qrcode";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { genererTables } from "../donnees/configuration";
import type { ClientApi, PostesProduction, ReponseComptes, ResumeCarte } from "@matalon/serveur/partage";
import { postesDeLaCarte } from "@matalon/catalogue";
import { EditeurPostes } from "../ui/EditeurPostes";
import { EditeurPlan } from "../ui/EditeurPlan";
import { nouvelIdClient } from "../donnees/clients";
import type { AlerteApi } from "@matalon/serveur/partage";
import { api, ErreurAdmin, type StatutAdmin, type AdresseImprimante, type CaisseAdmin, type EtablissementAdmin, type RapportVerification, type ResumeCloture } from "./api";
import { EditeurCarte, ListeCartes } from "./EditeurCarte";
import { Stock } from "./Stock";
import { TableauStatistiques, type AccesStatistiques } from "../ui/Statistiques";
import { CloturesAdmin } from "./CloturesAdmin";
import { FideliteAdmin } from "./FideliteAdmin";
import { LogoEtablissement } from "./Logo";
import { TicketsAdmin, type FiltreTickets } from "./TicketsAdmin";
import { ModaleMoments } from "./Moments";
import { Reservations } from "./Reservations";
import { FenetreClesAcces, SuggestionCleAcces, useClesAcces } from "./ClesAcces";
import { FenetreConfiguration } from "./Configuration";
import { cleAccesDisponible, utiliserCleAcces } from "./cleAcces";
import { Accueil } from "./Accueil";
import { EntetePage, TitreAvecAide } from "./Page";
import { confirmer, informer, Panneau } from "./Panneau";
import { Recherche } from "./Recherche";
import { AccepterInvitation, FenetreAcces } from "./Acces";
import { BoutonAlertes, BoutonRecherche, defRubrique, familleDe, Marque, MenuCompte, MenuEtablissement, MenuLateral, OngletsMobile, TOUTES_RUBRIQUES, useMenuReduit, useTheme, type Rubrique, type Signal } from "./Coque";
import {
  Archive,
  Ban,
  Check,
  History,
  FileJson,
  Fingerprint,
  FileSpreadsheet,
  KeyRound,
  Pencil,
  LogIn,
  Plus,
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

/** Jeton d'invitation dans l'adresse (#/invitation/<jeton>) : jamais envoyé au serveur dans l'URL. */
const jetonInvitation = () => /^#\/invitation\/([A-Za-z0-9_-]{20,100})$/.exec(location.hash)?.[1] ?? null;

export function Administration() {
  const [statut, setStatut] = useState<StatutAdmin | null>(null);
  const [erreur, setErreur] = useState("");
  const [invitation, setInvitation] = useState(jetonInvitation);

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
  if (invitation) {
    return (
      <AccepterInvitation
        jeton={invitation}
        onConnecte={() => {
          history.replaceState(null, "", "#/");
          setInvitation(null);
          charger();
        }}
      />
    );
  }
  if (!statut) return <div className="admin-acces">Chargement…</div>;
  if (!statut.initialise) return <Initialisation onTermine={charger} />;
  if (!statut.connecte) return <ConnexionAdmin onConnecte={charger} />;
  return <Tableau identifiant={statut.identifiant ?? ""} comptable={statut.role === "comptable"} nom={statut.nom ?? ""} onDeconnecte={charger} />;
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
  const avecCle = () =>
    void envoyer(async () => {
      const { options } = await api.optionsConnexionCle();
      await api.connexionCle(await utiliserCleAcces(options));
      props.onConnecte();
    });
  return (
    <div className="admin-acces">
      <EnteteAcces titre="Connexion" />
      {cleAccesDisponible() && (
        <div className="admin-carte connexion-cle">
          <button type="button" className="bouton principal" disabled={enCours} onClick={avecCle}>
            <AvecIcone icone={Fingerprint}>Se connecter avec une clé d'accès</AvecIcone>
          </button>
          <p className="explication">Face ID, Touch ID ou le code de l'appareil, sans mot de passe ni code de vérification.</p>
        </div>
      )}
      <form className="admin-carte" onSubmit={valider}>
        {cleAccesDisponible() && <h2 className="connexion-ou">Ou avec le mot de passe et le code</h2>}
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
        <button className={`bouton${cleAccesDisponible() ? "" : " principal"}`} disabled={enCours || code.length !== 6}>
          <AvecIcone icone={LogIn}>Se connecter</AvecIcone>
        </button>
      </form>
    </div>
  );
}

// ───────── Tableau de bord ─────────

/** Vue lue et écrite dans l'adresse (#/moka/equipe) : un rechargement ou un lien ramène au même écran. */
function vueDepuisAdresse(ouvertes?: Rubrique[]): { etab: string | null; rubrique: Rubrique; sous: string | null } {
  const [etab, rubrique, sous] = location.hash.replace(/^#\/?/, "").split("/");
  const connue = TOUTES_RUBRIQUES.some((r) => r.id === rubrique) && (!ouvertes || ouvertes.includes(rubrique as Rubrique));
  return { etab: etab || dernierEtablissement(), rubrique: connue ? (rubrique as Rubrique) : (ouvertes?.[0] ?? "accueil"), sous: connue && sous ? sous : null };
}

/** Rubriques d'un accès comptable (le serveur refuse toutes les autres routes). */
const RUBRIQUES_COMPTABLE: Rubrique[] = ["statistiques", "clotures"];

/** Dernier établissement ouvert sur ce poste : simple confort, absent en navigation privée. */
const CLE_DERNIER = "matalon-admin-etablissement";
function dernierEtablissement(): string | null {
  try {
    return localStorage.getItem(CLE_DERNIER);
  } catch {
    return null;
  }
}

function Tableau(props: { identifiant: string; comptable: boolean; nom: string; onDeconnecte: () => void }) {
  const [donnees, setDonnees] = useState<Awaited<ReturnType<typeof api.etablissements>> | null>(null);
  const [cartes, setCartes] = useState<ResumeCarte[]>([]);
  /** Accès comptable : statistiques et clôtures seulement ; undefined pour le propriétaire (tout). */
  const ouvertes = props.comptable ? RUBRIQUES_COMPTABLE : undefined;
  const initiale = useMemo(() => vueDepuisAdresse(ouvertes), [ouvertes]);
  /** Établissement choisi dans l'en-tête (ou « nouveau »), puis rubrique du menu latéral. */
  const [choisi, setChoisi] = useState<string | null>(initiale.etab);
  const [rubrique, setRubrique] = useState<Rubrique>(initiale.rubrique);
  /** Sous-page de la rubrique (onglet de Stock ou de Réservations), dans l'adresse : #/moka/stock/inventaire. */
  const [sous, setSous] = useState<string | null>(initiale.sous);
  const [carteOuverte, setCarteOuverte] = useState<string | null>(null);
  const [carteModifiee, setCarteModifiee] = useState(false);
  /** Tickets d'une personne, ouverts depuis les statistiques ; le menu les rouvre sans filtre. */
  const [filtreTickets, setFiltreTickets] = useState<FiltreTickets | null>(null);
  const [theme, choisirTheme] = useTheme();
  /** Élément à ouvrir à l'arrivée (choisi dans la recherche) : produit, personne, client, article. */
  const [cible, setCible] = useState<string | null>(null);
  const [recherche, setRecherche] = useState(false);
  // ⌘K ou Ctrl+K depuis n'importe quel écran ; « / » hors d'un champ de saisie.
  useEffect(() => {
    const touche = (ev: KeyboardEvent) => {
      const saisie = ev.target instanceof HTMLElement && (ev.target.closest("input, textarea, select, [contenteditable]") !== null);
      if (props.comptable) return;
      if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "k") {
        ev.preventDefault();
        setRecherche((o) => !o);
      } else if (ev.key === "/" && !saisie && !ev.metaKey && !ev.ctrlKey && !ev.altKey) {
        ev.preventDefault();
        setRecherche(true);
      }
    };
    window.addEventListener("keydown", touche);
    return () => window.removeEventListener("keydown", touche);
  }, [props.comptable]);
  const [menuReduit, basculerMenu] = useMenuReduit();
  /** Un changement de rubrique s'inscrit dans l'historique : le bouton Retour du navigateur y ramène. */
  const historique = useRef(false);
  /** Adresse de la vue affichée : un Retour refusé (carte non enregistrée) y revient. */
  const adresseCourante = useRef(location.hash);
  /** Changer de vue avec une carte modifiée non enregistrée demande confirmation. */
  const aller = (vue: { etab?: string; rubrique?: Rubrique; sous?: string | null; carte?: string | null; cible?: string | null }, abandonConfirme = false) => {
    if (carteModifiee && !abandonConfirme) {
      void confirmer({
        titre: "Abandonner les modifications de la carte ?",
        message: "La carte a des modifications non enregistrées : elles seront perdues.",
        confirmer: "Abandonner",
        annuler: "Rester sur la carte",
        danger: true,
      }).then((oui) => {
        if (oui) aller(vue, true);
        else if (location.hash !== adresseCourante.current) history.pushState(null, "", adresseCourante.current);
      });
      return false;
    }
    setCarteModifiee(false);
    historique.current = true;
    if (ouvertes && vue.rubrique !== undefined && !ouvertes.includes(vue.rubrique)) vue = { ...vue, rubrique: ouvertes[0]! };
    if (vue.etab !== undefined) setChoisi(vue.etab);
    if (vue.rubrique !== undefined) setRubrique(vue.rubrique);
    if (vue.sous !== undefined || vue.rubrique !== undefined) setSous(vue.sous ?? null);
    setCarteOuverte(vue.carte ?? null);
    setCible(vue.cible ?? null);
    setFiltreTickets(null);
    window.scrollTo({ top: 0 });
    return true;
  };
  const [erreur, setErreur] = useState("");
  const clesAcces = useClesAcces();
  const [fenetreCles, setFenetreCles] = useState(false);
  const [fenetreConfiguration, setFenetreConfiguration] = useState(false);
  const [fenetreAcces, setFenetreAcces] = useState(false);

  const recharger = useCallback(async () => {
    try {
      // Un accès comptable ne lit pas les cartes (refusé par le serveur) et ne crée pas d'établissement.
      const [d, c] = await Promise.all([api.etablissements(), props.comptable ? Promise.resolve({ cartes: [] as ResumeCarte[] }) : api.cartes()]);
      setDonnees(d);
      setCartes(c.cartes);
      setChoisi((x) =>
        x && ((x === "nouveau" && !props.comptable) || d.etablissements.some((e) => e.id === x)) ? x : (d.etablissements[0]?.id ?? (props.comptable ? null : "nouveau")),
      );
    } catch (e) {
      if (e instanceof ErreurAdmin && e.statut === 401) return props.onDeconnecte();
      setErreur(message(e));
    }
  }, [props]);
  useEffect(() => {
    void recharger();
  }, [recharger]);
  useEffect(() => {
    if (!choisi) return;
    const adresse = `#/${choisi}${choisi === "nouveau" ? "" : `/${rubrique}${sous ? `/${sous}` : ""}`}`;
    adresseCourante.current = adresse;
    if (historique.current && location.hash !== adresse) history.pushState(null, "", adresse);
    else history.replaceState(null, "", adresse);
    historique.current = false;
    try {
      if (choisi !== "nouveau") localStorage.setItem(CLE_DERNIER, choisi);
    } catch {
      /* stockage indisponible : on retombera sur le premier établissement */
    }
  }, [choisi, rubrique, sous]);
  // Retour et Suivant du navigateur, ou adresse modifiée à la main.
  const allerRef = useRef(aller);
  allerRef.current = aller;
  useEffect(() => {
    const suivre = () => {
      const v = vueDepuisAdresse();
      if (!v.etab) return;
      if (!allerRef.current({ etab: v.etab, rubrique: v.rubrique, sous: v.sous })) return;
      historique.current = false;
    };
    window.addEventListener("popstate", suivre);
    return () => window.removeEventListener("popstate", suivre);
  }, []);

  const etablissement = donnees?.etablissements.find((e) => e.id === choisi);
  const signal = (id: Rubrique): Signal => {
    const e = etablissement;
    if (!e) return null;
    if (id === "alertes" && e.alertesNonVues > 0) return { nombre: e.alertesNonVues, libelle: pluriel(e.alertesNonVues, "alerte") + " à lire" };
    if (id === "appareils" && e.caisses.some((c) => c.divergence && !c.revoqueeLe)) return { point: "danger", libelle: "Divergence sur un appareil" };
    if (id === "identite" && identiteIncomplete(e)) return { point: "attention", libelle: "Identité légale incomplète" };
    if (id === "identite" && !e.logo) return { point: "attention", libelle: "Logo à déposer" };
    return null;
  };
  const libelleRubrique = defRubrique(rubrique).libelle;
  useEffect(() => {
    document.title = etablissement ? `${libelleRubrique} · ${etablissement.identite.enseigne} · Matalon POS` : "Matalon POS · Administration";
  }, [etablissement, libelleRubrique]);

  return (
    <div className="admin">
      <a className="coque-evitement" href="#contenu" onClick={(ev) => {
        ev.preventDefault();
        document.getElementById("contenu")?.focus();
      }}>
        Aller au contenu
      </a>
      <header className="coque-barre">
        <Marque />
        {donnees && donnees.etablissements.length > 0 && (
          <MenuEtablissement etablissements={donnees.etablissements} choisi={choisi} onChoisir={(id) => aller({ etab: id })} restreint={props.comptable} />
        )}
        {etablissement && !props.comptable && <BoutonRecherche onOuvrir={() => setRecherche(true)} />}
        <div className="coque-barre-droite">
          {etablissement && !props.comptable && <BoutonAlertes nombre={etablissement.alertesNonVues} onOuvrir={() => aller({ rubrique: "alertes" })} />}
          <MenuCompte
            identifiant={props.identifiant}
            {...(props.comptable ? { sousTitre: `Comptable${props.nom ? ` · ${props.nom}` : ""}` } : {})}
            theme={theme}
            onTheme={choisirTheme}
            {...(props.comptable
              ? {}
              : { onCles: () => setFenetreCles(true), onAcces: () => setFenetreAcces(true), onConfiguration: () => setFenetreConfiguration(true) })}
            onDeconnexion={() => void api.deconnexion().finally(props.onDeconnecte)}
          />
        </div>
      </header>
      <div className={`coque-corps${etablissement ? "" : " sans-menu"}${menuReduit ? " reduit" : ""}`}>
        {etablissement && (
          <MenuLateral
            etab={etablissement}
            rubrique={rubrique}
            reduit={menuReduit}
            onReduire={basculerMenu}
            signal={signal}
            onAller={(r) => aller({ rubrique: r })}
            {...(ouvertes ? { rubriques: ouvertes } : {})}
          />
        )}
        <main id="contenu" tabIndex={-1} className="admin-contenu" aria-label={etablissement ? `${etablissement.identite.enseigne} · ${libelleRubrique}` : "Administration"}>
          {erreur && <p className="erreur">{erreur}</p>}
          {!props.comptable && <SuggestionCleAcces cles={clesAcces.cles} onOuvrir={() => setFenetreCles(true)} />}
          {!donnees ? (
            <p>Chargement…</p>
          ) : props.comptable && !etablissement ? (
            <p className="explication">Aucun établissement n'est ouvert à votre accès : demandez-le à l'administrateur.</p>
          ) : choisi === "nouveau" || !etablissement ? (
            <NouvelEtablissement
              cartes={donnees.cartes}
              onCree={(id) => {
                aller({ etab: id, rubrique: "identite" });
                void recharger();
              }}
            />
          ) : rubrique === "cartes" ? (
            carteOuverte ? (
              <EditeurCarte
                key={carteOuverte}
                id={carteOuverte}
                {...(cible ? { article: cible } : {})}
                onRetour={() => aller({ rubrique: "cartes" })}
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
          ) : (
            <FicheEtablissement
              key={etablissement.id}
              comptable={props.comptable}
              e={etablissement}
              rubrique={rubrique}
              cartes={donnees.cartes}
              onChange={recharger}
              onAller={(r, o) => aller({ rubrique: r, carte: o?.carte ?? null, sous: o?.sous ?? null })}
              sous={sous}
              onSous={(s) => aller({ sous: s, ...(carteOuverte ? { carte: carteOuverte } : {}) })}
              cible={cible}
              filtreTickets={filtreTickets}
              onTicketsServeur={(f) => {
                aller({ rubrique: "tickets" });
                setFiltreTickets(f);
              }}
            />
          )}
        </main>
      </div>
      {etablissement && (
        <OngletsMobile etab={etablissement} rubrique={rubrique} signal={signal} onAller={(r) => aller({ rubrique: r })} {...(ouvertes ? { rubriques: ouvertes } : {})} />
      )}
      {recherche && etablissement && !props.comptable && (
        <Recherche
          e={etablissement}
          onFermer={() => setRecherche(false)}
          onAller={(d) => {
            if (d.ticket) {
              const t = d.ticket;
              if (aller({ rubrique: "tickets" })) setFiltreTickets({ serveur: null, du: t.jour, au: t.jour, ticket: { caisseId: t.caisseId, numero: t.numero } });
            } else aller({ rubrique: d.rubrique, sous: d.sous ?? null, carte: d.carte ?? null, cible: d.cible ?? null });
          }}
        />
      )}
      {fenetreAcces && donnees && <FenetreAcces etablissements={donnees.etablissements} onFermer={() => setFenetreAcces(false)} />}
      {fenetreConfiguration && <FenetreConfiguration onFermer={() => setFenetreConfiguration(false)} onImporte={() => void recharger()} />}
      {fenetreCles && <FenetreClesAcces cles={clesAcces.cles} onChange={clesAcces.setCles} onFermer={() => setFenetreCles(false)} />}
    </div>
  );
}

const identiteIncomplete = (e: EtablissementAdmin) =>
  !e.identite.raisonSociale || !e.identite.siret || !e.identite.tvaIntracom || !e.identite.adresse || !e.identite.mentionsLegales;

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

function FicheEtablissement(props: {
  e: EtablissementAdmin;
  /** Accès comptable : statistiques sans lien vers les tickets ni réglage des moments. */
  comptable: boolean;
  rubrique: Rubrique;
  cartes: Array<{ id: string; nom: string }>;
  onChange: () => Promise<void>;
  /** Tickets ouverts depuis les statistiques : une personne, une période. */
  filtreTickets: FiltreTickets | null;
  onTicketsServeur: (f: FiltreTickets) => void;
  onAller: (r: Rubrique, options?: { carte?: string; sous?: string }) => void;
  sous: string | null;
  onSous: (s: string | null) => void;
  /** Élément à ouvrir à l'arrivée (recherche). */
  cible: string | null;
}) {
  const { e, rubrique } = props;
  const responsable = e.utilisateurs.some((u) => u.role === "responsable" && u.actif);
  const surtitre = familleDe(rubrique);
  return (
    <>
      {rubrique === "accueil" && <Accueil e={e} onAller={props.onAller} onChange={props.onChange} />}
      {rubrique === "appareils" && <Appareils e={e} responsable={responsable} onChange={props.onChange} surtitre={surtitre} />}
      {rubrique === "statistiques" && (
        <StatistiquesAdmin key={e.id} e={e} onChange={props.onChange} {...(props.comptable ? {} : { onServeur: props.onTicketsServeur })} />
      )}
      {rubrique === "tickets" && <TicketsAdmin key={JSON.stringify(props.filtreTickets)} e={e} filtre={props.filtreTickets} />}
      {rubrique === "clotures" && <CloturesAdmin e={e} />}
      {rubrique === "equipe" && <Equipe key={props.cible ?? ""} e={e} onChange={props.onChange} surtitre={surtitre} ouvrir={props.cible} />}
      {rubrique === "plan" && (
        <>
          <EntetePage
            surtitre={surtitre}
            titre="Plan de salle"
            aide="Ajoutez les tables (carré, rectangle, rond), réglez leurs chaises et glissez-les à leur place ; bar, porte et murs servent de repères. Grille de 25 cm. Un responsable peut aussi modifier le plan depuis l'iPad."
          />
          <PlanDeSalle e={e} onChange={props.onChange} />
        </>
      )}
      {rubrique === "imprimantes" && (
        <>
          <EntetePage surtitre={surtitre} titre="Imprimantes" />
          <ImprimanteTickets e={e} onChange={props.onChange} />
          <ImprimantesProduction e={e} onChange={props.onChange} />
        </>
      )}
      {rubrique === "reservations" && <Reservations etablissements={[e]} onglet={props.sous} onOnglet={props.onSous} />}
      {rubrique === "comptes" && <ComptesClients key={props.cible ?? ""} etablissementId={e.id} surtitre={surtitre} ouvrir={props.cible} />}
      {rubrique === "fidelite" && <FideliteAdmin key={e.id} e={e} />}
      {rubrique === "stock" && <Stock key={props.cible ?? ""} etablissementId={e.id} onglet={props.sous} onOnglet={props.onSous} ouvrir={props.cible} />}
      {rubrique === "alertes" && <Alertes e={e} onChange={props.onChange} surtitre={surtitre} />}
      {rubrique === "identite" && (
        <>
          <EntetePage surtitre={surtitre} titre="Établissement" />
          {identiteIncomplete(e) && (
            <p className="admin-alerte">
              <TriangleAlert className="icone" size={20} aria-hidden="true" /> Identité légale incomplète : raison sociale, adresse, SIRET et n° de TVA figurent sur chaque note client ; forme juridique, capital et RCS sont exigés pour émettre des factures.
            </p>
          )}
          <Identite e={e} cartes={props.cartes} onChange={props.onChange} />
          <LogoEtablissement e={e} onChange={props.onChange} />
        </>
      )}
    </>
  );
}

/** Statistiques de l'établissement, mêmes calculs et même écran que sur la caisse, recalculés en direct. */
function StatistiquesAdmin(props: { e: EtablissementAdmin; onChange: () => Promise<void>; onServeur?: (f: FiltreTickets) => void }) {
  const { e } = props;
  const etablissementId = e.id;
  // Le rechargement de l'administration change de fonction à chaque rendu : l'écran ne doit pas tout recalculer pour autant.
  const onChange = useRef(props.onChange);
  onChange.current = props.onChange;
  const onServeur = useRef(props.onServeur);
  onServeur.current = props.onServeur;
  const [editionMoments, setEditionMoments] = useState(false);
  // Moments modifiés : les statistiques se recalculent (même période).
  const versionMoments = JSON.stringify(e.moments ?? []);
  const acces = useMemo<AccesStatistiques>(
    () => ({
      charger: (du, au) => api.statistiques(etablissementId, du, au),
      marquerVue: async (a) => {
        await api.marquerAlerteVue(a.id);
        // Le compteur d'alertes du menu suit.
        await onChange.current();
        return true;
      },
      // Accès comptable : pas de tickets ni de réglage des moments (le serveur les refuse aussi).
      ...(onServeur.current
        ? { ouvrirServeur: (serveur: string, du: string, au: string) => onServeur.current?.({ serveur, du, au }), modifierMoments: () => setEditionMoments(true) }
        : {}),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [etablissementId, versionMoments],
  );
  return (
    <>
      <TableauStatistiques acces={acces} />
      {editionMoments && (
        <ModaleMoments etablissementId={e.id} moments={e.moments ?? []} onEnregistre={() => onChange.current()} onFermer={() => setEditionMoments(false)} />
      )}
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
function Alertes(props: { e: EtablissementAdmin; onChange: () => Promise<void>; surtitre?: string }) {
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
    <>
    <EntetePage
      surtitre={props.surtitre}
      titre="Alertes"
      aide="Ventes à un autre prix que la carte, articles hors carte et codes PIN bloqués, sur tous les appareils. Une alerte ne bloque rien ; on la marque vue."
      actions={
        <button className="bouton" aria-pressed={toutes} onClick={() => setToutes((t) => !t)}>
          <AvecIcone icone={History}>{toutes ? "Seulement les alertes à lire" : "Voir aussi les alertes vues"}</AvecIcone>
        </button>
      }
    />
    <section className="admin-section">
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
    </section>
    </>
  );
}

/** Appareils : rattacher un iPad ou un iPhone (panneau), codes encore valables, appareils rattachés. */
function Appareils(props: { e: EtablissementAdmin; responsable: boolean; onChange: () => Promise<void>; surtitre?: string }) {
  const [rattacher, setRattacher] = useState(false);
  const codes = props.e.codes;
  return (
    <>
      <EntetePage
        surtitre={props.surtitre}
        titre="Appareils"
        aide="Les clôtures (Z, mois, exercice) valent pour tout l'établissement, quel que soit l'appareil qui les a faites. Le contrôle d'établissement vérifie qu'elles couvrent chaque caisse sans trou ni double compte."
        actions={
          <button
            className="bouton principal"
            disabled={!props.responsable}
            title={props.responsable ? undefined : "Ajoutez d'abord un responsable à l'équipe"}
            onClick={() => setRattacher(true)}
          >
            <AvecIcone icone={Plus}>Rattacher un appareil</AvecIcone>
          </button>
        }
      />
      {!props.responsable && (
        <p className="a-bandeau attention">Ajoutez d'abord un responsable à l'équipe : sans lui, personne ne pourrait ouvrir la caisse.</p>
      )}
      {codes.length > 0 && (
        <section className="admin-section">
          <TitreAvecAide titre="Codes de rattachement en attente" nom="Codes de rattachement">
            Un code sert une seule fois et expire au bout de 48 heures. Sur l'appareil, ouvrez {location.host} dans Safari, ajoutez-le à l'écran
            d'accueil (Partager › Sur l'écran d'accueil), ouvrez-le depuis cette icône, puis saisissez le code.
          </TitreAvecAide>
          <ul className="a-codes">
            {codes.map((c) => (
              <li key={c.code}>
                <span className="chiffres a-code">{afficherCode(c.code)}</span>
                <span>
                  {c.nomCaisse} · valable jusqu'au {dateHeure(c.expireLe)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <Caisses e={props.e} caisses={props.e.caisses} onChange={props.onChange} />
      {rattacher && <PanneauRattacher e={props.e} onChange={props.onChange} onFermer={() => setRattacher(false)} />}
    </>
  );
}

function PanneauRattacher(props: { e: EtablissementAdmin; onChange: () => Promise<void>; onFermer: () => void }) {
  const [type, setType] = useState<"iPad" | "iPhone">("iPad");
  const [nom, setNom] = useState("");
  const [nouveau, setNouveau] = useState<{ code: string; expireLe: string; nomCaisse: string } | null>(null);
  const { enCours, erreur, envoyer } = useEnvoi();
  const generer = () =>
    void envoyer(async () => {
      setNouveau(await api.genererCode(props.e.id, nom.trim() || type));
      setNom("");
      await props.onChange();
    });
  return (
    <Panneau
      surtitre="Appareils"
      titre="Rattacher un iPad ou un iPhone"
      onFermer={props.onFermer}
      onEnregistrer={generer}
      libelleEnregistrer={nouveau ? "Générer un autre code" : "Générer un code"}
      enCours={enCours}
      erreur={erreur}
      modifie={!nouveau && nom.trim() !== ""}
    >
      <div className="options" role="radiogroup" aria-label="Appareil à rattacher">
        {(["iPad", "iPhone"] as const).map((t) => (
          <button key={t} type="button" role="radio" aria-checked={type === t} className={`option${type === t ? " active" : ""}`} onClick={() => setType(t)}>
            <AvecIcone icone={ICONE_APPAREIL[t]} classe={CLASSE_APPAREIL[t]}>
              {t}
            </AvecIcone>
          </button>
        ))}
      </div>
      <Champ libelle={`Nom de l'${type}`} aide={type === "iPad" ? "Comptoir, Terrasse…" : "Salle, Lionel…"}>
        <input value={nom} onChange={(ev) => setNom(ev.target.value)} placeholder={type === "iPad" ? "Nom de l'iPad (Comptoir, Terrasse…)" : "Nom de l'iPhone (Salle, Lionel…)"} maxLength={40} autoComplete="off" />
      </Champ>
      {nouveau ? (
        <div className="admin-code" role="status">
          <span>{afficherCode(nouveau.code)}</span>
          <small>
            {nouveau.nomCaisse} · valable jusqu'au {dateHeure(nouveau.expireLe)}
          </small>
        </div>
      ) : null}
      <ol className="a-etapes">
        <li>
          Sur l'{type}, ouvrez <strong>{location.host}</strong> dans Safari.
        </li>
        <li>Partager › Sur l'écran d'accueil, puis ouvrez la caisse depuis cette icône.</li>
        <li>Saisissez le code. Il sert une seule fois et expire au bout de 48 heures.</li>
      </ol>
    </Panneau>
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
    const oui = await confirmer({
      titre: `Révoquer « ${c.nom} » ?`,
      message: "Cet appareil ne pourra plus encaisser ni se synchroniser. C'est définitif : pour le réutiliser, il faudra le rattacher de nouveau.",
      confirmer: "Révoquer l'appareil",
      danger: true,
    });
    if (!oui) return;
    try {
      await api.revoquer(c.id);
      await props.onChange();
    } catch (e) {
      await informer("Révocation impossible", message(e));
    }
  };
  return (
    <section className="admin-section">
      <Titre icone={TabletSmartphone}>Appareils rattachés</Titre>
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

/** Personne ouverte dans le panneau : une nouvelle (sans id) ou une existante. */
interface FichePersonne {
  id?: string;
  nom: string;
  role: Role;
  actif: boolean;
  /** Nouveau code PIN ; vide pour une personne existante : inchangé. */
  pin: string;
}

function Equipe(props: { e: EtablissementAdmin; onChange: () => Promise<void>; surtitre?: string; ouvrir?: string | null }) {
  const initiale = ((u) => (u ? { id: u.id, nom: u.nom, role: u.role, actif: u.actif, pin: "" } : null))(props.e.utilisateurs.find((u) => u.id === props.ouvrir));
  const [fiche, setFiche] = useState<FichePersonne | null>(initiale);
  const [depart, setDepart] = useState<FichePersonne | null>(initiale);
  const { enCours, erreur, setErreur, envoyer } = useEnvoi();
  const ouvrir = (f: FichePersonne) => {
    setErreur("");
    setFiche(f);
    setDepart(f);
  };
  const nouvelle = () => ouvrir({ nom: "", role: props.e.utilisateurs.some((u) => u.role === "responsable") ? "serveur" : "responsable", actif: true, pin: "" });
  const modifie = !!fiche && JSON.stringify(fiche) !== JSON.stringify(depart);
  const enregistrer = () => {
    if (!fiche) return;
    if (!fiche.nom.trim()) return setErreur("Le prénom est obligatoire.");
    if ((!fiche.id || fiche.pin) && !PIN_VALIDE.test(fiche.pin)) return setErreur("Le code PIN compte 4 chiffres.");
    void envoyer(async () => {
      await api.enregistrerUtilisateur(props.e.id, {
        ...(fiche.id ? { id: fiche.id } : {}),
        nom: fiche.nom.trim(),
        role: fiche.role,
        actif: fiche.actif,
        ...(fiche.pin ? { pin: fiche.pin } : {}),
      });
      setFiche(null);
      await props.onChange();
    });
  };
  const actifs = props.e.utilisateurs.filter((u) => u.actif);

  return (
    <>
      <EntetePage
        surtitre={props.surtitre}
        titre="Équipe"
        aide="Chaque personne se connecte en caisse avec son code PIN. Les responsables valident annulations et clôtures. Les changements arrivent sur les iPad et iPhone à la synchronisation suivante (une minute au plus en ligne)."
        actions={
          <button className="bouton principal" onClick={nouvelle}>
            <AvecIcone icone={UserPlus}>Ajouter une personne</AvecIcone>
          </button>
        }
      />
      <section className="admin-section">
        {props.e.utilisateurs.length === 0 ? (
          <p className="explication">Personne pour l'instant : commencez par un responsable.</p>
        ) : (
          <>
            <p className="a-resume">
              {pluriel(actifs.length, "personne")} en service · {pluriel(actifs.filter((u) => u.role === "responsable").length, "responsable")}
            </p>
            <table className="tableau admin-tableau a-liste">
              <thead>
                <tr>
                  <th>Personne</th>
                  <th>Rôle</th>
                  <th>État</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {props.e.utilisateurs.map((u) => (
                  <tr key={u.id} className={u.actif ? "" : "annule"}>
                    <td>
                      <strong>{u.nom}</strong>
                    </td>
                    <td>{u.role === "responsable" ? "Responsable" : "Serveur"}</td>
                    <td>{u.actif ? "En service" : "Désactivé"}</td>
                    <td className="admin-boutons">
                      <button className="bouton" onClick={() => ouvrir({ id: u.id, nom: u.nom, role: u.role, actif: u.actif, pin: "" })} aria-label={`Modifier ${u.nom}`}>
                        <AvecIcone icone={Pencil}>Modifier</AvecIcone>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>
      {fiche && (
        <Panneau
          surtitre="Équipe"
          titre={fiche.id ? fiche.nom || "Personne" : "Nouvelle personne"}
          onFermer={() => setFiche(null)}
          onEnregistrer={enregistrer}
          libelleEnregistrer={fiche.id ? "Enregistrer" : "Ajouter"}
          enCours={enCours}
          modifie={modifie}
          erreur={erreur}
        >
          <Champ libelle="Prénom">
            <input value={fiche.nom} onChange={(ev) => setFiche({ ...fiche, nom: ev.target.value })} required maxLength={60} autoComplete="off" />
          </Champ>
          <fieldset className="a-choix">
            <legend>Rôle</legend>
            {(["serveur", "responsable"] as const).map((r) => (
              <label key={r} className="case">
                <input type="radio" name="role" checked={fiche.role === r} onChange={() => setFiche({ ...fiche, role: r })} />
                <span>
                  <strong>{r === "responsable" ? "Responsable" : "Serveur"}</strong>
                  <small>{r === "responsable" ? "Valide annulations, remises et clôtures ; ouvre les statistiques" : "Prend les commandes et encaisse"}</small>
                </span>
              </label>
            ))}
          </fieldset>
          <Champ libelle={fiche.id ? "Nouveau code PIN" : "Code PIN"} aide={fiche.id ? "4 chiffres ; laissez vide pour le garder" : "4 chiffres, pour se connecter en caisse"}>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              value={fiche.pin}
              onChange={(ev) => setFiche({ ...fiche, pin: ev.target.value.replace(/\D/g, "") })}
            />
          </Champ>
          {fiche.id && (
            <label className="case">
              <input type="checkbox" checked={fiche.actif} onChange={(ev) => setFiche({ ...fiche, actif: ev.target.checked })} />
              <span>
                <strong>En service</strong>
                <small>Décochée, la personne ne peut plus se connecter ; ses tickets restent à son nom.</small>
              </span>
            </label>
          )}
        </Panneau>
      )}
    </>
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
      {ok && <p className="admin-ok" role="status">Plan enregistré.</p>}
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
/** Imprimante des tickets commune aux appareils de l'établissement (un appareil peut en garder une à lui). */
function ImprimanteTickets(props: { e: EtablissementAdmin; onChange: () => Promise<void> }) {
  const actuelle = props.e.imprimanteTickets ?? null;
  const [adresse, setAdresse] = useState(actuelle?.adresse ?? "");
  const [sansAccents, setSansAccents] = useState(actuelle?.sansAccents ?? false);
  const [historique, setHistorique] = useState<AdresseImprimante[]>([]);
  const [fait, setFait] = useState("");
  const { enCours, erreur, setErreur, envoyer } = useEnvoi();
  // Réglée entre-temps depuis une caisse : le formulaire suit, pour ne jamais renvoyer une valeur périmée.
  useEffect(() => {
    setAdresse(actuelle?.adresse ?? "");
    setSansAccents(actuelle?.sansAccents ?? false);
  }, [actuelle?.adresse, actuelle?.sansAccents]);
  useEffect(() => {
    api
      .historiqueImprimanteTickets(props.e.id)
      .then((r) => setHistorique(r.historique))
      .catch(() => setHistorique([]));
  }, [props.e.id, actuelle?.adresse]);
  const enregistrer = (ev: FormEvent) => {
    ev.preventDefault();
    setFait("");
    const a = adresse.trim();
    if (a && !/^\d{1,3}(\.\d{1,3}){3}$/.test(a)) return setErreur("Adresse IP attendue, par exemple 192.168.1.50.");
    void envoyer(async () => {
      if (
        !a &&
        actuelle &&
        !(await confirmer({
          titre: `Retirer l'imprimante ${actuelle.adresse} ?`,
          message: "Les appareils qui n'ont pas d'imprimante à eux n'imprimeront plus les notes, factures et Z.",
          confirmer: "Retirer l'imprimante",
          danger: true,
        }))
      )
        return;
      const r = await api.enregistrerImprimanteTickets(props.e.id, a ? { adresse: a, sansAccents } : null);
      setHistorique(r.historique);
      await props.onChange();
      setFait(a ? "Enregistrée : les appareils la reçoivent à leur prochaine synchronisation." : "Retirée.");
    });
  };
  const anciennes = historique.filter((h) => h.adresse !== actuelle?.adresse);
  return (
    <form className="admin-section" onSubmit={enregistrer}>
      <TitreAvecAide titre="Imprimante des tickets" nom="Imprimante des tickets">
        Notes, factures, Z et reçus. Commune à tous les iPad et iPhone de l'établissement, sauf ceux à qui on a donné leur propre
        imprimante dans leurs Réglages. Sur chaque appareil, l'assistant de connexion fait accepter une fois le certificat de
        l'imprimante (étape « Autoriser »).
      </TitreAvecAide>
      <Champ libelle="Adresse IP" aide="Page d'état de l'imprimante (bouton Feed au démarrage)">
        <input value={adresse} onChange={(ev) => setAdresse(ev.target.value)} placeholder="192.168.1.50" inputMode="decimal" />
      </Champ>
      <label className="case">
        <input type="checkbox" checked={sansAccents} onChange={(ev) => setSansAccents(ev.target.checked)} /> Imprimer sans accents
      </label>
      {anciennes.length > 0 && (
        <div className="imprimante-historique">
          <span>Adresses déjà utilisées :</span>
          {anciennes.map((h) => (
            <button
              key={h.adresse}
              type="button"
              className="bouton"
              title={`Dernière utilisation le ${dateHeure(h.le)}`}
              onClick={() => {
                setAdresse(h.adresse);
                setSansAccents(h.sansAccents);
              }}
            >
              <AvecIcone icone={RotateCw}>{h.adresse}</AvecIcone>
            </button>
          ))}
        </div>
      )}
      {erreur && <p className="erreur">{erreur}</p>}
      {fait && <p className="succes">{fait}</p>}
      <div className="options">
        <button className="bouton principal" disabled={enCours}>
          <AvecIcone icone={Save}>Enregistrer</AvecIcone>
        </button>
      </div>
    </form>
  );
}

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
      <TitreAvecAide titre="Imprimantes de production" nom="Imprimantes de production">
        Les catégories de la carte désignent leur poste (bar, cuisine) ; indiquez ici l'adresse IP de l'imprimante de chaque poste sur
        le réseau de l'établissement. Le bon d'essai s'imprime depuis les Réglages d'une caisse, sur place.
      </TitreAvecAide>
      {erreur && <p className="erreur">{erreur}</p>}
      {postesCarte && <EditeurPostes postesCarte={postesCarte} valeur={props.e.postesProduction ?? {}} onEnregistrer={enregistrer} />}
    </section>
  );
}

function ComptesClients(props: { etablissementId: string; surtitre?: string; ouvrir?: string | null }) {
  const [donnees, setDonnees] = useState<ReponseComptes | null>(null);
  const [edition, setEdition] = useState<ClientApi | null>(null);
  const [departEdition, setDepartEdition] = useState<ClientApi | null>(null);
  const ouvrir = (c: ClientApi) => {
    setEdition(c);
    setDepartEdition(c);
  };
  const { enCours, erreur, setErreur, envoyer } = useEnvoi();
  const charger = useCallback(() => envoyer(async () => setDonnees(await api.comptes(props.etablissementId))), [envoyer, props.etablissementId]);
  useEffect(() => void charger(), [charger]);
  // Client choisi dans la recherche : sa fiche s'ouvre une fois la liste lue.
  const aOuvrir = useRef(props.ouvrir ?? null);
  useEffect(() => {
    const c = aOuvrir.current && donnees?.comptes.find((x) => x.client.id === aOuvrir.current);
    if (c) {
      aOuvrir.current = null;
      ouvrir({ ...c.client });
    }
  }, [donnees]); // eslint-disable-line react-hooks/exhaustive-deps
  const enregistrer = () => {
    if (!edition) return;
    if (!edition.nom.trim()) return setErreur("Le nom du client est obligatoire.");
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
    <>
    <EntetePage
      surtitre={props.surtitre}
      titre="Comptes clients"
      aide={
        <>
          Ventes portées en compte et réglées plus tard, sur n'importe quel appareil. La vente compte dans le chiffre du jour ; la TVA devient
          exigible au règlement. Le nom du client figure sur ses tickets en compte, conservés six ans (obligation légale) ; ce qu'en sait le client
          est sur la{" "}
          <a href={`/donnees/${props.etablissementId}`} target="_blank" rel="noopener">
            page d'information sur les données
          </a>
          .
        </>
      }
      actions={
        <>
          <button className="bouton" disabled={enCours} onClick={() => void charger()}>
            <AvecIcone icone={RotateCw}>Actualiser</AvecIcone>
          </button>
          <button className="bouton principal" onClick={() => ouvrir({ id: nouvelIdClient(), nom: "", telephone: "", email: "", actif: true })}>
            <AvecIcone icone={UserPlus}>Nouveau client</AvecIcone>
          </button>
        </>
      }
    />
    <section className="admin-section">
      {donnees && (
        <p className="a-resume">
          Total dû : <strong className="chiffres">{euros(du)}</strong>
          {donnees.comptes.length > 0 && ` · ${pluriel(donnees.comptes.filter((c) => c.soldeTTC > 0).length, "client")} à régler`}
        </p>
      )}
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
                  <BoutonIcone icone={Pencil} variante="discret" libelle={`Modifier la fiche de ${c.client.nom}`} onClick={() => ouvrir({ ...c.client })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {donnees && donnees.comptes.length === 0 && <p className="explication">Aucun client pour l'instant : ils se créent en caisse (Encaisser › En compte) ou ici.</p>}
      {erreur && !edition && <p className="erreur">{erreur}</p>}
    </section>
    {edition && (
      <Panneau
        surtitre="Comptes clients"
        titre={donnees?.comptes.some((c) => c.client.id === edition.id) ? departEdition?.nom || "Client" : "Nouveau client"}
        onFermer={() => setEdition(null)}
        onEnregistrer={enregistrer}
        enCours={enCours}
        modifie={JSON.stringify(edition) !== JSON.stringify(departEdition)}
        erreur={erreur}
      >
        <Champ libelle="Nom du client" aide="Figure sur ses tickets en compte">
          <input value={edition.nom} onChange={(ev) => setEdition({ ...edition, nom: ev.target.value })} required maxLength={80} autoComplete="off" />
        </Champ>
        <Champ libelle="Téléphone" aide="Facultatif">
          <input value={edition.telephone} onChange={(ev) => setEdition({ ...edition, telephone: ev.target.value })} maxLength={30} inputMode="tel" autoComplete="off" />
        </Champ>
        <Champ libelle="E-mail" aide="Facultatif">
          <input value={edition.email ?? ""} onChange={(ev) => setEdition({ ...edition, email: ev.target.value })} type="email" maxLength={254} autoComplete="off" />
        </Champ>
        <label className="case">
          <input type="checkbox" checked={edition.actif} onChange={(ev) => setEdition({ ...edition, actif: ev.target.checked })} />
          <span>
            <strong>Actif</strong>
            <small>Décoché, le client n'est plus proposé en caisse ; son solde reste dû.</small>
          </span>
        </label>
      </Panneau>
    )}
    </>
  );
}

function Identite(props: { e: EtablissementAdmin; cartes: Array<{ id: string; nom: string }>; onChange: () => Promise<void> }) {
  const { e } = props;
  const [identite, setIdentite] = useState(e.identite);
  const [carteId, setCarteId] = useState(e.carteId);
  const [seuil, setSeuil] = useState(e.seuilNote / 100);
  const [noteAuto, setNoteAuto] = useState(e.noteAutomatique !== false);
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
        noteAutomatique: noteAuto,
      });
      setEnregistre(true);
      await props.onChange();
    });
  };

  return (
    <form className="admin-section" onSubmit={enregistrer}>
      <Titre icone={Store}>Identité légale, carte et note</Titre>
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
          <Champ libelle="Note due à partir de (€)" aide={`Actuellement ${euros(e.seuilNote)}`}>
            <input type="number" min={0} step={1} value={seuil} onChange={(ev) => setSeuil(Number(ev.target.value))} />
          </Champ>
          <label className="case">
            <input type="checkbox" checked={noteAuto} onChange={(ev) => setNoteAuto(ev.target.checked)} /> Imprimer la note d'office à partir de ce montant
          </label>
          {!noteAuto && <p className="explication">La note reste due au client sans qu'il la demande : sur papier, ou par QR code s'il préfère la version dématérialisée. La caisse le rappelle à chaque encaissement concerné.</p>}
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
