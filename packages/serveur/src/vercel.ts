/**
 * Point d'entrée de la fonction Edge Vercel (région Paris).
 * DATABASE_URL est fournie par l'intégration Neon du projet Vercel.
 */
import { neon } from "@neondatabase/serverless";
import { traiter } from "./api.js";
import type { Db } from "./db.js";
import type { EnvoiCourriel } from "./reservations-serveur.js";

let db: Db | null = null;

function base(): Db {
  if (db) return db;
  const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!url) throw new Error("DATABASE_URL absente : reliez la base Neon au projet Vercel.");
  const sql = neon(url);
  db = {
    requete: async (texte, params = []) => (await sql.query(texte, params)) as never,
    lot: async (requetes) => {
      await sql.transaction(requetes.map((r) => sql.query(r.texte, r.params ?? [])));
    },
  };
  return db;
}

/**
 * E-mails par Resend : une seule clé pour le groupe, RESEND_API_KEY (secret, gardé dans Vercel).
 * Chaque établissement règle son adresse d'expédition dans l'administration (domaine vérifié
 * chez Resend) ; EMAIL_EXPEDITEUR, facultative, sert seulement d'adresse par défaut.
 * Sans clé, les réservations marchent sans e-mail.
 */
function courriel(): EnvoiCourriel | undefined {
  const cle = process.env.RESEND_API_KEY;
  if (!cle) return undefined;
  return async (c) => {
    const expediteur = c.de ?? process.env.EMAIL_EXPEDITEUR;
    if (!expediteur) throw new Error("aucune adresse d'expédition réglée pour l'établissement");
    // Nom affiché sans caractère qui casserait l'en-tête « Nom <adresse> ».
    const nom = c.deNom.replace(/[<>"\r\n]/g, "").trim();
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${cle}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: nom ? `"${nom}" <${expediteur}>` : expediteur,
        to: [c.a],
        ...(c.repondreA ? { reply_to: c.repondreA } : {}),
        subject: c.sujet,
        html: c.html,
        text: c.texte,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) {
      const detail = ((await r.json().catch(() => null)) as { message?: string } | null)?.message;
      throw new Error(`Resend ${r.status}${detail ? ` : ${detail}` : ""}`);
    }
  };
}

export default async function gestionnaire(requete: Request): Promise<Response> {
  try {
    const envoyerCourriel = courriel();
    return await traiter(requete, { db: base(), ...(envoyerCourriel ? { envoyerCourriel } : {}) });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ code: "CONFIGURATION", message: "Base de données indisponible." }), {
      status: 503,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
}
