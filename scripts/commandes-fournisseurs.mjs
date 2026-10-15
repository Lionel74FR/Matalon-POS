// Commandes fournisseurs (et import des fiches techniques par l'écran Importer) : fiche du fournisseur et réglages d'envoi dans l'administration ; sur l'iPad, un
// responsable saisit le bon, l'envoie par e-mail (à l'adresse de la fiche, copie à l'établissement), puis
// réceptionne une première livraison contre la commande ; l'administration réceptionne le reste et clôt.
// Un bon chez un fournisseur sans e-mail se « marque envoyé ». Sur iPhone, rien ne déborde.
// Usage : serveur local vierge (apps/caisse : node scripts/serveur-local.mjs 4180), puis
//         URL=http://localhost:4180 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/commandes-fournisseurs.mjs [dossier-captures]
import { chromium } from "playwright";
import { preparerServeur } from "./preparer-caisse.mjs";

const URL = process.env.URL ?? "http://localhost:4180";
const sortie = process.argv[2] ?? "captures";
const { code, cookie, appel } = await preparerServeur(URL, "Bar");
const [nomCookie, valeurCookie] = cookie.split("=");
const resultats = {};
const echecs = [];
const verifier = (nom, ok, valeur) => {
  resultats[nom] = valeur;
  if (!ok) echecs.push(nom);
};

await appel("POST", "/stock/import", {
  etablissementId: "moka",
  tableau: [
    ["produit", "unite", "famille", "zone", "fournisseur", "reference", "conditionnement", "quantite", "prix_ht"],
    ["Bombay Sapphire", "L", "Spiritueux", "Bar", "Caves du Mont", "25522", "Bouteille 70 cl", "0,7", "20,49"],
    ["Carlsberg pression", "L", "Bières", "Cave", "Caves du Mont", "13", "Fût 30 L", "30", "139,14"],
    ["Prosecco", "L", "Vins", "Cave", "Caves du Mont", "83335", "Bouteille 75 cl", "0,75", "6,29"],
    ["Citron vert", "kg", "Frais", "Chambre froide", "Metro", "", "Au kg", "1", "3,55"],
  ],
});

const b = await chromium.launch();
const erreurs = [];

// ── Administration : fiche Caves du Mont et réglages d'envoi ──
const bureau = await b.newContext({ viewport: { width: 1280, height: 900 } });
await bureau.addCookies([{ name: nomCookie, value: valeurCookie, url: `${URL}/api/admin` }]);
const a = await bureau.newPage();
a.on("pageerror", (e) => erreurs.push(`admin : ${e.message}`));
await a.goto(`${URL}/admin#/moka/stock`);
// Fiches techniques collées depuis le tableur : vérifiées, puis importées.
await a.getByRole("tab", { name: "Importer" }).click();
await a.getByLabel("Ou collez les cellules copiées depuis Excel").fill("Cocktail\tIngrédient\tQuantité\tUnité\nDolce Vita\tBombay Sapphire\t3\tcl\nDolce Vita\tProsecco\t8\tcl");
await a.getByRole("button", { name: "Vérifier" }).click();
await a.getByText("1 recette à créer : Dolce Vita").waitFor();
await a.getByRole("button", { name: "Importer", exact: true }).click();
await a.getByText("1 recette créée : Dolce Vita").waitFor();
verifier("fiche technique importée", true, "1 recette créée : Dolce Vita");
await a.getByRole("tab", { name: "Fournisseurs" }).click();
await a.getByRole("button", { name: "Caves du Mont", exact: true }).click();
await a.getByLabel("E-mail de commande").fill("commandes@cavesdumont.test");
await a.getByLabel("En copie (3 au plus, séparés par des virgules)").fill("johan@cavesdumont.test");
await a.getByLabel("Contact (représentant)").fill("Johan Panisset");
await a.getByLabel("Téléphone").fill("04 50 00 00 00");
await a.getByLabel("Franco de port (€ HT)").fill("250");
await a.getByLabel("Livraison (jours, délai, heure limite)").fill("Mardi et vendredi, commande la veille avant 12 h");
await a.getByLabel("N° de client · Moka").fill("1411");
await a.screenshot({ path: `${sortie}/f01-fiche-fournisseur.png` });
await a.getByRole("button", { name: "Enregistrer", exact: true }).click();
await a.locator(".modale").waitFor({ state: "detached" });
const tableauFournisseurs = (await a.locator(".stock-table").textContent()).replace(/\s+/g, " ");
verifier("fiche dans la liste", /commandes@cavesdumont\.test/.test(tableauFournisseurs) && /1411/.test(tableauFournisseurs) && /Metro.*à saisir/.test(tableauFournisseurs), tableauFournisseurs);

