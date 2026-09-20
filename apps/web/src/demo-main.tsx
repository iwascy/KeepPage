import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { loadDemoDataSource } from "./data-sources/use-app-data-source";
import "./styles.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Missing #root element");
}

async function mount() {
  await loadDemoDataSource();
  createRoot(rootElement!).render(
  <StrictMode>
    <App dataSourceKind="demo" />
  </StrictMode>,
);

}

void mount();
