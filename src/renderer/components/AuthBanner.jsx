export function AuthBanner({ market, onAuthAction, onCheckUpdates }) {
  const statusClass =
    market.authStatus === "valid"
      ? "auth-valid"
      : market.authStatus === "invalid"
        ? "auth-invalid"
        : "auth-checking";

  return (
    <div className="auth-banner" id="authBanner">
      <div className={`auth-toggle ${statusClass}`} id="authTokenIndicator" aria-hidden="true">
        <span className="auth-toggle-knob"></span>
      </div>
      <div className="auth-meta">
        <div className="auth-title">RollerCoin Auth</div>
        <div className="auth-subtitle" id="authTokenMessage">{market.authMessage}</div>
      </div>
      <div className="auth-actions">
        <button
          id="rollercoinLoginBtn"
          type="button"
          className="ghost"
          onClick={onAuthAction}
          disabled={market.authChecking}
        >
          {market.authChecking ? "Checking..." : market.authStatus === "invalid" ? "Login required" : "Check auth"}
        </button>
        <button
          id="checkAppUpdatesBtn"
          type="button"
          className="ghost"
          onClick={onCheckUpdates}
          disabled={market.appUpdateChecking}
        >
          {market.appUpdateChecking ? "Checking..." : "Check for app updates"}
        </button>
      </div>
    </div>
  );
}
