import { Cable, Download, Image, Printer, RefreshCw, Scissors, Vault } from "lucide-react";
import { useEffect, useState } from "react";
import { sortieTickets } from "../donnees/configuration";
import { definirLogoMemoire } from "../impression/escpos";
import { gabaritTest } from "../impression/gabarits";
import { descriptionBranchement, essaiCoupesPartielles, imprimantesPortees, imprimerIci, type ImprimanteEtablissement } from "../impression/imprimantes";
import { cleLogo, logoSerie } from "../impression/logo-serie";
import { Recu } from "../impression/recu";
import { etatScriptReseau, URL_SCRIPT_RESEAU } from "../impression/reseau";
import { BAUDS_PAR_DEFAUT, choisirPort, envoyerOctets, envoyerSerie, portsAutorises, serieDisponible } from "../impression/serie";
import { useCaisse } from "./contexte";
import { AvecIcone } from "./icones";

/**
 * Imprimantes de cet appareil (16 novembre 2026, demande de Lionel) : celle des tickets (notes, clôtures,
 * tiroir) et celle des additions, choisies ici dans la liste de l'établissement, sans valeur par défaut.
 */
export function ImprimantesAppareil(props: { onAssistant: () => void }) {
  const { config, majConfig, imprimer } = useCaisse();
  const liste = config.imprimantes ?? [];
  const appareils = { ...config.appareils, [config.caisseId]: config.caisseNom };
  const tickets = config.imprimanteTicketsId;
  const ancienne = tickets === undefined ? sortieTickets(config) : null;
  const choisie = liste.find((i) => i.id === tickets);
  // Une imprimante déclarée sur cet iPad ou iPhone : il ne peut ni ouvrir un port COM ni lancer le script.
  const impossibles = serieDisponible() ? [] : imprimantesPortees(config);
  const TYPES = { epson: "Epson", serie: "série", reseau: "réseau" } as const;
  const option = (i: ImprimanteEtablissement) => (
    <option key={i.id} value={i.id}>
      {i.nom} ({TYPES[i.branchement.type]})
    </option>
  );
  const additions = liste.find((i) => i.id === config.imprimanteAdditionsId);
  return (
    <fieldset>
      <legend>Imprimantes de cet appareil</legend>
      {liste.length === 0 ? (
        <p className="aide-champ">
          Aucune imprimante dans l'établissement : ajoutez-les dans la rubrique « Imprimantes », ou connectez une Epson avec l'assistant.
        </p>
      ) : (
        <p className="aide-champ">Choisies sur chaque appareil, dans la liste de l'établissement (rubrique « Imprimantes »).</p>
      )}
      <label className="champ">
        <span>
          Tickets, notes et clôtures
          <small>{choisie ? `${descriptionBranchement(choisie, appareils)} · tiroir` : "Sans imprimante : aperçu à l'écran et QR code"}</small>
        </span>
        <select
          aria-label="Imprimante des tickets"
          value={tickets ?? ""}
          onChange={(e) => void majConfig({ ...config, imprimanteTicketsId: e.target.value || null })}
        >
          <option value="">{tickets === undefined ? "À choisir" : "Aucune"}</option>
          {liste.map(option)}
        </select>
      </label>
      {ancienne && (
        <p className="aide-champ">
          Réglage précédent encore en service (
          {ancienne.connexion === "serie" ? "imprimante série" : ancienne.connexion === "relais" ? `dalle ${ancienne.nom}` : ancienne.connexion === "reseau" ? ancienne.adresse : ""}
          ) : choisissez son imprimante ci-dessus.
        </p>
      )}
      <label className="champ">
        <span>
          Additions
          <small>{additions ? descriptionBranchement(additions, appareils) : "Note provisoire remise à table"}</small>
        </span>
        <select
          aria-label="Imprimante des additions"
          value={config.imprimanteAdditionsId ?? ""}
          onChange={(e) => void majConfig({ ...config, imprimanteAdditionsId: e.target.value || null })}
        >
          <option value="">Celle des tickets</option>
          {liste.map(option)}
        </select>
      </label>
      {impossibles.length > 0 && (
        <p className="erreur">
          {impossibles.map((i) => `« ${i.nom} »`).join(", ")} {impossibles.length > 1 ? "sont déclarées portées" : "est déclarée portée"} par cet appareil,
          qui ne peut ni ouvrir un port COM ni lancer le script : choisissez une dalle dans la rubrique « Imprimantes ».
        </p>
      )}
      <div className="options">
        <button className="bouton" disabled={!sortieTickets(config)} onClick={() => void imprimer(gabaritTest(config), "Test")}>
          <AvecIcone icone={Printer}>Imprimer un essai</AvecIcone>
        </button>
        <button className="bouton" onClick={() => void imprimer(gabaritTest(config), "Addition d'essai", { addition: true })}>
          <AvecIcone icone={Printer}>Imprimer une addition d'essai</AvecIcone>
        </button>
        <button className="bouton discret" onClick={props.onAssistant}>
          <AvecIcone icone={Printer}>Assistant de connexion Epson</AvecIcone>
        </button>
      </div>
    </fieldset>
  );
}

