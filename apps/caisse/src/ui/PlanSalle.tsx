import type { ElementDecor, ZonePlan } from "@matalon/serveur/partage";
import { useRef, useState, type PointerEvent as PointerEventReact } from "react";
import { chaises, dimensions, formeDe, hauteurUtile, type TablePlacee } from "../metier/plan";
import "./plan.css";

export type StatutTable = "libre" | "reservee" | "occupee" | "addition" | "jointe";

/** Ce que la salle affiche sur une table en service. */
export interface EtatTable {
  statut: StatutTable;
  /** Lignes sous le nom (total, durée, couverts / chaises). */
  lignes: string[];
  /** Plus de couverts que de chaises. */
  alerte?: boolean;
  /** Réservation qui arrive bientôt (libre : à garder ; occupée : à libérer). */
  imminente?: boolean;
  /** Libellé pour le lecteur d'écran (« Table 5, occupée, 24 € »). */
  description: string;
}

type Element = { type: "table" | "decor"; id: string };

interface Proprietes {
  zone: ZonePlan;
  tables: TablePlacee[];
  /** Service : état de chaque table ; un toucher ouvre la table. */
  etats?: Map<string, EtatTable>;
  onTable?: (id: string) => void;
  /** Tables assemblées : traits entre la table principale et ses tables jointes. */
  liens?: Array<[string, string]>;
  /** Édition : glisser-déposer calé sur la grille, sélection. */
  edition?: {
    selection: Element | null;
    enConflit: Set<string>;
    onChoisir: (e: Element | null) => void;
    onDeplacer: (e: Element, x: number, y: number) => void;
  };
  /** Agrandissement (1,5 ; 2…) : le plan déborde et défile ; absent : toute la largeur. */
  zoom?: number;
  /** Le plan tient dans son conteneur, en largeur comme en hauteur (salle de la caisse). */
  ajuste?: boolean;
}

const LIBELLES_DECOR: Record<ElementDecor["type"], string> = { bar: "Bar", porte: "Porte", mur: "" };

