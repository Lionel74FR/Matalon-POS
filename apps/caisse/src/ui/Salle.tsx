import { Clock, Coffee, Printer, StickyNote, Users } from "lucide-react";
import { AvecIcone } from "./icones";
import { ID_COMPTOIR } from "../donnees/configuration";
import { totauxCommande, type Commande } from "../metier/commande";
import { euros, useCaisse } from "./contexte";

function depuis(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")}`;
}

/** Plan de salle : tables libres et occupées, comptoir. */
export function Salle(props: { commandes: Map<string, Commande>; onOuvrir: (tableId: string) => void }) {
  const { config } = useCaisse();
  const zones = [...new Set(config.tables.map((t) => t.zone))];
  const comptoir = props.commandes.get(ID_COMPTOIR);
  const occupees = [...props.commandes.values()].filter((c) => c.tableId !== ID_COMPTOIR);
  const enCours = occupees.reduce((s, c) => s + totauxCommande(c).totalTTC, 0);

  return (
    <div className="salle">
      <header className="salle-tete">
        <h1>Salle</h1>
        <p>
          {occupees.length === 0
            ? "Toutes les tables sont libres."
            : `${occupees.length} table${occupees.length > 1 ? "s" : ""} ouverte${occupees.length > 1 ? "s" : ""} · ${euros(enCours)} en cours`}
        </p>
      </header>
      <button className={`table comptoir${comptoir ? " occupee" : ""}`} onClick={() => props.onOuvrir(ID_COMPTOIR)}>
        <span className="table-nom">
          <AvecIcone icone={Coffee} taille={22}>Comptoir</AvecIcone>
        </span>
        {comptoir ? (
          <span className="table-total">{euros(totauxCommande(comptoir).totalTTC)}</span>
        ) : (
          <span className="table-libre">Vente directe</span>
        )}
      </button>
      {zones.map((zone) => (
        <section key={zone} className="zone">
          <h2>{zone}</h2>
          <div className="grille-tables">
            {config.tables
              .filter((t) => t.zone === zone)
              .map((t) => {
                const c = props.commandes.get(t.id);
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
    </div>
  );
}