/**
 * Imprimantes que cette dalle porte (16 novembre 2026) : le port COM de chaque imprimante série
 * (autorisation de Chrome, propre à l'appareil), et le script des imprimantes réseau. Les autres
 * appareils impriment par elle : la caisse doit rester ouverte.
 */
export function ImprimantesPortees() {
  const { config, majConfig, notifier } = useCaisse();
  const portees = imprimantesPortees(config);
  const [ports, setPorts] = useState<number | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [message, setMessage] = useState<{ texte: string; erreur?: boolean } | null>(null);
  useEffect(() => {
    if (serieDisponible()) void portsAutorises().then(setPorts);
  }, [config.portsSerie]);
  if (!serieDisponible()) return null;

  const agir = async (action: () => Promise<void>, reussite: string) => {
    setEnCours(true);
    setMessage(null);
    try {
      await action();
      setMessage({ texte: reussite });
    } catch (e) {
      if (e instanceof DOMException && e.name === "NotFoundError") return;
      setMessage({ texte: e instanceof Error ? e.message : String(e), erreur: true });
    } finally {
      setEnCours(false);
    }
  };
  const cle = cleLogo(config);
  // Quatre petits tickets, un par commande de coupe partielle : Lionel dit lequel reste accroché (18 novembre 2026).
  const essaiCoupes = (i: ImprimanteEtablissement) =>
    agir(() => essaiCoupesPartielles(config, i), `Quatre tickets envoyés à « ${i.nom} » (A, B, C, D) : notez celui qui reste accroché.`);
  const essai = (i: ImprimanteEtablissement) => agir(() => imprimerIci(config, i, gabaritTest(config)), `Essai envoyé à « ${i.nom} ».`);

  return (
    <fieldset>
      <legend>Imprimantes portées par cette dalle</legend>
      {portees.length === 0 ? (
        <p className="aide-champ">
          Pour une imprimante branchée sur un port COM de cet ordinateur (Oxhoo…), ou une imprimante réseau envoyée par lui, ajoutez-la à la liste de
          l'établissement en choisissant « {config.caisseNom} » comme dalle, puis revenez ici.
        </p>
      ) : (
        <p className="aide-champ">
          Les autres appareils impriment par cette dalle : gardez la caisse ouverte, fenêtre visible. Le port COM ne sert qu'à un logiciel à
          la fois : fermez l'ancien logiciel de caisse.
        </p>
      )}
      {portees.map((i) => {
        const b = i.branchement;
        if (b.type === "reseau") {
          return (
            <div key={i.id} className="imprimante-portee">
              <h3 className="sous-titre-reglages">
                {i.nom} · réseau {b.adresse}
              </h3>
              <p className="aide-champ">
                Une fois : téléchargez le script, puis dans Windows clic droit › « Exécuter avec PowerShell ». Il se relance à chaque ouverture de
                session. Chrome demande ensuite d'autoriser l'accès au réseau local : acceptez.
              </p>
              <div className="options">
                <a className="bouton" href={URL_SCRIPT_RESEAU} download>
                  <AvecIcone icone={Download}>Télécharger le script</AvecIcone>
                </a>
                <button
                  className="bouton"
                  disabled={enCours}
                  onClick={() =>
                    void agir(async () => {
                      const v = await etatScriptReseau();
                      if (v === null) throw new Error("Le script ne répond pas sur cet ordinateur : installez-le, ou autorisez Chrome à accéder au réseau local.");
                    }, "Script lancé sur cet ordinateur.")
                  }
                >
                  <AvecIcone icone={RefreshCw}>Vérifier le script</AvecIcone>
                </button>
                <button className="bouton" disabled={enCours} onClick={() => void essai(i)}>
                  <AvecIcone icone={Printer}>Imprimer un essai</AvecIcone>
                </button>
                <button className="bouton" disabled={enCours} onClick={() => void essaiCoupes(i)}>
                  <AvecIcone icone={Scissors}>Essai des coupes</AvecIcone>
                </button>
              </div>
            </div>
          );
        }
        const port = config.portsSerie?.[i.id];
        const memoire = !!cle && port?.logoMemoire === cle;
        const choisir = () =>
          agir(async () => {
            const rang = await choisirPort();
            await majConfig({ ...config, portsSerie: { ...config.portsSerie, [i.id]: { rang, bauds: port?.bauds ?? BAUDS_PAR_DEFAUT } } });
            setPorts(await portsAutorises());
            notifier(`Port de « ${i.nom} » choisi.`);
          }, "Port choisi : imprimez un essai pour vérifier.");
        return (
          <div key={i.id} className="imprimante-portee">
            <h3 className="sous-titre-reglages">
              {i.nom} · série{port ? ` · ${port.bauds} bauds` : " · port à choisir"}
            </h3>
            {port && ports !== null && ports !== 1 && (
              <p className="aide-champ">
                {ports === 0
                  ? "Aucun port autorisé : choisissez-le de nouveau."
                  : `${ports} ports autorisés : n'autorisez que celui de l'imprimante (pas celui de la tireuse).`}
              </p>
            )}
            <div className="options">
              <button className={`bouton${port ? "" : " principal"}`} disabled={enCours} onClick={() => void choisir()}>
                <AvecIcone icone={Cable}>{port ? "Changer de port" : "Choisir le port"}</AvecIcone>
              </button>
              {port && (
                <>
                  <button className="bouton" disabled={enCours} onClick={() => void essai(i)}>
                    <AvecIcone icone={Printer}>Imprimer un essai</AvecIcone>
                  </button>
                  <button className="bouton" disabled={enCours} onClick={() => void essaiCoupes(i)}>
                    <AvecIcone icone={Scissors}>Essai des coupes</AvecIcone>
                  </button>
                  <button
                    className="bouton"
                    disabled={enCours}
                    onClick={() => void agir(() => envoyerSerie(new Recu().ouvrirTiroir(), { ...port, sansAccents: i.sansAccents }), "Ouverture du tiroir envoyée.")}
                  >
                    <AvecIcone icone={Vault}>Ouvrir le tiroir</AvecIcone>
                  </button>
                  {cle && !memoire && (
                    <button
                      className="bouton"
                      disabled={enCours}
                      onClick={() =>
                        void agir(async () => {
                          const logo = await logoSerie(config);
                          if (!logo) throw new Error("Logo illisible : vérifiez la connexion, puis réessayez.");
                          await envoyerOctets(definirLogoMemoire(logo), port);
                          const suite = { ...config, portsSerie: { ...config.portsSerie, [i.id]: { ...port, logoMemoire: cle } } };
                          await majConfig(suite);
                          await imprimerIci(suite, i, gabaritTest(suite));
                        }, "Logo enregistré dans l'imprimante : l'essai doit sortir avec le logo. Sinon, touchez « Envoyer le logo avec chaque ticket ».")
                      }
                    >
                      <AvecIcone icone={Image}>Enregistrer le logo dans l'imprimante</AvecIcone>
                    </button>
                  )}
                  {memoire && (
                    <button
                      className="bouton"
                      disabled={enCours}
                      onClick={() =>
                        void agir(async () => {
                          const { logoMemoire: _, ...sans } = port;
                          await majConfig({ ...config, portsSerie: { ...config.portsSerie, [i.id]: sans } });
                        }, "Le logo partira de nouveau avec chaque ticket (plus lent).")
                      }
                    >
                      <AvecIcone icone={Image}>Envoyer le logo avec chaque ticket</AvecIcone>
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })}
      {!portees.some((i) => i.branchement.type === "reseau") && (
        <div className="imprimante-portee">
          <h3 className="sous-titre-reglages">Script d'impression réseau</h3>
          <p className="aide-champ">
            Pour une imprimante réseau envoyée par cet ordinateur (Oxhoo de la salle) : téléchargez le script, puis dans Windows clic droit ›
            « Exécuter avec PowerShell ». Déclarez ensuite l'imprimante dans la liste (« Réseau par une dalle », « {config.caisseNom} »).
          </p>
          <div className="options">
            <a className="bouton" href={URL_SCRIPT_RESEAU} download>
              <AvecIcone icone={Download}>Télécharger le script</AvecIcone>
            </a>
            <button
              className="bouton"
              disabled={enCours}
              onClick={() =>
                void agir(async () => {
                  if ((await etatScriptReseau()) === null) {
                    throw new Error("Le script ne répond pas sur cet ordinateur : installez-le, ou autorisez Chrome à accéder au réseau local.");
                  }
                }, "Script lancé sur cet ordinateur.")
              }
            >
              <AvecIcone icone={RefreshCw}>Vérifier le script</AvecIcone>
            </button>
          </div>
        </div>
      )}
      {message && <p className={message.erreur ? "erreur" : "succes"} role="status">{message.texte}</p>}
    </fieldset>
  );
}
