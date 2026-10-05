const formatParis = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});

function partiesParis(d: Date): { date: string; heure: number } {
  const p = Object.fromEntries(formatParis.formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, heure: Number(p.hour) };
}

/** Date civile à Paris (AAAA-MM-JJ) d'un instant. */
export function dateParis(d: Date): string {
  return partiesParis(d).date;
}

/** Jour précédent / suivant d'une date AAAA-MM-JJ. */
export function decalerJour(date: string, jours: number): string {
  const [a, m, j] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(a, m - 1, j + jours)).toISOString().slice(0, 10);
}

/** Premier jour du mois qui suit un mois AAAA-MM. */
export function premierJourMoisSuivant(mois: string): string {
  const [a, m] = mois.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(a, m, 1)).toISOString().slice(0, 10);
}

/** Liste des mois AAAA-MM de `debut` à `fin` inclus. */
export function listeMois(debut: string, fin: string): string[] {
  const out: string[] = [];
  let m = debut;
  while (m <= fin && out.length < 36) {
    out.push(m);
    m = premierJourMoisSuivant(m).slice(0, 7);
  }
  return out;
}

/**
 * Date comptable d'une vente : la journée d'exploitation se termine à
 * `heureBascule` heure de Paris (par défaut 5 h). Une vente à 0 h 40 le samedi
 * appartient ainsi à la journée du vendredi. Calculé sur l'heure locale de
 * Paris, donc juste aux changements d'heure.
 */
export function dateComptable(d: Date, heureBascule = 5): string {
  const { date, heure } = partiesParis(d);
  return heure < heureBascule ? decalerJour(date, -1) : date;
}

export function estDateAAAAMMJJ(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}
