/**
 * Point d'entrée de la fonction Edge Vercel (région Paris).
 * DATABASE_URL est fournie par l'intégration Neon du projet Vercel.
 */
import { neon } from "@neondatabase/serverless";
import { traiter } from "./api.js";
import type { Db } from "./db.js";

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

export default async function gestionnaire(requete: Request): Promise<Response> {
  try {
    return await traiter(requete, { db: base() });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ code: "CONFIGURATION", message: "Base de données indisponible." }), {
      status: 503,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
}
