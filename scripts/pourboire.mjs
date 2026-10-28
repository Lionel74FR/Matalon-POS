// Pourboire sur la carte (demande de Lionel du 27 octobre, noyau fiscal 1.1.0) : la note est réglée par
// une carte passée au TPE pour 2 € de plus ; la caisse demande de confirmer le rendu, l'excédent est
// rendu en espèces depuis le tiroir. Le ticket reste au total de la note ; la Z compte la CB du TPE et
// des espèces attendues diminuées de 2 € ; un titre-restaurant au-delà de la note est refusé.
// Usage : serveur local vierge (apps/caisse : node scripts/serveur-local.mjs 4180), puis
//         URL=http://localhost:4180 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/pourboire.mjs [dossier-captures]
import { chromium } from "playwright";
import { preparerServeur, saisirPave } from "./preparer-caisse.mjs";

const URL = process.env.URL ?? "http://localhost:4180";
const sortie = process.argv[2] ?? "captures";
const { code, appel } = await preparerServeur(URL, "Comptoir");
const erreurs = [];
const b = await chromium.launch();
const texte = async (loc) => ((await loc.textContent()) ?? "").replace(/[\s  ]+/g, " ").trim();
const centimes = (t) => Number(t.replace(/[^\d,-]/g, "").replace(",", ".")) * 100;
const r = {};

const ctx = await b.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true });
const p = await ctx.newPage();
p.on("pageerror", (e) => erreurs.push(`ipad : ${e.message}`));
const clic = (n) => p.getByRole("button", { name: n, exact: true }).first().click();
const champ = (libelle) => p.locator(".modale label.champ", { hasText: libelle }).locator("input");
await p.goto(URL);
await p.locator(".champ-code input").fill(code);
await clic("Rattacher l'iPad");
await clic("Configurer plus tard");
await p.locator(".carte-personne", { hasText: "Lionel" }).click();
for (const x of "1234") await p.locator(".pave .touche", { hasText: new RegExp(`^${x}$`) }).last().click();
await p.getByRole("dialog", { name: "Fond de caisse" }).waitFor();
await champ("Fond de caisse").fill("150");
await clic("Enregistrer le fond");

