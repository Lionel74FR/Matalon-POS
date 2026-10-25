import {
  Archive,
  Bell,
  BookOpen,
  CalendarCheck,
  ChartColumn,
  Check,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  Ellipsis,
  FileJson,
  Gift,
  House,
  KeyRound,
  LayoutGrid,
  LogOut,
  Monitor,
  Moon,
  NotebookPen,
  Package,
  Plus,
  Printer,
  ReceiptText,
  Store,
  Sun,
  TabletSmartphone,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { EtablissementAdmin } from "./api";

/**
 * Coque de l'administration (refonte du 25 octobre 2026, maquette validée par Lionel) : barre du
 * haut (établissement, alertes, compte), menu latéral par intention en quatre familles, réductible
 * en icônes, et barre d'onglets en bas sur iPhone. Le contenu de chaque rubrique est ailleurs.
 */

export type Rubrique =
  | "accueil"
  | "statistiques"
  | "tickets"
  | "clotures"
  | "alertes"
  | "reservations"
  | "stock"
  | "comptes"
  | "fidelite"
  | "cartes"
  | "identite"
  | "equipe"
  | "plan"
  | "appareils"
  | "imprimantes";

export interface DefRubrique {
  id: Rubrique;
  libelle: string;
  icone: LucideIcon;
  /** Infobulle du menu (l'ancien sous-titre). */
  aide: string;
  /** Commune au groupe : la portée se lit dans le menu. */
  groupe?: boolean;
}

export const ACCUEIL: DefRubrique = { id: "accueil", libelle: "Aujourd'hui", icone: House, aide: "Indicateurs du jour, alertes, points à faire" };

export const FAMILLES: Array<{ nom: string; liste: DefRubrique[] }> = [
  {
    nom: "Piloter",
    liste: [
      { id: "statistiques", libelle: "Statistiques", icone: ChartColumn, aide: "CA en direct, articles, équipe" },
      { id: "tickets", libelle: "Tickets", icone: ReceiptText, aide: "Par serveur, détail de chaque ticket" },
      { id: "clotures", libelle: "Clôtures", icone: Archive, aide: "Z, exports comptables, archives" },
      { id: "alertes", libelle: "Alertes", icone: Bell, aide: "Prix, articles hors carte, codes PIN" },
    ],
  },
  {
    nom: "Exploiter",
    liste: [
      { id: "reservations", libelle: "Réservations", icone: CalendarCheck, aide: "À venir, services, module du site" },
      { id: "stock", libelle: "Stock et recettes", icone: Package, aide: "Produits, fiches, food cost" },
      { id: "comptes", libelle: "Comptes clients", icone: NotebookPen, aide: "Ventes en compte, règlements" },
      { id: "fidelite", libelle: "Fidélité", icone: Gift, aide: "Programme, récompenses, membres" },
    ],
  },
  {
    nom: "Carte",
    liste: [{ id: "cartes", libelle: "Cartes et prix", icone: BookOpen, aide: "Communes au groupe", groupe: true }],
  },
  {
    nom: "Réglages",
    liste: [
      { id: "identite", libelle: "Établissement", icone: Store, aide: "Identité légale, carte, note, logo" },
      { id: "equipe", libelle: "Équipe", icone: Users, aide: "Personnes, rôles, codes PIN" },
      { id: "plan", libelle: "Plan de salle", icone: LayoutGrid, aide: "Zones, tables, chaises" },
      { id: "appareils", libelle: "Appareils", icone: TabletSmartphone, aide: "iPad et iPhone rattachés, contrôles" },
      { id: "imprimantes", libelle: "Imprimantes", icone: Printer, aide: "Tickets, bar et cuisine" },
    ],
  },
];

export const TOUTES_RUBRIQUES: DefRubrique[] = [ACCUEIL, ...FAMILLES.flatMap((f) => f.liste)];
export const defRubrique = (id: Rubrique) => TOUTES_RUBRIQUES.find((r) => r.id === id)!;

/** Onglets du bas sur iPhone ; « Plus » ouvre toutes les rubriques. */
const ONGLETS_MOBILE: Rubrique[] = ["accueil", "statistiques", "reservations", "stock"];

/** Signal d'une rubrique dans le menu : un nombre (alertes) ou un point (à regarder). */
export type Signal = { nombre: number; libelle: string } | { point: "attention" | "danger"; libelle: string } | null;

// ───────── Thème ─────────

export type Theme = "clair" | "sombre" | "systeme";
const CLE_THEME = "matalon-admin-theme";

/** Thème clair par défaut (décision de Lionel du 25 octobre) ; sombre ou réglage du système au choix. */
export function themeEnregistre(): Theme {
  try {
    const t = localStorage.getItem(CLE_THEME);
    return t === "sombre" || t === "systeme" ? t : "clair";
  } catch {
    return "clair";
  }
}

export function appliquerTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(themeEnregistre);
  const choisir = (t: Theme) => {
    setTheme(t);
    appliquerTheme(t);
    try {
      localStorage.setItem(CLE_THEME, t);
    } catch {
      /* navigation privée : le choix vaut pour cette page */
    }
  };
  return [theme, choisir];
}

