import type { Db } from "./db.js";
import { CONSERVATION_MEMBRE_JOURS } from "./fidelite.js";
import type { EtablissementApi } from "./partage.js";
import { CONSERVATION_JOURS, echapper, lireReglages } from "./reservations-serveur.js";

/**
 * Information des clients sur leurs données personnelles (RGPD, articles 13 et 14) : une page
 * publique par établissement, /donnees/<établissement>, citée là où des données sont recueillies
 * (compte client, carte de fidélité, réservation, note par e-mail). Le responsable du traitement
 * est la société qui exploite l'établissement ; la page reprend son identité et ses contacts.
 */
/** Date de la dernière modification du texte ci-dessous (à changer avec lui). */
const MISE_A_JOUR = "21 octobre 2026";

export async function pageDonnees(db: Db, etab: EtablissementApi): Promise<Response> {
  const i = etab.identite;
  const { reglages } = await lireReglages(db, etab.id);
  const [fid] = await db.requete<{ nom: string; actif: boolean }>(
    "select p.nom, p.actif from fidelite_programmes p join etablissements e on e.programme_fidelite = p.id where e.id = $1",
    [etab.id],
  );
  const contact = [reglages.email ? `par e-mail à <a href="mailto:${echapper(reglages.email)}">${echapper(reglages.email)}</a>` : "", i.telephone ? `par téléphone au ${echapper(i.telephone)}` : "", `par courrier : ${echapper(i.raisonSociale || i.enseigne)}, ${echapper(i.adresse)}, ${echapper(i.codePostalVille)}`]
    .filter(Boolean)
    .join(", ");
  const annees = (jours: number) => Math.round(jours / 365);
  const section = (titre: string, ...paragraphes: string[]) => `<section><h2>${titre}</h2>${paragraphes.map((p) => `<p>${p}</p>`).join("")}</section>`;
  const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Vos données personnelles · ${echapper(i.enseigne)}</title>
<style>
body{margin:0;background:#f4f1ec;color:#2b2420;font:16px/1.55 Helvetica,Arial,sans-serif}
main{max-width:720px;margin:0 auto;padding:32px 20px 48px}
h1{font-size:1.6rem;margin:0 0 6px}h2{font-size:1.1rem;margin:28px 0 6px}
p{margin:0 0 10px}small{color:#6b625b}a{color:#2b2420}
.entete{padding-bottom:16px;border-bottom:1px solid #ddd3c7}
</style></head><body><main>
<div class="entete"><h1>Vos données personnelles</h1><p>${echapper(i.enseigne)}${i.raisonSociale ? ` · ${echapper(i.raisonSociale)}` : ""} · ${echapper(i.adresse)}, ${echapper(i.codePostalVille)}</p></div>
${section(
  "Qui en est responsable",
  `${i.raisonSociale && i.raisonSociale !== i.enseigne ? `${echapper(i.raisonSociale)}, qui exploite ${echapper(i.enseigne)},` : echapper(i.enseigne)} est responsable des données décrites ici. Vous pouvez la joindre ${contact}.`,
)}
${section(
  "Achats et notes",
  "Un achat ne demande aucune donnée personnelle. Si vous demandez votre note par e-mail, votre adresse sert uniquement à cet envoi : elle n'est pas conservée.",
)}
${section(
  "Ventes en compte",
  "Si une consommation est portée à votre compte pour être réglée plus tard, nous enregistrons votre nom (et, si vous les donnez, votre téléphone et votre e-mail) pour suivre ce qui reste dû et vous le rappeler.",
  "Votre nom figure alors sur le ticket de la vente. Les tickets sont des enregistrements fiscaux inaltérables que la loi impose de conserver six ans (livre des procédures fiscales, article L102 B) : le nom ne peut pas en être retiré avant ce délai. Le reste de la fiche s'efface à votre demande une fois le compte soldé.",
)}
${section(
  "Réservations",
  `Pour une réservation, nous utilisons vos nom, téléphone, e-mail et commentaire pour la confirmer, vous prévenir en cas d'imprévu et vous accueillir. Ces données sont effacées ${CONSERVATION_JOURS === 365 ? "un an" : `${CONSERVATION_JOURS} jours`} après la date de la réservation. Les offres ne vous sont envoyées que si vous les avez demandées.`,
)}
${
  fid
    ? section(
        `Carte de fidélité${fid.nom ? ` · ${echapper(fid.nom)}` : ""}`,
        "Si vous adhérez au programme de fidélité, nous enregistrons votre téléphone et votre prénom (votre nom et votre e-mail si vous les donnez) ainsi que l'historique de vos points, pour faire fonctionner le programme : cumul, récompenses, e-mails de bienvenue et de récompense atteinte.",
        `Recevoir des offres demande votre accord, donné à part et retirable à tout moment. Vos coordonnées sont effacées à votre demande, ou d'office après ${annees(CONSERVATION_MEMBRE_JOURS)} ans sans visite ; l'historique des points reste alors sans nom.`,
      )
    : ""
}
${section(
  "Où sont vos données",
  "La base de données qui les conserve est hébergée dans l'Union européenne. Elles ne sont ni vendues ni cédées : seuls nos prestataires techniques les traitent, pour notre compte (hébergement de l'application et de la base de données, envoi des e-mails).",
)}
${section(
  "Vos droits",
  `Vous pouvez accéder à vos données, les faire corriger ou effacer, vous opposer à leur utilisation, en limiter l'usage ou en demander une copie : écrivez-nous (coordonnées ci-dessus). Si vous estimez que vos droits ne sont pas respectés, vous pouvez saisir la CNIL (<a href="https://www.cnil.fr">cnil.fr</a>).`,
)}
<p><small>Dernière mise à jour de cette page : ${MISE_A_JOUR}.</small></p>
</main></body></html>`;
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" } });
}
