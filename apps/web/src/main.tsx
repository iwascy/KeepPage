import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const dataSourceKind = import.meta.env.VITE_APP_MODE === "mock" ? "demo" : "live";
const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Missing #root element");
}

createRoot(rootElement).render(
  <StrictMode>
    <App dataSourceKind={dataSourceKind} />
  </StrictMode>,
);
