import { maintenantParis, REGLAGES_DEFAUT, validerReglages, type ReglagesReservation, type ServiceReservation } from "@matalon/reservations";
import type { EtatEnvoi } from "@matalon/serveur/partage";
import { Copy, ExternalLink, KeyRound, Plus, Save, Send, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { placerTables, zonesDuPlan } from "../metier/plan";
import { AvecIcone, BoutonIcone } from "../ui/icones";
import { PlanSalle } from "../ui/PlanSalle";
import { EspaceReservations, type CentreReservations } from "../ui/reservations/EspaceReservations";
import { dateLongue, etatsDuJour, type AccesReservations, type ContexteReservations } from "../ui/reservations/commun";
import { api, type EtablissementAdmin } from "./api";
import { EntetePage, Onglets, type DefOnglet } from "./Page";
import { confirmer } from "./Panneau";

type Onglet = "liste" | "reglages" | "site";
const ONGLETS: Array<DefOnglet<Onglet>> = [
  { id: "liste", libelle: "Réservations" },
  { id: "reglages", libelle: "Services et réglages" },
  { id: "site", libelle: "Sur votre site" },
];
const JOURS = ["L", "M", "M", "J", "V", "S", "D"];
const NOMS_JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const entierOuNul = (v: string) => (v.trim() === "" ? null : Math.max(0, Math.round(Number(v))));

/** Réservations : liste du jour et saisie, réglages des services, code à poser sur le site. */
export function Reservations(props: { etablissements: EtablissementAdmin[]; onglet?: string | null; onOnglet?: (o: string | null) => void }) {
  const [etabId, setEtabId] = useState(props.etablissements[0]?.id ?? "");
  const [ongletLocal, setOngletLocal] = useState<Onglet>("liste");
  // Sous-page dans l'adresse de l'administration (#/moka/reservations/reglages) ; « liste » par défaut.
  const onglet: Onglet = props.onOnglet ? (ONGLETS.some((o) => o.id === props.onglet) ? (props.onglet as Onglet) : "liste") : ongletLocal;
  const setOnglet = (o: Onglet) => (props.onOnglet ? props.onOnglet(o === "liste" ? null : o) : setOngletLocal(o));
  const etab = props.etablissements.find((e) => e.id === etabId);
  const [reglages, setReglages] = useState<{ reglages: ReglagesReservation; version: number; envoi?: EtatEnvoi } | null>(null);
  const [erreur, setErreur] = useState("");

  useEffect(() => {
    if (!etabId) return;
    setReglages(null);
    api
      .reglagesReservation(etabId)
      .then(setReglages)
      .catch((e) => setErreur(message(e)));
  }, [etabId]);

  if (!etab) return <p>Aucun établissement.</p>;
  return (
    <div className="resa">
      <EntetePage
        surtitre="Exploiter"
        titre="Réservations"
        aide="Le module du site propose les créneaux libres selon les services, les capacités et la durée d'une réservation. Chaque réservation reçoit d'office la plus petite table libre qui convient ; elle apparaît sur le plan de salle de la caisse."
        actions={
          props.etablissements.length > 1 && (
            <label className="champ stock-etab">
              <span>Établissement</span>
              <select value={etabId} onChange={(e) => setEtabId(e.target.value)}>
                {props.etablissements.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.identite.enseigne}
                  </option>
                ))}
              </select>
            </label>
          )
        }
      >
        <Onglets libelle="Sous-pages des réservations" groupes={[ONGLETS]} actif={onglet} adresse={(o) => `#/${etab.id}/reservations${o === "liste" ? "" : `/${o}`}`} onChoisir={setOnglet} />
      </EntetePage>
      {reglages && !reglages.reglages.actif && (
        <p className="a-bandeau attention">
          La réservation en ligne est fermée.{" "}
          <button type="button" className="lien-action" onClick={() => setOnglet("reglages")}>
            L'ouvrir dans les réglages
          </button>
        </p>
      )}
      {erreur && <p className="erreur">{erreur}</p>}
      {!reglages ? (
        <p>Chargement…</p>
      ) : onglet === "liste" ? (
        <Liste etab={etab} reglages={reglages.reglages} />
      ) : onglet === "reglages" ? (
        <Reglages key={etab.id} etabId={etab.id} initial={reglages} onEnregistre={(r) => setReglages((x) => ({ ...r, ...(x?.envoi ? { envoi: x.envoi } : {}) }))} />
      ) : (
        <SurLeSite etab={etab} actif={reglages.reglages.actif} />
      )}
    </div>
  );
}

