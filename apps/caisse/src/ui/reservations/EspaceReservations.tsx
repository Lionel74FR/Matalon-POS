import { active, minutes, temporaire, type Reservation } from "@matalon/reservations";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ListeReservations } from "./ListeReservations";
import { PanneauReservation } from "./PanneauReservation";
import { messageErreur, type AccesReservations, type ContexteReservations } from "./commun";
import "./reservations.css";

/** Ce que l'espace donne au centre (le plan de salle) : jour affiché, ses réservations, tables choisies dans la saisie. */
export interface CentreReservations {
  date: string;
  reservations: Reservation[];
  filtreService: string | null;
  /** Saisie ouverte : tables choisies, et un toucher sur le plan en ajoute ou en retire une. */
  selection: Set<string> | null;
  basculerTable: ((id: string) => void) | null;
  /** Ouvre la (première) réservation d'une table ce jour-là. */
  ouvrirTable: (id: string) => void;
  /** Revient au jour du service. */
  revenirAujourdhui: () => void;
}

type Panneau = { type: "nouvelle" } | { type: "fiche"; reservation: Reservation };

/**
 * Espace des réservations façon Zenchef : la liste à gauche, le plan au centre, le panneau de
 * saisie à droite (la liste s'efface tant qu'il est ouvert, comme dans Zenchef). Sur iPhone, la
 * liste et le panneau passent en plein écran.
 */
export function EspaceReservations(props: {
  ctx: ContexteReservations;
  acces: AccesReservations;
  /** Caisse : la liste du jour tenue par la salle (relue chaque minute, copie gardée hors ligne). */
  jourCaisse?: { date: string; reservations: Reservation[]; recharger: () => Promise<void> };
  /** Liste visible (la caisse la replie ; l'administration la montre toujours). */
  colonne: boolean;
  onColonne?: (visible: boolean) => void;
  centre: (c: CentreReservations) => ReactNode;
  notifier: (message: string) => void;
  installer?: (r: Reservation) => Promise<void>;
  occupees?: Set<string>;
  /** Administration : la liste reste dans la page sur iPhone (le plan s'y efface). */
  integre?: boolean;
}) {
  const { ctx, acces, jourCaisse } = props;
  const [date, setDate] = useState(ctx.aujourdhui);
  const [filtreService, setFiltreService] = useState<string | null>(null);
  const [propres, setPropres] = useState<{ date: string; liste: Reservation[] } | null>(null);
  const [erreur, setErreur] = useState("");
  const [panneau, setPanneau] = useState<Panneau | null>(null);
  const [tables, setTables] = useState<string[]>([]);
  /** Enregistrements faits depuis le panneau : la recherche de la liste se relit. */
  const [version, setVersion] = useState(0);
  const parCaisse = !!jourCaisse && jourCaisse.date === date;

  const charger = useCallback(async () => {
    if (parCaisse) return void (await jourCaisse!.recharger());
    try {
      const liste = await acces.lister(date, date);
      setPropres({ date, liste });
      setErreur("");
    } catch (e) {
      setErreur(`${messageErreur(e)}${jourCaisse ? " Hors ligne, seules les réservations du jour restent consultables." : ""}`);
    }
  }, [parCaisse, jourCaisse, acces, date]);

  useEffect(() => {
    if (parCaisse) return;
    setPropres((p) => (p?.date === date ? p : null));
    void charger();
    const t = setInterval(() => void charger(), 60_000);
    const visible = () => document.visibilityState === "visible" && void charger();
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [charger, parCaisse, date]);

  const reservations = parCaisse ? jourCaisse!.reservations : propres?.date === date ? propres.liste : null;

  const ouvrir = (p: Panneau | null) => {
    setPanneau(p);
    setTables(p?.type === "fiche" ? p.reservation.tables : []);
  };

  const ouvrirTable = (id: string) => {
    const r = (reservations ?? [])
      .filter((x) => x.tables.includes(id) && (active(x) || temporaire(x)) && (!filtreService || x.serviceId === filtreService))
      .sort((a, b) => minutes(a.heure) - minutes(b.heure))[0];
    if (r) ouvrir({ type: "fiche", reservation: r });
  };

  const basculerTable = (id: string) => setTables((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));

  return (
    <div className={`resa-espace${props.colonne && !panneau ? " avec-colonne" : ""}${panneau ? " avec-panneau" : ""}${props.integre ? " integre" : ""}`}>
      {/* Pendant la saisie, la liste s'efface sans se démonter : jour, filtres et recherche restent. */}
      {props.colonne && (
        <div className="resa-colonne" hidden={!!panneau}>
          <ListeReservations
            ctx={ctx}
            acces={acces}
            date={date}
            onDate={(d) => {
              setDate(d);
              setFiltreService(null);
            }}
            filtreService={filtreService}
            onFiltreService={setFiltreService}
            reservations={reservations}
            erreur={parCaisse ? "" : erreur}
            onOuvrir={(r) => ouvrir({ type: "fiche", reservation: r })}
            onCreer={() => ouvrir({ type: "nouvelle" })}
            onModifie={() => void charger()}
            version={version}
            {...(props.installer ? { installer: props.installer } : {})}
            {...(props.occupees ? { occupees: props.occupees } : {})}
            {...(props.onColonne && !props.integre ? { onFermer: () => props.onColonne!(false) } : {})}
          />
        </div>
      )}
      <div className="resa-centre">
        {props.centre({
          date,
          reservations: reservations ?? [],
          filtreService,
          selection: panneau ? new Set(tables) : null,
          basculerTable: panneau ? basculerTable : null,
          ouvrirTable,
          revenirAujourdhui: () => setDate(ctx.aujourdhui),
        })}
      </div>
      {panneau && (
        <PanneauReservation
          key={panneau.type === "fiche" ? panneau.reservation.id : "nouvelle"}
          ctx={ctx}
          acces={acces}
          {...(panneau.type === "fiche" ? { reservation: panneau.reservation } : {})}
          dateInitiale={date}
          tables={tables}
          onTables={setTables}
          planVisible
          onFermer={() => ouvrir(null)}
          onEnregistree={(_r, message) => {
            ouvrir(null);
            props.notifier(message);
            setVersion((v) => v + 1);
            void charger();
          }}
          {...(props.installer ? { installer: props.installer } : {})}
        />
      )}
    </div>
  );
}
