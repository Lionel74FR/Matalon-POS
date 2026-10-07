// Clôtures d'établissement (noyau 0.7.0) : l'iPad du comptoir et l'iPhone de salle vendent ; le fond
// déclaré sur l'iPad vaut pour l'iPhone ; la lecture X et la Z, faites sur l'iPhone, couvrent les deux
// appareils ; pendant le comptage, l'iPad ne peut pas clôturer ; l'archive de la Z (venue du serveur)
// contient les tickets des deux caisses ; le contrôle d'établissement est intègre.
// Usage : serveur local vierge (apps/caisse : node scripts/serveur-local.mjs 4180), puis
//         URL=http://localhost:4180 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/clotures-etablissement.mjs [dossier-captures]
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { preparerServeur } from "./preparer-caisse.mjs";

const URL = process.env.URL ?? "http://localhost:4180";
const sortie = process.argv[2] ?? "captures";
const { code, appel } = await preparerServeur(URL, "Comptoir");
const { code: codeIphone } = await appel("POST", "/etablissements/moka/codes", { nomCaisse: "Salle" });
const b = await chromium.launch();
const erreurs = [];

async function appareil(options, codeRattachement, bouton) {
  const ctx = await b.newContext({ hasTouch: true, acceptDownloads: true, ...options });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => erreurs.push(e.message));
  await p.goto(URL);
  await p.locator(".champ-code input").fill(codeRattachement);
  await p.getByRole("button", { name: bouton, exact: true }).click();
  await p.getByRole("button", { name: "Configurer plus tard", exact: true }).click();
  await p.locator(".carte-personne", { hasText: "Lionel" }).click();
  for (const x of "1234") await p.locator(".pave .touche", { hasText: new RegExp(`^${x}$`) }).last().click();
  return p;
}
const clic = (p, nom) => p.getByRole("button", { name: nom, exact: true }).first().click();
const champ = (p, libelle) => p.locator(".modale label.champ", { hasText: libelle }).locator("input");
const synchronise = (p) => p.locator(".puce-synchro.synchronise").waitFor({ timeout: 20000 });

