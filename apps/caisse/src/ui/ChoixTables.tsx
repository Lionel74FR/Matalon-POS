import { chaisesDe, conflitsTable, type Reservation } from "@matalon/reservations";
import { Check, Link2, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Modale } from "./communs";
import { AvecIcone } from "./icones";

interface TableChoix {
  id: string;
  nom: string;
  zone: string;
  chaises?: number;
  masquee?: boolean;
}

const placesDe = (tables: TableChoix[], ids: string[]) => ids.reduce((n, id) => n + chaisesDe(tables.find((t) => t.id === id) ?? { id, nom: id, zone: "" }), 0);
const pl = (n: number, mot: string) => `${n} ${mot}${n > 1 ? "s" : ""}`;

/**
 * Tables d'une réservation : une ou plusieurs, assemblées pour un groupe. Le bouton montre
 * les tables choisies et leurs places ; la fenêtre les propose par zone, avec le total des
 * places face au nombre de personnes et les tables déjà prises sur le créneau.
 */
export function ChoixTables(props: {
  tables: TableChoix[];
  valeur: string[];
  couverts: number;
  /** Libellé quand rien n'est choisi : « À placer » (liste) ou « Attribuée d'office » (saisie). */
  vide: string;
  /** Nom accessible du bouton (« Tables de Martin Dupont »). */
  libelle: string;
  /** Réservation et réservations du même jour : signale les tables prises sur le même créneau. */
  reservation?: Reservation;
  autres?: Reservation[];
  disabled?: boolean;
  onChange: (ids: string[]) => void;
}) {
  const [ouvert, setOuvert] = useState(false);
  const [choisies, setChoisies] = useState<string[]>(props.valeur);
  const visibles = props.tables.filter((t) => !t.masquee || props.valeur.includes(t.id));
  const nom = (id: string) => props.tables.find((t) => t.id === id)?.nom ?? id;
  const places = placesDe(props.tables, props.valeur);
  const manque = props.valeur.length > 0 && places < props.couverts;
  const zones = [...new Set(visibles.map((t) => t.zone))];
  /** Réservations qui tiennent déjà cette table sur le même créneau. */
  const prise = (id: string) => (props.reservation && props.autres ? conflitsTable(props.autres, { ...props.reservation, tables: [id] }) : []);
  const placesChoisies = placesDe(props.tables, choisies);

  const ouvrir = () => {
    setChoisies(props.valeur);
    setOuvert(true);
  };
  const basculer = (id: string) => setChoisies((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));

  return (
    <>
      <button
        type="button"
        className={`bouton choix-tables${manque ? " manque" : ""}`}
        aria-label={`${props.libelle} : ${props.valeur.length ? `table${props.valeur.length > 1 ? "s" : ""} ${props.valeur.map(nom).join(" + ")}` : props.vide}`}
        disabled={props.disabled}
        onClick={ouvrir}
      >
        {props.valeur.length ? (
          <>
            {props.valeur.length > 1 && <Link2 className="icone" size={16} aria-hidden="true" />}
            {props.valeur.map(nom).join(" + ")}
            <small>{pl(places, "place")}</small>
          </>
        ) : (
          props.vide
        )}
      </button>
      {ouvert && (
        <Modale
          titre={`Tables · ${pl(props.couverts, "personne")}`}
          large
          onFermer={() => setOuvert(false)}
          pied={
            <>
              <span className={`choix-tables-total${choisies.length && placesChoisies < props.couverts ? " manque" : ""}`} role="status">
                {choisies.length
                  ? `${pl(placesChoisies, "place")} pour ${pl(props.couverts, "personne")}${placesChoisies < props.couverts ? " : ajoutez une table" : ""}`
                  : props.vide}
              </span>
              <button type="button" className="bouton" disabled={!choisies.length} onClick={() => setChoisies([])}>
                Aucune table
              </button>
              <button
                type="button"
                className="bouton principal"
                onClick={() => {
                  setOuvert(false);
                  if (choisies.join() !== props.valeur.join()) props.onChange(choisies);
                }}
              >
                <AvecIcone icone={Check}>Valider</AvecIcone>
              </button>
            </>
          }
        >
          <p className="explication">Touchez les tables à réunir pour ce groupe ; elles s'ouvriront ensemble à l'installation.</p>
          {zones.map((z) => (
            <section key={z} className="choix-tables-zone">
              {zones.length > 1 && <h3>{z}</h3>}
              <div className="choix-tables-grille">
                {visibles
                  .filter((t) => t.zone === z)
                  .map((t) => {
                    const deja = prise(t.id);
                    const actif = choisies.includes(t.id);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        className={`choix-table${actif ? " actif" : ""}${deja.length ? " prise" : ""}`}
                        aria-pressed={actif}
                        onClick={() => basculer(t.id)}
                      >
                        <strong>{t.nom}</strong>
                        <small>{pl(chaisesDe(t), "place")}</small>
                        {deja.length > 0 && (
                          <small className="choix-table-prise">
                            <TriangleAlert size={13} aria-hidden="true" /> {deja[0]!.heure} · {deja[0]!.nom}
                          </small>
                        )}
                      </button>
                    );
                  })}
              </div>
            </section>
          ))}
        </Modale>
      )}
    </>
  );
}