// ───────── Menu réduit ─────────

const CLE_REDUIT = "matalon-admin-menu-reduit";
export function useMenuReduit(): [boolean, () => void] {
  const [reduit, setReduit] = useState(() => {
    try {
      return localStorage.getItem(CLE_REDUIT) === "1";
    } catch {
      return false;
    }
  });
  const basculer = () =>
    setReduit((r) => {
      try {
        localStorage.setItem(CLE_REDUIT, r ? "0" : "1");
      } catch {
        /* sans stockage, le choix vaut pour cette page */
      }
      return !r;
    });
  return [reduit, basculer];
}

// ───────── Menus déroulants ─────────

/** Ferme un menu ouvert sur un clic ailleurs ou sur Échap, et rend le focus à son bouton. */
function useMenuOuvert(): [boolean, (o: boolean) => void, RefObject<HTMLDivElement>, RefObject<HTMLButtonElement>] {
  const [ouvert, setOuvert] = useState(false);
  const zone = useRef<HTMLDivElement>(null);
  const bouton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!ouvert) return;
    const clic = (e: MouseEvent) => {
      if (zone.current && !zone.current.contains(e.target as Node)) setOuvert(false);
    };
    const touche = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOuvert(false);
        bouton.current?.focus();
      }
    };
    document.addEventListener("mousedown", clic);
    document.addEventListener("keydown", touche);
    return () => {
      document.removeEventListener("mousedown", clic);
      document.removeEventListener("keydown", touche);
    };
  }, [ouvert]);
  return [ouvert, setOuvert, zone, bouton];
}

const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? "s" : ""}`;
const ville = (e: EtablissementAdmin) => e.identite.codePostalVille?.replace(/^\s*\d{4,5}\s*/, "").trim() ?? "";
const resumeEtab = (e: EtablissementAdmin) => {
  const actifs = e.caisses.filter((c) => !c.revoqueeLe).length;
  return [ville(e), pluriel(actifs, "appareil")].filter(Boolean).join(" · ");
};

/** Sélecteur d'établissement : un vrai menu, chaque établissement avec sa ville et ses appareils. */
export function MenuEtablissement(props: { etablissements: EtablissementAdmin[]; choisi: string | null; onChoisir: (id: string) => void }) {
  const [ouvert, setOuvert, zone, bouton] = useMenuOuvert();
  const actuel = props.etablissements.find((e) => e.id === props.choisi);
  return (
    <div className="coque-deroulant" ref={zone}>
      <button
        ref={bouton}
        type="button"
        className="coque-etab"
        aria-haspopup="menu"
        aria-expanded={ouvert}
        aria-label={`Établissement : ${actuel?.identite.enseigne ?? "nouvel établissement"}. Changer d'établissement`}
        onClick={() => setOuvert(!ouvert)}
      >
        <Store className="icone" size={18} aria-hidden="true" />
        <span className="coque-etab-texte">
          <strong>{actuel?.identite.enseigne ?? "Nouvel établissement"}</strong>
          {actuel && <small>{resumeEtab(actuel)}</small>}
        </span>
        <ChevronDown className="icone" size={16} aria-hidden="true" />
      </button>
      {ouvert && (
        <div className="coque-menu-flottant" role="menu" aria-label="Établissements">
          {props.etablissements.map((e) => (
            <button
              key={e.id}
              type="button"
              role="menuitemradio"
              aria-checked={e.id === props.choisi}
              className="coque-menu-item"
              onClick={() => {
                setOuvert(false);
                props.onChoisir(e.id);
              }}
            >
              <span className="coque-menu-item-texte">
                <strong>{e.identite.enseigne}</strong>
                <small>
                  {resumeEtab(e)}
                  {e.alertesNonVues ? ` · ${pluriel(e.alertesNonVues, "alerte")}` : ""}
                </small>
              </span>
              {e.id === props.choisi && <Check className="icone" size={18} aria-hidden="true" />}
            </button>
          ))}
          <hr />
          <button
            type="button"
            role="menuitem"
            className="coque-menu-item"
            onClick={() => {
              setOuvert(false);
              props.onChoisir("nouveau");
            }}
          >
            <Plus className="icone" size={18} aria-hidden="true" />
            <span className="coque-menu-item-texte">Nouvel établissement</span>
          </button>
        </div>
      )}
    </div>
  );
}

