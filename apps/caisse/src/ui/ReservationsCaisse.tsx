import { maintenantParis, minutes, type Reservation, type StatutReservation } from "@matalon/reservations";
import { CalendarCheck, ChevronLeft, ChevronRight, Pencil, Phone, Plus, RefreshCw, Search, UserCheck, UserX, Undo2, X } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Modale } from "./communs";
import { useCaisse } from "./contexte";
import { AvecIcone, BoutonIcone } from "./icones";
import { messageServeur } from "./Reglages";
import { dateLongue, decaler, FicheReservation, JOURS_A_VENIR, LIBELLES_STATUT } from "./FicheReservation";

const CLE = "matalon.reservations.jour";
const LIBELLES: Record<StatutReservation, string> = { confirmee: "À venir", arrivee: "Installée", absente: "Absente", annulee: "Annulée" };

interface Jour {
  date: string;
  reservations: Reservation[];
  actif: boolean;
  /** Fenêtre de réservation en ligne (jours) : étendue de la vue « À venir ». */
  horizonJours?: number;
  /** Lu sur le serveur à cette heure ; hors ligne, la dernière copie gardée. */
  luLe: string;
}

function lireCopie(): Jour | null {
  try {
    const j = JSON.parse(localStorage.getItem(CLE) ?? "null") as Jour | null;
    return j && j.date === maintenantParis(new Date()).jour ? j : null;
  } catch {
    return null;
  }
}

/**
 * Réservations du jour, relues chaque minute (et au retour sur l'écran). Hors
 * ligne : la dernière copie du jour, gardée sur l'appareil.
 */
