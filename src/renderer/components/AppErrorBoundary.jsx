import { Component } from "react";
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
      return (
        <main className="container">
          <section className="workspace-shell">
            <section className="card">
              <div className="workspace-section-heading">
                <div>
                  <p className="panel-eyebrow">Renderer Error</p>
                  <h2>Application failed to render</h2>
                  <p className="section-subtitle">
                    The React renderer crashed before the interface finished loading.
                  </p>
                </div>
              </div>
              <div className="status-stack">
                <p className="error">{error.message || String(error)}</p>
                <p className="muted status-line">
                  See the startup log for details and reload the app after the fix.
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