const THEMES: Array<{ id: Theme; libelle: string; icone: LucideIcon }> = [
  { id: "clair", libelle: "Clair", icone: Sun },
  { id: "sombre", libelle: "Sombre", icone: Moon },
  { id: "systeme", libelle: "Comme l'appareil", icone: Monitor },
];

/** Menu du compte : thème, clés d'accès, configuration de l'installation, déconnexion. */
export function MenuCompte(props: {
  identifiant: string;
  theme: Theme;
  onTheme: (t: Theme) => void;
  onCles: () => void;
  onConfiguration: () => void;
  onDeconnexion: () => void;
}) {
  const [ouvert, setOuvert, zone, bouton] = useMenuOuvert();
  const initiales = props.identifiant.replace(/[^a-zA-ZÀ-ÿ0-9]/g, "").slice(0, 2).toUpperCase() || "?";
  const item = (libelle: string, icone: LucideIcon, action: () => void) => {
    const Icone = icone;
    return (
      <button
        type="button"
        role="menuitem"
        className="coque-menu-item"
        onClick={() => {
          setOuvert(false);
          action();
        }}
      >
        <Icone className="icone" size={18} aria-hidden="true" />
        <span className="coque-menu-item-texte">{libelle}</span>
      </button>
    );
  };
  return (
    <div className="coque-deroulant droite" ref={zone}>
      <button
        ref={bouton}
        type="button"
        className="coque-avatar"
        aria-haspopup="menu"
        aria-expanded={ouvert}
        aria-label={`Compte ${props.identifiant} : thème, clés d'accès, configuration, déconnexion`}
        title={props.identifiant}
        onClick={() => setOuvert(!ouvert)}
      >
        {initiales}
      </button>
      {ouvert && (
        <div className="coque-menu-flottant" role="menu" aria-label="Compte">
          <p className="coque-menu-titre">{props.identifiant}</p>
          <div role="group" aria-label="Thème" className="coque-themes">
            {THEMES.map((t) => {
              const Icone = t.icone;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={props.theme === t.id}
                  className="coque-theme"
                  onClick={() => props.onTheme(t.id)}
                >
                  <Icone className="icone" size={16} aria-hidden="true" />
                  {t.libelle}
                </button>
              );
            })}
          </div>
          <hr />
          {item("Clés d'accès", KeyRound, props.onCles)}
          {item("Configuration de l'installation", FileJson, props.onConfiguration)}
          <hr />
          {item("Se déconnecter", LogOut, props.onDeconnexion)}
        </div>
      )}
    </div>
  );
}

/** Lien d'une rubrique : un vrai lien (adresse #/moka/stock), ouvrable dans un autre onglet. */
function LienRubrique(props: {
  r: DefRubrique;
  etab: string;
  actif: boolean;
  signal: Signal;
  reduit?: boolean;
  onAller: (r: Rubrique) => void;
}) {
  const { r, signal } = props;
  const Icone = r.icone;
  return (
    <a
      href={`#/${props.etab}/${r.id}`}
      className={`coque-lien${props.actif ? " actif" : ""}`}
      aria-current={props.actif ? "page" : undefined}
      // Le signal (alertes à lire, point d'attention) se lit dans la description, pas dans le nom du lien.
      title={[props.reduit ? r.libelle : "", signal?.libelle ?? r.aide].filter(Boolean).join(" · ")}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        props.onAller(r.id);
      }}
    >
      <Icone className="icone" size={18} aria-hidden="true" />
      <span className="coque-lien-texte">{r.libelle}</span>
      {r.groupe && !props.reduit && <span className="coque-portee" aria-hidden="true">Groupe</span>}
      {signal && "nombre" in signal && (
        <span className="coque-nombre" aria-hidden="true">
          {signal.nombre}
        </span>
      )}
      {signal && "point" in signal && <span className={`coque-point ${signal.point}`} aria-hidden="true" />}
    </a>
  );
}