/** Plan d'une zone en SVG, en cases de 25 cm : sert à la caisse et à l'éditeur. */
export function PlanSalle(props: Proprietes) {
  const svg = useRef<SVGSVGElement>(null);
  const glisse = useRef<{ e: Element; dx: number; dy: number; x: number; y: number; bouge: boolean; pointeur: number } | null>(null);
  const [apercu, setApercu] = useState<{ e: Element; x: number; y: number } | null>(null);
  const largeur = props.zone.largeur;
  const hauteur = hauteurUtile(props.zone, props.tables);
  const edition = props.edition;

  const versCases = (ev: { clientX: number; clientY: number }) => {
    const s = svg.current!;
    const m = s.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };

  const position = (e: Element, x: number, y: number) => (apercu && apercu.e.id === e.id && apercu.e.type === e.type ? apercu : { x, y });

  const debut = (ev: PointerEventReact, e: Element, x: number, y: number) => {
    if (!edition) return;
    ev.stopPropagation();
    const p = versCases(ev);
    glisse.current = { e, dx: p.x - x, dy: p.y - y, x, y, bouge: false, pointeur: ev.pointerId };
    svg.current?.setPointerCapture(ev.pointerId);
    edition.onChoisir(e);
  };

  const dimensionsDe = (e: Element) => {
    if (e.type === "table") return dimensions(props.tables.find((t) => t.id === e.id)!);
    const d = props.zone.decor.find((x) => x.id === e.id)!;
    return { largeur: d.largeur, hauteur: d.hauteur };
  };

  const deplacement = (ev: PointerEventReact) => {
    const g = glisse.current;
    if (!g || g.pointeur !== ev.pointerId) return;
    const p = versCases(ev);
    const d = dimensionsDe(g.e);
    const x = Math.min(Math.max(0, Math.round(p.x - g.dx)), Math.max(0, largeur - d.largeur));
    const y = Math.min(Math.max(0, Math.round(p.y - g.dy)), Math.max(0, hauteur - d.hauteur));
    if (x === g.x && y === g.y) return;
    Object.assign(g, { x, y, bouge: true });
    setApercu({ e: g.e, x, y });
  };

  const fin = (ev: PointerEventReact) => {
    const g = glisse.current;
    if (!g || g.pointeur !== ev.pointerId) return;
    glisse.current = null;
    if (g.bouge) edition?.onDeplacer(g.e, g.x, g.y);
    setApercu(null);
  };

  const choisi = (e: Element) => edition?.selection?.type === e.type && edition.selection.id === e.id;
  const centre = (id: string) => {
    const t = props.tables.find((x) => x.id === id);
    if (!t) return null;
    const p = position({ type: "table", id }, t.x, t.y);
    const d = dimensions(t);
    return { x: p.x + d.largeur / 2, y: p.y + d.hauteur / 2 };
  };

  return (
    <svg
      ref={svg}
      className={`plan-salle${edition ? " edition" : ""}`}
      viewBox={`-1.5 -1.5 ${largeur + 3} ${hauteur + 3}`}
      width={`${(props.zoom ?? 1) * 100}%`}
      // Ajusté : le plan entier tient dans la place restante (largeur et hauteur), sans défiler.
      {...(props.ajuste && !(props.zoom && props.zoom > 1) ? { height: "100%" } : {})}
      role="group"
      aria-label={`Plan : ${props.zone.nom}`}
      onPointerMove={deplacement}
      onPointerUp={fin}
      onPointerCancel={fin}
      onPointerDown={() => edition?.onChoisir(null)}
    >
      <rect className="plan-sol" x={0} y={0} width={largeur} height={hauteur} rx={0.4} />
      {edition && (
        <g className="plan-grille" aria-hidden="true">
          {Array.from({ length: largeur + 1 }, (_, i) => (
            <line key={`v${i}`} x1={i} y1={0} x2={i} y2={hauteur} className={i % 4 === 0 ? "metre" : undefined} />
          ))}
          {Array.from({ length: hauteur + 1 }, (_, i) => (
            <line key={`h${i}`} x1={0} y1={i} x2={largeur} y2={i} className={i % 4 === 0 ? "metre" : undefined} />
          ))}
        </g>
      )}

      {props.zone.decor.map((d) => {
        const e: Element = { type: "decor", id: d.id };
        const p = position(e, d.x, d.y);
        const libelle = d.libelle ?? LIBELLES_DECOR[d.type];
        return (
          <g
            key={d.id}
            className={`plan-decor ${d.type}${choisi(e) ? " choisi" : ""}`}
            transform={`translate(${p.x} ${p.y})`}
            onPointerDown={(ev) => debut(ev, e, d.x, d.y)}
            {...(edition ? { role: "button", "aria-label": `${libelle || "Mur"} (décor)` } : { "aria-hidden": true })}
          >
            <rect width={d.largeur} height={d.hauteur} rx={d.type === "mur" ? 0 : 0.3} />
            {libelle && d.largeur >= 3 && d.hauteur >= 1 && (
              <text x={d.largeur / 2} y={d.hauteur / 2} className="plan-libelle-decor">
                {libelle}
              </text>
            )}
          </g>
        );
      })}

      {props.liens?.map(([a, b]) => {
        const p = centre(a);
        const q = centre(b);
        return p && q ? <line key={`${a}-${b}`} className="plan-lien" x1={p.x} y1={p.y} x2={q.x} y2={q.y} /> : null;
      })}

      {props.tables.map((t) => {
        const e: Element = { type: "table", id: t.id };
        const p = position(e, t.x, t.y);
        const d = dimensions(t);
        const etat = props.etats?.get(t.id);
        const classes = [
          "plan-table",
          etat?.statut ?? "libre",
          choisi(e) ? "choisi" : "",
          edition?.enConflit.has(t.id) ? "conflit" : "",
          etat?.alerte ? "alerte" : "",
          etat?.imminente ? "imminente" : "",
        ].join(" ");
        const lignes = etat?.lignes ?? [];
        const taille = Math.min(1.3, d.largeur / 2.6);
        // Nom et lignes centrés ensemble ; à trois lignes (suite à réclamer), tout se resserre pour tenir sur le plateau.
        const serre = lignes.length >= 3;
        const info = serre ? Math.min(0.56, taille * 0.5) : Math.min(0.68, taille * 0.6);
        const nom = serre ? taille * 0.82 : taille;
        const interligne = info * 1.1;
        const bloc = { nom, info, interligne, haut: d.hauteur / 2 - (nom + lignes.length * interligne) / 2 };
        return (
          <g
            key={t.id}
            className={classes}
            transform={`translate(${p.x} ${p.y})`}
            role="button"
            tabIndex={0}
            aria-label={etat?.description ?? `Table ${t.nom}`}
            onPointerDown={(ev) => debut(ev, e, t.x, t.y)}
            onClick={() => !edition && props.onTable?.(t.id)}
            onKeyDown={(ev) => {
              if (ev.key === "Enter" || ev.key === " ") {
                ev.preventDefault();
                if (edition) edition.onChoisir(e);
                else props.onTable?.(t.id);
              }
            }}
          >
            {chaises(t).map((c, i) => (
              <circle key={i} className="plan-chaise" cx={c.x} cy={c.y} r={0.55} />
            ))}
            {formeDe(t) === "rond" ? (
              <circle className="plan-plateau" cx={d.largeur / 2} cy={d.hauteur / 2} r={d.largeur / 2} />
            ) : (
              <rect className="plan-plateau" width={d.largeur} height={d.hauteur} rx={0.3} />
            )}
            <text className="plan-nom" x={d.largeur / 2} y={bloc.haut + bloc.nom / 2} fontSize={bloc.nom}>
              {t.nom}
            </text>
            {lignes.map((l, i) => (
              <text key={i} className="plan-info" x={d.largeur / 2} y={bloc.haut + bloc.nom + bloc.interligne * (i + 0.5)} fontSize={bloc.info}>
                {l}
              </text>
            ))}
          </g>
        );
      })}
    </svg>
  );
}
