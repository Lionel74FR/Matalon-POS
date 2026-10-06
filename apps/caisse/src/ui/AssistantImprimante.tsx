import { ArrowLeft, ArrowRight, Ban, Banknote, Check, Clock, ExternalLink, Printer, RotateCw, X } from "lucide-react";
import { AvecIcone } from "./icones";
import { NOM_APPAREIL } from "../donnees/appareil";
import { useEffect, useState } from "react";
import type { Configuration } from "../donnees/configuration";
import { ADRESSE_IPV4, envoyerEpson, ErreurImpression, testerEpson, type EtatImprimante } from "../impression/epson";
import { gabaritTest } from "../impression/gabarits";
import { Recu } from "../impression/recu";

type Imprimante = Configuration["imprimante"];

const ETAPES = ["Brancher", "Adresse", "Autoriser", "Connexion", "Impression", "Tiroir"] as const;

type Test =
  | { etat: "en cours" }
  | { etat: "ok"; info: EtatImprimante }
  | { etat: "probleme"; info: EtatImprimante }
  | { etat: "echec"; erreur: ErreurImpression };

/**
 * Assistant de première connexion de l'imprimante Epson TM-m30III :
 * branchement, adresse IP, certificat, test de connexion, test d'impression,
 * tiroir-caisse. Accessible à la mise en service et depuis les réglages.
 */
