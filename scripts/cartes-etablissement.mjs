// Cartes propres à chaque établissement (décision de Lionel du 16 novembre 2026 : plusieurs cartes par
// établissement, aucune partagée). Le Chardon est créé avec une copie de la carte du Moka ; sa rubrique
// « Cartes et prix » ne montre que ses cartes. Il copie la carte du Moka sous un autre nom (section
// « Copier une carte d'un autre établissement »), la met en service : sa fiche passe dessus, le Moka garde
// la sienne, inchangée. Une carte du Moka ne se met pas en service au Chardon (refus du serveur).
// Usage : serveur local vierge (apps/caisse : node scripts/serveur-local.mjs 4180), puis
//         URL=http://localhost:4180 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/cartes-etablissement.mjs [dossier-captures]
import { chromium } from "playwright";
import { accepterConfirmations, preparerServeur, rubriqueAdmin } from "./preparer-caisse.mjs";

const URL = process.env.URL ?? "http://localhost:4180";
const sortie = process.argv[2] ?? "captures";
const { cookie, appel } = await preparerServeur(URL, "Comptoir");
await appel("POST", "/etablissements", { id: "chardon", identite: { enseigne: "Au Chardon" }, carteId: "carte-automne-2026", tables: [], seuilNote: 2500 });

const [nomCookie, valeurCookie] = cookie.split("=");
const b = await chromium.launch();
const erreurs = [];
const r = {};
const texte = async (loc) => ((await loc.textContent()) ?? "").replace(/[\s  ]+/g, " ").trim();
const lignes = async (page) => Promise.all((await page.locator(".admin-tableau tbody tr").all()).map(texte));

const bureau = await b.newContext({ viewport: { width: 1280, height: 900 } });
await bureau.addCookies([{ name: nomCookie, value: valeurCookie, url: `${URL}/api/admin` }]);
const a = await bureau.newPage();
a.on("pageerror", (e) => erreurs.push(`admin : ${e.message}`));
await accepterConfirmations(a);

// ── Chardon : sa carte, copiée à la création ──
await a.goto(`${URL}/admin#/chardon/cartes`);
await a.locator(".admin-tableau").waitFor({ timeout: 20000 });
r.chardonAvant = await lignes(a);
r.portee = await texte(a.locator(".coque-portee, .entete-portee, .page-portee").first()).catch(() => "");
r.menuGroupe = await a.getByRole("navigation", { name: /^Rubriques de / }).getByText("Groupe", { exact: true }).count();

// ── Copier la carte du Moka sous un autre nom, puis la mettre en service ──
const copie = a.locator("form", { hasText: "Copier une carte d'un autre établissement" });
r.optionsCopie = await copie.locator("select option").allTextContents();
await copie.getByLabel("Carte à copier").selectOption("carte-automne-2026");
r.nomPropose = await copie.getByLabel("Nom de la copie").inputValue();
await copie.getByLabel("Nom de la copie").fill("Carte hiver Chardon");
await copie.getByRole("button", { name: "Copier" }).click();
await a.getByRole("button", { name: "Cartes", exact: true }).click();
await a.locator(".admin-tableau tbody tr", { hasText: "Carte hiver Chardon" }).waitFor();
r.chardonApresCopie = await lignes(a);
await a.screenshot({ path: `${sortie}/ce01-cartes-chardon.png`, fullPage: true });
await a.locator(".admin-tableau tbody tr", { hasText: "Carte hiver Chardon" }).getByRole("button", { name: "Mettre en service" }).click();
await a.locator(".admin-tableau tbody tr", { hasText: "Carte hiver Chardon" }).getByText("En service", { exact: true }).waitFor();
r.chardonApresService = await lignes(a);

// ── Moka : ses cartes seulement, la sienne toujours en service ──
await a.goto(`${URL}/admin#/moka/cartes`);
await a.reload();
await a.locator(".admin-tableau").waitFor({ timeout: 20000 });
r.moka = await lignes(a);

// ── Serveur : établissements et refus d'une carte d'un autre ──
const { etablissements, cartes } = await appel("GET", "/etablissements");
r.serveur = etablissements.map((e) => `${e.id}:${e.carteId}`).sort();
r.proprietaires = cartes.map((c) => `${c.id}:${c.etablissementId}`).sort();
r.refus = await appel("PUT", "/etablissements/chardon", { identite: { enseigne: "Au Chardon" }, carteId: "carte-automne-2026", seuilNote: 2500 }).then(
  () => "accepté",
  (e) => e.message,
);
const hiver = cartes.find((c) => c.etablissementId === "chardon" && c.nom === "Carte hiver Chardon");
await b.close();

console.log(JSON.stringify({ ...r, erreurs }, null, 2));
const ok =
  r.chardonAvant.length === 1 &&
  /Carte Au Chardon/.test(r.chardonAvant[0]) &&
  /En service/.test(r.chardonAvant[0]) &&
  r.menuGroupe === 0 &&
  r.optionsCopie.some((o) => /Moka · /.test(o)) &&
  !r.optionsCopie.some((o) => /Au Chardon · /.test(o)) &&
  r.nomPropose !== "" &&
  r.chardonApresCopie.length === 2 &&
  r.chardonApresCopie.some((l) => /Carte hiver Chardon.*Mettre en service/.test(l)) &&
  r.chardonApresService.some((l) => /Carte hiver Chardon.*En service/.test(l)) &&
  r.chardonApresService.some((l) => /Carte Au Chardon.*Mettre en service/.test(l)) &&
  r.moka.length === 1 &&
  /En service/.test(r.moka[0]) &&
  !!hiver &&
  r.serveur.includes(`chardon:${hiver.id}`) &&
  r.serveur.includes("moka:carte-automne-2026") &&
  r.proprietaires.includes("carte-automne-2026:moka") &&
  r.proprietaires.includes("carte-chardon:chardon") &&
  /appartient à un autre établissement/.test(r.refus) &&
  !erreurs.length;
if (!ok) process.exit(1);
