import { dateComptable } from "@matalon/noyau-fiscal";
import type { AlerteApi, IndicateursPeriode, LigneStat, ReponseStatistiques, SalleEnCours, StatMoment } from "@matalon/serveur/partage";
import { Bell, Check, Clock, Pencil, RefreshCw, TrendingDown, TrendingUp, Utensils } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { HEURE_BASCULE } from "../fiscal/caisse";
import { fraicheur } from "../fiscal/journee";
import { LIBELLES_PAIEMENT } from "../metier/libelles";
import { messageServeur } from "./Reglages";
import { euros, useCaisse } from "./contexte";
import { AvecIcone, BoutonIcone } from "./icones";
import "./statistiques.css";

// ───────── Périodes ─────────

const decaler = (jour: string, n: number) => {
  const d = new Date(`${jour}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const finDeMois = (mois: string) => decaler(`${decaler(`${mois}-28`, 4).slice(0, 7)}-01`, -1);

type Preset = "aujourdhui" | "hier" | "7j" | "30j" | "mois" | "moisPrecedent" | "annee";
const PRESETS: Array<[Preset, string]> = [
  ["aujourdhui", "Aujourd'hui"],
  ["hier", "Hier"],
  ["7j", "7 jours"],
  ["30j", "30 jours"],
  ["mois", "Ce mois"],
  ["moisPrecedent", "Mois dernier"],
  ["annee", "Cette année"],
];

function periodeDe(p: Preset, aujourdhui: string): { du: string; au: string } {
  switch (p) {
    case "aujourdhui":
      return { du: aujourdhui, au: aujourdhui };
    case "hier":
      return { du: decaler(aujourdhui, -1), au: decaler(aujourdhui, -1) };
    case "7j":
      return { du: decaler(aujourdhui, -6), au: aujourdhui };
    case "30j":
      return { du: decaler(aujourdhui, -29), au: aujourdhui };
    case "mois":
      return { du: `${aujourdhui.slice(0, 7)}-01`, au: aujourdhui };
    case "moisPrecedent": {
      const mois = decaler(`${aujourdhui.slice(0, 7)}-01`, -1).slice(0, 7);
      return { du: `${mois}-01`, au: finDeMois(mois) };
    }
    case "annee":
      return { du: `${aujourdhui.slice(0, 4)}-01-01`, au: aujourdhui };
  }
}

/**
 * Journée de service : de 8 h à 3 h du matin (consigne de Lionel du 17 octobre). Les heures
 * d'après minuit s'affichent après 23 h : elles appartiennent à la journée comptable de la
 * veille, qui ne bascule qu'à HEURE_BASCULE (5 h). Une vente hors de ces heures élargit l'axe.
 */
const OUVERTURE = 8;
const FERMETURE = 3;
/** Position d'une heure dans la journée comptable (0 = l'heure de bascule). */
const rangHeure = (h: number) => (h - HEURE_BASCULE + 24) % 24;

const dateCourte = (jour: string) => new Date(`${jour}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });
const dateLongue = (jour: string) =>
  new Date(`${jour}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const libellePeriode = (du: string, au: string) => (du === au ? dateLongue(du) : `du ${dateCourte(du)} au ${dateCourte(au)}`);
const JOURS_SEMAINE = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const entier = (n: number) => n.toLocaleString("fr-FR");
const pl = (n: number, mot: string) => `${entier(n)} ${mot}${Math.abs(n) > 1 ? "s" : ""}`;
const pourcent = (part: number, total: number) => (total ? `${Math.round((part / total) * 100)} %` : "—");

// ───────── Indicateurs ─────────

/** Variation vers la période précédente ; `hausseFavorable` : une hausse est une bonne nouvelle. */
function Variation(props: { actuel: number; precedent: number; hausseFavorable?: boolean }) {
  if (props.precedent === 0) return <span className="stat-variation neutre">{props.actuel === 0 ? "—" : "nouveau"}</span>;
  const v = Math.round(((props.actuel - props.precedent) / Math.abs(props.precedent)) * 100);
  if (v === 0) return <span className="stat-variation neutre">stable</span>;
  const bon = (v > 0) === (props.hausseFavorable ?? true);
  const Icone = v > 0 ? TrendingUp : TrendingDown;
  return (
    <span className={`stat-variation ${bon ? "bon" : "mauvais"}`}>
      <Icone size={15} aria-hidden="true" /> {v > 0 ? "+" : ""}
      {v} %
    </span>
  );
}

function Tuile(props: { libelle: string; valeur: string; actuel: number; precedent: number; hausseFavorable?: boolean; sous?: string; heros?: boolean }) {
  return (
    <div className={`stat-tuile${props.heros ? " heros" : ""}`}>
      <span className="stat-libelle">{props.libelle}</span>
      <strong className="stat-valeur">{props.valeur}</strong>
      <span className="stat-pied">
        <Variation actuel={props.actuel} precedent={props.precedent} {...(props.hausseFavorable === false ? { hausseFavorable: false } : {})} />
        {props.sous && <span className="stat-sous">{props.sous}</span>}
      </span>
    </div>
  );
}

function Indicateurs(props: { i: IndicateursPeriode; p: IndicateursPeriode }) {
  const { i, p } = props;
  return (
    <div className="stat-tuiles">
      <Tuile heros libelle="Chiffre d'affaires TTC" valeur={euros(i.caTTC)} actuel={i.caTTC} precedent={p.caTTC} sous={`${euros(i.caHT)} HT · TVA ${euros(i.tva)}`} />
      <Tuile
        libelle="Tickets"
        valeur={entier(i.ventesConservees)}
        actuel={i.ventesConservees}
        precedent={p.ventesConservees}
        {...(i.nbVentes !== i.ventesConservees ? { sous: i.nbVentes - i.ventesConservees > 1 ? `hors ${i.nbVentes - i.ventesConservees} ventes annulées` : "hors 1 vente annulée" } : {})}
      />
      <Tuile libelle="Ticket moyen" valeur={euros(i.ticketMoyen)} actuel={i.ticketMoyen} precedent={p.ticketMoyen} />
      <Tuile libelle="Couverts" valeur={entier(i.couverts)} actuel={i.couverts} precedent={p.couverts} />
      <Tuile libelle="Dépense par couvert" valeur={i.parCouvert ? euros(i.parCouvert) : "—"} actuel={i.parCouvert} precedent={p.parCouvert} />
      <Tuile libelle="Articles vendus" valeur={entier(i.articles)} actuel={i.articles} precedent={p.articles} />
      <Tuile
        libelle="Remises et offerts"
        valeur={euros(i.remises + i.offerts)}
        actuel={i.remises + i.offerts}
        precedent={p.remises + p.offerts}
        hausseFavorable={false}
        sous={`offerts ${euros(i.offerts)} · ${pourcent(i.remises + i.offerts, i.caTTC + i.remises + i.offerts)} du brut`}
      />
      <Tuile
        libelle="Annulations"
        valeur={entier(i.nbAnnulations)}
        actuel={i.montantAnnule}
        precedent={p.montantAnnule}
        hausseFavorable={false}
        sous={euros(i.montantAnnule)}
      />
      <Tuile
        libelle="Articles retirés après envoi"
        valeur={entier(i.articlesRetires ?? 0)}
        actuel={i.montantRetire ?? 0}
        precedent={p.montantRetire ?? 0}
        hausseFavorable={false}
        sous={`${euros(i.montantRetire ?? 0)} · avant encaissement`}
      />
    </div>
  );
}

// ───────── Graphiques ─────────

interface Point {
  cle: string;
  libelle: string;
  /** Libellé court sous la colonne (vide : pas d'étiquette). */
  axe: string;
  valeur: number;
  detail: string;
}

/** Graduation ronde de l'axe : 3 lignes au plus. */
function graduations(max: number): number[] {
  if (max <= 0) return [];
  const brut = max / 3;
  const puissance = 10 ** Math.floor(Math.log10(brut));
  const pas = [1, 2, 2.5, 5, 10].map((m) => m * puissance).find((x) => x >= brut)!;
  return [1, 2, 3].map((k) => k * pas).filter((v) => v <= max * 1.001 || v - pas < max);
}

/** Colonnes (une seule série) : la plus haute porte sa valeur ; les autres au survol ou au toucher. */
function Colonnes(props: { titre: string; points: Point[]; resume?: string }) {
  const [survol, setSurvol] = useState<{ p: Point; x: number } | null>(null);
  const zone = useRef<HTMLDivElement>(null);
  const max = Math.max(0, ...props.points.map((p) => p.valeur));
  const ticks = graduations(max);
  const haut = Math.max(max, ticks.at(-1) ?? 0) || 1;
  const plusHaut = props.points.find((p) => p.valeur === max && max > 0);
  const montrer = (p: Point, el: HTMLElement) => {
    const z = zone.current!.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    setSurvol({ p, x: r.left - z.left + r.width / 2 });
  };
  return (
    <section className="stat-carte">
      <h2>{props.titre}</h2>
      {props.resume && <p className="stat-resume">{props.resume}</p>}
      <div className="stat-colonnes" ref={zone} onPointerLeave={() => setSurvol(null)}>
        <div className="stat-grille" aria-hidden="true">
          {ticks.map((t) => (
            <div key={t} className="stat-ligne" style={{ bottom: `${(t / haut) * 100}%` }}>
              <span>{euros(t).replace(/,00\s/, " ")}</span>
            </div>
          ))}
        </div>
        <div className="stat-barres" role="list">
          {props.points.map((p) => (
            <button
              key={p.cle}
              role="listitem"
              className={`stat-col${survol?.p.cle === p.cle ? " active" : ""}`}
              aria-label={`${p.libelle} : ${euros(p.valeur)}, ${p.detail}`}
              onPointerEnter={(e) => montrer(p, e.currentTarget)}
              onFocus={(e) => montrer(p, e.currentTarget)}
              onClick={(e) => montrer(p, e.currentTarget)}
              onBlur={() => setSurvol(null)}
            >
              <span className="stat-col-zone">
                {p === plusHaut && <span className="stat-col-valeur">{euros(p.valeur)}</span>}
                <span className="stat-col-barre" style={{ height: `${(Math.max(0, p.valeur) / haut) * 100}%` }} />
              </span>
              <span className="stat-col-axe">{p.axe}</span>
            </button>
          ))}
        </div>
        {survol && (
          <div className="stat-bulle" style={{ left: survol.x }} role="status">
            <strong>{euros(survol.p.valeur)}</strong>
            <span>{survol.p.libelle}</span>
            <span>{survol.p.detail}</span>
          </div>
        )}
      </div>
    </section>
  );
}

/** Barres horizontales : valeur au bout, part du total. */
function BarresH(props: { titre: string; lignes: Array<{ cle: string; libelle: string; valeur: number; detail?: string }>; total?: number; vide?: string; max?: number }) {
  const lignes = props.lignes.slice(0, props.max ?? 8);
  const reste = props.lignes.slice(props.max ?? 8);
  const toutes = reste.length ? [...lignes, { cle: "autres", libelle: `Autres (${reste.length})`, valeur: reste.reduce((s, l) => s + l.valeur, 0) }] : lignes;
  const max = Math.max(0, ...toutes.map((l) => l.valeur)) || 1;
  const total = props.total ?? toutes.reduce((s, l) => s + Math.max(0, l.valeur), 0);
  return (
    <section className="stat-carte">
      <h2>{props.titre}</h2>
      {toutes.length === 0 ? (
        <p className="stat-resume">{props.vide ?? "Rien sur la période."}</p>
      ) : (
        <ul className="stat-barresh">
          {toutes.map((l) => (
            <li key={l.cle}>
              <span className="stat-barresh-libelle">
                {l.libelle}
                {"detail" in l && l.detail ? <small>{l.detail}</small> : null}
              </span>
              <span className="stat-barresh-piste" aria-hidden="true">
                <span style={{ width: `${(Math.max(0, l.valeur) / max) * 100}%` }} />
              </span>
              <span className="stat-barresh-valeur">
                {euros(l.valeur)}
                <small>{pourcent(Math.max(0, l.valeur), total)}</small>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Tableau(props: { titre: string; colonnes: string[]; lignes: ReactNode[][]; vide?: string; actions?: ReactNode }) {
  return (
    <section className="stat-carte stat-large">
      <header className="stat-carte-tete">
        <h2>{props.titre}</h2>
        {props.actions}
      </header>
      {props.lignes.length === 0 ? (
        <p className="stat-resume">{props.vide ?? "Rien sur la période."}</p>
      ) : (
        <div className="stat-defile">
          <table className="tableau stat-tableau">
            <thead>
              <tr>
                {props.colonnes.map((c, i) => (
                  <th key={c} className={i > 0 ? "nombre" : undefined}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {props.lignes.map((l, i) => (
                <tr key={i}>
                  {l.map((c, j) => (
                    <td key={j} className={j > 0 ? "nombre" : undefined}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ───────── Écran ─────────

const LIBELLES_ALERTE: Record<AlerteApi["type"], string> = {
  PRIX_DIFFERENT: "Prix différent de la carte",
  ARTICLE_HORS_CARTE: "Article hors carte",
  PIN_BLOQUE: "Code PIN bloqué",
};

/** Ce que l'écran demande à son hôte : la caisse (jeton d'appareil) ou l'administration (session). */
export interface AccesStatistiques {
  charger(du: string, au: string): Promise<ReponseStatistiques>;
  /** Marque une alerte vue ; faux si la personne a renoncé (code non saisi). */
  marquerVue(a: AlerteApi): Promise<boolean>;
  /** Appareil qui affiche l'écran : sa propre synchronisation n'est pas signalée. */
  appareilCourant?: string;
  messageErreur?: (e: unknown) => string;
  /** Administration : les tickets d'une personne sur la période affichée. */
  ouvrirServeur?: (serveurId: string, du: string, au: string) => void;
  /** Administration : ouvre l'éditeur des moments de la journée. */
  modifierMoments?: () => void;
}

/** Recalcul automatique tant que la période va jusqu'à aujourd'hui : la journée seule, puis les périodes longues. */
const DIRECT_JOUR_MS = 10_000;
const DIRECT_PERIODE_MS = 60_000;
const heureCourte = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** Statistiques sur la caisse : réservées aux responsables, alerte lue avec le code d'un responsable. */
export function Statistiques() {
  const ctx = useCaisse();
  const { caisse, config } = ctx;
  // Le contexte change à chaque synchronisation : l'écran ne se recalcule pas pour autant.
  const courant = useRef(ctx);
  courant.current = ctx;
  const acces = useMemo<AccesStatistiques>(
    () => ({
      charger: (du, au) => caisse.client.statistiques(du, au),
      marquerVue: async (a) => {
        const responsable = await courant.current.demanderPinResponsable(`Alerte lue : ${LIBELLES_ALERTE[a.type]}.`);
        if (!responsable) return false;
        await caisse.client.marquerAlerteVue(a.id, responsable);
        courant.current.notifier("Alerte marquée comme vue.");
        return true;
      },
      appareilCourant: config.caisseId,
      messageErreur: messageServeur,
    }),
    [caisse.client, config.caisseId],
  );
  return <TableauStatistiques acces={acces} />;
}

/** Horaires d'un moment : « 18:00 – 03:00 » (fin exclue). */
const heureLisible = (hhmm: string) => `${Number(hhmm.slice(0, 2))} h${hhmm.slice(3) === "00" ? "" : ` ${hhmm.slice(3)}`}`;
const horaires = (m: StatMoment) => (m.id ? `${heureLisible(m.debut)} – ${heureLisible(m.fin)}` : "en dehors des moments définis");

/** CA par moment de la journée (matin, midi, soir…), comparé au même moment de la période précédente. */
function Moments(props: { moments: StatMoment[]; caTTC: number; onModifier?: () => void }) {
  const { moments } = props;
  return (
    <section className="stat-carte stat-large stat-moments">
      <header className="stat-carte-tete">
        <h2>
          <AvecIcone icone={Clock}>CA par moment</AvecIcone>
        </h2>
        {props.onModifier && (
          <button className="bouton discret" onClick={props.onModifier}>
            <AvecIcone icone={Pencil}>{moments.length ? "Modifier les moments" : "Définir les moments"}</AvecIcone>
          </button>
        )}
      </header>
      {moments.length === 0 ? (
        <p className="explication">Aucun moment défini. Créez par exemple Matin, Après-midi et Soir avec leurs horaires : le CA de chacun s'affichera ici.</p>
      ) : (
        <div className="stat-defile">
          <table className="tableau stat-tableau">
            <thead>
              <tr>
                <th>Moment</th>
                <th className="nombre">CA TTC</th>
                <th className="nombre">Part du CA</th>
                <th className="nombre">Tickets</th>
                <th className="nombre">Ticket moyen</th>
                <th className="nombre">Couverts</th>
              </tr>
            </thead>
            <tbody>
              {moments.map((m) => (
                <tr key={m.id || "hors"}>
                  <td>
                    {m.nom}
                    <small className="stat-detail">{horaires(m)}</small>
                  </td>
                  <td className="nombre">
                    {euros(m.ttc)}
                    <small className="stat-detail">
                      <Variation actuel={m.ttc} precedent={m.ttcPrecedent} />
                    </small>
                  </td>
                  <td className="nombre">{pourcent(m.ttc, props.caTTC)}</td>
                  <td className="nombre">{entier(m.tickets)}</td>
                  <td className="nombre">{m.tickets ? euros(m.ticketMoyen) : "—"}</td>
                  <td className="nombre">{entier(m.couverts)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Tables ouvertes en ce moment : ce qui sera encaissé, en plus du CA déjà fait. */
function EnSalle(props: { salle: SalleEnCours }) {
  const { salle } = props;
  return (
    <section className="stat-carte stat-large stat-en-salle" aria-label="En salle maintenant">
      <h2>
        <AvecIcone icone={Utensils}>En salle maintenant</AvecIcone>
      </h2>
      {salle.tables === 0 ? (
        <p className="explication">Aucune table ouverte.</p>
      ) : (
        <div className="stat-en-salle-corps">
          <span>
            <strong>{pl(salle.tables, "table")}</strong> ouverte{salle.tables > 1 ? "s" : ""}
            {salle.couverts ? ` · ${pl(salle.couverts, "couvert")}` : ""}
            {salle.plusAncienne ? ` · la plus ancienne depuis ${heureCourte(salle.plusAncienne).slice(0, 5)}` : ""}
          </span>
          <span>
            À encaisser <strong>{euros(salle.montantTTC - salle.acomptesTTC)}</strong>
            {salle.acomptesTTC > 0 ? ` (sur ${euros(salle.montantTTC)}, ${euros(salle.acomptesTTC)} d'acomptes déjà versés)` : ""}
          </span>
        </div>
      )}
      <small className="stat-detail">Hors comptoir, propre à chaque appareil. Pas encore dans le chiffre d'affaires : il y entre à l'encaissement.</small>
    </section>
  );
}

