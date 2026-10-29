import { ArrowLeft, Check, Link2, ListChecks, Merge, Save } from "lucide-react";
import { AvecIcone } from "../icones";
import { useState } from "react";
import { ID_COMPTOIR } from "../../donnees/configuration";
import { Modale } from "../communs";
import { euros, useCaisse } from "../contexte";
import { acomptesActifs, ligneTransferable, type Commande } from "../../metier/commande";
import { montantPartiel, reglerSelection, SelectionArticles } from "./ModaleDivision";

/**
 * Choix de la table d'arrivée : une table libre reçoit la commande, une table ouverte la fusionne.
 * « Choisir des articles » (29 octobre 2026) : seuls les articles choisis, en entier ou en partie,
 * partent ; le reste, les couverts et la note demeurent sur la table de départ.
 */
export function ModaleTransfert(props: {
  depuis: string;
  /** Tables occupées, assemblées comprises. */
  tablesOuvertes: Set<string>;
  /** Tables assemblées à la commande transférée : elles ne sont pas une destination. */
  jointes?: string[];
  /** Commande de la table de départ : permet de n'en transférer que certains articles. */
  commande?: Commande;
  onChoisir: (tableId: string) => void;
  onArticles?: (tableId: string, selection: Map<string, number>) => void;
  onFermer: () => void;
}) {
  const { config } = useCaisse();
  const [fusion, setFusion] = useState<string | null>(null);
  const [etape, setEtape] = useState<"tables" | "articles">("tables");
  const [selection, setSelection] = useState<Map<string, number>>(new Map());
  const zones = [...new Set(config.tables.map((t) => t.zone))];
  const nom = (id: string) => (id === ID_COMPTOIR ? "Comptoir" : `Table ${config.tables.find((t) => t.id === id)?.nom ?? id}`);
  const transferables = props.commande ? props.commande.lignes.filter(ligneTransferable) : [];
  const avecAcomptes = !!props.commande && acomptesActifs(props.commande).length > 0;
  const nbChoisis = transferables.reduce((s, l) => s + (selection.get(l.uid) ?? 0), 0);
  const totalChoisi = transferables.reduce((s, l) => s + (selection.get(l.uid) ? montantPartiel(l, selection.get(l.uid)!) : 0), 0);
  // Tout est choisi et rien ne doit rester (ligne réglée, récompense) : c'est le transfert de la table entière.
  const tout =
    nbChoisis > 0 &&
    transferables.every((l) => (selection.get(l.uid) ?? 0) === l.quantite) &&
    props.commande!.lignes.every((l) => ligneTransferable(l) || !!l.retiree);
  const partiel = nbChoisis > 0 && !tout && !!props.onArticles;
  const libelleArticles = `${nbChoisis} article${nbChoisis > 1 ? "s" : ""} (${euros(totalChoisi)})`;
  const choisir = (tableId: string) => (partiel ? props.onArticles!(tableId, selection) : props.onChoisir(tableId));

  if (etape === "articles") {
    return (
      <Modale
        titre={`Articles à transférer de ${nom(props.depuis)}`}
        large
        onFermer={props.onFermer}
        pied={
          <>
            <button
              className="bouton"
              onClick={() => {
                setSelection(new Map());
                setEtape("tables");
              }}
            >
              <AvecIcone icone={ArrowLeft}>Toute la table</AvecIcone>
            </button>
            <button className="bouton principal grand" disabled={nbChoisis === 0} onClick={() => setEtape("tables")}>
              <AvecIcone icone={Check}>{nbChoisis ? `Choisir la table d'arrivée · ${libelleArticles}` : "Choisissez des articles"}</AvecIcone>
            </button>
          </>
        }
      >
        <p className="explication">
          Touchez un article pour le transférer en entier, ou réglez le nombre d'unités. Il garde son envoi, sa suite et sa remise ; les
          couverts et la note restent sur {nom(props.depuis)}.
        </p>
        <SelectionArticles lignes={transferables} selection={selection} onRegler={(l, n) => setSelection((m) => reglerSelection(m, l, n))} />
      </Modale>
    );
  }

  if (fusion) {
    return (
      <Modale
        titre="Regrouper les commandes"
        onFermer={() => setFusion(null)}
        pied={
          <>
            <button className="bouton" onClick={() => setFusion(null)}>
              <AvecIcone icone={ArrowLeft}>Choisir une autre table</AvecIcone>
            </button>
            <button className="bouton principal" onClick={() => choisir(fusion)}>
              <AvecIcone icone={Merge}>Regrouper sur {nom(fusion)}</AvecIcone>
            </button>
          </>
        }
      >
        <p className="explication">
          {partiel
            ? `${nom(fusion)} a déjà une commande ouverte : ${libelleArticles} s'y ${nbChoisis > 1 ? "ajoutent" : "ajoute"}. Le reste demeure sur ${nom(props.depuis)}.`
            : `${nom(fusion)} a déjà une commande ouverte. Les articles de ${nom(props.depuis)} s'y ajoutent et les couverts s'additionnent ; ${nom(props.depuis)} redevient libre.`}
        </p>
      </Modale>
    );
  }

  return (
    <Modale titre={partiel ? `Transférer ${libelleArticles} de ${nom(props.depuis)}` : `Transférer ${nom(props.depuis)}`} large onFermer={props.onFermer}>
      <p className="explication">
        {partiel ? "Touchez la table d'arrivée des articles choisis. Une table occupée les ajoute à sa commande." : "Touchez la table d'arrivée. Une table occupée regroupe les deux commandes."}
      </p>
      {props.onArticles && transferables.length > 0 && (
        <div className="transfert-articles">
          <button className="bouton" disabled={avecAcomptes} onClick={() => setEtape("articles")}>
            <AvecIcone icone={ListChecks}>{partiel ? "Modifier les articles choisis" : "Ne transférer que certains articles"}</AvecIcone>
          </button>
          {avecAcomptes && <small>Des acomptes sont versés sur cette table : elle se transfère en entier.</small>}
        </div>
      )}
      {zones.map((zone) => (
        <section key={zone} className="zone">
          <h3>{zone}</h3>
          <div className="grille-tables compacte">
            {config.tables
              .filter((t) => t.zone === zone && t.id !== props.depuis && !t.masquee && !props.jointes?.includes(t.id))
              .map((t) => {
                const occupee = props.tablesOuvertes.has(t.id);
                return (
                  <button key={t.id} className={`table${occupee ? " occupee" : ""}`} onClick={() => (occupee ? setFusion(t.id) : choisir(t.id))}>
                    <span className="table-nom">{t.nom}</span>
                    <span className="table-libre">{occupee ? "Occupée" : "Libre"}</span>
                  </button>
                );
              })}
          </div>
        </section>
      ))}
    </Modale>
  );
}

