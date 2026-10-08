import { BellRing, Clock, Coffee, LayoutList, Link2, Map as IconePlan, PencilRuler, Printer, StickyNote, Users, ZoomIn, ZoomOut } from "lucide-react";
import { useMemo, useState } from "react";
import { ID_COMPTOIR, type Table } from "../donnees/configuration";
import { nomCourtSuite, nomSuite, suitesDe, suiviSuites, tablesDeCommande, totauxCommande, type Commande } from "../metier/commande";
import { chaisesDe, placerTables, zonesDuPlan } from "../metier/plan";
import { euros, useCaisse } from "./contexte";
import { EditeurPlan, type PlanEditable } from "./EditeurPlan";
import { AvecIcone, BoutonIcone } from "./icones";
import { PlanSalle, type EtatTable } from "./PlanSalle";
import { messageServeur } from "./Reglages";

function depuis(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")}`;
}

/**
 * Suites de la table : prochaine à réclamer (« AS1 · 12 min » depuis le
 * dernier envoi ou la dernière réclame), ou dernière réclamée une fois tout
 * réclamé. Rien si la table n'a que de l'« En direct ».
 */
function suiviTable(c: Commande): { court: string; long: string; aReclamer: boolean } | null {
  if (!suitesDe(c).some((s) => s !== 0)) return null;
  const { prochaine, derniereReclame, dernierMouvement } = suiviSuites(c);
  const temps = depuis(dernierMouvement ?? c.ouverteLe);
  if (prochaine) return { court: `${nomCourtSuite(prochaine)} · ${temps}`, long: `${nomSuite(prochaine)} à réclamer, dernier envoi il y a ${temps}`, aReclamer: true };
  if (derniereReclame) return { court: `${nomCourtSuite(derniereReclame.suite)} ✓ ${temps}`, long: `${nomSuite(derniereReclame.suite)} réclamée il y a ${temps}`, aReclamer: false };
  return null;
}

const CLE_VUE = "matalon.salle.vue";
const lireVue = (): "plan" | "liste" => {
  try {
    return localStorage.getItem(CLE_VUE) === "liste" ? "liste" : "plan";
  } catch {
    return "plan";
  }
};
const ZOOMS = [1, 1.5, 2, 3];

