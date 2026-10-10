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
 * E-mails des réservations par Brevo (API transactionnelle, données en UE) :
 * BREVO_CLE (clé API) et EMAIL_EXPEDITEUR (adresse d'un domaine vérifié chez Brevo).
 * Sans elles, les réservations marchent sans e-mail.
 */
function courriel(): EnvoiCourriel | undefined {
  const cle = process.env.BREVO_CLE;
  const expediteur = process.env.EMAIL_EXPEDITEUR;
  if (!cle || !expediteur) return undefined;
  return async (c) => {
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": cle, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        sender: { email: expediteur, name: c.deNom },
        to: [{ email: c.a, ...(c.nomA ? { name: c.nomA } : {}) }],
        ...(c.repondreA ? { replyTo: { email: c.repondreA } } : {}),
        subject: c.sujet,
        htmlContent: c.html,
        textContent: c.texte,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) throw new Error(`Brevo ${r.status}`);
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
