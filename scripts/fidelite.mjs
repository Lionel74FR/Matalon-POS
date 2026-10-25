// Carte de fidélité, étape 7a (validée par Lionel le 21 octobre) : l'administration crée et règle le programme
// (1 point par euro, un cappuccino offert à 10 points, 10 € à 30 points, 5 points de bienvenue) ; l'iPad inscrit
// une cliente par son téléphone (e-mail de bienvenue), cumule à la réception du ticket, applique la récompense
// atteinte en remise « Fidélité » ; un ticket du jour vendu sans la carte se rattache depuis l'écran Tickets ;
// l'administration voit la fiche, l'historique, ajuste, et la carte « Fidélité » des statistiques ; l'iPhone ne déborde pas.
// Usage : serveur local vierge (apps/caisse : node scripts/serveur-local.mjs 4180), puis
//         URL=http://localhost:4180 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/fidelite.mjs [dossier-captures]
import { chromium } from "playwright";
import { preparerServeur, rubriqueAdmin } from "./preparer-caisse.mjs";

const URL = process.env.URL ?? "http://localhost:4180";
const sortie = process.argv[2] ?? "captures";
const { code, cookie, appel } = await preparerServeur(URL, "Comptoir");
const [nomCookie, valeurCookie] = cookie.split("=");
const erreurs = [];
const b = await chromium.launch();
const texte = async (loc) => ((await loc.textContent()) ?? "").replace(/[\s  ]+/g, " ").trim();
const r = {};
const attendre = async (condition, message, delai = 30000) => {
  const fin = Date.now() + delai;
  for (;;) {
    const v = await condition();
    if (v) return v;
    if (Date.now() > fin) throw new Error(`Délai dépassé : ${message}`);
    await new Promise((x) => setTimeout(x, 500));
  }
};

async function administration(nom, viewport) {
  const c = await b.newContext({ viewport, hasTouch: nom === "iphone" });
  await c.addCookies([{ name: nomCookie, value: valeurCookie, url: `${URL}/api/admin` }]);
  const a = await c.newPage();
  a.on("pageerror", (e) => erreurs.push(`${nom} : ${e.message}`));
  a.on("dialog", (d) => void d.accept());
  return a;
}

// ── Administration : créer et régler le programme ──
const a = await administration("admin", { width: 1280, height: 900 });
await a.goto(`${URL}/admin#/moka/fidelite`);
await a.getByRole("button", { name: "Créer le programme" }).click();
const editeur = a.locator(".fidelite-editeur");
await editeur.waitFor({ timeout: 15000 });
r.inactif = await texte(a.locator(".fidelite-entete .pastille"));
await editeur.getByLabel("Nom affiché au client").fill("Club Moka");
await editeur.getByLabel(/Programme actif/).check();
// Récompense proposée (10 € à 150 points) transformée en cappuccino offert à 10 points.
await editeur.getByLabel("Libellé de la récompense").first().fill("Un cappuccino offert");
await editeur.getByLabel("Un cappuccino offert : seuil").fill("10");
await editeur.getByLabel("Un cappuccino offert : type").selectOption("ARTICLE");
r.sansArticle = await texte(editeur.locator(".erreur").first());
await editeur.getByRole("group", { name: "Articles offerts : Un cappuccino offert" }).getByRole("checkbox", { name: "Cappuccino", exact: true }).check();
await editeur.getByRole("button", { name: "Ajouter une récompense" }).click();
await editeur.getByLabel("Libellé de la récompense").nth(1).fill("10 € offerts");
await editeur.getByLabel("10 € offerts : seuil").fill("30");
await editeur.getByLabel("10 € offerts : montant").fill("10");
await editeur.getByLabel(/^Bienvenue/).fill("5");
await a.screenshot({ path: `${sortie}/fi01-programme.png`, fullPage: true });
await editeur.getByRole("button", { name: "Enregistrer le programme" }).click();
await a.locator(".fidelite-admin .admin-ok").waitFor({ timeout: 10000 });
r.actif = await texte(a.locator(".fidelite-entete .pastille"));
const { programme } = await appel("GET", "/etablissements/moka/fidelite");
const solde = async () => (await appel("GET", `/fidelite/${programme.id}/membres`)).membres[0]?.solde ?? null;

