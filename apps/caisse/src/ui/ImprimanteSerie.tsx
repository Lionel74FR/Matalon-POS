import { Cable, Printer, Unplug, Vault } from "lucide-react";
import { useEffect, useState } from "react";
import { gabaritTest } from "../impression/gabarits";
import { Recu } from "../impression/recu";
import { BAUDS_PAR_DEFAUT, choisirPort, envoyerSerie, portsAutorises, serieDisponible } from "../impression/serie";
import { useCaisse } from "./contexte";
import { AvecIcone } from "./icones";

/**
 * Réglage de l'imprimante série de cet appareil (15 novembre 2026, caisses du Chardon) : une
 * imprimante branchée sur un port COM de l'ordinateur (Oxhoo TP85), utilisée par Chrome. Elle
 * remplace l'imprimante Epson pour les tickets de cet appareil seulement. Invisible là où le
 * navigateur n'a pas de port série (iPad, iPhone) : rien n'y change.
 */
export function ImprimanteSerie() {
  const { config, majConfig, notifier } = useCaisse();
  const s = config.imprimanteSerie;
  const [ports, setPorts] = useState<number | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [message, setMessage] = useState<{ texte: string; erreur?: boolean } | null>(null);
  useEffect(() => {
    if (serieDisponible()) void portsAutorises().then(setPorts);
  }, [s]);
  if (!serieDisponible()) return null;

  const agir = async (action: () => Promise<void>, reussite: string) => {
    setEnCours(true);
    setMessage(null);
    try {
      await action();
      setMessage({ texte: reussite });
    } catch (e) {
      // Fenêtre de Chrome fermée sans choisir de port : rien à signaler.
      if (e instanceof DOMException && e.name === "NotFoundError") return;
      setMessage({ texte: e instanceof Error ? e.message : String(e), erreur: true });
    } finally {
      setEnCours(false);
    }
  };

  const choisir = () =>
    agir(async () => {
      const rang = await choisirPort();
      await majConfig({ ...config, imprimanteSerie: { rang, bauds: s?.bauds ?? BAUDS_PAR_DEFAUT, sansAccents: s?.sansAccents ?? false } });
      setPorts(await portsAutorises());
      notifier("Imprimante série choisie pour les tickets de cet appareil.");
    }, "Port choisi : imprimez un essai pour vérifier.");

  return (
    <fieldset>
      <legend>Imprimante série (port COM)</legend>
      <p className="aide-champ">
        Pour une imprimante branchée sur un port COM de cet ordinateur (Oxhoo TP85…), réglée en 9600 bauds, 8N1, sans contrôle de flux. Elle
        imprime les tickets, notes et clôtures de cet appareil à la place de l'imprimante Epson, et ouvre le tiroir. Le port ne sert qu'à un
        logiciel à la fois : fermez l'ancien logiciel de caisse.
      </p>
      {!s ? (
        <button className="bouton" disabled={enCours} onClick={() => void choisir()}>
          <AvecIcone icone={Cable}>Utiliser une imprimante série</AvecIcone>
        </button>
      ) : (
        <>
          <p className="explication imprimante-serie-etat">
            Tickets de cet appareil sur l'imprimante série · {s.bauds} bauds · {s.sansAccents ? "sans accents" : "accents et euro (PC858)"}
            {ports !== null && ports !== 1 && (
              <>
                <br />
                {ports === 0
                  ? "Aucun port autorisé : choisissez-le de nouveau."
                  : `${ports} ports autorisés : la caisse utilise celui choisi en dernier. N'autorisez que celui de l'imprimante (pas celui de la tireuse).`}
              </>
            )}
          </p>
          <div className="options">
            <button className="bouton" disabled={enCours} onClick={() => void agir(() => envoyerSerie(gabaritTest(config), s), "Essai envoyé à l'imprimante série.")}>
              <AvecIcone icone={Printer}>Imprimer un essai</AvecIcone>
            </button>
            <button className="bouton" disabled={enCours} onClick={() => void agir(() => envoyerSerie(new Recu().ouvrirTiroir(), s), "Ouverture du tiroir envoyée.")}>
              <AvecIcone icone={Vault}>Ouvrir le tiroir</AvecIcone>
            </button>
            <button className="bouton" disabled={enCours} onClick={() => void choisir()}>
              <AvecIcone icone={Cable}>Changer de port</AvecIcone>
            </button>
            <button
              className="bouton"
              disabled={enCours}
              onClick={() =>
                void agir(async () => {
                  const { imprimanteSerie: _, ...reste } = config;
                  await majConfig(reste);
                }, "Les tickets de cet appareil repartent sur l'imprimante Epson.")
              }
            >
              <AvecIcone icone={Unplug}>Ne plus l'utiliser</AvecIcone>
            </button>
          </div>
          <label className="case">
            <input type="checkbox" checked={s.sansAccents} onChange={(e) => void majConfig({ ...config, imprimanteSerie: { ...s, sansAccents: e.target.checked } })} />
            Imprimer sans accents (si l'euro ou les accents sortent mal)
          </label>
        </>
      )}
      {message && <p className={message.erreur ? "erreur" : "succes"} role="status">{message.texte}</p>}
    </fieldset>
  );
}