await a.getByRole("tab", { name: "Commandes" }).click();
await a.locator(".commandes-reglages summary").click();
await a.getByLabel("Adresse d'expédition").fill("commandes@moka.test");
await a.getByLabel("E-mail de l'établissement (copie et réponses)").fill("bar@moka.test");
await a.getByLabel("Consignes de livraison (imprimées sur le bon)").fill("Livraison par la cour, avant 11 h");
await a.locator(".commandes-reglages").getByRole("button", { name: "Enregistrer" }).click();
await a.getByText("Réglages enregistrés.").waitFor();
verifier("réglages", true, (await a.locator(".commandes-reglages .explication").textContent()).trim());

// ── iPad : un responsable saisit et envoie le bon ──
const ctx = await b.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true });
const p = await ctx.newPage();
p.on("pageerror", (e) => erreurs.push(`caisse : ${e.message}`));
const clic = (nom) => p.getByRole("button", { name: nom, exact: true }).first().click();
await p.goto(URL);
await p.locator(".champ-code input").fill(code);
await clic("Rattacher l'iPad");
await clic("Configurer plus tard");
await p.locator(".carte-personne", { hasText: "Lionel" }).click();
for (const x of "1234") await p.locator(".pave .touche", { hasText: new RegExp(`^${x}$`) }).last().click();
await clic("Plus tard");
await p.locator(".puce-synchro.synchronise").waitFor({ timeout: 15000 });
await p.getByRole("button", { name: /^Menu/ }).click().then(() => p.getByRole("menuitem", { name: "Stock" }).click());
await p.getByRole("tab", { name: "Commandes" }).click();
await clic("Nouvelle commande");
await p.locator(".commande-carte", { hasText: "Caves du Mont" }).click();
const resumeFiche = (await p.locator(".fiche-fournisseur-resume").textContent()).replace(/\s+/g, " ");
verifier("fiche affichée sur l'iPad", /1411/.test(resumeFiche) && /Johan Panisset/.test(resumeFiche), resumeFiche);
await p.getByLabel("Prosecco : quantité à commander").fill("6");
// Sous le franco : avertissement.
const sousFranco = (await p.locator(".avertissement").textContent()).trim();
verifier("franco signalé", /il manque 212,26/.test(sousFranco.replace(/ | /g, " ")), sousFranco);
await p.getByLabel("Bombay Sapphire : quantité à commander").fill("10");
await p.getByLabel("Carlsberg pression : quantité à commander").fill("2");
await p.getByLabel("Livraison souhaitée").fill("2026-10-20");
await p.getByLabel("Message au fournisseur").fill("Merci de livrer avant 11 h.");
await clic("Enregistrer le brouillon");
await p.getByText(/Brouillon n° 1 enregistré/).waitFor();
const total = (await p.locator(".commande-total").textContent()).replace(/\s+/g, " ");
verifier("total du bon", /3 articles · 520,92/.test(total.replace(/ | /g, " ")), total);
await p.screenshot({ path: `${sortie}/f02-saisie-ipad.png`, fullPage: true });
await clic("Envoyer par e-mail");
const confirmation = (await p.locator(".commande-confirmation p").textContent()).replace(/\s+/g, " ");
verifier("confirmation d'envoi", /commandes@cavesdumont\.test/.test(confirmation) && /bar@moka\.test/.test(confirmation), confirmation);
await p.locator(".commande-confirmation").getByRole("button", { name: "Envoyer" }).click();
await p.locator(".commande-detail .statut-commande", { hasText: "Envoyée" }).waitFor();
const courriels = await (await fetch(`${URL}/__courriels`)).json();
const bon = courriels.find((c) => c.sujet.startsWith("Commande n° 1"));
verifier(
  "e-mail du bon",
  bon && bon.a === "commandes@cavesdumont.test" && bon.copies.join() === "johan@cavesdumont.test,bar@moka.test" && bon.de === "commandes@moka.test" && bon.repondreA === "bar@moka.test" && /Total HT indicatif : 520,92/.test(bon.texte.replace(/ | /g, " ")),
  bon && { a: bon.a, copies: bon.copies, de: bon.de, sujet: bon.sujet },
);
await p.screenshot({ path: `${sortie}/f03-commande-envoyee.png`, fullPage: true });

