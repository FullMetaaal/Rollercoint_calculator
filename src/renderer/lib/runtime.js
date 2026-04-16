function getWindowRequire() {
  if (typeof window === "undefined") return null;
  return typeof window.require === "function" ? window.require : null;
}

export function getRuntimeModule(name) {
  const runtimeRequire = getWindowRequire();
  if (!runtimeRequire) return null;

  try {
    return runtimeRequire(name);
  } catch {
    return null;
  }
}

export function getIpcRenderer() {
  return getRuntimeModule("electron")?.ipcRenderer || null;
}

export function getFs() {
  return getRuntimeModule("fs");
}

export function getPath() {
  return getRuntimeModule("path");
}

export function getOs() {
  return getRuntimeModule("os");
}

export function writeRendererLog(message, extra = null) {
  const fs = getFs();
  const path = getPath();
  const os = getOs();
  if (!fs || !path || !os) return;

  const suffix = extra ? ` ${JSON.stringify(extra)}` : "";
  const startupLogPath = path.join(os.tmpdir(), "roller-coin-calculator-startup.log");

  try {
    fs.appendFileSync(
      startupLogPath,
      `[${new Date().toISOString()}] [react-renderer] ${message}${suffix}\n`,
      "utf8",
    );
  } catch {
    // Ignore logging failures in renderer.
  }
}
