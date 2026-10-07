import type { FormeTable, Table, ZonePlan } from "@matalon/serveur/partage";

/**
 * Géométrie du plan de salle, en cases de grille (25 cm). La position d'une
 * table est le coin haut-gauche du plateau ; les chaises débordent autour,
 * d'une case environ. Partagé par l'éditeur (administration, iPad) et la caisse.
 */
/** Débord des chaises autour du plateau (chaise de 45 cm environ). */
export const MARGE_CHAISES = 1.5;
export const ZONE_PAR_DEFAUT = { largeur: 40, hauteur: 24 };

export const formeDe = (t: Table): FormeTable => t.forme ?? "carre";
export const chaisesDe = (t: Table): number => t.chaises ?? 4;

/** Plateau de la table (sans les chaises), rotation comprise. */
export function dimensions(t: Pick<Table, "forme" | "chaises" | "rotation">): { largeur: number; hauteur: number } {
  const n = t.chaises ?? 4;
  switch (t.forme ?? "carre") {
    case "rond": {
      const d = n <= 4 ? 3 : n <= 6 ? 4 : n <= 8 ? 5 : 6;
      return { largeur: d, hauteur: d };
    }
    case "carre": {
      const c = n <= 4 ? 3 : n <= 8 ? 4 : 5;
      return { largeur: c, hauteur: c };
    }
    case "rectangle": {
      // Chaises sur les deux grands côtés, environ 50 cm chacune.
      const long = Math.max(4, Math.ceil(n / 2) * 2 + 1);
      return t.rotation === 90 ? { largeur: 3, hauteur: long } : { largeur: long, hauteur: 3 };
    }
  }
}

/** Centre de chaque chaise, relatif au coin haut-gauche du plateau. */
export function chaises(t: Pick<Table, "forme" | "chaises" | "rotation">): Array<{ x: number; y: number }> {
  const n = t.chaises ?? 4;
  const { largeur, hauteur } = dimensions(t);
  const ecart = 0.9;
  if (n === 0) return [];
  if ((t.forme ?? "carre") === "rond") {
    const r = largeur / 2;
    return Array.from({ length: n }, (_, i) => {
      const a = (2 * Math.PI * i) / n - Math.PI / 2;
      return { x: r + Math.cos(a) * (r + ecart), y: r + Math.sin(a) * (r + ecart) };
    });
  }
  const repartir = (k: number, longueur: number) => Array.from({ length: k }, (_, i) => ((i + 1) * longueur) / (k + 1));
  if (t.forme === "rectangle") {
    const a = Math.ceil(n / 2);
    const b = n - a;
    const horizontal = t.rotation !== 90;
    const long = horizontal ? largeur : hauteur;
    const court = horizontal ? hauteur : largeur;
    const cotes = [
      ...repartir(a, long).map((p) => ({ p, q: -ecart })),
      ...repartir(b, long).map((p) => ({ p, q: court + ecart })),
    ];
    return cotes.map(({ p, q }) => (horizontal ? { x: p, y: q } : { x: q, y: p }));
  }
  // Carré : haut, bas, droite, gauche, tour à tour.
  const parCote = [0, 0, 0, 0];
  for (let i = 0; i < n; i++) parCote[i % 4]!++;
  const c = largeur;
  return [
    ...repartir(parCote[0]!, c).map((p) => ({ x: p, y: -ecart })),
    ...repartir(parCote[1]!, c).map((p) => ({ x: p, y: c + ecart })),
    ...repartir(parCote[2]!, c).map((p) => ({ x: c + ecart, y: p })),
    ...repartir(parCote[3]!, c).map((p) => ({ x: -ecart, y: p })),
  ];
}

interface Rect {
  x: number;
  y: number;
  largeur: number;
  hauteur: number;
}

/** Emprise au sol (plateau et chaises), pour les chevauchements. */
export function emprise(t: Table & { x: number; y: number }): Rect {
  const d = dimensions(t);
  const m = chaisesDe(t) ? MARGE_CHAISES : 0;
  return { x: t.x - m, y: t.y - m, largeur: d.largeur + 2 * m, hauteur: d.hauteur + 2 * m };
}

const chevauche = (a: Rect, b: Rect) =>
  a.x < b.x + b.largeur && b.x < a.x + a.largeur && a.y < b.y + b.hauteur && b.y < a.y + a.hauteur;

/** Zones du plan : celles enregistrées, puis celles que citent des tables sans zone dessinée. */
export function zonesDuPlan(zones: ZonePlan[] | undefined, tables: Table[]): ZonePlan[] {
  const liste = [...(zones ?? [])];
  for (const t of tables) {
    if (!liste.some((z) => z.nom === t.zone)) liste.push({ nom: t.zone, ...ZONE_PAR_DEFAUT, decor: [] });
  }
  return liste;
}

export type TablePlacee = Table & { x: number; y: number };

/**
 * Tables visibles d'une zone, toutes placées : celles sans position (tables
 * d'avant le plan, ou nouvelles) prennent la première place libre, ligne par ligne.
 */
export function placerTables(zone: ZonePlan, tables: Table[]): TablePlacee[] {
  const visibles = tables.filter((t) => t.zone === zone.nom && !t.masquee);
  const placees: TablePlacee[] = visibles.filter((t): t is TablePlacee => t.x !== undefined && t.y !== undefined);
  const resultat = new Map<string, TablePlacee>(placees.map((t) => [t.id, t]));
  for (const t of visibles) {
    if (resultat.has(t.id)) continue;
    const d = dimensions(t);
    let place: TablePlacee | null = null;
    // La zone peut s'allonger vers le bas si elle est pleine (voir hauteurUtile).
    for (let y = 1; !place && y <= 400; y++) {
      for (let x = 1; x + d.largeur + 1 <= zone.largeur; x++) {
        const essai = { ...t, x, y };
        const e = emprise(essai);
        const marge = { ...e, x: e.x - 1, y: e.y - 1, largeur: e.largeur + 2, hauteur: e.hauteur + 2 };
        if ([...resultat.values()].every((o) => !chevauche(marge, emprise(o)))) {
          place = essai;
          break;
        }
      }
    }
    resultat.set(t.id, place ?? { ...t, x: 1, y: 1 });
  }
  return visibles.map((t) => resultat.get(t.id)!);
}

/** Tables dont l'emprise en recouvre une autre (signalées dans l'éditeur, jamais bloquantes). */
export function chevauchements(tables: TablePlacee[]): Set<string> {
  const ids = new Set<string>();
  for (let i = 0; i < tables.length; i++) {
    for (let j = i + 1; j < tables.length; j++) {
      if (chevauche(emprise(tables[i]!), emprise(tables[j]!))) {
        ids.add(tables[i]!.id);
        ids.add(tables[j]!.id);
      }
    }
  }
  return ids;
}

/** Hauteur utile d'une zone : ses dimensions, agrandies si une table placée d'office déborde. */
export function hauteurUtile(zone: ZonePlan, tables: TablePlacee[]): number {
  return Math.max(zone.hauteur, ...tables.map((t) => emprise(t).y + emprise(t).hauteur + 1));
}

/** Nom proposé pour une nouvelle table : le numéro suivant. */
export function nomSuivant(tables: Table[]): string {
  const numeros = tables.map((t) => Number.parseInt(t.nom.replace(/^\D+/, ""), 10)).filter(Number.isFinite);
  let n = Math.max(0, ...numeros) + 1;
  while (tables.some((t) => t.nom === String(n))) n++;
  return String(n);
}
