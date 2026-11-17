import { minutes, TAGS_RESERVATION, type Reservation, type SourceReservation, type StatutReservation } from "@matalon/reservations";
import {
  ArrowDownWideNarrow,
  AtSign,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ConciergeBell,
  EllipsisVertical,
  Footprints,
  Globe,
  Hourglass,
  LayoutGrid,
  MessageCircle,
  MessageSquareText,
  Phone,
  PhoneIncoming,
  Plus,
  Search,
  SlidersHorizontal,
  StickyNote,
  TriangleAlert,
  UserCheck,
  UserPlus,
  Users,
  Utensils,
  X,
  ChevronsRight,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { confirmer } from "../../admin/Panneau";
import { ChoixTables } from "../ChoixTables";
import { AvecIcone, BoutonIcone } from "../icones";
import {
  compte,
  dateCourte,
  dateLongue,
  decaler,
  estConflit,
  LIBELLES_CANAL,
  LIBELLES_STATUT,
  messageErreur,
  nomClient,
  nomListe,
  pl,
  sansAccents,
  servicesDuJour,
  TEINTES,
  temporaire,
  type AccesReservations,
  type ContexteReservations,
} from "./commun";

const ICONES_CANAL: Record<SourceReservation, LucideIcon> = {
  en_ligne: Globe,
  telephone: PhoneIncoming,
  sur_place: Footprints,
  email: AtSign,
  messagerie: MessageCircle,
};

type Tri = "heure" | "nom" | "table";
const LIBELLES_TRI: Record<Tri, string> = { heure: "Par heure", nom: "Par nom", table: "Par table" };
/** Statuts proposés dans la pastille d'une réservation, dans cet ordre. */
const ORDRE_STATUTS: StatutReservation[] = ["confirmee", "arrivee", "option", "attente", "absente", "annulee"];

/** Petit menu déroulant (tri, options) : fermé d'un toucher ailleurs ou par Échap. */
function Menu(props: { icone: LucideIcon; libelle: string; children: (fermer: () => void) => ReactNode }) {
  const [ouvert, setOuvert] = useState(false);
  const boite = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ouvert) return;
    const dehors = (e: PointerEvent) => !boite.current?.contains(e.target as Node) && setOuvert(false);
    const echap = (e: KeyboardEvent) => e.key === "Escape" && setOuvert(false);
    document.addEventListener("pointerdown", dehors);
    document.addEventListener("keydown", echap);
    return () => {
      document.removeEventListener("pointerdown", dehors);
      document.removeEventListener("keydown", echap);
    };
  }, [ouvert]);
  return (
    <div className="resa-menu" ref={boite}>
      <BoutonIcone icone={props.icone} libelle={props.libelle} variante="discret" aria-expanded={ouvert} onClick={() => setOuvert((o) => !o)} />
      {ouvert && (
        <div className="resa-menu-liste" role="menu" aria-label={props.libelle}>
          {props.children(() => setOuvert(false))}
        </div>
      )}
    </div>
  );
}

/** Compteur de la barre (« 23 Total ») : icône, nombre, et son sens en bulle et pour le lecteur d'écran. */
function Compteur(props: { icone: LucideIcon; nombre: number; libelle: string; texte?: string; principal?: boolean }) {
  return (
    <span className={`resa-compteur${props.principal ? " principal" : ""}`} title={props.libelle} aria-label={`${props.libelle} : ${props.nombre}`} role="img">
      <AvecIcone icone={props.icone} taille={18} />
      <strong>{String(props.nombre).padStart(2, "0")}</strong>
      {props.texte && <span>{props.texte}</span>}
    </span>
  );
}

/**
 * Liste des réservations façon Zenchef : jour, services, compteurs, puis les réservations
 * rangées par service et par créneau, avec leurs personnes, statut, canal et tables ; en pied,
 * la répartition par taille de table. La recherche porte sur toutes les réservations à venir.
 */