/**
 * Statistiques de l'établissement (toutes les caisses, copie du serveur) :
 * indicateurs comparés à la période précédente, heures, jours, moyens de
 * paiement, catégories, articles, serveurs, salle, remises, annulations, TVA,
 * et les alertes à lire. Même écran sur la caisse et dans l'administration ;
 * tant que la période va jusqu'à aujourd'hui, il se recalcule tout seul
 * (chaque vente arrive au serveur quelques secondes après l'encaissement).
 */
export function TableauStatistiques(props: { acces: AccesStatistiques }) {
  const { acces } = props;
  const aujourdhui = dateComptable(new Date(), HEURE_BASCULE);
  const [preset, setPreset] = useState<Preset | null>("aujourdhui");
  const [periode, setPeriode] = useState(() => periodeDe("aujourdhui", aujourdhui));
  const [stats, setStats] = useState<ReponseStatistiques | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [chargement, setChargement] = useState(false);
  const [articles, setArticles] = useState<"meilleurs" | "moins" | "tous">("meilleurs");
  const message = acces.messageErreur ?? ((e: unknown) => (e instanceof Error ? e.message : String(e)));
  const enDirect = periode.au >= aujourdhui;

  /** `discret` : recalcul automatique, sans assombrir l'écran ni effacer une erreur affichée par une action. */
  const charger = useCallback(
    async (discret = false) => {
      if (!discret) setChargement(true);
      try {
        setStats(await acces.charger(periode.du, periode.au));
        setErreur(null);
      } catch (e) {
        setErreur(message(e));
      } finally {
        if (!discret) setChargement(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [acces, periode],
  );
  useEffect(() => void charger(), [charger]);
  useEffect(() => {
    if (!enDirect) return;
    const tic = () => document.visibilityState === "visible" && void charger(true);
    const minuterie = setInterval(tic, periode.du === periode.au ? DIRECT_JOUR_MS : DIRECT_PERIODE_MS);
    document.addEventListener("visibilitychange", tic);
    return () => {
      clearInterval(minuterie);
      document.removeEventListener("visibilitychange", tic);
    };
  }, [enDirect, charger, periode]);

  const choisir = (p: Preset) => {
    setPreset(p);
    setPeriode(periodeDe(p, aujourdhui));
  };
  const personnaliser = (champ: "du" | "au", valeur: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(valeur)) return;
    setPreset(null);
    setPeriode((p) => {
      const suivante = { ...p, [champ]: valeur };
      return suivante.du <= suivante.au ? suivante : { du: valeur, au: valeur };
    });
  };

  const alerteVue = async (a: AlerteApi) => {
    try {
      if (await acces.marquerVue(a)) await charger();
    } catch (e) {
      setErreur(message(e));
    }
  };

  const s = stats;
  const graphiques = useMemo(() => {
    if (!s) return null;
    // Heures dans l'ordre du service : de l'ouverture à la nuit, minuit passé après 23 h.
    const ordre = [...s.parHeure].sort((a, b) => rangHeure(a.heure) - rangHeure(b.heure));
    const actives = ordre.filter((h) => h.ttc !== 0 || h.tickets > 0).map((h) => rangHeure(h.heure));
    const premiere = Math.min(...actives, rangHeure(OUVERTURE));
    const derniere = Math.max(...actives, rangHeure(FERMETURE - 1));
    const heures: Point[] = ordre
      .filter((h) => rangHeure(h.heure) >= premiere && rangHeure(h.heure) <= derniere)
      .map((h) => ({ cle: String(h.heure), libelle: `${h.heure} h – ${(h.heure + 1) % 24} h`, axe: h.heure % 2 === 0 ? `${h.heure}h` : "", valeur: h.ttc, detail: `${h.tickets} ticket${h.tickets > 1 ? "s" : ""}` }));
    // Plus de deux mois : un point par mois, sinon un par jour.
    const parMois = s.jours > 62;
    const jours: Point[] = parMois
      ? [...new Set(s.parJour.map((j) => j.jour.slice(0, 7)))].map((m) => {
          const js = s.parJour.filter((j) => j.jour.startsWith(m));
          const ttc = js.reduce((x, j) => x + j.ttc, 0);
          const tickets = js.reduce((x, j) => x + j.tickets, 0);
          const nom = new Date(`${m}-15T12:00:00Z`).toLocaleDateString("fr-FR", { month: "short", timeZone: "UTC" });
          return { cle: m, libelle: new Date(`${m}-15T12:00:00Z`).toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }), axe: nom, valeur: ttc, detail: pl(tickets, "ticket") };
        })
      : s.parJour.map((j, i) => ({
          cle: j.jour,
          libelle: dateLongue(j.jour),
          axe: s.jours <= 14 || i % Math.ceil(s.jours / 10) === 0 ? dateCourte(j.jour) : "",
          valeur: j.ttc,
          detail: `${pl(j.tickets, "ticket")} · ${pl(j.couverts, "couvert")}`,
        }));
    const semaine: Point[] = s.parJourSemaine.map((j) => ({
      cle: String(j.jour),
      libelle: `${JOURS_SEMAINE[j.jour]} (moyenne)`,
      axe: JOURS_SEMAINE[j.jour]!.slice(0, 3),
      valeur: j.moyenne,
      detail: `${euros(j.ttc)} sur la période · ${pl(j.tickets, "ticket")}`,
    }));
    return { heures, jours, semaine, parMois };
  }, [s]);

  const listeArticles = (l: LigneStat[]) => {
    const vendus = l.filter((a) => (a.quantite ?? 0) > 0);
    if (articles === "tous") return vendus;
    if (articles === "moins") return [...vendus].sort((a, b) => (a.quantite ?? 0) - (b.quantite ?? 0) || a.ttc - b.ttc).slice(0, 15);
    return vendus.slice(0, 15);
  };

  return (
    <div className="page statistiques">
      <header className="page-tete">
        <h1>Statistiques</h1>
        <p>{s ? `Tous les appareils · ${libellePeriode(s.du, s.au)}, comparé ${libellePeriode(s.precedente.du, s.precedente.au)}` : "Tous les appareils de l'établissement"}</p>
        {s && enDirect && (
          <p className="stat-direct" role="status">
            <span className="stat-direct-point" aria-hidden="true" /> En direct · mis à jour à {heureCourte(s.calculeLe)}
          </p>
        )}
      </header>

      <div className="stat-filtres">
        <div className="stat-presets" role="group" aria-label="Période">
          {PRESETS.map(([p, libelle]) => (
            <button key={p} className={`pastille${preset === p ? " active" : ""}`} aria-pressed={preset === p} onClick={() => choisir(p)}>
              {libelle}
            </button>
          ))}
        </div>
        <label className="stat-date">
          Du
          <input type="date" value={periode.du} max={aujourdhui} onChange={(e) => personnaliser("du", e.target.value)} />
        </label>
        <label className="stat-date">
          au
          <input type="date" value={periode.au} max={aujourdhui} onChange={(e) => personnaliser("au", e.target.value)} />
        </label>
        <BoutonIcone icone={RefreshCw} variante="discret" libelle="Actualiser" disabled={chargement} onClick={() => void charger()} />
      </div>

      {erreur && <p className="erreur">{erreur}</p>}
      {!s && !erreur && <p className="explication">Calcul des statistiques…</p>}

      {s && graphiques && (
        <div className={`stat-contenu${chargement ? " recharge" : ""}`}>
          {s.alertes.length > 0 && (
            <section className="stat-carte stat-large stat-alertes">
              <h2>
                <AvecIcone icone={Bell}>{`Alertes à lire (${s.alertes.length})`}</AvecIcone>
              </h2>
              <ul>
                {s.alertes.slice(0, 20).map((a) => (
                  <li key={a.id}>
                    <span>
                      <strong>{LIBELLES_ALERTE[a.type] ?? a.type}</strong>
                      <small>
                        {new Date(a.creeLe).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })} ·{" "}
                        {a.caisseId ? (s.nomsAppareils[a.caisseId] ?? a.caisseId) : "serveur"}
                      </small>
                    </span>
                    <span>{a.message}</span>
                    <button className="bouton discret" onClick={() => void alerteVue(a)}>
                      <AvecIcone icone={Check}>Vu</AvecIcone>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {s.enCours && enDirect && <EnSalle salle={s.enCours} />}

          <Indicateurs i={s.indicateurs} p={s.indicateursPrecedents} />

          {(s.parMoment.length > 0 || acces.modifierMoments) && (
            <Moments moments={s.parMoment} caTTC={s.indicateurs.caTTC} {...(acces.modifierMoments ? { onModifier: acces.modifierMoments } : {})} />
          )}

          <div className="stat-grille-cartes">
            <Colonnes
              titre="CA par heure"
              points={graphiques.heures}
              resume={(() => {
                const top = [...s.parHeure].sort((a, b) => b.ttc - a.ttc)[0];
                return top && top.ttc > 0 ? `Heure la plus forte : ${top.heure} h – ${(top.heure + 1) % 24} h (${euros(top.ttc)}).` : "Aucune vente sur la période.";
              })()}
            />
            {s.jours > 1 && <Colonnes titre={graphiques.parMois ? "CA par mois" : "CA par jour"} points={graphiques.jours} />}
            {s.jours >= 7 && <Colonnes titre="Jour de la semaine (CA moyen par jour)" points={graphiques.semaine} />}
            <BarresH
              titre="Moyens de paiement"
              lignes={s.paiements.map((p) => ({
                cle: p.mode,
                libelle: p.mode === "EN_COMPTE" ? "Porté en compte" : (LIBELLES_PAIEMENT[p.mode as keyof typeof LIBELLES_PAIEMENT] ?? p.mode),
                valeur: p.montant,
                detail: `${p.tickets} ticket${p.tickets > 1 ? "s" : ""}`,
              }))}
            />
            <BarresH titre="Catégories" lignes={s.categories.map((c) => ({ cle: c.cle, libelle: c.libelle, valeur: c.ttc, detail: pl(c.quantite ?? 0, "article") }))} total={s.indicateurs.caTTC} />
            <BarresH titre="Salle et comptoir" lignes={s.zones.map((z) => ({ cle: z.cle, libelle: z.libelle, valeur: z.ttc, detail: `${pl(z.tickets ?? 0, "ticket")} · ${pl(z.couverts ?? 0, "couvert")}` }))} />
            {s.appareils.length > 1 && <BarresH titre="Par appareil" lignes={s.appareils.map((a) => ({ cle: a.cle, libelle: a.libelle, valeur: a.ttc, detail: pl(a.tickets ?? 0, "ticket") }))} />}
          </div>

          <Tableau
            titre="Articles"
            actions={
              <div className="stat-presets" role="group" aria-label="Articles affichés">
                {(
                  [
                    ["meilleurs", "Les plus vendus"],
                    ["moins", "Les moins vendus"],
                    ["tous", "Tous"],
                  ] as const
                ).map(([v, l]) => (
                  <button key={v} className={`pastille${articles === v ? " active" : ""}`} aria-pressed={articles === v} onClick={() => setArticles(v)}>
                    {l}
                  </button>
                ))}
              </div>
            }
            colonnes={["Article", "Quantité", "CA TTC", "Part du CA"]}
            lignes={listeArticles(s.articles).map((a) => [
              <span key="a">
                {a.libelle}
                <small className="stat-detail">{a.detail}</small>
              </span>,
              entier(a.quantite ?? 0),
              euros(a.ttc),
              pourcent(a.ttc, s.indicateurs.caTTC),
            ])}
          />

          <Tableau
            titre="Équipe"
            colonnes={["Serveur", "Tickets", "CA TTC", "Ticket moyen", "Couverts", "Remises et offerts", "Annulations", "Retraits après envoi"]}
            lignes={s.serveurs.map((v) => [
              acces.ouvrirServeur ? (
                <button key="n" className="lien" title={`Voir les tickets de ${v.nom}`} aria-label={`Voir les tickets de ${v.nom}`} onClick={() => acces.ouvrirServeur!(v.id, s.du, s.au)}>
                  {v.nom}
                </button>
              ) : (
                v.nom
              ),
              entier(v.tickets),
              euros(v.ttc),
              euros(v.ticketMoyen),
              entier(v.couverts),
              euros(v.remises + v.offerts),
              v.annulations ? `${v.annulations} · ${euros(v.montantAnnule)}` : "—",
              v.articlesRetires ? `${v.articlesRetires} · ${euros(v.montantRetire ?? 0)}` : "—",
            ])}
          />

          <div className="stat-grille-cartes">
            <Tableau
              titre="Tables"
              colonnes={["Table", "Tickets", "Couverts", "CA TTC"]}
              lignes={s.tables.slice(0, 12).map((t) => [
                <span key="t">
                  {t.libelle}
                  <small className="stat-detail">{t.detail}</small>
                </span>,
                entier(t.tickets ?? 0),
                entier(t.couverts ?? 0),
                euros(t.ttc),
              ])}
              vide="Aucune vente à table sur la période."
            />
            <Tableau
              titre="TVA collectée"
              colonnes={["Taux", "Base HT", "TVA", "TTC"]}
              lignes={s.tva.map((v) => [`${v.tauxTVA / 100} %`, euros(v.baseHT), euros(v.montantTVA), euros(v.montantTTC)])}
            />
            <Tableau
              titre="Remises et offerts par motif"
              colonnes={["Motif", "Articles", "Montant"]}
              lignes={s.remisesParMotif.map((r) => [r.libelle, entier(r.quantite ?? 0), euros(r.ttc)])}
              vide="Aucune remise ni offert."
            />
            <Tableau
              titre="Annulations par motif"
              colonnes={["Motif", "Tickets", "Montant"]}
              lignes={s.annulationsParMotif.map((r) => [r.libelle, entier(r.tickets ?? 0), euros(r.ttc)])}
              vide="Aucune annulation."
            />
            <Tableau
              titre="Articles retirés après envoi, par motif"
              colonnes={["Motif", "Articles", "Montant"]}
              lignes={(s.retraitsParMotif ?? []).map((r) => [r.libelle, entier(r.quantite ?? 0), euros(r.ttc)])}
              vide="Aucun article retiré après envoi."
            />
          </div>

          <p className="explication stat-notes">
            Ventes en compte {euros(s.indicateurs.ventesEnCompte)} · règlements de comptes reçus {euros(s.indicateurs.reglementsComptes)} · corrections de
            paiement {s.indicateurs.nbCorrections}. CA net des annulations, comme les Z ; les ventes d'un appareil pas encore synchronisé n'y sont pas
            {Object.keys(s.synchros).length > 1
              ? ` (${Object.entries(s.synchros)
                  .filter(([id]) => id !== acces.appareilCourant)
                  .map(([id, iso]) => `${s.nomsAppareils[id] ?? id} ${fraicheur(iso)}`)
                  .join(", ")})`
              : ""}
            . Calculé le {new Date(s.calculeLe).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}.
          </p>
        </div>
      )}
    </div>
  );
}
