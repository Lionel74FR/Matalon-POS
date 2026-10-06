import { afficherCode, ID_ETABLISSEMENT_VALIDE, PIN_VALIDE, type IdentiteEtablissement, type Role, type UtilisateurApi } from "@matalon/serveur/partage";
import QRCode from "qrcode";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { genererTables } from "../donnees/configuration";
import { api, ErreurAdmin, type CaisseAdmin, type EtablissementAdmin, type RapportVerification } from "./api";

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
          Réessayer
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
            Ce compte gère les établissements, les équipes et les iPad du groupe. Il est protégé par un mot de passe et un
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
            Continuer
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
            Activer et se connecter
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
          Se connecter
        </button>
      </form>
    </div>
  );
}

// ───────── Tableau de bord ─────────

function Tableau(props: { identifiant: string; onDeconnecte: () => void }) {
  const [donnees, setDonnees] = useState<Awaited<ReturnType<typeof api.etablissements>> | null>(null);
  const [choisi, setChoisi] = useState<string | null>(null);
  const [erreur, setErreur] = useState("");

  const recharger = useCallback(async () => {
    try {
      const d = await api.etablissements();
      setDonnees(d);
      setChoisi((c) => c ?? d.etablissements[0]?.id ?? "nouveau");
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
          <span>{props.identifiant}</span>
          <button className="bouton discret" onClick={() => void api.deconnexion().finally(props.onDeconnecte)}>
            Se déconnecter
          </button>
        </div>
      </header>
      <div className="admin-corps">
        <nav className="admin-liste" aria-label="Établissements">
          <h2>Établissements</h2>
          {donnees?.etablissements.map((e) => (
            <button key={e.id} className={`admin-lien${e.id === choisi ? " actif" : ""}`} onClick={() => setChoisi(e.id)}>
              <strong>{e.identite.enseigne}</strong>
              <small>
                {e.caisses.filter((c) => !c.revoqueeLe).length} iPad · {pluriel(e.utilisateurs.filter((u) => u.actif).length, "personne")}
                {e.caisses.some((c) => c.divergence && !c.revoqueeLe) ? " · divergence" : ""}
              </small>
            </button>
          ))}
          <button className={`admin-lien${choisi === "nouveau" ? " actif" : ""}`} onClick={() => setChoisi("nouveau")}>
            + Nouvel établissement
          </button>
        </nav>
        <main className="admin-contenu">
          {erreur && <p className="erreur">{erreur}</p>}
          {!donnees ? (
            <p>Chargement…</p>
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
      <h1>Nouvel établissement</h1>
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
        Créer l'établissement
      </button>
    </form>
  );
}

// ───────── Fiche établissement ─────────

function FicheEtablissement(props: { e: EtablissementAdmin; cartes: Array<{ id: string; nom: string }>; onChange: () => Promise<void> }) {
  const { e } = props;
  const responsable = e.utilisateurs.some((u) => u.role === "responsable" && u.actif);
  const identiteIncomplete = !e.identite.raisonSociale || !e.identite.siret || !e.identite.tvaIntracom || !e.identite.adresse;
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
          Identité légale incomplète : raison sociale, adresse, SIRET et n° de TVA doivent figurer sur chaque note client.
        </p>
      )}
      <Rattacher e={e} responsable={responsable} onChange={props.onChange} />
      <Caisses caisses={e.caisses} onChange={props.onChange} />
      <Equipe e={e} onChange={props.onChange} />
      <Identite e={e} cartes={props.cartes} onChange={props.onChange} />
    </>
  );
}

function Rattacher(props: { e: EtablissementAdmin; responsable: boolean; onChange: () => Promise<void> }) {
  const [nom, setNom] = useState("");
  const [nouveau, setNouveau] = useState<{ code: string; expireLe: string; nomCaisse: string } | null>(null);
  const { enCours, erreur, envoyer } = useEnvoi();
  const generer = (ev: FormEvent) => {
    ev.preventDefault();
    void envoyer(async () => {
      setNouveau(await api.genererCode(props.e.id, nom.trim() || "iPad"));
      setNom("");
      await props.onChange();
    });
  };
  return (
    <section className="admin-section">
      <h2>Rattacher un iPad</h2>
      {!props.responsable ? (
        <p className="explication">Ajoutez d'abord un responsable à l'équipe : sans lui, personne ne pourrait ouvrir la caisse.</p>
      ) : (
        <>
          <p className="explication">
            Sur l'iPad, ouvrez {location.host} depuis Safari, ajoutez-le à l'écran d'accueil (Partager › Sur l'écran d'accueil),
            ouvrez-le, puis saisissez le code. Un code sert une seule fois et expire au bout de 48 heures.
          </p>
          <form className="admin-ligne" onSubmit={generer}>
            <input value={nom} onChange={(ev) => setNom(ev.target.value)} placeholder="Nom de l'iPad (Comptoir, Terrasse…)" maxLength={40} />
            <button className="bouton principal" disabled={enCours}>
              Générer un code
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

function Caisses(props: { caisses: CaisseAdmin[]; onChange: () => Promise<void> }) {
  const [rapports, setRapports] = useState<Record<string, RapportVerification | string>>({});
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
    if (!window.confirm(`Révoquer « ${c.nom} » ? Cet iPad ne pourra plus encaisser ni se synchroniser. C'est définitif.`)) return;
    try {
      await api.revoquer(c.id);
      await props.onChange();
    } catch (e) {
      window.alert(message(e));
    }
  };
  return (
    <section className="admin-section">
      <h2>iPad rattachés</h2>
      {props.caisses.length === 0 ? (
        <p className="explication">Aucun iPad pour l'instant.</p>
      ) : (
        <div className="admin-caisses">
          {props.caisses.map((c) => {
            const rapport = rapports[c.id];
            return (
              <article key={c.id} className={`admin-caisse${c.revoqueeLe ? " revoquee" : ""}`}>
                <header>
                  <strong>{c.nom}</strong>
                  <small>{c.id}</small>
                  <span className={c.divergence && !c.revoqueeLe ? "erreur" : "etat"}>
                    {c.revoqueeLe ? `Révoqué le ${dateHeure(c.revoqueeLe)}` : c.divergence ? "Divergence" : "En service"}
                  </span>
                </header>
                <p className="admin-meta">
                  Rattaché le {dateHeure(c.rattacheeLe)} · dernière synchronisation {dateHeure(c.derniereSynchro)} ·{" "}
                  {pluriel(c.derniers.tickets?.numero ?? 0, "ticket")} · {pluriel(c.derniers.clotures?.numero ?? 0, "clôture")}
                </p>
                {c.divergence && !c.revoqueeLe && <p className="erreur">{c.divergence}</p>}
                {rapport && (
                  <p className={typeof rapport !== "string" && !rapport.integre ? "erreur" : "admin-ok"}>
                    {typeof rapport === "string"
                      ? rapport
                      : rapport.integre
                        ? `Chaîne intègre : ${pluriel(rapport.compteurs.tickets ?? 0, "ticket")}, ${pluriel(rapport.compteurs.evenements ?? 0, "événement")}, ${pluriel(rapport.compteurs.clotures ?? 0, "clôture")}.`
                        : `${pluriel(rapport.anomalies.length, "anomalie")} : ${rapport.anomalies
                            .slice(0, 3)
                            .map((x) => `${x.chaine ?? ""} n°${x.numero ?? "?"} ${x.code}`)
                            .join(", ")}`}
                  </p>
                )}
                <div className="admin-actions">
                  <button className="bouton" onClick={() => void verifier(c.id)}>
                    Vérifier la chaîne
                  </button>
                  <a className="bouton" href={api.urlCsv(c.id)}>
                    Clôtures (CSV)
                  </a>
                  <a className="bouton" href={api.urlJournal(c.id)}>
                    Journal complet (JSON)
                  </a>
                  {!c.revoqueeLe && (
                    <button className="bouton danger" onClick={() => void revoquer(c)}>
                      Révoquer
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
      <h2>Équipe</h2>
      <p className="explication">
        Chaque personne se connecte en caisse avec son code PIN. Les responsables valident annulations et clôtures. Les
        changements arrivent sur les iPad à la synchronisation suivante (une minute au plus en ligne).
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
                <td>
                  <button className="bouton discret" disabled={enCours} onClick={() => changerPin(u)}>
                    Changer le code
                  </button>
                  <button className="bouton discret" disabled={enCours} onClick={() => void modifier(u, { actif: !u.actif })}>
                    {u.actif ? "Désactiver" : "Réactiver"}
                  </button>
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
          Ajouter
        </button>
      </form>
      {props.e.utilisateurs.length === 0 && <p className="explication">Commencez par un responsable.</p>}
      {erreur && <p className="erreur">{erreur}</p>}
    </section>
  );
}

function Identite(props: { e: EtablissementAdmin; cartes: Array<{ id: string; nom: string }>; onChange: () => Promise<void> }) {
  const { e } = props;
  const [identite, setIdentite] = useState(e.identite);
  const [carteId, setCarteId] = useState(e.carteId);
  const [seuil, setSeuil] = useState(e.seuilNote / 100);
  const [salle, setSalle] = useState(e.tables.filter((t) => t.zone === "Salle").length);
  const [terrasse, setTerrasse] = useState(e.tables.filter((t) => t.zone === "Terrasse").length);
  const [enregistre, setEnregistre] = useState(false);
  const { enCours, erreur, envoyer } = useEnvoi();

  const enregistrer = (ev: FormEvent) => {
    ev.preventDefault();
    setEnregistre(false);
    void envoyer(async () => {
      const autres = e.tables.filter((t) => t.zone !== "Salle" && t.zone !== "Terrasse");
      await api.modifierEtablissement(e.id, {
        identite: { ...identite, siret: identite.siret.replace(/\s/g, "") },
        carteId,
        tables: [...genererTables(salle, terrasse), ...autres],
        seuilNote: Math.round(seuil * 100),
      });
      setEnregistre(true);
      await props.onChange();
    });
  };

  return (
    <form className="admin-section" onSubmit={enregistrer}>
      <h2>Identité, carte et salle</h2>
      <div className="formulaire-colonnes">
        <div>
          {CHAMPS_IDENTITE.map(([cle, libelle, aide]) => (
            <Champ key={cle} libelle={libelle} aide={aide}>
              <input value={identite[cle]} onChange={(ev) => setIdentite({ ...identite, [cle]: ev.target.value })} required={cle === "enseigne"} />
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
          <Champ libelle="Tables en salle">
            <input type="number" min={0} max={60} value={salle} onChange={(ev) => setSalle(Number(ev.target.value))} />
          </Champ>
          <Champ libelle="Tables en terrasse">
            <input type="number" min={0} max={60} value={terrasse} onChange={(ev) => setTerrasse(Number(ev.target.value))} />
          </Champ>
          <Champ libelle="Note imprimée d'office à partir de (€)" aide={`Actuellement ${euros(e.seuilNote)}`}>
            <input type="number" min={0} step={1} value={seuil} onChange={(ev) => setSeuil(Number(ev.target.value))} />
          </Champ>
        </div>
      </div>
      <div className="admin-ligne">
        <button className="bouton principal" disabled={enCours}>
          Enregistrer
        </button>
        {enregistre && <span className="admin-ok">Enregistré. Les iPad le recevront à la prochaine synchronisation.</span>}
        {erreur && <span className="erreur">{erreur}</span>}
      </div>
    </form>
  );
}