// ── iPad ──
const ctx = await b.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true });
const p = await ctx.newPage();
p.on("pageerror", (e) => erreurs.push(`ipad : ${e.message}`));
const clic = (n) => p.getByRole("button", { name: n, exact: true }).first().click();
await p.goto(URL);
await p.locator(".champ-code input").fill(code);
await clic("Rattacher l'iPad");
await clic("Configurer plus tard");
await p.locator(".carte-personne", { hasText: "Lionel" }).click();
for (const x of "1234") await p.locator(".pave .touche", { hasText: new RegExp(`^${x}$`) }).last().click();
await clic("Plus tard");
await p.locator(".puce-synchro.synchronise").waitFor({ timeout: 20000 });
const cappuccino = () => p.locator(".tuile", { hasText: "Cappuccino" }).first().click();
const encaisser = async (mode) => {
  await clic("Encaisser");
  await p.locator(".mode", { hasText: mode }).click();
  await p.getByRole("button", { name: /^Valider l'encaissement/ }).click();
  await clic("Terminé");
};

// Vente 1 : deux cappuccinos, nouvelle cliente inscrite par son téléphone.
await clic("Vente Directe");
await cappuccino();
await cappuccino();
await p.getByRole("button", { name: "Carte de fidélité" }).click();
let fenetre = p.getByRole("dialog", { name: "Fidélité · Club Moka" });
await fenetre.getByLabel("Téléphone du client").fill("06 12 34 56 78");
await fenetre.getByRole("button", { name: "Chercher" }).click();
await fenetre.getByLabel("Prénom").fill("Marie");
await fenetre.getByRole("textbox", { name: /E-mail/ }).fill("marie@exemple.fr");
await p.screenshot({ path: `${sortie}/fi02-inscription.png` });
await fenetre.getByRole("button", { name: "Inscrire" }).click();
await fenetre.locator(".fidelite-membre").waitFor();
r.inscrite = await texte(fenetre.locator(".fidelite-membre"));
r.suite = await texte(fenetre.locator(".explication").first());
await fenetre.getByRole("button", { name: "Terminé" }).click();
r.puce = await texte(p.locator(".ticket-fidelite"));
await encaisser("Carte bancaire");
r.apresVente1 = await attendre(async () => ((await solde()) === 13 ? 13 : null), "points de la vente 1");

// Vente 2 : la récompense atteinte (cappuccino offert) s'applique d'un geste ; 10 € pas encore atteints.
await clic("Vente Directe");
await cappuccino();
await cappuccino();
await p.getByRole("button", { name: "Carte de fidélité" }).click();
fenetre = p.getByRole("dialog", { name: "Fidélité · Club Moka" });
await fenetre.getByLabel("Téléphone du client").fill("0612345678");
await fenetre.getByRole("button", { name: "Chercher" }).click();
await fenetre.locator(".fidelite-membre").waitFor();
r.retrouvee = await texte(fenetre.locator(".fidelite-membre"));
const recompenses = fenetre.getByRole("list", { name: "Récompenses" });
r.dixBloque = await recompenses.locator("li", { hasText: "10 € offerts" }).getByRole("button", { name: "Utiliser" }).isDisabled();
await recompenses.locator("li", { hasText: "Un cappuccino offert" }).getByRole("button", { name: "Utiliser" }).click();
await fenetre.getByRole("list", { name: "Récompenses appliquées" }).waitFor();
r.apresRecompense = await texte(fenetre.locator(".fidelite-membre"));
await p.screenshot({ path: `${sortie}/fi03-recompense.png` });
await fenetre.getByRole("button", { name: "Terminé" }).click();
r.ligneOfferte = await texte(p.locator(".ticket-ligne", { hasText: "Fidélité" }));
r.total = await texte(p.locator(".ticket-total strong"));
await encaisser("Carte bancaire");
r.apresVente2 = await attendre(async () => ((await solde()) === 11 ? 11 : null), "points de la vente 2");

// Vente 3, sans la carte : rattachée ensuite depuis l'écran Tickets.
await clic("Vente Directe");
await cappuccino();
await encaisser("Espèces");
await p.locator(".puce-synchro.synchronise").waitFor({ timeout: 20000 });
await p.getByRole("tab", { name: "Tickets" }).click();
await p.locator(".tableau-tickets tbody tr").first().click();
const detail = p.getByRole("dialog", { name: /^Ticket n° 3/ });
await detail.getByRole("button", { name: "Ajouter à une carte de fidélité" }).click();
await detail.getByLabel("Téléphone du client").fill("06 12 34 56 78");
await detail.getByRole("button", { name: "Rattacher" }).click();
const fait = detail.locator(".modale-corps > .explication", { hasText: /rattaché/ });
await fait.waitFor({ timeout: 10000 });
r.rattachement = await texte(fait);
await p.screenshot({ path: `${sortie}/fi04-rattachement.png` });
await detail.getByRole("button", { name: "Fermer" }).click();
// Le ticket 1 (rattaché à la vente) ne se rattache pas une seconde fois.
await p.locator(".tableau-tickets tbody tr").last().click();
const deja = p.getByRole("dialog", { name: /^Ticket n° 1/ }).locator(".modale-corps > .explication", { hasText: /déjà/ });
await deja.waitFor({ timeout: 10000 });
r.ticket1 = await texte(deja);

// ── Administration : fiche, historique, ajustement, statistiques ──
await a.getByRole("button", { name: "Actualiser les membres" }).click();
const membre = a.getByRole("list", { name: "Membres" }).locator(".ticket-admin").first();
await membre.waitFor();
r.listeMembres = await texte(membre);
await membre.click();
const fiche = a.getByRole("dialog", { name: "Marie" });
await fiche.locator("table").waitFor();
r.historique = await fiche.locator("tbody tr").evaluateAll((l) => l.map((x) => x.textContent.replace(/[\s  ]+/g, " ").trim()));
await fiche.getByLabel("Points à ajouter ou retirer").fill("2");
await fiche.getByLabel("Motif de l'ajustement").fill("Geste d'accueil");
await fiche.getByRole("button", { name: "Ajuster" }).click();
await fiche.locator(".fidelite-solde", { hasText: "17 points" }).waitFor({ timeout: 10000 });
r.ajuste = await texte(fiche.locator(".fidelite-solde"));
await a.screenshot({ path: `${sortie}/fi05-fiche.png` });
await fiche.getByRole("button", { name: "Fermer" }).click();
await rubriqueAdmin(a, "Statistiques");
const carteStats = a.locator(".stat-fidelite");
await carteStats.waitFor({ timeout: 15000 }).catch(async (e) => {
  await a.screenshot({ path: `${sortie}/fi-debug.png`, fullPage: true });
  throw e;
});
r.statistiques = await carteStats.locator(".stat-tuile").evaluateAll((l) => l.map((x) => x.textContent.replace(/[\s  ]+/g, " ").trim()));
await a.screenshot({ path: `${sortie}/fi06-statistiques.png`, fullPage: true });

// E-mails envoyés à la cliente (serveur local : boîte en mémoire).
const courriels = await (await fetch(`${URL}/__courriels`)).json();
r.courriels = courriels.map((c) => `${c.a} · ${c.sujet}`);

// ── iPhone : rubrique et éditeur sans débordement ──
const m = await administration("iphone", { width: 390, height: 844 });
await m.goto(`${URL}/admin#/moka/fidelite`);
await m.locator(".fidelite-editeur").waitFor({ timeout: 15000 });
r.debordementIphone = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
await m.screenshot({ path: `${sortie}/fi07-iphone.png`, fullPage: true });
await b.close();

console.log(JSON.stringify({ ...r, erreurs }, null, 2));
const ok =
  r.inactif === "Inactif" &&
  r.sansArticle === "« Un cappuccino offert » : choisissez au moins un article offert." &&
  r.actif === "Actif" &&
  /^Marie ?5 points ?06 12 34 56 78$/.test(r.inscrite) &&
  /Prochaine récompense : Un cappuccino offert, encore 5 points\./.test(r.suite) &&
  r.puce === "Marie · 5 points" &&
  r.apresVente1 === 13 &&
  /13 points/.test(r.retrouvee) &&
  r.dixBloque === true &&
  /3 points/.test(r.apresRecompense) &&
  /Offert · Fidélité/.test(r.ligneOfferte) &&
  r.total === "8,00 €" &&
  r.apresVente2 === 11 &&
  /Ticket rattaché à la carte de Marie : \+4 points, solde 15 points\./.test(r.rattachement) &&
  /déjà avec une carte/.test(r.ticket1) &&
  /^Marie ?06 12 34 56 78 · marie@exemple\.fr · dernière visite .* ?15 points$/.test(r.listeMembres) &&
  r.historique.length === 5 &&
  /Vente · ticket n° 3 ?\+4$/.test(r.historique[0]) &&
  /Récompense · Un cappuccino offert ?-10$/.test(r.historique[2]) &&
  /Bienvenue ?\+5$/.test(r.historique[4]) &&
  /^17 points/.test(r.ajuste) &&
  r.statistiques.some((t) => /^Membres venus ?1 ?1 membre · 1 inscription sur la période$/.test(t)) &&
  r.statistiques.some((t) => /^CA des membres ?20,00 €/.test(t)) &&
  r.statistiques.some((t) => /^Récompenses données ?1 ?valeur 4,00 €/.test(t)) &&
  r.courriels.includes("marie@exemple.fr · Bienvenue au programme Club Moka") &&
  // Récompense atteinte à la vente 1 (13 points), puis de nouveau à la vente 2 (3 → 11 points).
  r.courriels.filter((c) => c === "marie@exemple.fr · Une récompense vous attend chez Moka").length === 2 &&
  r.debordementIphone <= 0 &&
  !erreurs.length;
if (!ok) process.exit(1);
