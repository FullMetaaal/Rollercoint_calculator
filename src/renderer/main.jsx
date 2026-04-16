import ReactDOM from "react-dom/client";
import App from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { writeRendererLog } from "./lib/runtime";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("React root element was not found.");
}

window.addEventListener("error", (event) => {
  writeRendererLog("window.error", {
    message: event.error?.message || event.message || "Unknown error",
    stack: event.error?.stack || "",
  });
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  writeRendererLog("window.unhandledrejection", {
    message: reason?.message || String(reason),
    stack: reason?.stack || "",
  });
});

ReactDOM.createRoot(rootElement).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>,
);