// ── iPad : fond de caisse et une vente ──
const ipad = await appareil({ viewport: { width: 1180, height: 820 } }, code, "Rattacher l'iPad");
await ipad.getByRole("dialog", { name: "Fond de caisse" }).waitFor();
await champ(ipad, "Fond de caisse").fill("150");
await clic(ipad, "Enregistrer le fond");
await clic(ipad, "Vente comptoir");
await ipad.locator(".tuile", { hasText: "Cappuccino" }).first().click();
await clic(ipad, "Encaisser");
await ipad.locator(".mode", { hasText: "Carte bancaire" }).click();
await ipad.getByRole("button", { name: /^Valider l'encaissement/ }).click();
await clic(ipad, "Terminé");
await ipad.locator(".puce-synchro").click();
await synchronise(ipad);

// ── iPhone : le fond déjà déclaré ne se redemande pas ; une vente en espèces ──
const iphone = await appareil(
  {
    viewport: { width: 390, height: 844 },
    isMobile: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  },
  codeIphone,
  "Rattacher l'iPhone",
);
await iphone.locator(".salle").waitFor();
await iphone.waitForTimeout(1500);
const fondRedemande = await iphone.getByRole("dialog", { name: "Fond de caisse" }).isVisible();
await iphone.getByRole("button", { name: "Afficher la liste des tables" }).click();
await iphone.locator(".grille-tables .table", { hasText: /^2/ }).first().click();
await iphone.locator(".tuile", { hasText: "Cappuccino" }).first().click();
await iphone.locator(".resume-mobile").click();
await clic(iphone, "Encaisser");
await iphone.locator(".mode", { hasText: "Espèces" }).click();
await iphone.getByRole("button", { name: /^Valider l'encaissement/ }).click();
await clic(iphone, "Terminé");
await iphone.locator(".puce-synchro").click();
await synchronise(iphone);

// ── Lecture X sur l'iPad : les deux appareils ──
await ipad.getByRole("tab", { name: "Clôtures" }).click();
await clic(ipad, "Lecture X");
await ipad.locator(".carte-lecture").waitFor();
const lectureX = (await ipad.locator(".carte-lecture").textContent()).replace(/\s+/g, " ");
await ipad.screenshot({ path: `${sortie}/e01-lecture-x.png` });

// ── Z sur l'iPhone ; pendant son comptage, l'iPad ne peut pas clôturer ──
await iphone.getByRole("tab", { name: "Clôtures" }).click();
await clic(iphone, "Clôturer la journée (Z)");
await iphone.locator(".comptage-lignes").first().waitFor();
const comptageIphone = (await iphone.locator(".modale").textContent()).replace(/\s+/g, " ");
await clic(ipad, "Clôturer la journée (Z)");
const refus = await ipad.getByText(/Une clôture est en cours sur « Salle »/).first().textContent({ timeout: 10000 });
const attendu = (await iphone.locator(".comptage-lignes div", { hasText: "Attendu dans le tiroir" }).locator("dd").textContent()).replace(/[^\d,]/g, "");
await clic(iphone, "Saisir le total directement");
await champ(iphone, "Espèces comptées").fill(attendu);
const cb = (await iphone.locator(".modale label.champ", { hasText: "Total CB du TPE" }).locator("small").textContent()).replace(/[^\d,]/g, "");
await champ(iphone, "Total CB du TPE").fill(cb);
await champ(iphone, "Titres-restaurant carte du TPE").fill("0");
await iphone.screenshot({ path: `${sortie}/e02-comptage-iphone.png` });
await iphone.getByRole("button", { name: /^Valider.*clôturer/ }).click();
await iphone.getByText(/clôturée/).first().waitFor();
await synchronise(iphone);

// ── L'iPad voit la Z de l'iPhone (deux appareils), télécharge son archive, puis peut clôturer à son tour ──
await ipad.getByRole("button", { name: "Fermer" }).last().click().catch(() => undefined);
await ipad.getByRole("tab", { name: "Tickets" }).click();
await ipad.getByRole("tab", { name: "Clôtures" }).click();
const ligneZ = ipad.locator(".tableau-clotures tbody tr", { hasText: "Salle" }).first();
await ligneZ.waitFor();
const ligne = (await ligneZ.textContent()).replace(/\s+/g, " ");
await ligneZ.click();
const detail = (await ipad.locator(".modale").textContent()).replace(/\s+/g, " ");
await ipad.screenshot({ path: `${sortie}/e03-z-etablissement.png` });
const [telechargement] = await Promise.all([ipad.waitForEvent("download"), clic(ipad, "Télécharger l'archive")]);
const archive = JSON.parse(await readFile(await telechargement.path(), "utf8"));
await ipad.getByRole("button", { name: "Fermer" }).last().click();
await clic(ipad, "Clôturer la journée (Z)");
await ipad.locator(".comptage-lignes").first().waitFor();
const comptageIpad = (await ipad.locator(".modale").textContent()).replace(/\s+/g, " ");
await ipad.getByRole("button", { name: "Fermer" }).last().click();

const verification = await appel("GET", "/etablissements/moka/verification");
await b.close();

const resultat = {
  fondRedemande,
  lectureX: lectureX.slice(0, 220),
  comptageIphone: comptageIphone.slice(0, 260),
  refus,
  ligne,
  detail: detail.slice(0, 260),
  archive: { format: archive.format, tickets: archive.tickets?.length, autres: archive.autresCaisses?.map((c) => [c.caisseId, c.tickets.length]) },
  comptageIpad: comptageIpad.slice(0, 160),
  verification: { integre: verification.integre, anomalies: verification.anomalies },
  erreurs,
};
console.log(JSON.stringify(resultat, null, 2));
const ok =
  !fondRedemande &&
  /Total TTC ?8,00/.test(lectureX) &&
  /Salle/.test(lectureX) &&
  /2 ventes pour 8,00 €, tous appareils confondus/.test(comptageIphone) &&
  /Comptoir/.test(detail) &&
  /tickets 1 à 1/.test(detail) &&
  archive.format === "matalon-archive-serveur/2" &&
  archive.autresCaisses?.length === 1 &&
  /0 vente pour 0,00 €/.test(comptageIpad) &&
  verification.integre &&
  erreurs.length === 0;
if (!ok) process.exit(1);