export function AssistantImprimante(props: {
  config: Configuration;
  onTerminer: (imprimante: Imprimante) => void;
  onPlusTard: () => void;
}) {
  const [etape, setEtape] = useState(0);
  const [adresse, setAdresse] = useState(props.config.imprimante.adresse);
  const [sansAccents, setSansAccents] = useState(props.config.imprimante.sansAccents);
  const [test, setTest] = useState<Test | null>(null);
  const [impression, setImpression] = useState<"attente" | "envoyee" | "erreur">("attente");
  const [tiroir, setTiroir] = useState<"attente" | "envoye" | "bloque">("attente");
  const [message, setMessage] = useState("");
  const adresseValide = ADRESSE_IPV4.test(adresse.trim());
  const ip = adresse.trim();

  const lancerTest = async () => {
    setTest({ etat: "en cours" });
    try {
      const info = await testerEpson(ip);
      setTest(info.pret ? { etat: "ok", info } : { etat: "probleme", info });
    } catch (e) {
      setTest({ etat: "echec", erreur: e instanceof ErreurImpression ? e : new ErreurImpression(String(e), "injoignable") });
    }
  };

  useEffect(() => {
    if (etape === 3) void lancerTest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [etape]);

  const imprimerTest = async (accents: boolean) => {
    setMessage("");
    setSansAccents(!accents);
    try {
      await envoyerEpson(ip, gabaritTest(props.config), { sansAccents: !accents });
      setImpression("envoyee");
    } catch (e) {
      setImpression("erreur");
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };

  const ouvrirTiroir = async () => {
    setMessage("");
    try {
      await envoyerEpson(ip, new Recu().ouvrirTiroir(), { sansAccents });
      setTiroir("envoye");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };

  const terminer = () => props.onTerminer({ adresse: ip, sansAccents });

  return (
    <div className="assistant">
      <aside className="assistant-etapes">
        <h1>Connecter l'imprimante</h1>
        <p>Epson TM-m30III</p>
        <ol>
          {ETAPES.map((nom, i) => (
            <li key={nom} className={i === etape ? "courante" : i < etape ? "faite" : ""} aria-current={i === etape ? "step" : undefined}>
              <span className="pastille-etape">{i < etape ? "✓" : i + 1}</span>
              {nom}
            </li>
          ))}
        </ol>
        <button className="bouton discret" onClick={props.onPlusTard}>
          <AvecIcone icone={Clock}>Configurer plus tard</AvecIcone>
        </button>
      </aside>

      <section className="assistant-contenu">
        {etape === 0 && (
          <>
            <h2>Brancher l'imprimante</h2>
            <ol className="consignes">
              <li>Branchez l'alimentation, placez le rouleau de papier de 80 mm et fermez le capot. Le voyant vert doit être allumé.</li>
              <li>
                Reliez l'imprimante à la box de l'établissement avec un câble réseau, sur le port <strong>LAN</strong> à l'arrière. En Wi-Fi,
                connectez-la d'abord avec l'app gratuite Epson TM Utility sur l'{NOM_APPAREIL}.
              </li>
              <li>
                Branchez le câble du tiroir-caisse sur la prise <strong>DK</strong> à l'arrière de l'imprimante.
              </li>
              <li>Vérifiez que l'{NOM_APPAREIL} est connecté au Wi-Fi de l'établissement, le même réseau que l'imprimante.</li>
            </ol>
            <div className="assistant-actions">
              <button className="bouton principal grand" onClick={() => setEtape(1)}>
                <AvecIcone icone={Check}>C'est branché</AvecIcone>
              </button>
            </div>
          </>
        )}

        {etape === 1 && (
          <>
            <h2>Trouver l'adresse de l'imprimante</h2>
            <ol className="consignes">
              <li>
                Imprimante allumée, appuyez quelques secondes avec la pointe d'un stylo sur le petit bouton enfoncé à l'arrière,
                près du port réseau : une feuille d'état s'imprime.
              </li>
              <li>
                Repérez la ligne <strong>IP Address</strong> et saisissez-la ci-dessous.
              </li>
            </ol>
            <label className="champ champ-ip">
              <span>Adresse IP</span>
              <input
                value={adresse}
                inputMode="decimal"
                placeholder="192.168.1.50"
                autoFocus
                onChange={(e) => setAdresse(e.target.value.replace(/[^\d.]/g, ""))}
              />
            </label>
            {adresse && !adresseValide && <p className="erreur">Une adresse IP s'écrit comme 192.168.1.50.</p>}
            <p className="explication">
              Pour que l'adresse ne change jamais, réservez-la dans les réglages de la box (« bail DHCP fixe »). Sinon, après une
              coupure, la caisse peut ne plus trouver l'imprimante.
            </p>
            <div className="assistant-actions">
              <button className="bouton" onClick={() => setEtape(0)}>
                <AvecIcone icone={ArrowLeft}>Retour</AvecIcone>
              </button>
              <button className="bouton principal grand" disabled={!adresseValide} onClick={() => setEtape(2)}>
                <AvecIcone icone={ArrowRight}>Continuer</AvecIcone>
              </button>
            </div>
          </>
        )}

        {etape === 2 && (
          <>
            <h2>Autoriser la connexion sécurisée</h2>
            <p className="explication">
              La caisse parle à l'imprimante en connexion chiffrée. L'{NOM_APPAREIL} doit accepter une fois le certificat de l'imprimante.
            </p>
            <ol className="consignes">
              <li>Touchez « Ouvrir l'imprimante » : Safari affiche « Cette connexion n'est pas privée ». C'est normal.</li>
              <li>Touchez « Afficher les détails », puis « consulter ce site web », puis confirmez.</li>
              <li>La page Epson s'affiche. Rien à y modifier : revenez sur la caisse.</li>
            </ol>
            <div className="assistant-actions">
              <button className="bouton" onClick={() => setEtape(1)}>
                <AvecIcone icone={ArrowLeft}>Retour</AvecIcone>
              </button>
              <a className="bouton" href={`https://${ip}/`} target="_blank" rel="noreferrer">
                <AvecIcone icone={ExternalLink}>Ouvrir l'imprimante</AvecIcone>
              </a>
              <button className="bouton principal grand" onClick={() => setEtape(3)}>
                <AvecIcone icone={Check}>C'est fait, tester</AvecIcone>
              </button>
            </div>
          </>
        )}

        {etape === 3 && (
          <>
            <h2>Test de connexion</h2>
            {test?.etat === "en cours" && <p className="explication">Recherche de l'imprimante à {ip}…</p>}
            {test?.etat === "ok" && (
              <>
                <p className="succes">L'imprimante répond et elle est prête.</p>
                {test.info.papierBientotFini && <p className="erreur">Le rouleau de papier est presque fini.</p>}
              </>
            )}
            {test?.etat === "probleme" && (
              <>
                <p className="erreur">L'imprimante répond mais signale : {test.info.problemes.join(", ")}.</p>
                <p className="explication">Corrigez le problème, puis relancez le test.</p>
              </>
            )}
            {test?.etat === "echec" && test.erreur.cause_ === "certificat" && (
              <>
                <p className="erreur">{test.erreur.message}</p>
                <p className="explication">Revenez à l'étape précédente et acceptez le certificat dans Safari.</p>
              </>
            )}
            {test?.etat === "echec" && test.erreur.cause_ !== "certificat" && (
              <>
                <p className="erreur">{test.erreur.message}</p>
                <ul className="consignes">
                  <li>Le voyant vert de l'imprimante est-il allumé ?</li>
                  <li>L'adresse saisie ({ip}) est-elle celle de la feuille d'état ?</li>
                  <li>L'{NOM_APPAREIL} est-il sur le Wi-Fi de l'établissement, et non en 4G ou sur un Wi-Fi invité ?</li>
                </ul>
              </>
            )}
            <div className="assistant-actions">
              <button className="bouton" onClick={() => setEtape(test?.etat === "echec" && test.erreur.cause_ === "injoignable" ? 1 : 2)}>
                <AvecIcone icone={ArrowLeft}>Retour</AvecIcone>
              </button>
              <button className="bouton" disabled={test?.etat === "en cours"} onClick={() => void lancerTest()}>
                <AvecIcone icone={RotateCw}>Relancer le test</AvecIcone>
              </button>
              <button className="bouton principal grand" disabled={test?.etat !== "ok"} onClick={() => setEtape(4)}>
                <AvecIcone icone={ArrowRight}>Continuer</AvecIcone>
              </button>
            </div>
          </>
        )}

        {etape === 4 && (
          <>
            <h2>Test d'impression</h2>
            {impression === "attente" && (
              <p className="explication">Un ticket de test va sortir, avec des accents et le symbole euro.</p>
            )}
            {impression === "envoyee" && <p className="explication">Le ticket est-il sorti correctement ?</p>}
            {impression === "erreur" && <p className="erreur">{message}</p>}
            <div className="assistant-actions">
              {impression !== "envoyee" ? (
                <button className="bouton principal grand" onClick={() => void imprimerTest(true)}>
                  <AvecIcone icone={Printer}>Imprimer un ticket de test</AvecIcone>
                </button>
              ) : (
                <>
                  <button className="bouton" onClick={() => { setImpression("attente"); setEtape(3); }}>
                    <AvecIcone icone={X}>Rien n'est sorti</AvecIcone>
                  </button>
                  <button className="bouton" onClick={() => void imprimerTest(false)}>
                    <AvecIcone icone={RotateCw}>Accents déformés : réimprimer sans accents</AvecIcone>
                  </button>
                  <button className="bouton principal grand" onClick={() => setEtape(5)}>
                    <AvecIcone icone={Check}>Le ticket est correct</AvecIcone>
                  </button>
                </>
              )}
            </div>
          </>
        )}

        {etape === 5 && (
          <>
            <h2>Tiroir-caisse</h2>
            <p className="explication">Le tiroir s'ouvre par l'imprimante à chaque paiement en espèces.</p>
            {tiroir === "bloque" && (
              <p className="erreur">
                Vérifiez que le câble du tiroir est bien branché sur la prise DK de l'imprimante, et non sur le port réseau.
              </p>
            )}
            {message && <p className="erreur">{message}</p>}
            <div className="assistant-actions">
              {tiroir === "attente" || tiroir === "bloque" ? (
                <>
                  <button className="bouton" onClick={terminer}>
                    <AvecIcone icone={Ban}>Pas de tiroir</AvecIcone>
                  </button>
                  <button className="bouton principal grand" onClick={() => void ouvrirTiroir()}>
                    <AvecIcone icone={Banknote}>Ouvrir le tiroir</AvecIcone>
                  </button>
                </>
              ) : (
                <>
                  <button className="bouton" onClick={() => setTiroir("bloque")}>
                    <AvecIcone icone={X}>Il ne s'est pas ouvert</AvecIcone>
                  </button>
                  <button className="bouton principal grand" onClick={terminer}>
                    <AvecIcone icone={Check}>Il s'est ouvert, terminer</AvecIcone>
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