const NOTES_RAPIDES = ["Anniversaire", "Client pressé", "Allergie à signaler", "Servir ensemble"];

export function ModaleNoteCommande(props: { note: string; onValider: (note: string) => void; onFermer: () => void }) {
  const [note, setNote] = useState(props.note);
  return (
    <Modale
      titre="Note sur la commande"
      onFermer={props.onFermer}
      pied={
        <button className="bouton principal" onClick={() => props.onValider(note)}>
          <AvecIcone icone={Save}>Enregistrer</AvecIcone>
        </button>
      }
    >
      <div className="options">
        {NOTES_RAPIDES.map((n) => (
          <button key={n} className="option" onClick={() => setNote((x) => (x ? `${x}, ${n}` : n))}>
            {n}
          </button>
        ))}
      </div>
      <textarea className="saisie-note" rows={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Visible par toute l'équipe sur cette table" />
    </Modale>
  );
}

/**
 * Tables assemblées pour un groupe : elles restent sur le plan, occupées avec
 * la table de la commande, et se libèrent avec elle (encaissement, transfert).
 */
export function ModaleAssembler(props: {
  tableId: string;
  jointes: string[];
  /** Tables occupées par d'autres commandes : non disponibles. */
  occupees: Set<string>;
  onValider: (jointes: string[]) => void;
  onFermer: () => void;
}) {
  const { config } = useCaisse();
  const [choix, setChoix] = useState(props.jointes);
  const principale = config.tables.find((t) => t.id === props.tableId);
  // La zone de la table d'abord : on assemble d'ordinaire des tables voisines.
  const zones = [...new Set([principale?.zone, ...config.tables.map((t) => t.zone)].filter((z): z is string => !!z))];
  return (
    <Modale
      titre={`Assembler à la table ${principale?.nom ?? props.tableId}`}
      large
      onFermer={props.onFermer}
      pied={
        <button className="bouton principal" onClick={() => props.onValider(choix)}>
          <AvecIcone icone={Check}>{choix.length ? `Assembler ${choix.length} table${choix.length > 1 ? "s" : ""}` : "Aucune table assemblée"}</AvecIcone>
        </button>
      }
    >
      <p className="explication">
        Touchez les tables rapprochées pour ce groupe : une seule commande, une seule addition. Elles se libèrent à l'encaissement.
      </p>
      {zones.map((zone) => (
        <section key={zone} className="zone">
          <h3>{zone}</h3>
          <div className="grille-tables compacte">
            {config.tables
              .filter((t) => t.zone === zone && t.id !== props.tableId && !t.masquee)
              .map((t) => {
                const prise = props.occupees.has(t.id);
                const choisie = choix.includes(t.id);
                return (
                  <button
                    key={t.id}
                    className={`table${choisie ? " occupee" : ""}`}
                    disabled={prise}
                    aria-pressed={choisie}
                    onClick={() => setChoix((l) => (choisie ? l.filter((x) => x !== t.id) : [...l, t.id]))}
                  >
                    <span className="table-nom">{t.nom}</span>
                    <span className="table-libre">
                      {prise ? "Occupée" : choisie ? <AvecIcone icone={Link2} taille={14}>Assemblée</AvecIcone> : "Libre"}
                    </span>
                  </button>
                );
              })}
          </div>
        </section>
      ))}
    </Modale>
  );
}
