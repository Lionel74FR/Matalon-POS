import { useState } from "react";
import type { BaseCaisse } from "../donnees/base";
import { genererTables, type Etablissement } from "../donnees/configuration";
import { installer, MODE_TEST, type Caisse } from "../fiscal/caisse";

const CHAMPS: Array<{ cle: keyof Etablissement; libelle: string; aide?: string; requis?: boolean }> = [
  { cle: "enseigne", libelle: "Enseigne", requis: true },
  { cle: "raisonSociale", libelle: "Raison sociale", aide: "Société qui exploite l'établissement", requis: true },
  { cle: "adresse", libelle: "Adresse", requis: true },
  { cle: "codePostalVille", libelle: "Code postal et ville", requis: true },
  { cle: "telephone", libelle: "Téléphone" },
  { cle: "siret", libelle: "SIRET", requis: true },
  { cle: "tvaIntracom", libelle: "N° de TVA intracommunautaire", requis: true },
];

/** Première mise en service de la caisse sur cet iPad. */
export function Installation(props: { db: BaseCaisse; onInstallee: (c: Caisse) => void }) {
  const [etablissement, setEtablissement] = useState<Etablissement>({
    enseigne: "Moka",
    raisonSociale: "",
    adresse: "6 rue Vaugelas",
    codePostalVille: "74000 Annecy",
    telephone: "04 56 19 02 68",
    siret: "",
    tvaIntracom: "",
  });
  const [nom, setNom] = useState("");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [salle, setSalle] = useState(12);
  const [terrasse, setTerrasse] = useState(0);
  const [erreur, setErreur] = useState("");
  const [enCours, setEnCours] = useState(false);

  const valider = async () => {
    const manquant = CHAMPS.find((c) => c.requis && !etablissement[c.cle].trim());
    if (manquant) return setErreur(`Renseignez : ${manquant.libelle}.`);
    if (!/^\d{14}$/.test(etablissement.siret.replace(/\s/g, ""))) return setErreur("Le SIRET compte 14 chiffres.");
    if (!nom.trim()) return setErreur("Renseignez le nom du responsable.");
    if (!/^\d{4}$/.test(pin)) return setErreur("Le code PIN compte 4 chiffres.");
    if (pin !== pin2) return setErreur("Les deux codes PIN sont différents.");
    setEnCours(true);
    try {
      const caisse = await installer(props.db, {
        etablissement: { ...etablissement, siret: etablissement.siret.replace(/\s/g, "") },
        responsable: { nom: nom.trim(), pin },
        tables: genererTables(salle, terrasse),
      });
      props.onInstallee(caisse);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
      setEnCours(false);
    }
  };

  return (
    <div className="ecran-installation">
      <header>
        <h1>Mise en service de la caisse{MODE_TEST ? " de test" : ""}</h1>
        <p>
          Ces informations figurent sur chaque note client. Elles se modifient ensuite dans les réglages, sauf l'identité de
          cette caisse et sa clé de signature, créées une fois pour toutes.
        </p>
      </header>
      <div className="formulaire-colonnes">
        <fieldset>
          <legend>Établissement</legend>
          {CHAMPS.map((c) => (
            <label key={c.cle} className="champ">
              <span>
                {c.libelle}
                {c.aide && <small>{c.aide}</small>}
              </span>
              <input
                value={etablissement[c.cle]}
                onChange={(e) => setEtablissement({ ...etablissement, [c.cle]: e.target.value })}
                inputMode={c.cle === "siret" || c.cle === "telephone" ? "numeric" : "text"}
              />
            </label>
          ))}
        </fieldset>
        <div>
          <fieldset>
            <legend>Responsable</legend>
            <label className="champ">
              <span>Prénom</span>
              <input value={nom} onChange={(e) => setNom(e.target.value)} />
            </label>
            <label className="champ">
              <span>Code PIN (4 chiffres)</span>
              <input type="password" inputMode="numeric" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
            </label>
            <label className="champ">
              <span>Confirmer le code</span>
              <input type="password" inputMode="numeric" maxLength={4} value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, ""))} />
            </label>
          </fieldset>
          <fieldset>
            <legend>Salle</legend>
            <label className="champ">
              <span>Tables en salle</span>
              <input type="number" min={0} max={60} value={salle} onChange={(e) => setSalle(Number(e.target.value))} />
            </label>
            <label className="champ">
              <span>Tables en terrasse</span>
              <input type="number" min={0} max={60} value={terrasse} onChange={(e) => setTerrasse(Number(e.target.value))} />
            </label>
          </fieldset>
        </div>
      </div>
      <footer>
        <p className="erreur" aria-live="assertive">
          {erreur}
        </p>
        <button className="bouton principal grand" disabled={enCours} onClick={() => void valider()}>
          {enCours ? "Mise en service…" : "Mettre la caisse en service"}
        </button>
      </footer>
    </div>
  );
}
