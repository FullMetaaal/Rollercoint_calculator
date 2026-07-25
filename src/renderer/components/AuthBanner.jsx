export function AuthBanner({ market, onAuthAction, onCheckUpdates, i18n }) {
  const { t, rt } = i18n;
  const statusClass =
    market.authStatus === "valid"
      ? "auth-valid"
      : market.authStatus === "invalid"
        ? "auth-invalid"
        : "auth-checking";
  const updateTone =
    market.appUpdateStatus === "error"
      ? "error"
      : market.appUpdateStatus === "update-available" ||
        market.appUpdateStatus === "update-downloaded" ||
        market.appUpdateStatus === "installing-update" ||
        market.appUpdateStatus === "up-to-date"
        ? "success"
        : "neutral";

  return (
    <div className="auth-banner" id="authBanner">
      <div className={`auth-toggle ${statusClass}`} id="authTokenIndicator" aria-hidden="true">
        <span className="auth-toggle-knob"></span>
      </div>
      <div className="auth-meta">
        <div className="auth-title">{t("auth_title")}</div>
        <div className="auth-subtitle" id="authTokenMessage">{rt(market.authMessage)}</div>
      </div>
      <div className="auth-actions">
        <div className="auth-action-row">
          <button
            id="rollercoinLoginBtn"
            type="button"
            className="ghost"
            onClick={onAuthAction}
            disabled={market.authChecking}
          >
            {market.authChecking ? t("auth_checking") : market.authStatus === "invalid" ? t("auth_login_button") : t("auth_check_button")}
          </button>
          <button
            id="checkAppUpdatesBtn"
            type="button"
            className="ghost"
            onClick={onCheckUpdates}
            disabled={market.appUpdateChecking}
          >
            {market.appUpdateChecking ? t("auth_checking") : t("auth_updates_button")}
          </button>
        </div>
        {market.appUpdateMessage ? (
          <p className={`auth-update-note is-${updateTone}`} aria-live="polite">
            {rt(market.appUpdateMessage)}
          </p>
        ) : null}
      </div>
    </div>
  );
}
