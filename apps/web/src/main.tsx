import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { getCoverImagePreconnectUrl } from "./lib/cover-image";
import "./styles.css";

const dataSourceKind = import.meta.env.VITE_APP_MODE === "mock" ? "demo" : "live";
const rootElement = document.getElementById("root");
const coverImagePreconnectUrl = getCoverImagePreconnectUrl();

if (coverImagePreconnectUrl) {
  const link = document.createElement("link");
  link.rel = "preconnect";
  link.href = coverImagePreconnectUrl;
  link.crossOrigin = "";
  document.head.append(link);
}

if (!rootElement) {
  throw new Error("Missing #root element");
}

createRoot(rootElement).render(
  <StrictMode>
    <App dataSourceKind={dataSourceKind} />
  </StrictMode>,
);