/** Menu latéral : Aujourd'hui, puis les quatre familles ; réductible en icônes. */
export function MenuLateral(props: {
  etab: EtablissementAdmin;
  rubrique: Rubrique;
  reduit: boolean;
  onReduire: () => void;
  signal: (r: Rubrique) => Signal;
  onAller: (r: Rubrique) => void;
}) {
  const lien = (r: DefRubrique) => (
    <LienRubrique key={r.id} r={r} etab={props.etab.id} actif={props.rubrique === r.id} signal={props.signal(r.id)} reduit={props.reduit} onAller={props.onAller} />
  );
  return (
    <div className="coque-menu-colonne">
    <nav className="coque-menu" aria-label={`Rubriques de ${props.etab.identite.enseigne}`}>
      {lien(ACCUEIL)}
      {FAMILLES.map((f) => (
        <div key={f.nom} className="coque-famille" role="group" aria-label={f.nom}>
          <p className="coque-famille-nom" aria-hidden="true">
            {f.nom}
          </p>
          {f.liste.map(lien)}
        </div>
      ))}
      <button type="button" className="coque-reduire" onClick={props.onReduire} aria-label={props.reduit ? "Déplier le menu" : "Réduire le menu"} title={props.reduit ? "Déplier le menu" : "Réduire le menu"}>
        {props.reduit ? <ChevronsRight className="icone" size={18} aria-hidden="true" /> : <ChevronsLeft className="icone" size={18} aria-hidden="true" />}
        <span className="coque-lien-texte">Réduire le menu</span>
      </button>
    </nav>
    </div>
  );
}

/** Barre d'onglets en bas de l'écran sur iPhone ; « Plus » ouvre une feuille avec toutes les rubriques. */
export function OngletsMobile(props: { etab: EtablissementAdmin; rubrique: Rubrique; signal: (r: Rubrique) => Signal; onAller: (r: Rubrique) => void }) {
  const [plus, setPlus] = useState(false);
  const dansOnglets = ONGLETS_MOBILE.includes(props.rubrique);
  useEffect(() => {
    if (!plus) return;
    const touche = (e: KeyboardEvent) => e.key === "Escape" && setPlus(false);
    document.addEventListener("keydown", touche);
    return () => document.removeEventListener("keydown", touche);
  }, [plus]);
  const aller = (r: Rubrique) => {
    setPlus(false);
    props.onAller(r);
  };
  const libelleCourt: Partial<Record<Rubrique, string>> = { statistiques: "Stats", stock: "Stock" };
  return (
    <>
      <nav className="coque-onglets" aria-label="Navigation principale">
        {ONGLETS_MOBILE.map((id) => {
          const r = defRubrique(id);
          const Icone = r.icone;
          const s = props.signal(id);
          return (
            <a
              key={id}
              href={`#/${props.etab.id}/${id}`}
              className="coque-onglet"
              aria-current={props.rubrique === id ? "page" : undefined}
              onClick={(e) => {
                e.preventDefault();
                aller(id);
              }}
            >
              <span className="coque-onglet-icone">
                <Icone className="icone" size={22} aria-hidden="true" />
                {s && <span className={`coque-point ${"point" in s ? s.point : "danger"}`} aria-hidden="true" />}
              </span>
              {libelleCourt[id] ?? r.libelle}
            </a>
          );
        })}
        <button type="button" className="coque-onglet" aria-current={!dansOnglets ? "page" : undefined} aria-expanded={plus} onClick={() => setPlus(true)}>
          <span className="coque-onglet-icone">
            <Ellipsis className="icone" size={22} aria-hidden="true" />
          </span>
          Plus
        </button>
      </nav>
      {plus && (
        <div className="coque-feuille-voile" onClick={(e) => e.target === e.currentTarget && setPlus(false)}>
          <div className="coque-feuille" role="dialog" aria-modal="true" aria-label="Toutes les rubriques">
            <div className="coque-feuille-tete">
              <strong>{props.etab.identite.enseigne}</strong>
              <button type="button" className="coque-icone" aria-label="Fermer" onClick={() => setPlus(false)}>
                <X className="icone" size={20} aria-hidden="true" />
              </button>
            </div>
            {FAMILLES.map((f) => (
              <div key={f.nom} className="coque-famille" role="group" aria-label={f.nom}>
                <p className="coque-famille-nom" aria-hidden="true">
                  {f.nom}
                </p>
                {f.liste.map((r) => (
                  <LienRubrique key={r.id} r={r} etab={props.etab.id} actif={props.rubrique === r.id} signal={props.signal(r.id)} onAller={aller} />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/** Cloche de la barre du haut : le nombre d'alertes à lire, ouvre la rubrique Alertes. */
export function BoutonAlertes(props: { nombre: number; onOuvrir: () => void }) {
  const libelle = props.nombre ? `Alertes : ${pluriel(props.nombre, "alerte")} à lire` : "Alertes : aucune à lire";
  return (
    <button type="button" className="coque-icone coque-cloche" aria-label={libelle} title={libelle} onClick={props.onOuvrir}>
      <Bell className="icone" size={20} aria-hidden="true" />
      {props.nombre > 0 && (
        <span className="coque-nombre" aria-hidden="true">
          {props.nombre}
        </span>
      )}
    </button>
  );
}

export function Marque(): ReactNode {
  return (
    <div className="coque-marque">
      <img src="/icone.svg" alt="" width={32} height={32} />
      <span>Matalon POS</span>
    </div>
  );
}