// ── Vente Directe : deux cappuccinos, carte passée pour 2 € de plus ──
await clic("Vente Directe");
for (let i = 0; i < 2; i++) await p.locator(".tuile", { hasText: "Cappuccino" }).first().click();
await clic("Encaisser");
const total = centimes(await texte(p.locator(".encaissement-etat .ligne-montant").first().locator("strong")));
r.total = total;
const saisie = String(total + 200);
for (const x of saisie) await p.locator(".encaissement-saisie .pave .touche", { hasText: new RegExp(`^${x}$`) }).first().click();
r.afficheur = await texte(p.locator(".afficheur"));
await p.locator(".mode", { hasText: "Carte bancaire" }).click();
const confirmation = p.getByRole("alertdialog", { name: "Confirmer le rendu" });
await confirmation.waitFor();
r.confirmation = await texte(confirmation.locator("p"));
await p.screenshot({ path: `${sortie}/po01-confirmation.png` });
await confirmation.getByRole("button", { name: /^Oui, rendre/ }).click();
r.aRendre = await texte(p.locator(".ligne-montant.reste"));
await p.screenshot({ path: `${sortie}/po02-a-rendre.png` });
await p.getByRole("button", { name: /^Valider l'encaissement/ }).click();
await p.locator(".fin-encaissement").waitFor();
r.fin = await texte(p.locator(".fin-encaissement .rendu").first());
await p.screenshot({ path: `${sortie}/po03-rendu.png` });
await clic("Terminé");

// ── Un titre-restaurant ne donne jamais de rendu ──
await clic("Vente Directe");
await p.locator(".tuile", { hasText: "Espresso" }).first().click();
await clic("Encaisser");
const totalEspresso = centimes(await texte(p.locator(".encaissement-etat .ligne-montant").first().locator("strong")));
for (const x of String(totalEspresso + 100)) await p.locator(".encaissement-saisie .pave .touche", { hasText: new RegExp(`^${x}$`) }).first().click();
await p.locator(".mode", { hasText: "Titre-restaurant carte" }).click();
r.refusTitre = await texte(p.locator(".toast", { hasText: "rendu" }).first());
await p.keyboard.press("Escape");

// ── Z : espèces attendues = fond − 2 €, CB caisse = total + 2 € ──
await p.getByRole("button", { name: /^Menu/ }).click().then(() => p.getByRole("menuitem", { name: "Clôtures" }).click());
await clic("Clôturer la journée (Z)");
await p.locator(".comptage-lignes").first().waitFor();
r.encaisseEspeces = await texte(p.locator(".comptage-lignes div", { hasText: "Encaissé en espèces" }).locator("dd"));
const attendu = centimes(await texte(p.locator(".comptage-lignes div", { hasText: "Attendu dans le tiroir" }).locator("dd")));
r.attendu = attendu;
r.cbCaisse = await texte(p.locator(".modale .champ", { hasText: "Total CB du TPE" }).locator("small"));
await p.screenshot({ path: `${sortie}/po04-comptage.png` });
await clic("Saisir le total directement");
await saisirPave(p, "Espèces comptées", String(attendu / 100).replace(".", ","));
await saisirPave(p, "Total CB du TPE", String((total + 200) / 100).replace(".", ","));
await saisirPave(p, "Titres-restaurant carte du TPE", "0");
// Sans vente en espèces, le tiroir a 2 € de moins que le fond du matin : on y laisse tout.
await saisirPave(p, "Fond laissé dans le tiroir", String(attendu / 100).replace(".", ","));
await p.getByRole("button", { name: /^Valider.*clôturer/ }).click();
await p.getByText(/clôturée/).first().waitFor();
await p.locator(".puce-synchro.synchronise").waitFor({ timeout: 20000 });

// ── Serveur : ticket et Z ──
const jour = new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris" }).format(new Date(Date.now() - 5 * 3600_000));
const { tickets } = await appel("GET", `/etablissements/moka/tickets?du=${jour}&au=${jour}`);
const t = tickets.find((x) => x.type === "VENTE");
r.ticket = { totalTTC: t.totalTTC, paiements: t.paiements, renduMonnaie: t.renduMonnaie, version: t.versionLogiciel };
const { clotures } = await appel("GET", `/etablissements/moka/clotures?du=${jour}&au=${jour}`);
const z = clotures.find((c) => c.periode === "JOUR");
r.z = { totalTTC: z.totalTTC, paiements: z.paiements };
await b.close();

console.log(JSON.stringify({ ...r, erreurs }, null, 2));
const euros = (c) => (c / 100).toFixed(2).replace(".", ",");
const ok =
  r.afficheur.includes(euros(total + 200)) &&
  r.confirmation.includes("rendre 2,00") &&
  r.confirmation.includes("en espèces") &&
  /À rendre en espèces \(pourboire\)\s*2,00/.test(r.aRendre) &&
  /Rendu en espèces \(pourboire CB\)\s*2,00/.test(r.fin) &&
  /rendu/.test(r.refusTitre) &&
  r.encaisseEspeces.includes("-2,00") &&
  r.attendu === 14800 &&
  r.cbCaisse.includes(euros(total + 200)) &&
  r.ticket.totalTTC === total &&
  r.ticket.renduMonnaie === 200 &&
  r.ticket.version === "1.1.0" &&
  JSON.stringify(r.ticket.paiements) === JSON.stringify([{ mode: "CB", montant: total + 200 }]) &&
  r.z.totalTTC === total &&
  JSON.stringify(r.z.paiements) === JSON.stringify([{ mode: "CB", montant: total + 200 }, { mode: "ESPECES", montant: -200 }]) &&
  !erreurs.length;
if (!ok) process.exit(1);
