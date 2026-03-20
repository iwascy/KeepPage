import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./tailwind.css";
import "./styles.css";

const appMode = import.meta.env.VITE_APP_MODE === "mock" ? "mock" : "live";
const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Missing #root element");
}

createRoot(rootElement).render(
  <StrictMode>
    <App mode={appMode} />
  </StrictMode>,
);