// Première livraison : 6 bouteilles de gin sur 10, les fûts et le prosecco.
await clic("Réceptionner la livraison");
const prerempli = await p.getByLabel("Bombay Sapphire : nombre reçu").inputValue();
verifier("reste pré-rempli", prerempli === "10", prerempli);
await p.getByLabel("Bombay Sapphire : nombre reçu").fill("6");
await p.getByLabel("Bon de livraison").fill("BL-77");
await p.screenshot({ path: `${sortie}/f04-reception-ipad.png`, fullPage: true });
await p.getByRole("button", { name: /^Réceptionner ·/ }).click();
await p.locator(".commande-detail .statut-commande", { hasText: "Reçue en partie" }).waitFor();
const detail = (await p.locator(".tableau-commande tbody").textContent()).replace(/\s+/g, " ");
verifier("reçu par ligne", /Bombay Sapphire.*10.*6/.test(detail), detail);

// iPhone : liste et saisie sans débordement.
await p.setViewportSize({ width: 390, height: 844 });
await p.getByRole("button", { name: "Retour aux commandes" }).click();
await p.waitForTimeout(300);
const debordementListe = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
await p.screenshot({ path: `${sortie}/f05-liste-iphone.png` });
await clic("Nouvelle commande");
await p.locator(".commande-carte", { hasText: "Caves du Mont" }).click();
await p.waitForTimeout(300);
const debordementSaisie = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
await p.screenshot({ path: `${sortie}/f06-saisie-iphone.png`, fullPage: true });
verifier("iPhone sans débordement", debordementListe <= 0 && debordementSaisie <= 0, { debordementListe, debordementSaisie });

// ── Administration : reste de la livraison, clôture ; Metro sans e-mail, marqué envoyé ──
await a.reload();
await a.getByRole("tab", { name: "Commandes" }).click();
await a.locator(".commande-carte", { hasText: "Reçue en partie" }).click();
await a.getByRole("button", { name: "Réceptionner la livraison" }).click();
const resteAdmin = await a.getByLabel("Bombay Sapphire : nombre reçu").inputValue();
verifier("reste à recevoir", resteAdmin === "4", resteAdmin);
await a.getByRole("button", { name: /^Réceptionner ·/ }).click();
await a.locator(".commande-detail .statut-commande", { hasText: "Reçue" }).waitFor();
await a.getByRole("button", { name: "Clore", exact: true }).click();
await a.locator(".commande-confirmation").getByRole("button", { name: "Clore" }).click();
await a.locator(".commande-detail .operation-actions").getByRole("button", { name: "Dupliquer" }).waitFor();
const actionsApres = (await a.locator(".commande-detail .operation-actions").textContent()).trim();
verifier("close : plus de réception", !/Réceptionner/.test(actionsApres), actionsApres);
await a.screenshot({ path: `${sortie}/f07-commande-close.png`, fullPage: true });

await a.getByRole("button", { name: "Retour aux commandes" }).click();
await a.getByRole("button", { name: "Nouvelle commande" }).click();
await a.locator(".commande-carte", { hasText: "Metro" }).click();
await a.getByLabel("Citron vert : quantité à commander").fill("2,5");
const boutonEmail = await a.getByRole("button", { name: "Envoyer par e-mail" }).isDisabled();
await a.getByRole("button", { name: "Marquer envoyée" }).click();
await a.locator(".commande-confirmation").getByRole("button", { name: "Marquer envoyée" }).click();
await a.locator(".commande-detail .statut-commande", { hasText: "Envoyée" }).waitFor();
const passee = (await a.locator(".commande-detail .explication").first().textContent()).trim();
verifier("Metro marquée envoyée", boutonEmail && /téléphone, portail/.test(passee), { boutonEmail, passee });
await a.getByRole("button", { name: "Retour aux commandes" }).click();
await a.getByRole("tab", { name: "Toutes" }).click();
const liste = (await a.locator(".commandes-liste").textContent()).replace(/\s+/g, " ");
verifier("liste des bons", /N° 2 · Metro.*Envoyée/.test(liste) && /N° 1 · Caves du Mont.*Reçue/.test(liste), liste);
await a.screenshot({ path: `${sortie}/f08-liste-admin.png`, fullPage: true });
await b.close();

const etat = await appel("GET", "/stock/etat?etab=moka");
const q = (id) => etat.produits.find((x) => x.produitId === id)?.quantite;
verifier("stock entré", q("bombay-sapphire") === 7000 && q("carlsberg-pression") === 60000 && q("prosecco") === 4500, { gin: q("bombay-sapphire"), fut: q("carlsberg-pression"), prosecco: q("prosecco") });
verifier("aucune erreur de page", erreurs.length === 0, erreurs);
console.log(JSON.stringify(resultats, null, 2));
if (echecs.length) {
  console.log(`ÉCHEC : ${echecs.join(", ")}`);
  process.exit(1);
}
console.log("OK : commandes fournisseurs");
