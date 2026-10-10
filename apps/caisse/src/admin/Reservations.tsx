import { maintenantParis, REGLAGES_DEFAUT, validerReglages, type ReglagesReservation, type Reservation, type ServiceReservation, type StatutReservation } from "@matalon/reservations";
import type { EtatEnvoi } from "@matalon/serveur/partage";
import { CalendarCheck, ChevronLeft, ChevronRight, Code, Copy, ExternalLink, KeyRound, Plus, Save, Send, Settings, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { AvecIcone, BoutonIcone } from "../ui/icones";
import { api, ErreurAdmin, type EtablissementAdmin } from "./api";

type Onglet = "liste" | "reglages" | "site";
const JOURS = ["L", "M", "M", "J", "V", "S", "D"];
const NOMS_JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
export const LIBELLES_STATUT: Record<StatutReservation, string> = { confirmee: "Confirmée", arrivee: "Arrivée", absente: "Absente", annulee: "Annulée" };
export const LIBELLES_SOURCE: Record<Reservation["source"], string> = { en_ligne: "en ligne", telephone: "téléphone", sur_place: "sur place" };

const decaler = (jour: string, n: number) => {
  const d = new Date(`${jour}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const dateLongue = (jour: string) =>
  new Date(`${jour}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const entierOuNul = (v: string) => (v.trim() === "" ? null : Math.max(0, Math.round(Number(v))));

/** Réservations : liste du jour et saisie, réglages des services, code à poser sur le site. */
export function Reservations(props: { etablissements: EtablissementAdmin[] }) {
  const [etabId, setEtabId] = useState(props.etablissements[0]?.id ?? "");
  const [onglet, setOnglet] = useState<Onglet>("liste");
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
      <section className="admin-section">
        <div className="stock-tete">
          <h1 className="titre-icone">
            <AvecIcone icone={CalendarCheck} taille={26}>Réservations</AvecIcone>
          </h1>
          {props.etablissements.length > 1 && (
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
          )}
        </div>
        <p className="explication">
          Le module du site propose les créneaux libres selon les services, les capacités et la durée d'une réservation. Chaque
          réservation reçoit d'office la plus petite table libre qui convient ; elle apparaît sur le plan de salle de la caisse.
          {reglages && !reglages.reglages.actif ? " La réservation en ligne est fermée : ouvrez-la dans les réglages." : ""}
        </p>
        <div className="options" role="tablist">
          {(
            [
              ["liste", "Réservations", CalendarCheck],
              ["reglages", "Services et réglages", Settings],
              ["site", "Sur votre site", Code],
            ] as const
          ).map(([id, libelle, ic]) => (
            <button key={id} role="tab" aria-selected={onglet === id} className={`option${onglet === id ? " active" : ""}`} onClick={() => setOnglet(id)}>
              <AvecIcone icone={ic}>{libelle}</AvecIcone>
            </button>
          ))}
        </div>
      </section>
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

// ───────── Liste du jour ─────────

function Liste(props: { etab: EtablissementAdmin; reglages: ReglagesReservation }) {
  const { etab, reglages } = props;
  const [jour, setJour] = useState(() => maintenantParis(new Date()).jour);
  const [liste, setListe] = useState<Reservation[] | null>(null);
  const [erreur, setErreur] = useState("");
  const [saisie, setSaisie] = useState(false);
  const [annulees, setAnnulees] = useState(false);
  const charger = useCallback(async () => {
    try {
      setListe((await api.reservations(etab.id, jour)).reservations);
      setErreur("");
    } catch (e) {
      setErreur(message(e));
    }
  }, [etab.id, jour]);
  useEffect(() => void charger(), [charger]);

  const modifier = async (r: Reservation, corps: Record<string, unknown>) => {
    try {
      await api.modifierReservation(etab.id, r.id, corps);
    } catch (e) {
      if (e instanceof ErreurAdmin && e.statut === 409 && window.confirm(e.message)) await api.modifierReservation(etab.id, r.id, { ...corps, forcer: true });
      else setErreur(message(e));
    }
    await charger();
  };

  const tables = etab.tables.filter((t) => !t.masquee);
  const nomTables = (ids: string[]) => (ids.length ? ids.map((id) => etab.tables.find((t) => t.id === id)?.nom ?? id).join(" + ") : "À placer");
  const visibles = (liste ?? []).filter((r) => annulees || (r.statut !== "annulee" && r.statut !== "absente"));
  const services = [...reglages.services.map((s) => ({ id: s.id, nom: s.nom, max: s.couvertsMax })), { id: "hors-service", nom: "Hors service", max: 0 }];
  const parService = services
    .map((s) => ({ ...s, liste: visibles.filter((r) => r.serviceId === s.id || (s.id === "hors-service" && !reglages.services.some((x) => x.id === r.serviceId))) }))
    .filter((s) => s.liste.length > 0);
  const couverts = (l: Reservation[]) => l.filter((r) => r.statut === "confirmee" || r.statut === "arrivee").reduce((n, r) => n + r.couverts, 0);

  return (
    <section className="admin-section">
      <div className="admin-ligne resa-jour">
        <BoutonIcone icone={ChevronLeft} libelle="Jour précédent" variante="discret" onClick={() => setJour(decaler(jour, -1))} />
        <input type="date" value={jour} aria-label="Jour" onChange={(e) => e.target.value && setJour(e.target.value)} />
        <BoutonIcone icone={ChevronRight} libelle="Jour suivant" variante="discret" onClick={() => setJour(decaler(jour, 1))} />
        <strong className="resa-date">{dateLongue(jour)}</strong>
        <label className="case">
          <input type="checkbox" checked={annulees} onChange={(e) => setAnnulees(e.target.checked)} /> Annulées et absentes
        </label>
        <button className="bouton principal" onClick={() => setSaisie((o) => !o)}>
          <AvecIcone icone={saisie ? X : Plus}>{saisie ? "Fermer" : "Nouvelle réservation"}</AvecIcone>
        </button>
      </div>
      {saisie && (
        <Saisie
          etab={etab}
          jour={jour}
          onFaite={() => {
            setSaisie(false);
            void charger();
          }}
        />
      )}
      {erreur && <p className="erreur">{erreur}</p>}
      {!liste ? (
        <p>Chargement…</p>
      ) : parService.length === 0 ? (
        <p className="explication">Aucune réservation ce jour-là.</p>
      ) : (
        parService.map((s) => (
          <div key={s.id} className="resa-service">
            <h2>
              {s.nom} · {couverts(s.liste)} couvert{couverts(s.liste) > 1 ? "s" : ""}
              {s.max ? ` sur ${s.max}` : ""}
            </h2>
            <table className="tableau admin-tableau resa-table">
              <thead>
                <tr>
                  <th>Heure</th>
                  <th>Client</th>
                  <th className="nombre">Pers.</th>
                  <th>Table</th>
                  <th>Statut</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {s.liste.map((r) => (
                  <tr key={r.id} className={r.statut === "annulee" || r.statut === "absente" ? "annule" : ""}>
                    <td>
                      <strong>{r.heure}</strong>
                      <small>{r.dureeMinutes} min</small>
                    </td>
                    <td>
                      {`${r.civilite ? `${r.civilite} ` : ""}${r.prenom} ${r.nom}`}
                      <small>
                        <a href={`tel:${r.telephone}`}>{r.telephone}</a>
                        {r.email ? ` · ${r.email}` : ""} · {LIBELLES_SOURCE[r.source]}
                      </small>
                    </td>
                    <td className="nombre">{r.couverts}</td>
                    <td>
                      <select
                        aria-label={`Table de ${r.prenom} ${r.nom}`}
                        value={r.tables.length === 1 ? r.tables[0] : r.tables.length ? "plusieurs" : ""}
                        onChange={(e) => void modifier(r, { tables: e.target.value ? [e.target.value] : [] })}
                      >
                        <option value="">À placer</option>
                        {r.tables.length > 1 && <option value="plusieurs">{nomTables(r.tables)}</option>}
                        {tables.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.zone} · {t.nom} ({t.chaises ?? 4} pl.)
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select aria-label={`Statut de ${r.prenom} ${r.nom}`} value={r.statut} onChange={(e) => void modifier(r, { statut: e.target.value })}>
                        {(Object.keys(LIBELLES_STATUT) as StatutReservation[]).map((st) => (
                          <option key={st} value={st}>
                            {LIBELLES_STATUT[st]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      {r.commentaire ?? ""}
                      {(r.offresEmail || r.offresSms) && <small>Offres : {[r.offresEmail && "e-mail", r.offresSms && "SMS"].filter(Boolean).join(", ")}</small>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}
    </section>
  );
}

/** Réservation prise par l'équipe (téléphone, sur place) : pas tenue par le délai ni la taille de groupe du site. */
export function Saisie(props: { etab: { id: string }; jour: string; onFaite: () => void; creer?: (corps: Record<string, unknown>) => Promise<unknown> }) {
  const [erreur, setErreur] = useState("");
  const creer = props.creer ?? ((corps: Record<string, unknown>) => api.creerReservation(props.etab.id, corps));
  const envoyer = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const corps = { ...f, couverts: Number(f.couverts), source: f.source || "telephone" };
    try {
      await creer(corps);
      props.onFaite();
    } catch (err) {
      if (err instanceof Error && "statut" in err && (err as ErreurAdmin).statut === 409 && window.confirm(`${err.message} Enregistrer quand même ?`)) {
        try {
          await creer({ ...corps, forcer: true });
          props.onFaite();
        } catch (e2) {
          setErreur(message(e2));
        }
      } else setErreur(message(err));
    }
  };
  return (
    <form className="resa-saisie" onSubmit={(e) => void envoyer(e)}>
      <label className="champ">
        <span>Date</span>
        <input name="date" type="date" defaultValue={props.jour} required />
      </label>
      <label className="champ">
        <span>Heure</span>
        <input name="heure" type="time" step={900} defaultValue="20:00" required />
      </label>
      <label className="champ">
        <span>Personnes</span>
        <input name="couverts" type="number" min={1} max={200} defaultValue={2} required />
      </label>
      <label className="champ">
        <span>Prénom</span>
        <input name="prenom" required maxLength={60} />
      </label>
      <label className="champ">
        <span>Nom</span>
        <input name="nom" required maxLength={60} />
      </label>
      <label className="champ">
        <span>Téléphone</span>
        <input name="telephone" type="tel" required />
      </label>
      <label className="champ">
        <span>E-mail (confirmation)</span>
        <input name="email" type="email" />
      </label>
      <label className="champ">
        <span>Prise</span>
        <select name="source" defaultValue="telephone">
          <option value="telephone">Au téléphone</option>
          <option value="sur_place">Sur place</option>
        </select>
      </label>
      <label className="champ resa-large">
        <span>Note</span>
        <input name="commentaire" maxLength={500} placeholder="Allergies, anniversaire, chaise haute…" />
      </label>
      {erreur && <p className="erreur resa-large">{erreur}</p>}
      <div className="resa-large">
        <button className="bouton principal" type="submit">
          <AvecIcone icone={Save}>Enregistrer la réservation</AvecIcone>
        </button>
      </div>
    </form>
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
    if (!window.confirm("Retirer la clé Resend de l'établissement ? Les e-mails ne partiront plus (sauf clé commune du groupe).")) return;
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
