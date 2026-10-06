import { deflateSync, inflateSync, strFromU8, strToU8 } from "fflate";
import { MODES_PAIEMENT, type ModePaiement, type Ticket } from "@matalon/noyau-fiscal";

/**
 * Note numérique : la note client voyage entière dans le fragment d'URL du
 * QR code (`https://<caisse>/n#<données>`). Le fragment n'est jamais envoyé
 * au serveur : aucune donnée stockée, aucune donnée personnelle collectée.
 * La page /n décode et affiche la note sur le téléphone du client.
 */
export interface NoteNumerique {
  v: 1;
  /** Caisse de test : note sans valeur. */
  x: boolean;
  /** Enseigne, raison sociale, adresse, code postal et ville, téléphone, SIRET, n° de TVA. */
  e: [string, string, string, string, string, string, string];
  c: string;
  n: number;
  k: "V" | "A";
  /** Ticket annulé (annulation). */
  o: number | null;
  m: string | null;
  d: string;
  tb: string;
  cv: number | null;
  s: string;
  /** Quantité, libellé, prix unitaire TTC, taux TVA, remise TTC, motif de remise. */
  l: Array<[number, string, number, number, number, string | null]>;
  p: Array<[ModePaiement, number]>;
  r: number;
  tt: number;
  /** Début de l'empreinte du ticket. */
  h: string;
  ver: string;
  /** 0 pour l'original, n pour le duplicata n. */
  dup: number;
}

export interface ContexteNote {
  etablissement: { enseigne: string; raisonSociale: string; adresse: string; codePostalVille: string; telephone: string; siret: string; tvaIntracom: string };
  caisseId: string;
  table: string;
  serveur: string;
  test: boolean;
  duplicata?: number;
}

export function noteDepuisTicket(t: Ticket, ctx: ContexteNote): NoteNumerique {
  const e = ctx.etablissement;
  return {
    v: 1,
    x: ctx.test,
    e: [e.enseigne, e.raisonSociale, e.adresse, e.codePostalVille, e.telephone, e.siret, e.tvaIntracom],
    c: ctx.caisseId,
    n: t.numero,
    k: t.type === "VENTE" ? "V" : "A",
    o: t.ticketOrigine?.numero ?? null,
    m: t.motif,
    d: t.horodatage,
    tb: ctx.table,
    cv: t.couverts,
    s: ctx.serveur,
    l: t.lignes.map((l) => [l.quantite, l.libelle, l.prixUnitaireTTC, l.tauxTVA, l.remiseTTC, l.motifRemise]),
    p: t.paiements.map((p) => [p.mode, p.montant]),
    r: t.renduMonnaie,
    tt: t.totalTTC,
    h: t.hash.slice(0, 24),
    ver: t.versionLogiciel,
    dup: ctx.duplicata ?? 0,
  };
}

function versBase64Url(octets: Uint8Array): string {
  let s = "";
  for (const b of octets) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function depuisBase64Url(texte: string): Uint8Array {
  const b64 = texte.replace(/-/g, "+").replace(/_/g, "/");
  const s = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function encoderNote(note: NoteNumerique): string {
  return versBase64Url(deflateSync(strToU8(JSON.stringify(note)), { level: 9 }));
}

export class NoteIllisible extends Error {}

export function decoderNote(fragment: string): NoteNumerique {
  let brut: unknown;
  try {
    brut = JSON.parse(strFromU8(inflateSync(depuisBase64Url(fragment.replace(/^#/, "")))));
  } catch {
    throw new NoteIllisible("Ce lien de note est incomplet ou abîmé.");
  }
  const n = brut as NoteNumerique;
  const entier = (x: unknown) => typeof x === "number" && Number.isSafeInteger(x);
  const valide =
    n?.v === 1 &&
    Array.isArray(n.e) &&
    n.e.length === 7 &&
    entier(n.n) &&
    (n.k === "V" || n.k === "A") &&
    typeof n.d === "string" &&
    Array.isArray(n.l) &&
    n.l.every((l) => Array.isArray(l) && entier(l[0]) && typeof l[1] === "string" && entier(l[2]) && entier(l[3]) && entier(l[4])) &&
    Array.isArray(n.p) &&
    n.p.every((p) => Array.isArray(p) && MODES_PAIEMENT.includes(p[0]) && entier(p[1])) &&
    entier(n.tt) &&
    entier(n.r);
  if (!valide) throw new NoteIllisible("Ce lien ne contient pas une note de caisse valide.");
  return n;
}

/** Adresse complète à mettre dans le QR code. */
export function urlNote(origine: string, note: NoteNumerique): string {
  return `${origine}/n#${encoderNote(note)}`;
}
