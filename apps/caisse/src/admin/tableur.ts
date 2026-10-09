import { lireTableau } from "@matalon/stock";
import { unzipSync, strFromU8 } from "fflate";

/**
 * Lit un fichier de tableur en lignes de cellules texte : CSV ou TXT
 * (séparateur détecté), ou classeur Excel .xlsx (première feuille). Les
 * nombres d'Excel arrivent avec un point décimal, que l'import accepte.
 */
export async function lireFichierTableau(fichier: File): Promise<string[][]> {
  if (/\.xlsx$/i.test(fichier.name)) return lireXlsx(new Uint8Array(await fichier.arrayBuffer()));
  if (/\.xls$/i.test(fichier.name)) throw new Error("Ancien format Excel (.xls) : enregistrez le fichier en .xlsx ou en CSV.");
  const octets = new Uint8Array(await fichier.arrayBuffer());
  // Excel enregistre souvent ses CSV en Windows-1252 : repli si l'UTF-8 est invalide.
  let texte: string;
  try {
    texte = new TextDecoder("utf-8", { fatal: true }).decode(octets);
  } catch {
    texte = new TextDecoder("windows-1252").decode(octets);
  }
  return lireTableau(texte);
}

const XML = (s: string) => new DOMParser().parseFromString(s, "application/xml");
const elements = (n: Document | Element, nom: string) => [...n.getElementsByTagNameNS("*", nom)];

/** Indice de colonne d'une référence de cellule (« C12 » → 2). */
function colonne(ref: string): number {
  const lettres = /^[A-Z]+/.exec(ref)?.[0] ?? "A";
  return [...lettres].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
}

export function lireXlsx(octets: Uint8Array): string[][] {
  let fichiers: Record<string, Uint8Array>;
  try {
    fichiers = unzipSync(octets);
  } catch {
    throw new Error("Classeur Excel illisible.");
  }
  const texte = (chemin: string) => (fichiers[chemin] ? strFromU8(fichiers[chemin]!) : null);
  const partages = texte("xl/sharedStrings.xml");
  const chaines = partages ? elements(XML(partages), "si").map((si) => elements(si, "t").map((t) => t.textContent ?? "").join("")) : [];
  // Première feuille du classeur, d'après workbook.xml et ses relations.
  let feuille = "xl/worksheets/sheet1.xml";
  const classeur = texte("xl/workbook.xml");
  const relations = texte("xl/_rels/workbook.xml.rels");
  if (classeur && relations) {
    const premiere = elements(XML(classeur), "sheet")[0];
    const rid = premiere?.getAttribute("r:id") ?? premiere?.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    const cible = elements(XML(relations), "Relationship").find((r) => r.getAttribute("Id") === rid)?.getAttribute("Target");
    if (cible) feuille = cible.startsWith("/") ? cible.slice(1) : `xl/${cible.replace(/^\.\//, "")}`;
  }
  const contenu = texte(feuille);
  if (!contenu) throw new Error("Aucune feuille trouvée dans le classeur.");
  const lignes: string[][] = [];
  for (const row of elements(XML(contenu), "row")) {
    const ligne: string[] = [];
    for (const c of elements(row, "c")) {
      const type = c.getAttribute("t");
      const v = elements(c, "v")[0]?.textContent ?? "";
      const valeur =
        type === "s" ? (chaines[Number(v)] ?? "") : type === "inlineStr" ? elements(c, "t").map((t) => t.textContent ?? "").join("") : type === "b" ? (v === "1" ? "VRAI" : "FAUX") : v;
      ligne[colonne(c.getAttribute("r") ?? "A")] = valeur;
    }
    lignes.push(Array.from(ligne, (x) => x ?? ""));
  }
  return lignes.filter((l) => l.some((x) => x.trim() !== ""));
}
