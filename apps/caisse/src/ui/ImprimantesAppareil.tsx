import { Cable, Download, Image, Printer, RefreshCw, Vault } from "lucide-react";
import { useEffect, useState } from "react";
import { NOM_APPAREIL } from "../donnees/appareil";
import { sortieTickets } from "../donnees/configuration";
import { definirLogoMemoire } from "../impression/escpos";
import { gabaritTest } from "../impression/gabarits";
import { descriptionBranchement, imprimantesPortees, imprimerIci, type ImprimanteEtablissement } from "../impression/imprimantes";
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
  const additions = config.imprimanteAdditionsId ?? null;
  const ancienne = tickets === undefined ? sortieTickets(config) : null;
  const choix = (valeur: string | null | undefined, nom: string, onChoisir: (id: string | null) => void, aucune: string) => (
    <div className="options" role="radiogroup" aria-label={nom}>
      {liste.map((i) => (
        <button key={i.id} role="radio" aria-checked={valeur === i.id} className={`bouton${valeur === i.id ? " actif" : ""}`} onClick={() => onChoisir(i.id)}>
          {i.nom}
          <small> · {descriptionBranchement(i, appareils)}</small>
        </button>
      ))}
      <button role="radio" aria-checked={valeur === null} className={`bouton${valeur === null ? " actif" : ""}`} onClick={() => onChoisir(null)}>
        {aucune}
      </button>
    </div>
  );
  const epson = liste.find((i) => i.id === tickets)?.branchement.type === "epson";
  return (
    <fieldset>
      <legend>Imprimantes de cet {NOM_APPAREIL}</legend>
      {liste.length === 0 ? (
        <p className="aide-champ">
          Aucune imprimante dans l'établissement : ajoutez-les plus bas (« Imprimantes de l'établissement »), ou connectez une Epson avec l'assistant.
        </p>
      ) : (
        <p className="aide-champ">Choisies sur chaque appareil dans la liste de l'établissement.</p>
      )}
      <h3 className="sous-titre-reglages">Tickets, notes et clôtures</h3>
      {ancienne && (
        <p className="aide-champ">
          Réglage précédent en service ({ancienne.connexion === "serie" ? "imprimante série" : ancienne.connexion === "relais" ? `dalle ${ancienne.nom}` : ancienne.connexion === "reseau" ? ancienne.adresse : ""}) :
          choisissez son imprimante dans la liste.
        </p>
      )}
      {choix(tickets, "Imprimante des tickets", (id) => void majConfig({ ...config, imprimanteTicketsId: id }), "Aucune (aperçu à l'écran, QR code)")}
      <h3 className="sous-titre-reglages">Additions</h3>
      {choix(additions, "Imprimante des additions", (id) => void majConfig({ ...config, imprimanteAdditionsId: id }), "Celle des tickets")}
      <div className="options">
        <button className="bouton" disabled={!sortieTickets(config)} onClick={() => void imprimer(gabaritTest(config), "Test")}>
          <AvecIcone icone={Printer}>Imprimer un essai</AvecIcone>
        </button>
        <button className="bouton" onClick={() => void imprimer(gabaritTest(config), "Addition d'essai", { addition: true })}>
          <AvecIcone icone={Printer}>Imprimer une addition d'essai</AvecIcone>
        </button>
        <button className={`bouton${epson || !liste.length ? " principal" : ""}`} onClick={props.onAssistant}>
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
  const essai = (i: ImprimanteEtablissement) => agir(() => imprimerIci(config, i, gabaritTest(config)), `Essai envoyé à « ${i.nom} ».`);

  return (
    <fieldset>
      <legend>Imprimantes portées par cet {NOM_APPAREIL}</legend>
      {portees.length === 0 ? (
        <p className="aide-champ">
          Pour une imprimante branchée sur un port COM de cet ordinateur (Oxhoo…), ou une imprimante réseau envoyée par lui, ajoutez-la à la liste de
          l'établissement en choisissant « {config.caisseNom} » comme dalle, puis revenez ici.
        </p>
      ) : (
        <p className="aide-champ">
          Les autres appareils impriment par cet {NOM_APPAREIL} : gardez la caisse ouverte, fenêtre visible. Le port COM ne sert qu'à un logiciel à
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
      {message && <p className={message.erreur ? "erreur" : "succes"} role="status">{message.texte}</p>}
    </fieldset>
  );
}