// ───────── Liste et plan du jour (façon Zenchef, 17 novembre 2026) ─────────

/**
 * Liste des réservations du jour à gauche, plan de salle du jour au centre (chaque table montre
 * ses réservations), saisie dans un panneau à droite : le même espace qu'en caisse.
 */
function Liste(props: { etab: EtablissementAdmin; reglages: ReglagesReservation }) {
  const { etab, reglages } = props;
  const [message, setMessage] = useState("");
  const ctx: ContexteReservations = {
    aujourdhui: maintenantParis(new Date()).jour,
    reglages,
    tables: etab.tables,
    zones: etab.zones ?? [],
    equipe: etab.utilisateurs.filter((u) => u.actif).map((u) => u.nom),
  };
  const acces: AccesReservations = useMemo(
    () => ({
      lister: async (du, au) => (await api.reservations(etab.id, du, au)).reservations,
      creer: (corps) => api.creerReservation(etab.id, corps),
      modifier: (id, corps) => api.modifierReservation(etab.id, id, corps),
    }),
    [etab.id],
  );
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(""), 5000);
    return () => clearTimeout(t);
  }, [message]);
  return (
    <section className="admin-section resa-admin">
      {message && (
        <p className="succes resa-admin-message" role="status">
          {message}
        </p>
      )}
      <EspaceReservations ctx={ctx} acces={acces} colonne integre notifier={setMessage} centre={(c) => <PlanDuJour etab={etab} centre={c} />} />
    </section>
  );
}

/** Plan du jour dans l'administration : zones en onglets, tables avec leurs réservations ; un toucher ouvre la réservation (ou choisit la table pendant une saisie). */
function PlanDuJour(props: { etab: EtablissementAdmin; centre: CentreReservations }) {
  const { etab, centre } = props;
  const zones = zonesDuPlan(etab.zones, etab.tables);
  const [zoneNom, setZoneNom] = useState<string | null>(null);
  const zone = zones.find((z) => z.nom === zoneNom) ?? zones[0];
  if (!zone || etab.tables.filter((t) => !t.masquee).length === 0) {
    return <p className="explication resa-plan-vide">Le plan de salle s'affiche ici une fois dessiné (Réglages › Plan de salle).</p>;
  }
  const etats = etatsDuJour(etab.tables, centre.reservations, centre.filtreService);
  return (
    <div className="resa-plan">
      <div className="resa-plan-tete">
        <strong>{dateLongue(centre.date)}</strong>
        {zones.length > 1 && (
          <div className="resa-filtre-services" role="tablist" aria-label="Zones">
            {zones.map((z) => (
              <button key={z.nom} type="button" role="tab" aria-selected={z.nom === zone.nom} className={`option${z.nom === zone.nom ? " active" : ""}`} onClick={() => setZoneNom(z.nom)}>
                {z.nom}
              </button>
            ))}
          </div>
        )}
      </div>
      {centre.selection && <p className="salle-autre-jour salle-selection">Touchez les tables de la réservation sur le plan.</p>}
      <div className="resa-plan-dessin">
        <PlanSalle
          zone={zone}
          tables={placerTables(zone, etab.tables)}
          etats={etats}
          onTable={(id) => (centre.basculerTable ? centre.basculerTable(id) : centre.ouvrirTable(id))}
          {...(centre.selection ? { selection: centre.selection } : {})}
          ajuste
        />
      </div>
    </div>
  );
}

// ───────── Réglages ─────────

function nouveauService(existants: ServiceReservation[]): ServiceReservation {
  const dejeuner = !existants.some((s) => s.debut < "16:00");
  return {
    id: `s-${Math.random().toString(36).slice(2, 8)}`,
    nom: dejeuner ? "Déjeuner" : "Dîner",
    jours: [1, 2, 3, 4, 5, 6, 7],
    debut: dejeuner ? "12:00" : "19:00",
    fin: dejeuner ? "13:45" : "21:30",
    couvertsMax: 40,
    simultanesMax: null,
    arriveesMax: null,
  };
}

