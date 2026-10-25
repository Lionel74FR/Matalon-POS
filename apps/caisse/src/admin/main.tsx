import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/atkinson-hyperlegible/700.css";
import "@fontsource/bricolage-grotesque/500.css";
import "@fontsource/bricolage-grotesque/700.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles.css";
import "./admin.css";
import "./edition.css";
import "./theme.css";
import { Administration } from "./Administration";
import { appliquerTheme, themeEnregistre } from "./Coque";
import { etiqueterTableaux } from "./etiquettes";

// Thème posé avant le premier rendu : pas d'éclair d'un thème à l'autre au chargement.
appliquerTheme(themeEnregistre());

createRoot(document.getElementById("racine")!).render(
  <StrictMode>
    <Administration />
  </StrictMode>,
);
etiqueterTableaux();
