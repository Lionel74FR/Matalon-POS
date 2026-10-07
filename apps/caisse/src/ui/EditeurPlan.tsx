import { CASE_CM, problemePlan, type ElementDecor, type FormeTable, type Table, type ZonePlan } from "@matalon/serveur/partage";
import {
  BrickWall,
  Circle,
  Copy,
  DoorOpen,
  Eye,
  EyeOff,
  Minus,
  Plus,
  RectangleHorizontal,
  RotateCw,
  Save,
  Square,
  Trash2,
  Wine,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { identifiantAleatoire } from "../donnees/configuration";
import { chevauchements, chaisesDe, formeDe, nomSuivant, placerTables, zonesDuPlan } from "../metier/plan";
import { AvecIcone, BoutonIcone } from "./icones";
import { PlanSalle } from "./PlanSalle";

export interface PlanEditable {
  zones: ZonePlan[];
  tables: Table[];
  version: number;
}

type Selection = { type: "table" | "decor"; id: string } | null;

const FORMES: Array<[FormeTable, string, typeof Square]> = [
  ["carre", "Carré", Square],
  ["rectangle", "Rectangle", RectangleHorizontal],
  ["rond", "Rond", Circle],
];
const AJOUTS: Record<FormeTable, string> = { carre: "Table carrée", rectangle: "Table rectangulaire", rond: "Table ronde" };
const DECORS: Array<[ElementDecor["type"], string, typeof Square, { largeur: number; hauteur: number }]> = [
  ["bar", "Bar", Wine, { largeur: 12, hauteur: 3 }],
  ["porte", "Porte", DoorOpen, { largeur: 4, hauteur: 1 }],
  ["mur", "Mur", BrickWall, { largeur: 8, hauteur: 1 }],
];
const metres = (cases: number) => `${((cases * CASE_CM) / 100).toLocaleString("fr-FR")} m`;

/**
 * Éditeur du plan de salle : tables (carré, rectangle, rond) et repères de
 * décor glissés sur une grille de 25 cm, zone par zone. Partagé par
 * l'administration et l'iPad (responsable). Une table n'est jamais supprimée :
 * elle est masquée, parce que les tickets la citent.
 */
export function EditeurPlan(props: { plan: PlanEditable; onEnregistrer: (p: PlanEditable) => Promise<void>; onFermer?: () => void }) {
  const initial = useMemo(() => ({ zones: zonesDuPlan(props.plan.zones, props.plan.tables), tables: props.plan.tables }), [props.plan]);
  const [zones, setZones] = useState(initial.zones);
  const [tables, setTables] = useState(initial.tables);
  const [zoneNom, setZoneNom] = useState(initial.zones[0]?.nom ?? "Salle");
  const [selection, setSelection] = useState<Selection>(null);
  const [erreur, setErreur] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [nouvelleZone, setNouvelleZone] = useState<string | null>(null);

  useEffect(() => {
    setZones(initial.zones);
    setTables(initial.tables);
    setSelection(null);
  }, [initial]);

  const zone = zones.find((z) => z.nom === zoneNom) ?? zones[0] ?? { nom: "Salle", largeur: 40, hauteur: 24, decor: [] };
  const placees = useMemo(() => placerTables(zone, tables), [zone, tables]);
  const conflits = useMemo(() => chevauchements(placees), [placees]);
  const masquees = tables.filter((t) => t.zone === zone.nom && t.masquee);
  const modifie = JSON.stringify({ zones, tables }) !== JSON.stringify(initial);
  const table = selection?.type === "table" ? tables.find((t) => t.id === selection.id) : undefined;
  const decor = selection?.type === "decor" ? zone.decor.find((d) => d.id === selection.id) : undefined;

  const majTable = (id: string, v: Partial<Table>) => setTables((l) => l.map((t) => (t.id === id ? { ...t, ...v } : t)));
  const majZone = (v: Partial<ZonePlan>) => setZones((l) => l.map((z) => (z.nom === zone.nom ? { ...z, ...v } : z)));
  const majDecor = (id: string, v: Partial<ElementDecor>) => majZone({ decor: zone.decor.map((d) => (d.id === id ? { ...d, ...v } : d)) });

  /** Nouvelle table à la première place libre de la zone. */
  const ajouterTable = (forme: FormeTable, modele?: Table) => {
    const base: Table = {
      id: identifiantAleatoire("t"),
      nom: nomSuivant(tables),
      zone: zone.nom,
      forme,
      chaises: modele?.chaises ?? (forme === "rectangle" ? 6 : forme === "rond" ? 4 : 4),
      ...(modele?.rotation ? { rotation: modele.rotation } : {}),
    };
    const place = placerTables(zone, [...placees, base]).find((t) => t.id === base.id)!;
    setTables((l) => [...l, { ...base, x: place.x, y: place.y }]);
    setSelection({ type: "table", id: base.id });
  };

  const ajouterDecor = (type: ElementDecor["type"], taille: { largeur: number; hauteur: number }) => {
    const d: ElementDecor = { id: identifiantAleatoire("d"), type, x: 1, y: Math.max(0, zone.hauteur - taille.hauteur - 1), ...taille };
    majZone({ decor: [...zone.decor, d] });
    setSelection({ type: "decor", id: d.id });
  };

  const deplacer = (e: { type: "table" | "decor"; id: string }, x: number, y: number) =>
    e.type === "table" ? majTable(e.id, { x, y }) : majDecor(e.id, { x, y });

  const creerZone = () => {
    const nom = (nouvelleZone ?? "").trim();
    if (!nom) return setNouvelleZone(null);
    if (zones.some((z) => z.nom === nom)) return setErreur(`La zone « ${nom} » existe déjà.`);
    setZones((l) => [...l, { nom, largeur: 40, hauteur: 24, decor: [] }]);
    setZoneNom(nom);
    setNouvelleZone(null);
    setErreur("");
  };

  const renommerZone = (nom: string) => {
    const ancien = zone.nom;
    setZones((l) => l.map((z) => (z.nom === ancien ? { ...z, nom } : z)));
    setTables((l) => l.map((t) => (t.zone === ancien ? { ...t, zone: nom } : t)));
    setZoneNom(nom);
  };

  const enregistrer = async () => {
    // Les tables placées d'office reçoivent leur position : le plan ne bouge plus d'un appareil à l'autre.
    const positions = new Map(zones.flatMap((z) => placerTables(z, tables)).map((t) => [t.id, t]));
    const finales = tables.map((t) => positions.get(t.id) ?? t);
    const probleme = problemePlan(zones, finales, props.plan.tables);
    if (probleme) return setErreur(probleme);
    setErreur("");
    setEnvoi(true);
    try {
      await props.onEnregistrer({ zones, tables: finales, version: props.plan.version });
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <div className="editeur-plan">
      <header className="editeur-plan-tete">
        <div className="onglets-zones" role="tablist" aria-label="Zones">
          {zones.map((z) => (
            <button
              key={z.nom}
              role="tab"
              aria-selected={z.nom === zone.nom}
              className={`pastille${z.nom === zone.nom ? " active" : ""}`}
              onClick={() => {
                setZoneNom(z.nom);
                setSelection(null);
              }}
            >
              {z.nom}
            </button>
          ))}
          {nouvelleZone === null ? (
            <BoutonIcone icone={Plus} variante="discret" libelle="Ajouter une zone" onClick={() => setNouvelleZone("")} />
          ) : (
            <form
              className="nouvelle-zone"
              onSubmit={(e) => {
                e.preventDefault();
                creerZone();
              }}
            >
              <input autoFocus value={nouvelleZone} maxLength={40} placeholder="Mezzanine" aria-label="Nom de la zone" onChange={(e) => setNouvelleZone(e.target.value)} />
              <button className="bouton">Créer</button>
            </form>
          )}
        </div>
        <div className="editeur-plan-actions">
          {modifie && <span className="editeur-modifiee">Modifié</span>}
          <button className="bouton principal" disabled={!modifie || envoi} onClick={() => void enregistrer()}>
            <AvecIcone icone={Save}>{envoi ? "Enregistrement…" : "Enregistrer le plan"}</AvecIcone>
          </button>
          {props.onFermer && <BoutonIcone icone={X} variante="discret" libelle="Fermer l'éditeur" onClick={props.onFermer} />}
        </div>
      </header>

      <div className="outils-plan" role="toolbar" aria-label="Ajouter au plan">
        {FORMES.map(([forme, , icone]) => (
          <button key={forme} className="bouton" onClick={() => ajouterTable(forme)}>
            <AvecIcone icone={icone}>{AJOUTS[forme]}</AvecIcone>
          </button>
        ))}
        <span className="separateur" aria-hidden="true" />
        {DECORS.map(([type, libelle, icone, taille]) => (
          <button key={type} className="bouton discret" onClick={() => ajouterDecor(type, taille)}>
            <AvecIcone icone={icone}>{libelle}</AvecIcone>
          </button>
        ))}
      </div>

      {erreur && <p className="erreur">{erreur}</p>}
      {conflits.size > 0 && <p className="aide-champ">Tables trop proches (chaises comprises), en pointillé rouge : écartez-les.</p>}

      <div className="editeur-plan-corps">
        <div className="editeur-plan-zone">
          <PlanSalle
            zone={zone}
            tables={placees}
            edition={{ selection, enConflit: conflits, onChoisir: setSelection, onDeplacer: deplacer }}
          />
        </div>

        <aside className="editeur-plan-panneau" aria-label="Propriétés">
          {table ? (
            <>
              <h3>Table {table.nom}</h3>
              <label className="champ">
                <span>Nom</span>
                <input value={table.nom} maxLength={20} onChange={(e) => majTable(table.id, { nom: e.target.value })} />
              </label>
              <div className="options" role="radiogroup" aria-label="Forme">
                {FORMES.map(([forme, libelle, icone]) => (
                  <button
                    key={forme}
                    role="radio"
                    aria-checked={formeDe(table) === forme}
                    className={`option${formeDe(table) === forme ? " active" : ""}`}
                    onClick={() => majTable(table.id, { forme, ...(forme !== "rectangle" ? { rotation: 0 } : {}) })}
                  >
                    <AvecIcone icone={icone}>{libelle}</AvecIcone>
                  </button>
                ))}
              </div>
              <div className="quantite" aria-label="Chaises">
                <button className="bouton" aria-label="Une chaise de moins" onClick={() => majTable(table.id, { chaises: Math.max(0, chaisesDe(table) - 1) })}>
                  <Minus className="icone" size={20} aria-hidden="true" />
                </button>
                <span>
                  {chaisesDe(table)} chaise{chaisesDe(table) > 1 ? "s" : ""}
                </span>
                <button className="bouton" aria-label="Une chaise de plus" onClick={() => majTable(table.id, { chaises: Math.min(20, chaisesDe(table) + 1) })}>
                  <Plus className="icone" size={20} aria-hidden="true" />
                </button>
              </div>
              <div className="options">
                {formeDe(table) === "rectangle" && (
                  <button className="bouton" onClick={() => majTable(table.id, { rotation: table.rotation === 90 ? 0 : 90 })}>
                    <AvecIcone icone={RotateCw}>Tourner</AvecIcone>
                  </button>
                )}
                <button className="bouton" onClick={() => ajouterTable(formeDe(table), table)}>
                  <AvecIcone icone={Copy}>Dupliquer</AvecIcone>
                </button>
                <button
                  className="bouton"
                  onClick={() => {
                    majTable(table.id, { masquee: true });
                    setSelection(null);
                  }}
                >
                  <AvecIcone icone={EyeOff}>Masquer</AvecIcone>
                </button>
              </div>
              <p className="aide-champ">Glissez la table sur le plan ; elle se cale tous les 25 cm.</p>
            </>
          ) : decor ? (
            <>
              <h3>{DECORS.find(([t]) => t === decor.type)![1]}</h3>
              {decor.type !== "mur" && (
                <label className="champ">
                  <span>Libellé</span>
                  <input value={decor.libelle ?? ""} maxLength={30} placeholder={DECORS.find(([t]) => t === decor.type)![1]} onChange={(e) => majDecor(decor.id, { libelle: e.target.value || undefined })} />
                </label>
              )}
              {(["largeur", "hauteur"] as const).map((cote) => (
                <div key={cote} className="quantite" aria-label={cote === "largeur" ? "Largeur" : "Profondeur"}>
                  <button className="bouton" aria-label={`${cote === "largeur" ? "Largeur" : "Profondeur"} : moins`} onClick={() => majDecor(decor.id, { [cote]: Math.max(1, decor[cote] - 1) })}>
                    <Minus className="icone" size={20} aria-hidden="true" />
                  </button>
                  <span>
                    {cote === "largeur" ? "Largeur" : "Profondeur"} {metres(decor[cote])}
                  </span>
                  <button className="bouton" aria-label={`${cote === "largeur" ? "Largeur" : "Profondeur"} : plus`} onClick={() => majDecor(decor.id, { [cote]: Math.min(200, decor[cote] + 1) })}>
                    <Plus className="icone" size={20} aria-hidden="true" />
                  </button>
                </div>
              ))}
              <div className="options">
                <button className="bouton" onClick={() => majDecor(decor.id, { largeur: decor.hauteur, hauteur: decor.largeur })}>
                  <AvecIcone icone={RotateCw}>Tourner</AvecIcone>
                </button>
                <button
                  className="bouton danger"
                  onClick={() => {
                    majZone({ decor: zone.decor.filter((d) => d.id !== decor.id) });
                    setSelection(null);
                  }}
                >
                  <AvecIcone icone={Trash2}>Retirer</AvecIcone>
                </button>
              </div>
            </>
          ) : (
            <>
              <h3>Zone {zone.nom}</h3>
              <label className="champ">
                <span>Nom</span>
                <input value={zone.nom} maxLength={40} onChange={(e) => renommerZone(e.target.value)} />
              </label>
              {(["largeur", "hauteur"] as const).map((cote) => (
                <label key={cote} className="champ">
                  <span>{cote === "largeur" ? "Largeur (m)" : "Profondeur (m)"}</span>
                  <input
                    type="number"
                    min={2}
                    max={50}
                    step={0.5}
                    value={(zone[cote] * CASE_CM) / 100}
                    onChange={(e) => majZone({ [cote]: Math.min(200, Math.max(8, Math.round((Number(e.target.value) * 100) / CASE_CM))) })}
                  />
                </label>
              ))}
              <p className="aide-champ">
                {placees.length} table{placees.length > 1 ? "s" : ""} · {placees.reduce((s, t) => s + chaisesDe(t), 0)} chaises. Touchez une table ou
                un repère pour le modifier.
              </p>
              {tables.every((t) => t.zone !== zone.nom) && zones.length > 1 && (
                <button
                  className="bouton danger"
                  onClick={() => {
                    setZones((l) => l.filter((z) => z.nom !== zone.nom));
                    setZoneNom(zones.find((z) => z.nom !== zone.nom)!.nom);
                  }}
                >
                  <AvecIcone icone={Trash2}>Supprimer la zone</AvecIcone>
                </button>
              )}
            </>
          )}
          {masquees.length > 0 && (
            <details className="tables-masquees">
              <summary>
                {masquees.length} table{masquees.length > 1 ? "s" : ""} masquée{masquees.length > 1 ? "s" : ""}
              </summary>
              {masquees.map((t) => (
                <button key={t.id} className="bouton discret" onClick={() => majTable(t.id, { masquee: false })}>
                  <AvecIcone icone={Eye}>{`Réafficher ${t.nom}`}</AvecIcone>
                </button>
              ))}
            </details>
          )}
        </aside>
      </div>
    </div>
  );
}
