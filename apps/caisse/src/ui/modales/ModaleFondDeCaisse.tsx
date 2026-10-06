import { Clock, Save } from "lucide-react";
import { AvecIcone } from "../icones";
import { useState } from "react";
import { centimesDepuisSaisie, ChampEuros, Modale, saisieDepuisCentimes } from "../communs";
import { euros, useCaisse } from "../contexte";

/** Ouverture de la journée : le fond de caisse est déclaré et tracé au journal. */
export function ModaleFondDeCaisse(props: { propose: number | null; onDeclare: (montant: number) => void; onPlusTard: () => void }) {
  const { caisse, utilisateur, notifier } = useCaisse();
  const [saisie, setSaisie] = useState(saisieDepuisCentimes(props.propose));
  const [enCours, setEnCours] = useState(false);
  const montant = centimesDepuisSaisie(saisie);

  const declarer = async () => {
    if (montant == null) return;
    setEnCours(true);
    try {
      await caisse.registre.journaliser("FOND_DE_CAISSE", { montant }, utilisateur.id);
      notifier(`Fond de caisse de ${euros(montant)} enregistré.`);
      props.onDeclare(montant);
    } catch (e) {
      notifier(String(e), "erreur");
      setEnCours(false);
    }
  };

  return (
    <Modale
      titre="Fond de caisse"
      onFermer={props.onPlusTard}
      pied={
        <>
          <button className="bouton" onClick={props.onPlusTard}>
            <AvecIcone icone={Clock}>Plus tard</AvecIcone>
          </button>
          <button className="bouton principal" disabled={montant == null || enCours} onClick={() => void declarer()}>
            <AvecIcone icone={Save}>Enregistrer le fond</AvecIcone>
          </button>
        </>
      }
    >
      <p className="explication">
        Comptez les espèces présentes dans le tiroir avant le premier encaissement. Ce montant sert de point de départ au
        comptage de la clôture Z.
      </p>
      <ChampEuros
        libelle="Fond de caisse"
        aide={props.propose != null ? `Fond laissé hier soir : ${euros(props.propose)}` : undefined}
        valeur={saisie}
        onChange={setSaisie}
        autoFocus
      />
    </Modale>
  );
}
