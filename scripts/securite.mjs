// Sécurité de l'équipe et alertes : 5 codes PIN faux bloquent la personne 5 minutes (alerte dans
// l'administration) ; modifier l'équipe depuis l'iPad demande le code d'un responsable, vérifié par le
// serveur ; une vente à un autre prix que la carte (carte de l'iPad trafiquée) remonte en alerte.
// Usage : serveur local vierge (apps/caisse : node scripts/serveur-local.mjs 4180), puis
//         URL=http://localhost:4180 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/securite.mjs [dossier-captures]
import { chromium } from "playwright";
import { preparerServeur } from "./preparer-caisse.mjs";

const URL = process.env.URL ?? "http://localhost:4180";
const sortie = process.argv[2] ?? "captures";
const { code, appel, cookie } = await preparerServeur(URL, "Comptoir");
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true });
const p = await ctx.newPage();
const erreurs = [];
p.on("pageerror", (e) => erreurs.push(e.message));
const clic = (nom) => p.getByRole("button", { name: nom, exact: true }).first().click();
const pin = async (code) => {
  for (const x of code) await p.locator(".pave .touche", { hasText: new RegExp(`^${x}$`) }).last().click();
};
/** Après un rechargement : l'assistant d'imprimante peut revenir avant l'écran de connexion. */
const recharger = async () => {
  await p.reload();
  await p.locator(".ecran-connexion, .assistant-imprimante, .modale").first().waitFor();
  const plusTard = p.getByRole("button", { name: "Configurer plus tard", exact: true });
  if (await plusTard.isVisible().catch(() => false)) await plusTard.click();
};
/** Connexion de Lionel ; le fond de caisse (pas encore déclaré) est remis à plus tard. */
const connecter = async () => {
  await p.locator(".carte-personne", { hasText: "Lionel" }).click();
  await pin("1234");
  await p.locator(".salle").waitFor();
  const fond = p.getByRole("dialog", { name: "Fond de caisse" });
  await fond.waitFor({ timeout: 4000 }).catch(() => undefined);
  if (await fond.isVisible()) await clic("Plus tard");
};
const synchroniser = async () => {
  await p.locator(".puce-synchro").click();
  await p.locator(".puce-synchro.synchronise").waitFor({ timeout: 20000 });
};

await p.goto(URL);
await p.locator(".champ-code input").fill(code);
await clic("Rattacher l'iPad");
await clic("Configurer plus tard");
await p.locator(".carte-personne", { hasText: "Lionel" }).click();
await pin("1234");
await clic("Plus tard");
await p.locator(".puce-synchro.synchronise").waitFor({ timeout: 15000 });

// ── 1. Cinq codes faux à la connexion : bloqué 5 minutes, le bon code ne passe plus ──
await p.getByRole("button", { name: /^Quitter \(Lionel\)/ }).click();
await p.locator(".carte-personne", { hasText: "Lionel" }).click();
for (let i = 0; i < 4; i++) await pin("0000");
const avantDernier = await p.locator(".saisie-pin .erreur").textContent();
await pin("0000");
const bloque = await p.locator(".saisie-pin .erreur").textContent();
// Pavé grisé et inactif : même le bon code ne peut plus être tapé.
const toujoursBloque = await p.locator(".saisie-pin.bloquee .pave").evaluate((e) => getComputedStyle(e).pointerEvents === "none");
await p.screenshot({ path: `${sortie}/s01-pin-bloque.png` });
// Les 5 minutes écoulées (horloge avancée en vidant l'échéance), le bon code passe.
await p.evaluate(() => {
  for (const k of Object.keys(localStorage)) if (k.startsWith("matalon.pin.")) localStorage.setItem(k, JSON.stringify({ echecs: 5, bloqueJusqua: Date.now() - 1 }));
});
await recharger();
await connecter();

// ── 2. Ajout d'un serveur depuis l'iPad : code du responsable demandé et vérifié par le serveur ──
await p.getByRole("tab", { name: "Réglages" }).click();
await p.getByPlaceholder("Prénom").fill("Tom");
await p.getByPlaceholder("Code PIN").fill("5678");
await clic("Ajouter à l'équipe");
await p.getByRole("dialog", { name: "Validation responsable" }).waitFor();
await p.screenshot({ path: `${sortie}/s02-pin-equipe.png` });
await pin("1234");
await p.getByText("Tom peut maintenant se connecter").waitFor();
const equipe = (await appel("GET", "/etablissements")).etablissements[0].utilisateurs.map((u) => u.nom);

// ── 3. Carte trafiquée sur l'iPad : cappuccino vendu 1,00 € au lieu de 4,00 € ──
await p.evaluate(async () => {
  const db = await new Promise((ok, ko) => {
    const r = indexedDB.open("matalon-pos");
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
  });
  const config = await new Promise((ok) => {
    const r = db.transaction("config").objectStore("config").get("configuration");
    r.onsuccess = () => ok(r.result);
  });
  for (const c of config.carte.categories) for (const a of c.articles) if (a.id === "cappuccino") a.prixTTC = 100;
  await new Promise((ok) => {
    const tx = db.transaction("config", "readwrite");
    tx.objectStore("config").put(config, "configuration");
    tx.oncomplete = ok;
  });
});
await recharger();
await connecter();
await clic("Vente comptoir");
await p.locator(".tuile", { hasText: "Cappuccino" }).first().click();
await clic("Encaisser");
await p.locator(".mode", { hasText: "Carte bancaire" }).click();
await p.getByRole("button", { name: /^Valider l'encaissement/ }).click();
await clic("Terminé");
await synchroniser();

const { alertes } = await appel("GET", "/etablissements/moka/alertes");
// L'administration montre les alertes (session administrateur reprise du script de préparation).
const [nom, valeur] = cookie.split("=");
await ctx.addCookies([{ name: nom, value: valeur, url: URL }]);
const admin = await ctx.newPage();
await admin.goto(`${URL}/admin`);
await admin.getByRole("heading", { name: /^Alertes/ }).waitFor({ timeout: 15000 });
await admin.getByRole("heading", { name: /^Alertes/ }).scrollIntoViewIfNeeded();
await admin.screenshot({ path: `${sortie}/s03-alertes-admin.png` });
const ecranAlertes = (await admin.locator(".admin-alertes").textContent()).replace(/\s+/g, " ");
await b.close();

const resultat = { avantDernier, bloque, toujoursBloque, equipe, alertes: alertes.map((a) => [a.type, a.message]), ecranAlertes: ecranAlertes.slice(0, 300), erreurs };
console.log(JSON.stringify(resultat, null, 2));
const ok =
  /1 essai avant blocage/.test(avantDernier) &&
  /bloqué jusqu'à/.test(bloque) &&
  toujoursBloque &&
  equipe.includes("Tom") &&
  alertes.some((a) => a.type === "PIN_BLOQUE") &&
  alertes.some((a) => a.type === "PRIX_DIFFERENT" && /1,00 € au lieu de 4,00 €/.test(a.message)) &&
  /Prix différent de la carte/.test(ecranAlertes) &&
  erreurs.length === 0;
if (!ok) process.exit(1);
