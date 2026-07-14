import { createRoot } from "react-dom/client";
import { App } from "./app";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./styles.css";

// Register the push service worker (best-effort; push is optional).
if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("/sw.js")
    .catch((err) => console.warn("[holston] Service worker registration failed:", err));
}

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