export function ListeReservations(props: {
  ctx: ContexteReservations;
  acces: AccesReservations;
  date: string;
  onDate: (jour: string) => void;
  filtreService: string | null;
  onFiltreService: (id: string | null) => void;
  /** Réservations du jour affiché ; null : chargement. */
  reservations: Reservation[] | null;
  erreur?: string;
  onOuvrir: (r: Reservation) => void;
  onCreer: () => void;
  /** Après un changement fait depuis la liste (statut, tables). */
  onModifie: () => void;
  /** Caisse, jour du service : installer ouvre la table. */
  installer?: (r: Reservation) => Promise<void>;
  /** Caisse : tables occupées maintenant (installer y est impossible). */
  occupees?: Set<string>;
  /** Liste en plein écran (iPhone) : bouton pour revenir au plan. */
  onFermer?: () => void;
  /** Change à chaque enregistrement : la recherche relit les réservations à venir. */
  version?: number;
}) {
  const { ctx, acces, date } = props;
  const [annulees, setAnnulees] = useState(false);
  const [tri, setTri] = useState<Tri>("heure");
  const [chercher, setChercher] = useState(false);
  const [recherche, setRecherche] = useState("");
  const [trouvees, setTrouvees] = useState<Reservation[] | null>(null);
  const [erreurAction, setErreurAction] = useState("");
  const q = sansAccents(recherche.trim());

  useEffect(() => setTrouvees(null), [props.version]);

  // Recherche : toutes les réservations de la fenêtre (aujourd'hui → horizon, au moins 60 jours), lues une fois.
  useEffect(() => {
    if (!q || trouvees) return;
    let fini = false;
    acces
      .lister(ctx.aujourdhui, decaler(ctx.aujourdhui, Math.max(60, ctx.reglages.horizonJours)))
      .then((l) => !fini && setTrouvees(l))
      .catch(() => !fini && setTrouvees([]));
    return () => {
      fini = true;
    };
  }, [q, trouvees, acces, ctx.aujourdhui, ctx.reglages.horizonJours]);

  const services = servicesDuJour(ctx.reglages, date);
  const nomTable = (id: string) => ctx.tables.find((t) => t.id === id)?.nom ?? id;

  const correspond = (r: Reservation) =>
    !q ||
    sansAccents(`${r.prenom} ${r.nom} ${r.telephone} ${r.email ?? ""} ${r.commentaire ?? ""} ${r.memo ?? ""} ${r.allergies ?? ""}`).includes(q) ||
    // Téléphone : « 06 44… » retrouve « +33 6 44… » (le 0 national tombe).
    r.telephone.replace(/\D/g, "").includes(q.replace(/\D/g, "").replace(/^0/, "") || "§");
  const source = q ? (trouvees ?? []) : (props.reservations ?? []);
  const visibles = source
    .filter((r) => annulees || (r.statut !== "annulee" && r.statut !== "absente"))
    .filter((r) => q || !props.filtreService || r.serviceId === props.filtreService)
    .filter(correspond);
  const duJour = props.reservations ?? [];
  const couvertsDe = (l: Reservation[]) => l.reduce((n, r) => n + r.couverts, 0);
  const filtreJour = duJour.filter((r) => !props.filtreService || r.serviceId === props.filtreService);
  const compteurs = {
    total: couvertsDe(filtreJour.filter(compte)),
    aVenir: couvertsDe(filtreJour.filter((r) => r.statut === "confirmee")),
    installes: couvertsDe(filtreJour.filter((r) => r.statut === "arrivee")),
    attente: couvertsDe(filtreJour.filter(temporaire)),
  };

  const trier = (l: Reservation[]) =>
    [...l].sort((a, b) =>
      tri === "nom"
        ? nomListe(a).localeCompare(nomListe(b), "fr")
        : tri === "table"
          ? (a.tables[0] ? nomTable(a.tables[0]) : "~").localeCompare(b.tables[0] ? nomTable(b.tables[0]) : "~", "fr", { numeric: true }) || a.heure.localeCompare(b.heure)
          : a.date.localeCompare(b.date) || minutes(a.heure) - minutes(b.heure) || nomListe(a).localeCompare(nomListe(b), "fr"),
    );

  /** Groupes : par service (puis créneau) pour un jour ; par jour pour une recherche. */
  const groupes = (() => {
    if (q) {
      return [...new Set(visibles.map((r) => r.date))].sort().map((d) => ({
        cle: d,
        titre: d === ctx.aujourdhui ? "Aujourd'hui" : d === decaler(ctx.aujourdhui, 1) ? "Demain" : dateLongue(d),
        plafond: null as number | null,
        liste: trier(visibles.filter((r) => r.date === d)),
      }));
    }
    const connus = new Set(services.map((s) => s.id));
    return [
      ...services.map((s) => ({ cle: s.id, titre: s.nom, plafond: s.couvertsMax as number | null, liste: trier(visibles.filter((r) => r.serviceId === s.id)) })),
      { cle: "hors-service", titre: "Hors service", plafond: null, liste: trier(visibles.filter((r) => !connus.has(r.serviceId))) },
    ].filter((g) => g.liste.length > 0);
  })();

  const modifier = async (r: Reservation, corps: Record<string, unknown>) => {
    setErreurAction("");
    try {
      try {
        await acces.modifier(r.id, corps);
      } catch (e) {
        if (estConflit(e) && (await confirmer({ titre: "Enregistrer quand même ?", message: messageErreur(e), confirmer: "Enregistrer quand même" })))
          await acces.modifier(r.id, { ...corps, forcer: true });
        else throw e;
      }
    } catch (e) {
      setErreurAction(`${nomClient(r)} : ${messageErreur(e)}`);
    }
    if (q) setTrouvees(null);
    props.onModifie();
  };

  const changerStatut = async (r: Reservation, statut: StatutReservation) => {
    if (statut === r.statut) return;
    if (
      statut === "annulee" &&
      !(await confirmer({
        titre: `Annuler la réservation de ${nomClient(r)} ?`,
        message: `${dateLongue(r.date)}, ${r.heure}, ${pl(r.couverts, "personne")}.${r.email && !temporaire(r) ? " Le client est prévenu par e-mail." : ""}`,
        confirmer: "Annuler la réservation",
        annuler: "Garder",
        danger: true,
      }))
    )
      return;
    await modifier(r, { statut });
  };

  /** Répartition des réservations du jour par taille de table (1 à 7, puis 8 et plus). */
  const repartition = Array.from({ length: 8 }, (_, i) => filtreJour.filter((r) => r.statut !== "annulee" && r.statut !== "absente" && (i === 7 ? r.couverts >= 8 : r.couverts === i + 1)).length);

  return (
    <section className="resa-liste" aria-label="Réservations">
      <div className="resa-barre-jour">
        <div className="resa-jour" role="group" aria-label="Jour">
          <BoutonIcone icone={ChevronLeft} libelle="Jour précédent" variante="discret" onClick={() => props.onDate(decaler(date, -1))} />
          <button type="button" className="resa-jour-nom" onClick={() => props.onDate(ctx.aujourdhui)} title="Revenir à aujourd'hui">
            {date === ctx.aujourdhui ? `Auj. ${dateCourte(date).replace(/^\S+\s/, "")}` : dateCourte(date)}
          </button>
          <label className="resa-calendrier" title="Choisir un jour">
            <CalendarDays className="icone" size={20} aria-hidden="true" />
            <input type="date" value={date} aria-label="Choisir le jour" onChange={(e) => e.target.value && props.onDate(e.target.value)} />
          </label>
          <BoutonIcone icone={ChevronRight} libelle="Jour suivant" variante="discret" onClick={() => props.onDate(decaler(date, 1))} />
        </div>
        <button type="button" className="bouton principal resa-creer" disabled={ctx.horsLigne} onClick={props.onCreer}>
          <AvecIcone icone={Plus}>Créer</AvecIcone>
        </button>
        {props.onFermer && <BoutonIcone icone={X} libelle="Fermer la liste des réservations" variante="discret" onClick={props.onFermer} />}
      </div>
      <div className="resa-filtre-services" role="group" aria-label="Service">
        <button type="button" className={`option${props.filtreService === null ? " active" : ""}`} aria-pressed={props.filtreService === null} onClick={() => props.onFiltreService(null)}>
          Tous
        </button>
        {services.map((s) => (
          <button key={s.id} type="button" className={`option${props.filtreService === s.id ? " active" : ""}`} aria-pressed={props.filtreService === s.id} onClick={() => props.onFiltreService(s.id)}>
            {s.nom}
          </button>
        ))}
        <Menu icone={SlidersHorizontal} libelle="Filtres de la liste">
          {() => (
            <label className="case resa-menu-case">
              <input type="checkbox" checked={annulees} onChange={(e) => setAnnulees(e.target.checked)} /> Annulées et absentes
            </label>
          )}
        </Menu>
      </div>
      <div className="resa-compteurs">
        <BoutonIcone
          icone={chercher ? X : Search}
          libelle={chercher ? "Fermer la recherche" : "Rechercher une réservation"}
          variante="discret"
          onClick={() => {
            setChercher((c) => !c);
            setRecherche("");
            setTrouvees(null);
          }}
        />
        {chercher ? (
          <input
            className="resa-recherche"
            type="search"
            autoFocus
            value={recherche}
            placeholder="Nom, téléphone, e-mail, note…"
            aria-label="Rechercher dans les réservations à venir"
            onChange={(e) => setRecherche(e.target.value)}
          />
        ) : (
          <>
            <Compteur icone={LayoutGrid} nombre={compteurs.total} libelle="Couverts réservés (confirmés et installés)" texte="Total" principal />
            <Compteur icone={ChevronsRight} nombre={compteurs.aVenir} libelle="Couverts à venir" />
            <Compteur icone={ConciergeBell} nombre={compteurs.installes} libelle="Couverts installés" />
            <Compteur icone={Hourglass} nombre={compteurs.attente} libelle="Couverts sous option ou en liste d'attente" />
          </>
        )}
        <Menu icone={ArrowDownWideNarrow} libelle={`Trier : ${LIBELLES_TRI[tri].toLowerCase()}`}>
          {(fermer) =>
            (Object.keys(LIBELLES_TRI) as Tri[]).map((t) => (
              <button
                key={t}
                type="button"
                role="menuitemradio"
                aria-checked={tri === t}
                className={`resa-menu-choix${tri === t ? " actif" : ""}`}
                onClick={() => {
                  setTri(t);
                  fermer();
                }}
              >
                {LIBELLES_TRI[t]}
              </button>
            ))
          }
        </Menu>
        <Menu icone={EllipsisVertical} libelle="Plus d'options">
          {(fermer) => (
            <button
              type="button"
              role="menuitem"
              className="resa-menu-choix"
              onClick={() => {
                props.onModifie();
                setTrouvees(null);
                fermer();
              }}
            >
              Actualiser la liste
            </button>
          )}
        </Menu>
      </div>

      <div className="resa-defilant">
        {erreurAction && <p className="erreur resa-erreur">{erreurAction}</p>}
        {props.erreur && !q && <p className="erreur resa-erreur">{props.erreur}</p>}
        {(q ? trouvees === null : props.reservations === null) ? (
          <p className="explication resa-vide">Chargement…</p>
        ) : groupes.length === 0 ? (
          <p className="explication resa-vide">
            {q
              ? "Aucune réservation à venir ne correspond."
              : ctx.reglages.fermetures.includes(date)
                ? "Établissement fermé ce jour-là."
                : !ctx.reglages.actif && duJour.length === 0
                  ? "Aucune réservation. La réservation en ligne est fermée (administration › Réservations)."
                  : "Aucune réservation ce jour-là."}
          </p>
        ) : (
          groupes.map((g) => {
            // Créneaux : au jour et par heure seulement ; un tri par nom ou par table donne une liste continue.
            const parCreneau = !q && tri === "heure";
            const creneaux = parCreneau ? [...new Set(g.liste.map((r) => r.heure))] : [""];
            const service = ctx.reglages.services.find((s) => s.id === g.cle);
            return (
              <section key={g.cle} className="resa-groupe">
                <h3 className="resa-groupe-tete">
                  <span>{g.titre}</span>
                  <span className="resa-pastille" title={`${pl(couvertsDe(g.liste.filter(compte)), "couvert")}${g.plafond ? ` sur ${g.plafond}` : ""}`}>
                    <AvecIcone icone={LayoutGrid} taille={15}>
                      {g.plafond ? `${couvertsDe(g.liste.filter(compte))}/${g.plafond}` : couvertsDe(g.liste.filter(compte))}
                    </AvecIcone>
                  </span>
                </h3>
                {creneaux.map((h) => {
                  const ici = h ? g.liste.filter((r) => r.heure === h) : g.liste;
                  const arrivees = couvertsDe(ici.filter(compte));
                  return (
                    <div key={h || "tout"} className="resa-creneau">
                      {h && (
                        <h4 className="resa-creneau-tete">
                          <span>{h}</span>
                          <span className="resa-pastille" title={pl(ici.length, "réservation")}>
                            <AvecIcone icone={Users} taille={14}>
                              {ici.length}
                            </AvecIcone>
                          </span>
                          <span
                            className="resa-pastille"
                            title={`${pl(arrivees, "couvert")} arrive${arrivees > 1 ? "nt" : ""} à ${h}${service?.arriveesMax ? ` (plafond ${service.arriveesMax})` : ""}`}
                          >
                            <AvecIcone icone={UserPlus} taille={14}>
                              {service?.arriveesMax ? `${arrivees}/${service.arriveesMax}` : arrivees}
                            </AvecIcone>
                          </span>
                        </h4>
                      )}
                      <ul className="resa-lignes">
                        {ici.map((r) => (
                          <Ligne
                            key={r.id}
                            r={r}
                            ctx={ctx}
                            avecDate={!!q}
                            jour={duJour.length ? duJour : ici}
                            occupee={r.tables.some((t) => props.occupees?.has(t))}
                            onOuvrir={() => props.onOuvrir(r)}
                            onStatut={(s) => void changerStatut(r, s)}
                            onTables={(ids) => void modifier(r, { tables: ids })}
                            {...(props.installer && r.date === ctx.aujourdhui ? { installer: props.installer } : {})}
                          />
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </section>
            );
          })
        )}
      </div>

      {!q && (
        <table className="resa-repartition" aria-label="Réservations par nombre de personnes">
          <tbody>
            <tr>
              <th scope="row">
                <Utensils size={16} aria-hidden="true" />
                <span className="lecteur-ecran">Personnes</span>
              </th>
              {repartition.map((_, i) => (
                <td key={i}>{i === 7 ? "8+" : i + 1}</td>
              ))}
            </tr>
            <tr>
              <th scope="row">
                <LayoutGrid size={16} aria-hidden="true" />
                <span className="lecteur-ecran">Réservations</span>
              </th>
              {repartition.map((n, i) => (
                <td key={i}>{n}</td>
              ))}
            </tr>
          </tbody>
        </table>
      )}
    </section>
  );
}

/** Une réservation : heure, nom, personnes, statut, canal, tables ; message, allergies, mémo et étiquettes dessous. */
function Ligne(props: {
  r: Reservation;
  ctx: ContexteReservations;
  avecDate: boolean;
  jour: Reservation[];
  occupee: boolean;
  onOuvrir: () => void;
  onStatut: (s: StatutReservation) => void;
  onTables: (ids: string[]) => void;
  installer?: (r: Reservation) => Promise<void>;
}) {
  const { r, ctx } = props;
  const Canal = ICONES_CANAL[r.source];
  const installable = !!props.installer && r.statut === "confirmee" && r.tables.length > 0 && !props.occupee;
  const statuts = ORDRE_STATUTS.filter((s) => s !== "arrivee" || r.statut === "arrivee" || !props.installer);
  return (
    <li className={`resa-ligne ${r.statut}`} style={r.couleur ? { borderLeftColor: TEINTES[r.couleur] } : undefined}>
      <button type="button" className="resa-ligne-ouvrir" aria-label={`Ouvrir la réservation de ${nomClient(r)}`} onClick={props.onOuvrir}>
        <span className="resa-heure">{r.heure}</span>
        <span className="resa-nom">
          {nomListe(r)}
          {props.avecDate && <small>{dateCourte(r.date)}</small>}
        </span>
      </button>
      <div className="resa-ligne-table">
        <ChoixTables
          tables={ctx.tables}
          valeur={r.tables}
          couverts={r.couverts}
          vide={temporaire(r) ? "—" : "À placer"}
          libelle={`Tables de ${nomClient(r)}`}
          reservation={r}
          autres={props.jour}
          disabled={ctx.horsLigne || r.statut === "annulee"}
          onChange={props.onTables}
        />
      </div>
      <div className="resa-ligne-infos">
        <span className="resa-couverts" title={pl(r.couverts, "personne")}>
          <AvecIcone icone={Utensils} taille={14}>
            {r.couverts}
          </AvecIcone>
          <span className="lecteur-ecran"> personnes</span>
        </span>
        <select
          className={`resa-statut ${r.statut}`}
          aria-label={`Statut de ${nomClient(r)}`}
          value={r.statut}
          disabled={ctx.horsLigne}
          onChange={(e) => props.onStatut(e.target.value as StatutReservation)}
        >
          {statuts.map((s) => (
            <option key={s} value={s}>
              {LIBELLES_STATUT[s]}
            </option>
          ))}
        </select>
        <span className="resa-canal" title={`Prise ${LIBELLES_CANAL[r.source].toLowerCase()}${r.prisePar ? ` par ${r.prisePar}` : ""}`}>
          <Canal className="icone" size={17} aria-hidden="true" />
          <span className="lecteur-ecran">{LIBELLES_CANAL[r.source]}</span>
        </span>
        {r.telephone && (
          <a className="resa-appel" href={`tel:${r.telephone}`} title={`Appeler ${r.telephone}`} aria-label={`Appeler ${nomClient(r)}`}>
            <Phone className="icone" size={17} aria-hidden="true" />
          </a>
        )}
        {installable && (
          <button type="button" className="bouton principal resa-installer" onClick={() => void props.installer!(r)}>
            <AvecIcone icone={UserCheck} taille={18}>
              Installer
            </AvecIcone>
          </button>
        )}
      </div>
      {(r.commentaire || r.allergies || r.memo || r.tags?.length) && (
        <div className="resa-ligne-notes">
          {r.allergies && (
            <p className="resa-allergies">
              <AvecIcone icone={TriangleAlert} taille={14}>
                {r.allergies}
              </AvecIcone>
            </p>
          )}
          {r.commentaire && (
            <p>
              <AvecIcone icone={MessageSquareText} taille={14}>
                {r.commentaire}
              </AvecIcone>
            </p>
          )}
          {r.memo && (
            <p className="resa-memo">
              <AvecIcone icone={StickyNote} taille={14}>
                {r.memo}
              </AvecIcone>
            </p>
          )}
          {!!r.tags?.length && (
            <p className="resa-tags">
              {TAGS_RESERVATION.filter((t) => r.tags!.includes(t)).map((t) => (
                <span key={t} className="resa-tag">
                  {t}
                </span>
              ))}
            </p>
          )}
        </div>
      )}
    </li>
  );
}
