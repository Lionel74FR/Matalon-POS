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
 * E-mails des réservations par Resend (domaine moka-annecy.com déjà vérifié chez Resend, région UE) :
 * RESEND_API_KEY (clé API « re_… ») et EMAIL_EXPEDITEUR (adresse du domaine vérifié,
 * ex. reservations@moka-annecy.com). Sans elles, les réservations marchent sans e-mail.
 */
function courriel(): EnvoiCourriel | undefined {
  const cle = process.env.RESEND_API_KEY;
  const expediteur = process.env.EMAIL_EXPEDITEUR;
  if (!cle || !expediteur) return undefined;
  return async (c) => {
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
    if (!r.ok) throw new Error(`Resend ${r.status}`);
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
