import { Component } from "react";
import { createI18n, restoreLocale } from "../lib/i18n";
import { writeRendererLog } from "../lib/runtime";

export class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, errorInfo) {
    writeRendererLog("React render crash", {
      message: error?.message || String(error),
      stack: error?.stack || "",
      componentStack: errorInfo?.componentStack || "",
    });
  }

  render() {
    const { error } = this.state;
    if (error) {
      const i18n = createI18n(restoreLocale());
      return (
        <main className="container">
          <section className="workspace-shell">
            <section className="card">
              <div className="workspace-section-heading">
                <div>
                  <p className="panel-eyebrow">{i18n.t("renderer_error_eyebrow")}</p>
                  <h2>{i18n.t("renderer_error_title")}</h2>
                  <p className="section-subtitle">
                    {i18n.t("renderer_error_copy")}
                  </p>
                </div>
              </div>
              <div className="status-stack">
                <p className="error">{error.message || String(error)}</p>
                <p className="muted status-line">
                  {i18n.t("renderer_error_hint")}
                </p>
              </div>
            </section>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}