/** Salle : plan des tables (ou liste), libres et occupées, et le comptoir. */
export function Salle(props: { commandes: Map<string, Commande>; onOuvrir: (tableId: string) => void }) {
  const { caisse, config, majConfig, notifier, demanderResponsable } = useCaisse();
  const [vue, setVue] = useState(lireVue);
  const [edition, setEdition] = useState(false);
  const [zoom, setZoom] = useState(0);
  const zones = useMemo(() => zonesDuPlan(config.zones, config.tables), [config.zones, config.tables]);
  const [zoneNom, setZoneNom] = useState<string | null>(null);
  const zone = zones.find((z) => z.nom === zoneNom) ?? zones[0];
  const comptoir = props.commandes.get(ID_COMPTOIR);
  const occupees = [...props.commandes.values()].filter((c) => c.tableId !== ID_COMPTOIR);
  const enCours = occupees.reduce((s, c) => s + totauxCommande(c).totalTTC, 0);
  const tableParId = useMemo(() => new Map(config.tables.map((t) => [t.id, t])), [config.tables]);
  const nom = (id: string) => tableParId.get(id)?.nom ?? id;

  /** Commande de chaque table occupée, table principale ou assemblée. */
  const commandeDe = useMemo(() => {
    const m = new Map<string, Commande>();
    for (const c of occupees) for (const id of tablesDeCommande(c)) if (!m.has(id)) m.set(id, c);
    return m;
  }, [occupees]);

  const etats = useMemo(() => {
    const m = new Map<string, EtatTable>();
    for (const t of config.tables) {
      const c = commandeDe.get(t.id);
      if (!c) {
        m.set(t.id, { statut: "libre", lignes: [], description: `Table ${t.nom}, libre, ${chaisesDe(t)} chaises` });
        continue;
      }
      if (c.tableId !== t.id) {
        m.set(t.id, { statut: "jointe", lignes: [`avec ${nom(c.tableId)}`], description: `Table ${t.nom}, assemblée à la table ${nom(c.tableId)}` });
        continue;
      }
      const chaises = tablesDeCommande(c).reduce((s, id) => s + (tableParId.has(id) ? chaisesDe(tableParId.get(id)!) : 0), 0);
      const total = euros(totauxCommande(c).totalTTC);
      const couverts = c.couverts ? `${c.couverts}/${chaises}` : null;
      const suivi = suiviTable(c);
      m.set(t.id, {
        statut: c.additionsImprimees > 0 ? "addition" : "occupee",
        lignes: [total, [depuis(c.ouverteLe), couverts].filter(Boolean).join(" · "), ...(suivi ? [suivi.court] : [])],
        alerte: !!c.couverts && chaises > 0 && c.couverts > chaises,
        description: `Table ${t.nom}, ${c.additionsImprimees > 0 ? "addition imprimée" : "occupée"}, ${total}${suivi ? `, ${suivi.long}` : ""}`,
      });
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.tables, commandeDe, tableParId]);

  // Commandes qu'aucune table visible ne montre (table masquée depuis) : jamais perdues de vue.
  const visibles = new Set(config.tables.filter((t) => !t.masquee).map((t) => t.id));
  const horsPlan = occupees.filter((c) => !visibles.has(c.tableId));

  const changerVue = (v: "plan" | "liste") => {
    setVue(v);
    try {
      localStorage.setItem(CLE_VUE, v);
    } catch {
      /* stockage indisponible : le choix vaut pour la session */
    }
  };

  const modifierPlan = async () => {
    if (await demanderResponsable("Modifier le plan de salle.")) setEdition(true);
  };

  /** Le plan est commun à l'établissement : enregistré d'abord sur le serveur. */
  const enregistrerPlan = async (p: PlanEditable) => {
    try {
      const { etablissement: e } = await caisse.client.enregistrerPlan(p);
      await majConfig({ ...config, tables: e.tables, zones: e.zones ?? [], planVersion: e.planVersion ?? 0 });
      notifier("Plan de salle enregistré pour toutes les caisses.");
      setEdition(false);
    } catch (e) {
      throw new Error(messageServeur(e));
    }
  };

  if (edition) {
    return (
      <div className="salle">
        <EditeurPlan
          plan={{ zones: config.zones ?? [], tables: config.tables, version: config.planVersion ?? 0 }}
          onEnregistrer={enregistrerPlan}
          onFermer={() => setEdition(false)}
        />
      </div>
    );
  }

  const placees = zone ? placerTables(zone, config.tables) : [];
  const liens: Array<[string, string]> = occupees.flatMap((c) => (c.jointes ?? []).map((j): [string, string] => [c.tableId, j]));

  return (
    <div className={`salle${vue === "plan" ? " avec-plan" : ""}`}>
      <header className="salle-tete">
        <h1>Salle</h1>
        <p>
          {occupees.length === 0
            ? "Toutes les tables sont libres."
            : `${occupees.length} table${occupees.length > 1 ? "s" : ""} ouverte${occupees.length > 1 ? "s" : ""} · ${euros(enCours)} en cours`}
        </p>
        <div className="salle-outils">
          {vue === "plan" && (
            <>
              <BoutonIcone icone={ZoomOut} variante="discret" libelle="Dézoomer le plan" disabled={zoom === 0} onClick={() => setZoom((z) => Math.max(0, z - 1))} />
              <BoutonIcone icone={ZoomIn} variante="discret" libelle="Zoomer le plan" disabled={zoom === ZOOMS.length - 1} onClick={() => setZoom((z) => Math.min(ZOOMS.length - 1, z + 1))} />
            </>
          )}
          <BoutonIcone
            icone={vue === "plan" ? LayoutList : IconePlan}
            variante="discret"
            libelle={vue === "plan" ? "Afficher la liste des tables" : "Afficher le plan de salle"}
            onClick={() => changerVue(vue === "plan" ? "liste" : "plan")}
          />
          <BoutonIcone icone={PencilRuler} variante="discret" libelle="Modifier le plan de salle" onClick={() => void modifierPlan()} />
        </div>
      </header>
      <button className={`table comptoir${comptoir ? " occupee" : ""}`} onClick={() => props.onOuvrir(ID_COMPTOIR)}>
        <span className="table-nom">
          <AvecIcone icone={Coffee} taille={22}>Comptoir</AvecIcone>
        </span>
        {comptoir ? <span className="table-total">{euros(totauxCommande(comptoir).totalTTC)}</span> : <span className="table-libre">Vente directe</span>}
      </button>

      {vue === "plan" && zone ? (
        <>
          {zones.length > 1 && (
            <div className="categories" role="tablist" aria-label="Zones">
              {zones.map((z) => {
                const n = config.tables.filter((t) => t.zone === z.nom && commandeDe.get(t.id)?.tableId === t.id).length;
                return (
                  <button key={z.nom} role="tab" aria-selected={z.nom === zone.nom} className={`pastille${z.nom === zone.nom ? " active" : ""}`} onClick={() => setZoneNom(z.nom)}>
                    {z.nom}
                    {n > 0 && ` · ${n}`}
                  </button>
                );
              })}
            </div>
          )}
          <div className="plan-defilant">
            <PlanSalle
              zone={zone}
              tables={placees}
              etats={etats}
              liens={liens}
              onTable={props.onOuvrir}
              ajuste
              {...(ZOOMS[zoom]! > 1 ? { zoom: ZOOMS[zoom]! } : {})}
            />
          </div>
        </>
      ) : (
        <ListeTables tables={config.tables} commandeDe={commandeDe} nom={nom} onOuvrir={props.onOuvrir} />
      )}

      {horsPlan.length > 0 && (
        <section className="zone">
          <h2>Hors plan</h2>
          <div className="grille-tables">
            {horsPlan.map((c) => (
              <button key={c.tableId} className="table occupee" onClick={() => props.onOuvrir(c.tableId)}>
                <span className="table-nom">{nom(c.tableId)}</span>
                <span className="table-total">{euros(totauxCommande(c).totalTTC)}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/** Vue en liste, par zone : la plus rapide sur iPhone. */
function ListeTables(props: { tables: Table[]; commandeDe: Map<string, Commande>; nom: (id: string) => string; onOuvrir: (id: string) => void }) {
  const tables = props.tables.filter((t) => !t.masquee);
  const zones = [...new Set(tables.map((t) => t.zone))];
  return (
    <>
      {zones.map((zone) => (
        <section key={zone} className="zone">
          <h2>{zone}</h2>
          <div className="grille-tables">
            {tables
              .filter((t) => t.zone === zone)
              .map((t) => {
                const c = props.commandeDe.get(t.id);
                if (c && c.tableId !== t.id) {
                  return (
                    <button key={t.id} className="table occupee jointe" onClick={() => props.onOuvrir(t.id)}>
                      <span className="table-nom">{t.nom}</span>
                      <span className="table-libre">
                        <AvecIcone icone={Link2} taille={14}>{`avec ${props.nom(c.tableId)}`}</AvecIcone>
                      </span>
                    </button>
                  );
                }
                return (
                  <button key={t.id} className={`table${c ? " occupee" : ""}`} onClick={() => props.onOuvrir(t.id)}>
                    <span className="table-nom">{t.nom}</span>
                    {c ? (
                      <>
                        <span className="table-total">{euros(totauxCommande(c).totalTTC)}</span>
                        <span className="table-meta">
                          {c.couverts ? (
                            <span title={`${c.couverts} couverts`}>
                              <AvecIcone icone={Users} taille={14}>{c.couverts}</AvecIcone>
                            </span>
                          ) : null}
                          <span title="Ouverte depuis">
                            <AvecIcone icone={Clock} taille={14}>{depuis(c.ouverteLe)}</AvecIcone>
                          </span>
                          {suiviTable(c) && (
                            <span className={`suivi-suite${suiviTable(c)!.aReclamer ? " a-reclamer" : ""}`} title={suiviTable(c)!.long}>
                              <AvecIcone icone={BellRing} taille={14}>{suiviTable(c)!.court}</AvecIcone>
                            </span>
                          )}
                          {c.additionsImprimees > 0 && (
                            <span title="Addition imprimée">
                              <AvecIcone icone={Printer} taille={14} />
                              <span className="lecteur-ecran">addition</span>
                            </span>
                          )}
                          {c.note && (
                            <span title="Note sur la commande">
                              <AvecIcone icone={StickyNote} taille={14} />
                              <span className="lecteur-ecran">note</span>
                            </span>
                          )}
                        </span>
                      </>
                    ) : (
                      <span className="table-libre">Libre</span>
                    )}
                  </button>
                );
              })}
          </div>
        </section>
      ))}
    </>
  );
}
