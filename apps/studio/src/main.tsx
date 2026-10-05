// VideoOS Studio entry: React 18 root + i18n provider (语言即时切换的根)。
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { I18nProvider } from "./i18n";
import "./styles.css";

const rootEl = document.getElementById("root");
if (rootEl === null) throw new Error("VideoOS Studio: #root element missing");

createRoot(rootEl).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
);