export function useReservationsDuJour() {
  const { caisse } = useCaisse();
  const [jour, setJour] = useState<Jour | null>(lireCopie);
  const [horsLigne, setHorsLigne] = useState(false);
  const recharger = useCallback(async () => {
    try {
      const r = await caisse.client.reservations();
      const j: Jour = { date: r.date, reservations: r.reservations, actif: r.actif, horizonJours: r.horizonJours, luLe: new Date().toISOString() };
      setJour(j);
      setHorsLigne(false);
      try {
        localStorage.setItem(CLE, JSON.stringify(j));
      } catch {
        /* stockage plein ou indisponible : la copie sert seulement hors ligne */
      }
    } catch {
      setHorsLigne(true);
    }
  }, [caisse.client]);
  useEffect(() => {
    void recharger();
    const t = setInterval(() => void recharger(), 60_000);
    const visible = () => document.visibilityState === "visible" && void recharger();
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [recharger]);
  return { jour, horsLigne, recharger };
}

/** Minute de Paris maintenant (0–1439). */
export const minuteParis = () => maintenantParis(new Date()).minute;

/** Prochaine réservation à venir (pas encore installée) de chaque table, sur le reste du jour. */
export function aVenirParTable(liste: Reservation[]): Map<string, Reservation> {
  const m = new Map<string, Reservation>();
  const maintenant = minuteParis();
  for (const r of [...liste].sort((a, b) => minutes(a.heure) - minutes(b.heure))) {
    if (r.statut !== "confirmee" || minutes(r.heure) + r.dureeMinutes <= maintenant) continue;
    for (const t of r.tables) if (!m.has(t)) m.set(t, r);
  }
  return m;
}

export const nomClient = (r: Reservation) => `${r.prenom} ${r.nom}`.trim();

type Vue = "jour" | "avenir" | "date";

const sansAccents = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

/**
 * Réservations : celles du jour (installer, placer, absente, annuler), celles à venir sur toute
 * la fenêtre de réservation, ou celles d'un jour choisi ; recherche, fiche pour modifier ou annuler,
 * saisie d'une réservation prise au téléphone. Comme dans l'administration.
 */
export function PanneauReservations(props: {
  jour: Jour | null;
  horsLigne: boolean;
  occupees: Set<string>;
  onRecharger: () => Promise<void>;
  onInstaller: (r: Reservation) => Promise<void>;
  onFermer: () => void;
}) {
  const { caisse, config, utilisateur, notifier } = useCaisse();
  const aujourdhui = props.jour?.date ?? maintenantParis(new Date()).jour;
  const [vue, setVue] = useState<Vue>("jour");
  const [dateChoisie, setDateChoisie] = useState(decaler(aujourdhui, 1));
  const [autres, setAutres] = useState<Reservation[] | null>(null);
  const [erreur, setErreur] = useState("");
  const [saisie, setSaisie] = useState(false);
  const [toutes, setToutes] = useState(false);
  const [recherche, setRecherche] = useState("");
  const [fiche, setFiche] = useState<Reservation | null>(null);
  const tables = config.tables.filter((t) => !t.masquee);
  const nomTables = (ids: string[]) => ids.map((id) => config.tables.find((t) => t.id === id)?.nom ?? id).join(" + ");

  const chargerAutres = useCallback(async () => {
    if (vue === "jour") return;
    setErreur("");
    try {
      const r =
        vue === "avenir"
          ? await caisse.client.reservations(aujourdhui, decaler(aujourdhui, JOURS_A_VENIR({ horizonJours: props.jour?.horizonJours ?? 60 })))
          : await caisse.client.reservations(dateChoisie);
      setAutres(r.reservations);
    } catch (e) {
      setAutres(null);
      setErreur(`${messageServeur(e)} Seules les réservations du jour restent consultables hors ligne.`);
    }
  }, [vue, dateChoisie, aujourdhui, caisse.client, props.jour?.horizonJours]);
  useEffect(() => void chargerAutres(), [chargerAutres]);

  const recharger = async () => {
    await props.onRecharger();
    await chargerAutres();
  };

  const modifier = async (r: Reservation, corps: Record<string, unknown>, quoi: string) => {
    try {
      await caisse.client.modifierReservation(r.id, { ...corps, par: utilisateur.id });
      notifier(`${nomClient(r)} : ${quoi}.`);
    } catch (e) {
      if (e instanceof Error && "statut" in e && (e as { statut: number }).statut === 409 && window.confirm(messageServeur(e))) {
        await caisse.client.modifierReservation(r.id, { ...corps, par: utilisateur.id, forcer: true }).catch((e2) => notifier(messageServeur(e2), "erreur"));
      } else notifier(messageServeur(e), "erreur");
    }
    await recharger();
  };

  const source = vue === "jour" ? (props.jour?.reservations ?? []) : (autres ?? []);
  const q = sansAccents(recherche.trim());
  const liste = source
    .filter((r) => toutes || r.statut === "confirmee" || r.statut === "arrivee")
    .filter(
      (r) =>
        !q ||
        sansAccents(`${r.prenom} ${r.nom} ${r.telephone} ${r.email ?? ""} ${r.commentaire ?? ""}`).includes(q) ||
        r.telephone.replace(/\D/g, "").includes(q.replace(/\D/g, "") || "§"),
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.heure.localeCompare(b.heure));
  const actives = (l: Reservation[]) => l.filter((r) => r.statut === "confirmee" || r.statut === "arrivee");
  const couverts = (l: Reservation[]) => actives(l).reduce((n, r) => n + r.couverts, 0);
  const pl = (n: number, mot: string) => `${n} ${mot}${n > 1 ? "s" : ""}`;
  const groupes = [...new Set(liste.map((r) => r.date))].map((d) => ({ date: d, liste: liste.filter((r) => r.date === d) }));

  const creer = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const corps = { ...f, couverts: Number(f.couverts), par: utilisateur.id };
    try {
      await caisse.client.creerReservation(corps);
    } catch (err) {
      if (err instanceof Error && "statut" in err && (err as { statut: number }).statut === 409 && window.confirm(`${messageServeur(err)} Enregistrer quand même ?`)) {
        try {
          await caisse.client.creerReservation({ ...corps, forcer: true });
        } catch (e2) {
          return notifier(messageServeur(e2), "erreur");
        }
      } else return notifier(messageServeur(err), "erreur");
    }
    notifier(`Réservation de ${f.prenom} ${f.nom} enregistrée.`);
    setSaisie(false);
    await recharger();
  };

  const resume =
    vue === "jour"
      ? `${props.horsLigne ? "Hors ligne : dernière liste reçue. " : ""}Aujourd'hui · ${pl(actives(source).length, "réservation")} · ${pl(couverts(source), "couvert")}`
      : vue === "avenir"
        ? `À venir · ${pl(actives(source).length, "réservation")} · ${pl(couverts(source), "couvert")}`
        : `${dateLongue(dateChoisie)} · ${pl(actives(source).length, "réservation")} · ${pl(couverts(source), "couvert")}`;

  return (
    <Modale titre="Réservations" large onFermer={props.onFermer}>
      <div className="resa-caisse-vues">
        <div className="options" role="group" aria-label="Période">
          {(
            [
              ["jour", "Aujourd'hui"],
              ["avenir", "À venir"],
              ["date", "Par jour"],
            ] as const
          ).map(([v, libelle]) => (
            <button key={v} className={`option${vue === v ? " active" : ""}`} aria-pressed={vue === v} onClick={() => setVue(v)}>
              {libelle}
            </button>
          ))}
        </div>
        {vue === "date" && (
          <div className="resa-caisse-date">
            <BoutonIcone icone={ChevronLeft} libelle="Jour précédent" variante="discret" onClick={() => setDateChoisie(decaler(dateChoisie, -1))} />
            <input type="date" value={dateChoisie} aria-label="Jour" onChange={(e) => e.target.value && setDateChoisie(e.target.value)} />
            <BoutonIcone icone={ChevronRight} libelle="Jour suivant" variante="discret" onClick={() => setDateChoisie(decaler(dateChoisie, 1))} />
          </div>
        )}
      </div>
      <div className="resa-caisse-tete">
        <p>{resume}</p>
        <label className="case">
          <input type="checkbox" checked={toutes} onChange={(e) => setToutes(e.target.checked)} /> Annulées et absentes
        </label>
        <BoutonIcone icone={RefreshCw} variante="discret" libelle="Actualiser les réservations" onClick={() => void recharger()} />
        <button className="bouton" disabled={props.horsLigne} onClick={() => setSaisie((o) => !o)}>
          <AvecIcone icone={saisie ? X : Plus}>{saisie ? "Fermer" : "Nouvelle"}</AvecIcone>
        </button>
      </div>
      <label className="recherche-client resa-caisse-recherche">
        <Search size={20} aria-hidden="true" />
        <input type="search" value={recherche} placeholder="Nom, téléphone, e-mail, note…" aria-label="Rechercher une réservation" onChange={(e) => setRecherche(e.target.value)} />
      </label>
      {saisie && (
        <form className="resa-caisse-saisie" onSubmit={(e) => void creer(e)}>
          <label className="champ">
            <span>Heure</span>
            <input name="heure" type="time" step={900} defaultValue="20:00" required />
          </label>
          <label className="champ">
            <span>Personnes</span>
            <input name="couverts" type="number" inputMode="numeric" min={1} max={200} defaultValue={2} required />
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
            <span>E-mail (facultatif)</span>
            <input name="email" type="email" />
          </label>
          <label className="champ">
            <span>Date</span>
            <input name="date" type="date" defaultValue={vue === "date" ? dateChoisie : aujourdhui} required />
          </label>
          <label className="champ">
            <span>Note</span>
            <input name="commentaire" maxLength={500} />
          </label>
          <input type="hidden" name="source" value="telephone" />
          <button className="bouton principal" type="submit">
            <AvecIcone icone={CalendarCheck}>Enregistrer</AvecIcone>
          </button>
        </form>
      )}
      {erreur && vue !== "jour" && <p className="erreur">{erreur}</p>}
      {vue !== "jour" && autres === null && !erreur ? (
        <p className="explication">Chargement…</p>
      ) : liste.length === 0 ? (
        <p className="explication">
          {q
            ? "Aucune réservation ne correspond."
            : props.jour?.actif === false && vue === "jour"
              ? "La réservation en ligne est fermée (administration › Réservations)."
              : vue === "jour"
                ? "Aucune réservation aujourd'hui."
                : vue === "avenir"
                  ? "Aucune réservation à venir."
                  : "Aucune réservation ce jour-là."}
        </p>
      ) : (
        groupes.map((g) => (
          <section key={g.date} className="resa-caisse-groupe">
            {vue === "avenir" && (
              <h3>
                {g.date === aujourdhui ? "Aujourd'hui" : g.date === decaler(aujourdhui, 1) ? "Demain" : dateLongue(g.date)} · {pl(actives(g.liste).length, "réservation")} ·{" "}
                {pl(couverts(g.liste), "couvert")}
              </h3>
            )}
            <ul className="resa-caisse-liste">
              {g.liste.map((r) => {
                const occupee = r.tables.some((t) => props.occupees.has(t));
                const duJour = r.date === aujourdhui;
                return (
                  <li key={r.id} className={`resa-caisse-ligne ${r.statut}`}>
                    <div className="resa-caisse-heure">
                      <strong>{r.heure}</strong>
                      <span>{r.couverts} pers.</span>
                    </div>
                    <div className="resa-caisse-client">
                      <strong>{nomClient(r)}</strong>
                      <span>
                        <a href={`tel:${r.telephone}`}>
                          <AvecIcone icone={Phone} taille={14}>{r.telephone}</AvecIcone>
                        </a>
                        {" · "}
                        {duJour ? LIBELLES[r.statut] : LIBELLES_STATUT[r.statut]}
                      </span>
                      {r.commentaire && <em>{r.commentaire}</em>}
                    </div>
                    <label className="resa-caisse-table">
                      <span className="lecteur-ecran">Table de {nomClient(r)}</span>
                      <select
                        value={r.tables.length === 1 ? r.tables[0] : r.tables.length ? "plusieurs" : ""}
                        disabled={props.horsLigne || r.statut === "annulee"}
                        onChange={(e) => void modifier(r, { tables: e.target.value ? [e.target.value] : [] }, e.target.value ? `table ${nomTables([e.target.value])}` : "à placer")}
                      >
                        <option value="">À placer</option>
                        {r.tables.length > 1 && <option value="plusieurs">{nomTables(r.tables)}</option>}
                        {tables.map((t) => (
                          <option key={t.id} value={t.id}>
                            Table {t.nom} ({t.chaises ?? 4})
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="resa-caisse-actions">
                      {duJour && r.statut === "confirmee" && (
                        <>
                          <button
                            className="bouton principal"
                            disabled={r.tables.length === 0 || occupee}
                            title={r.tables.length === 0 ? "Placez d'abord la réservation sur une table" : occupee ? "La table est encore occupée" : undefined}
                            onClick={() => void props.onInstaller(r)}
                          >
                            <AvecIcone icone={UserCheck}>Installer</AvecIcone>
                          </button>
                          <BoutonIcone icone={UserX} variante="discret" libelle={`${nomClient(r)} ne vient pas (absente)`} disabled={props.horsLigne} onClick={() => void modifier(r, { statut: "absente" }, "absente")} />
                        </>
                      )}
                      {duJour && r.statut !== "confirmee" && (
                        <BoutonIcone icone={Undo2} variante="discret" libelle={`Remettre la réservation de ${nomClient(r)} à venir`} disabled={props.horsLigne} onClick={() => void modifier(r, { statut: "confirmee" }, "remise à venir")} />
                      )}
                      <BoutonIcone icone={Pencil} variante="discret" libelle={`Modifier la réservation de ${nomClient(r)}`} disabled={props.horsLigne} onClick={() => setFiche(r)} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
      {fiche && (
        <FicheReservation
          reservation={fiche}
          modifier={(corps) => caisse.client.modifierReservation(fiche.id, { ...corps, par: utilisateur.id }).then(() => undefined)}
          onFermer={() => setFiche(null)}
          onFaite={() => {
            notifier(`Réservation de ${nomClient(fiche)} enregistrée.`);
            setFiche(null);
            void recharger();
          }}
        />
      )}
    </Modale>
  );
}
