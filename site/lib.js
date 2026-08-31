export const GITHUB_API_BASE = "https://api.github.com";
export const GITHUB_API_VERSION = "2026-03-10";
export const DEFAULT_PORT = 3000;
export const DEFAULT_PORT_DOMAIN = "app.github.dev";

export const TERMINAL_ERROR_STATES = new Set([
  "failed",
  "unavailable",
]);

export function normalizeState(state) {
  return String(state || "Unknown").trim() || "Unknown";
}

export function stateKey(state) {
  return normalizeState(state).toLowerCase();
}

export function isAvailableState(state) {
  return stateKey(state) === "available";
}

export function isStoppedState(state) {
  const key = stateKey(state);
  return key === "shutdown" || key === "stopped";
}

export function isTerminalErrorState(state) {
  return TERMINAL_ERROR_STATES.has(stateKey(state));
}

export function sanitizeCodespaceName(value) {
  const name = String(value || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/.test(name)) {
    throw new Error("Invalid Codespace name.");
  }
  return name;
}

export function sanitizePortDomain(value) {
  const domain = String(value || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (
    !domain ||
    domain.length > 253 ||
    !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(domain) ||
    domain.includes("..")
  ) {
    throw new Error("Invalid forwarded-port domain.");
  }
  return domain;
}

export function privateWebUiUrl(
  codespaceName,
  {
    port = DEFAULT_PORT,
    domain = DEFAULT_PORT_DOMAIN,
    path = "/",
  } = {},
) {
  const name = sanitizeCodespaceName(codespaceName);
  const safeDomain = sanitizePortDomain(domain);
  const numericPort = Number(port);
  if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) {
    throw new Error("Invalid forwarded port.");
  }

  let safePath = String(path || "/").trim();
  if (!safePath.startsWith("/")) safePath = "/" + safePath;
  if (safePath.startsWith("//")) safePath = "/" + safePath.replace(/^\/+/, "");

  return `https://${name}-${numericPort}.${safeDomain}${safePath}`;
}

export function normalizeCodespace(raw) {
  if (!raw || typeof raw !== "object") return null;
  let name;
  try {
    name = sanitizeCodespaceName(raw.name);
  } catch {
    return null;
  }

  const repository =
    raw.repository && typeof raw.repository === "object"
      ? String(raw.repository.full_name || "")
      : "";

  return {
    name,
    state: normalizeState(raw.state),
    repository: repository.slice(0, 240),
    lastUsedAt:
      typeof raw.last_used_at === "string" ? raw.last_used_at.slice(0, 80) : null,
    webUrl:
      typeof raw.web_url === "string" && raw.web_url.startsWith("https://")
        ? raw.web_url.slice(0, 500)
        : null,
  };
}

export function codespaceStateLabel(state) {
  switch (stateKey(state)) {
    case "available":
      return "Disponible";
    case "shutdown":
    case "stopped":
      return "Detenido";
    case "starting":
      return "Iniciando";
    case "stopping":
      return "Deteniendo";
    case "rebuilding":
      return "Reconstruyendo";
    case "failed":
      return "Falló";
    case "unavailable":
      return "No disponible";
    default:
      return normalizeState(state);
  }
}

export function stateTone(state) {
  const key = stateKey(state);
  if (key === "available") return "success";
  if (key === "failed" || key === "unavailable") return "danger";
  if (key === "shutdown" || key === "stopped") return "neutral";
  return "warning";
}

export function shouldStart(state) {
  return isStoppedState(state);
}

export function shouldPollForAvailable(state) {
  const key = stateKey(state);
  return !isAvailableState(key) && !isStoppedState(key) && !isTerminalErrorState(key);
}

export function retryDelayMs(attempt) {
  const safe = Math.max(0, Math.min(30, Number(attempt) || 0));
  return Math.min(5000, 1800 + safe * 120);
}

export function isGitHubApiUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "api.github.com";
  } catch {
    return false;
  }
}