function Reglages(props: {
  etabId: string;
  initial: { reglages: ReglagesReservation; version: number; envoi?: EtatEnvoi };
  onEnregistre: (r: { reglages: ReglagesReservation; version: number }) => void;
}) {
  const [r, setR] = useState<ReglagesReservation>({ ...REGLAGES_DEFAUT, ...props.initial.reglages });
  const [version, setVersion] = useState(props.initial.version);
  const [fermeture, setFermeture] = useState("");
  const [envoi, setEnvoi] = useState(props.initial.envoi);
  const [etat, setEtat] = useState<{ ok?: string; erreur?: string }>({});
  const erreurs = useMemo(() => validerReglages(r), [r]);
  const maj = (m: Partial<ReglagesReservation>) => setR((x) => ({ ...x, ...m }));
  const majService = (id: string, m: Partial<ServiceReservation>) => setR((x) => ({ ...x, services: x.services.map((s) => (s.id === id ? { ...s, ...m } : s)) }));

  const enregistrer = async () => {
    try {
      const res = await api.enregistrerReglagesReservation(props.etabId, r, version);
      setVersion(res.version);
      props.onEnregistre(res);
      setEtat({ ok: `Réglages enregistrés${res.reglages.actif ? " : la réservation en ligne est ouverte" : " (réservation en ligne fermée)"}.` });
    } catch (e) {
      setEtat({ erreur: message(e) });
    }
  };

  return (
    <section className="admin-section resa-reglages">
      <label className="case resa-ouverture">
        <input type="checkbox" checked={r.actif} onChange={(e) => maj({ actif: e.target.checked })} />
        <strong>Réservation en ligne ouverte</strong>
      </label>

      <h2>Services ouverts à la réservation</h2>
      <p className="explication">
        Pour chaque service : les jours, la première et la dernière heure d'arrivée, puis les plafonds. « Couverts du service » compte
        tout le service ; « En même temps » compte les personnes à table au même moment (avec la durée) ; « Arrivées par créneau »
        protège la cuisine d'un coup de feu. Laissez vide pour ne pas plafonner.
      </p>
      <div className="resa-services">
        {r.services.map((s) => (
          <div key={s.id} className="resa-service-carte">
            <div className="resa-service-tete">
              <input className="resa-nom" value={s.nom} aria-label="Nom du service" onChange={(e) => majService(s.id, { nom: e.target.value })} />
              <BoutonIcone icone={Trash2} libelle={`Supprimer ${s.nom}`} variante="discret" onClick={() => maj({ services: r.services.filter((x) => x.id !== s.id) })} />
            </div>
            <div className="resa-jours" role="group" aria-label={`Jours de ${s.nom}`}>
              {JOURS.map((j, i) => (
                <button
                  key={i}
                  type="button"
                  className={`pastille${s.jours.includes(i + 1) ? " active" : ""}`}
                  aria-pressed={s.jours.includes(i + 1)}
                  aria-label={NOMS_JOURS[i]}
                  onClick={() => majService(s.id, { jours: s.jours.includes(i + 1) ? s.jours.filter((x) => x !== i + 1) : [...s.jours, i + 1].sort() })}
                >
                  {j}
                </button>
              ))}
            </div>
            <div className="resa-grille">
              <label className="champ">
                <span>Première arrivée</span>
                <input type="time" step={900} value={s.debut} onChange={(e) => majService(s.id, { debut: e.target.value })} />
              </label>
              <label className="champ">
                <span>Dernière arrivée</span>
                <input type="time" step={900} value={s.fin} onChange={(e) => majService(s.id, { fin: e.target.value })} />
              </label>
              <label className="champ">
                <span>Couverts du service</span>
                <input type="number" min={1} value={s.couvertsMax} onChange={(e) => majService(s.id, { couvertsMax: Math.round(Number(e.target.value)) })} />
              </label>
              <label className="champ">
                <span>En même temps</span>
                <input type="number" min={1} placeholder="sans plafond" value={s.simultanesMax ?? ""} onChange={(e) => majService(s.id, { simultanesMax: entierOuNul(e.target.value) })} />
              </label>
              <label className="champ">
                <span>Arrivées par créneau</span>
                <input type="number" min={1} placeholder="sans plafond" value={s.arriveesMax ?? ""} onChange={(e) => majService(s.id, { arriveesMax: entierOuNul(e.target.value) })} />
              </label>
              <label className="champ">
                <span>Durée (min)</span>
                <input
                  type="number"
                  min={15}
                  step={5}
                  placeholder={`${r.dureeMinutes} (défaut)`}
                  value={s.dureeMinutes ?? ""}
                  onChange={(e) => {
                    const d = entierOuNul(e.target.value);
                    const { dureeMinutes: _, ...reste } = s;
                    setR((x) => ({ ...x, services: x.services.map((y) => (y.id === s.id ? (d === null ? reste : { ...reste, dureeMinutes: d }) : y)) }));
                  }}
                />
              </label>
            </div>
          </div>
        ))}
        <button type="button" className="bouton" onClick={() => maj({ services: [...r.services, nouveauService(r.services)] })}>
          <AvecIcone icone={Plus}>Ajouter un service</AvecIcone>
        </button>
      </div>

      <h2>Règles</h2>
      <div className="resa-grille">
        <label className="champ">
          <span>Durée par défaut (min)</span>
          <input type="number" min={15} step={5} value={r.dureeMinutes} onChange={(e) => maj({ dureeMinutes: Math.round(Number(e.target.value)) })} />
        </label>
        <label className="champ">
          <span>Écart entre créneaux</span>
          <select value={r.pasMinutes} onChange={(e) => maj({ pasMinutes: Number(e.target.value) as 15 | 30 })}>
            <option value={15}>15 min</option>
            <option value={30}>30 min</option>
          </select>
        </label>
        <label className="champ">
          <span>Au plus tard (min avant)</span>
          <input type="number" min={0} step={15} value={r.delaiMinutes} onChange={(e) => maj({ delaiMinutes: Math.round(Number(e.target.value)) })} />
        </label>
        <label className="champ">
          <span>Jusqu'à (jours à l'avance)</span>
          <input type="number" min={1} value={r.horizonJours} onChange={(e) => maj({ horizonJours: Math.round(Number(e.target.value)) })} />
        </label>
        <label className="champ">
          <span>Groupe en ligne (pers. max)</span>
          <input type="number" min={1} value={r.groupeMax} onChange={(e) => maj({ groupeMax: Math.round(Number(e.target.value)) })} />
        </label>
      </div>

      <h2>Fermetures exceptionnelles</h2>
      <div className="admin-ligne">
        <input type="date" value={fermeture} aria-label="Date de fermeture" onChange={(e) => setFermeture(e.target.value)} />
        <button
          type="button"
          className="bouton"
          disabled={!fermeture}
          onClick={() => {
            if (!r.fermetures.includes(fermeture)) maj({ fermetures: [...r.fermetures, fermeture].sort() });
            setFermeture("");
          }}
        >
          <AvecIcone icone={Plus}>Fermer ce jour</AvecIcone>
        </button>
      </div>
      <div className="resa-fermetures">
        {r.fermetures.map((j) => (
          <span key={j} className="pastille">
            {dateLongue(j)}
            <BoutonIcone icone={X} taille={16} libelle={`Rouvrir le ${dateLongue(j)}`} variante="discret" onClick={() => maj({ fermetures: r.fermetures.filter((x) => x !== j) })} />
          </span>
        ))}
      </div>

      <h2>Module du site</h2>
      <div className="resa-grille">
        <label className="champ resa-large">
          <span>Message d'accueil</span>
          <textarea rows={2} maxLength={400} value={r.accueil} placeholder="Bienvenue au Moka !" onChange={(e) => maj({ accueil: e.target.value })} />
        </label>
        <label className="champ">
          <span>Téléphone (groupes)</span>
          <input value={r.telephone ?? ""} onChange={(e) => maj({ telephone: e.target.value })} />
        </label>
        <label className="champ">
          <span>E-mail de l'établissement</span>
          <input type="email" value={r.email ?? ""} placeholder="reçoit chaque réservation et les réponses" onChange={(e) => maj({ email: e.target.value })} />
        </label>
        <label className="champ">
          <span>Conditions d'utilisation (lien)</span>
          <input type="url" value={r.conditions ?? ""} placeholder="https://…" onChange={(e) => maj({ conditions: e.target.value })} />
        </label>
        <label className="champ">
          <span>Confidentialité (lien)</span>
          <input type="url" value={r.confidentialite ?? ""} placeholder="https://…" onChange={(e) => maj({ confidentialite: e.target.value })} />
        </label>
      </div>

      <h2>E-mails aux clients</h2>
      <p className="explication">
        Confirmations et annulations partent de l'adresse d'expédition, au nom de l'établissement, par son propre compte Resend ; les
        réponses des clients arrivent sur l'e-mail de l'établissement. Le domaine de l'adresse doit être vérifié dans ce compte Resend.
      </p>
      <CleResend etabId={props.etabId} envoi={envoi} onChange={setEnvoi} />
      <div className="resa-grille">
        <label className="champ">
          <span>Adresse d'expédition</span>
          <input type="email" value={r.expediteur ?? ""} placeholder="reservations@moka-annecy.com" onChange={(e) => maj({ expediteur: e.target.value })} />
        </label>
        <div className="champ">
          <span>Vérifier l'envoi</span>
          <button
            type="button"
            className="bouton"
            disabled={!envoi?.cleEtablissement && !envoi?.groupe}
            title="Envoie un e-mail d'essai à l'e-mail de l'établissement, avec les réglages enregistrés"
            onClick={async () => {
              try {
                const e = await api.essaiEmailReservation(props.etabId);
                setEtat({ ok: `E-mail d'essai envoyé à ${e.a}${e.de ? ` depuis ${e.de}` : ""} : vérifiez sa réception.` });
              } catch (err) {
                setEtat({ erreur: message(err) });
              }
            }}
          >
            <AvecIcone icone={Send}>Envoyer un e-mail d'essai</AvecIcone>
          </button>
        </div>
      </div>

      {erreurs.length > 0 && (
        <ul className="erreur">
          {erreurs.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      {etat.erreur && <p className="erreur">{etat.erreur}</p>}
      {etat.ok && <p className="succes">{etat.ok}</p>}
      <div className="admin-ligne">
        <button className="bouton principal" disabled={erreurs.length > 0} onClick={() => void enregistrer()}>
          <AvecIcone icone={Save}>Enregistrer les réglages</AvecIcone>
        </button>
      </div>
    </section>
  );
}

/**
 * Clé API Resend de l'établissement (son propre compte) : saisie une fois, chiffrée
 * sur le serveur, jamais réaffichée — seulement son aperçu.
 */
function CleResend(props: { etabId: string; envoi: EtatEnvoi | undefined; onChange: (e: EtatEnvoi) => void }) {
  const [saisie, setSaisie] = useState("");
  const [ouvert, setOuvert] = useState(false);
  const [etat, setEtat] = useState<{ ok?: string; erreur?: string }>({});
  const envoi = props.envoi;
  if (!envoi) return null;
  const cle = envoi.cleEtablissement;
  const enregistrer = async () => {
    try {
      const r = await api.enregistrerCleResend(props.etabId, saisie.trim());
      props.onChange({ ...envoi, cleEtablissement: r.cleEtablissement });
      setSaisie("");
      setOuvert(false);
      setEtat({ ok: "Clé enregistrée, chiffrée sur le serveur." });
    } catch (e) {
      setEtat({ erreur: message(e) });
    }
  };
  const retirer = async () => {
    if (!(await confirmer({ titre: "Retirer la clé Resend de l'établissement ?", message: "Les e-mails ne partiront plus, sauf avec la clé commune du groupe.", confirmer: "Retirer la clé", danger: true }))) return;
    try {
      await api.retirerCleResend(props.etabId);
      props.onChange({ ...envoi, cleEtablissement: null });
      setEtat({ ok: "Clé retirée." });
    } catch (e) {
      setEtat({ erreur: message(e) });
    }
  };
  return (
    <div className="resa-cle">
      <p>
        <strong>Clé API Resend de l'établissement : </strong>
        {cle
          ? `${cle.apercu}, enregistrée le ${new Date(cle.majLe).toLocaleDateString("fr-FR")}${cle.majPar ? ` (${cle.majPar.replace(/^administration · /, "")})` : ""}`
          : envoi.groupe
            ? "aucune, la clé commune du groupe sert à défaut"
            : "aucune : aucun e-mail ne part"}
      </p>
      {!envoi.chiffrement && (
        <p className="erreur">Clé maîtresse absente : ajoutez CLE_SECRETS dans Vercel (openssl rand -base64 32), redéployez, puis enregistrez la clé ici.</p>
      )}
      {ouvert ? (
        <div className="admin-ligne">
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            aria-label="Clé API Resend"
            placeholder="re_…"
            value={saisie}
            onChange={(e) => setSaisie(e.target.value)}
          />
          <button className="bouton principal" disabled={!saisie.trim() || !envoi.chiffrement} onClick={() => void enregistrer()}>
            <AvecIcone icone={KeyRound}>Enregistrer la clé</AvecIcone>
          </button>
          <button className="bouton discret" onClick={() => (setOuvert(false), setSaisie(""))}>
            Annuler
          </button>
        </div>
      ) : (
        <div className="admin-ligne">
          <button className="bouton" disabled={!envoi.chiffrement} onClick={() => setOuvert(true)}>
            <AvecIcone icone={KeyRound}>{cle ? "Remplacer la clé" : "Ajouter la clé"}</AvecIcone>
          </button>
          {cle && (
            <button className="bouton discret" onClick={() => void retirer()}>
              <AvecIcone icone={Trash2}>Retirer</AvecIcone>
            </button>
          )}
        </div>
      )}
      <p className="explication">
        Dans Resend : API Keys › Create API key, droit « Sending access », domaine de l'établissement. La clé n'est plus affichée après
        l'enregistrement ; pour la changer, remplacez-la.
      </p>
      {etat.erreur && <p className="erreur">{etat.erreur}</p>}
      {etat.ok && <p className="succes">{etat.ok}</p>}
    </div>
  );
}

// ───────── Code à poser sur le site ─────────

function SurLeSite(props: { etab: EtablissementAdmin; actif: boolean }) {
  const origine = location.origin;
  const balise = `<script src="${origine}/reservation.js" data-etablissement="${props.etab.id}" async></script>`;
  const lien = `${origine}/reserver/${props.etab.id}`;
  const [copie, setCopie] = useState("");
  const copier = async (texte: string, quoi: string) => {
    try {
      await navigator.clipboard.writeText(texte);
      setCopie(quoi);
    } catch {
      setCopie("");
    }
  };
  return (
    <section className="admin-section resa-site">
      {!props.actif && <p className="erreur">La réservation en ligne est fermée : le module affichera « indisponible » tant qu'elle n'est pas ouverte.</p>}
      <h2>Balise à coller dans le site</h2>
      <p className="explication">
        À placer une fois, juste avant <code>&lt;/body&gt;</code> (ou dans un bloc « code HTML » de Wix, WordPress, Squarespace…). Elle ajoute
        le bouton « Réserver une table » en bas à droite et ouvre le panneau de réservation par-dessus le site.
      </p>
      <pre className="resa-code">{balise}</pre>
      <div className="admin-ligne">
        <button className="bouton principal" onClick={() => void copier(balise, "balise")}>
          <AvecIcone icone={Copy}>{copie === "balise" ? "Balise copiée" : "Copier la balise"}</AvecIcone>
        </button>
        <a className="bouton" href={lien} target="_blank" rel="noopener">
          <AvecIcone icone={ExternalLink}>Voir le module</AvecIcone>
        </a>
      </div>
      <h2>Les boutons « Réserver » du site</h2>
      <p className="explication">
        Pour que les boutons existants ouvrent le même panneau, ajoutez-leur l'attribut <code>data-matalon-reserver</code>, ou faites-les
        pointer vers <code>#reserver</code>. Exemple : <code>&lt;a href="#reserver"&gt;Réserver une table&lt;/a&gt;</code>.
      </p>
      <h2>Options de la balise</h2>
      <table className="tableau admin-tableau">
        <thead>
          <tr>
            <th>Attribut</th>
            <th>Effet</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>data-texte="Réserver"</code>
            </td>
            <td>Texte du bouton flottant.</td>
          </tr>
          <tr>
            <td>
              <code>data-logo="https://…/logo.png"</code>
            </td>
            <td>Logo en tête du panneau (sinon, le nom de l'établissement).</td>
          </tr>
          <tr>
            <td>
              <code>data-bouton="non"</code>
            </td>
            <td>Pas de bouton flottant : seuls les boutons du site ouvrent le panneau.</td>
          </tr>
          <tr>
            <td>
              <code>data-position="gauche"</code>
            </td>
            <td>Bouton et panneau en bas à gauche.</td>
          </tr>
        </tbody>
      </table>
      <h2>Lien direct</h2>
      <p className="explication">Pour Google, Instagram ou un QR code : la même réservation en page entière.</p>
      <pre className="resa-code">{lien}</pre>
      <button className="bouton" onClick={() => void copier(lien, "lien")}>
        <AvecIcone icone={Copy}>{copie === "lien" ? "Lien copié" : "Copier le lien"}</AvecIcone>
      </button>
    </section>
  );
}
