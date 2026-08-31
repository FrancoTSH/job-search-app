import {
  DEFAULT_PORT_DOMAIN,
  GITHUB_API_BASE,
  GITHUB_API_VERSION,
  codespaceStateLabel,
  isAvailableState,
  isStoppedState,
  isTerminalErrorState,
  normalizeCodespace,
  privateWebUiUrl,
  retryDelayMs,
  stateTone,
} from "./lib.js";

const TOKEN_KEY = "job-search-launcher-token";
const SELECTED_KEY = "job-search-launcher-selected";
const DOMAIN_KEY = "job-search-launcher-port-domain";

const ui = {
  authCard: document.querySelector("#auth-card"),
  token: document.querySelector("#token"),
  connect: document.querySelector("#connect"),
  disconnect: document.querySelector("#disconnect"),
  refresh: document.querySelector("#refresh"),
  install: document.querySelector("#install"),
  codespaceSelect: document.querySelector("#codespace-select"),
  selectedCard: document.querySelector("#selected-card"),
  selectedRepo: document.querySelector("#selected-repo"),
  selectedName: document.querySelector("#selected-name"),
  selectedState: document.querySelector("#selected-state"),
  selectedLastUsed: document.querySelector("#selected-last-used"),
  start: document.querySelector("#start"),
  open: document.querySelector("#open"),
  stop: document.querySelector("#stop"),
  status: document.querySelector("#status"),
  statusTitle: document.querySelector("#status-title"),
  statusDetail: document.querySelector("#status-detail"),
  portDomain: document.querySelector("#port-domain"),
  saveDomain: document.querySelector("#save-domain"),
  online: document.querySelector("#online-indicator"),
};

let token = sessionStorage.getItem(TOKEN_KEY) || "";
let codespaces = [];
let selectedName = localStorage.getItem(SELECTED_KEY) || "";
let busy = false;
let installPrompt = null;

function setStatus(title, detail = "", tone = "neutral") {
  ui.status.dataset.tone = tone;
  ui.statusTitle.textContent = title;
  ui.statusDetail.textContent = detail;
}

function setBusy(value) {
  busy = value;
  for (const button of [ui.connect, ui.refresh, ui.start, ui.open, ui.stop]) {
    button.disabled = value;
  }
  ui.codespaceSelect.disabled = value;
}

function selectedCodespace() {
  return codespaces.find((item) => item.name === selectedName) || null;
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("es-PE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function apiPath(path) {
  return `${GITHUB_API_BASE}${path}`;
}

async function apiRequest(path, init = {}) {
  if (!token) throw new Error("Ingresa un token de GitHub para continuar.");

  const response = await fetch(apiPath(path), {
    ...init,
    cache: "no-store",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      ...(init.headers || {}),
    },
  });

  let body = null;
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      body = await response.json();
    } catch {
      body = null;
    }
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("GitHub rechazó el token. Revísalo o genera uno nuevo.");
    }
    if (response.status === 403) {
      throw new Error(
        "El token no tiene permisos suficientes para administrar el Codespace seleccionado.",
      );
    }
    if (response.status === 404) {
      throw new Error("GitHub no encontró el Codespace solicitado.");
    }
    if (response.status === 409) {
      throw new Error("GitHub rechazó la transición de estado del Codespace. Actualiza e inténtalo de nuevo.");
    }
    throw new Error(`GitHub API respondió HTTP ${response.status}.`);
  }

  return body;
}

async function listCodespaces() {
  const body = await apiRequest("/user/codespaces?per_page=100");
  const raw = Array.isArray(body?.codespaces) ? body.codespaces : [];
  return raw.map(normalizeCodespace).filter(Boolean);
}

async function getCodespace(name) {
  const body = await apiRequest(`/user/codespaces/${encodeURIComponent(name)}`);
  const normalized = normalizeCodespace(body);
  if (!normalized) throw new Error("GitHub devolvió un Codespace inválido.");
  return normalized;
}

async function transition(name, action) {
  if (!["start", "stop"].includes(action)) throw new Error("Unsupported lifecycle action.");
  const body = await apiRequest(
    `/user/codespaces/${encodeURIComponent(name)}/${action}`,
    { method: "POST" },
  );
  const normalized = normalizeCodespace(body);
  return normalized || getCodespace(name);
}

function replaceCodespace(item) {
  const index = codespaces.findIndex((current) => current.name === item.name);
  if (index >= 0) codespaces[index] = item;
  else codespaces.push(item);
}

function renderSelect() {
  const old = ui.codespaceSelect.value;
  ui.codespaceSelect.replaceChildren();

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = codespaces.length
    ? "Selecciona un Codespace"
    : "No se encontraron Codespaces";
  ui.codespaceSelect.append(placeholder);

  for (const codespace of codespaces) {
    const option = document.createElement("option");
    option.value = codespace.name;
    const repo = codespace.repository || "repositorio privado";
    option.textContent = `${repo} · ${codespaceStateLabel(codespace.state)}`;
    ui.codespaceSelect.append(option);
  }

  if (selectedName && codespaces.some((item) => item.name === selectedName)) {
    ui.codespaceSelect.value = selectedName;
  } else if (old && codespaces.some((item) => item.name === old)) {
    ui.codespaceSelect.value = old;
    selectedName = old;
  } else {
    selectedName = "";
    localStorage.removeItem(SELECTED_KEY);
  }
}

function renderSelected() {
  const current = selectedCodespace();
  ui.selectedCard.hidden = !current;

  if (!current) {
    ui.start.hidden = true;
    ui.open.hidden = true;
    ui.stop.hidden = true;
    return;
  }

  ui.selectedRepo.textContent = current.repository || "Repositorio no informado";
  ui.selectedName.textContent = current.name;
  ui.selectedState.textContent = codespaceStateLabel(current.state);
  ui.selectedState.dataset.tone = stateTone(current.state);
  ui.selectedLastUsed.textContent = formatDate(current.lastUsedAt);

  ui.start.hidden = isAvailableState(current.state);
  ui.start.textContent = isStoppedState(current.state)
    ? "Iniciar y abrir"
    : "Esperar y abrir";

  ui.open.hidden = !isAvailableState(current.state);
  ui.stop.hidden = !isAvailableState(current.state);
}

function renderAuth() {
  const connected = Boolean(token);
  ui.authCard.dataset.connected = connected ? "true" : "false";
  ui.disconnect.hidden = !connected;
  ui.refresh.hidden = !connected;
  ui.token.value = connected ? "••••••••••••••••" : "";
  ui.token.disabled = connected;
  ui.connect.hidden = connected;
}

function renderAll() {
  renderAuth();
  renderSelect();
  renderSelected();
}

async function refreshCodespaces({ quiet = false } = {}) {
  if (!token) return;
  if (!quiet) setStatus("Consultando GitHub…", "Leyendo tus Codespaces.", "warning");

  codespaces = await listCodespaces();
  renderAll();

  if (!quiet) {
    setStatus(
      "Codespaces actualizados",
      codespaces.length
        ? "Selecciona el Codespace que contiene la UI privada."
        : "No hay Codespaces disponibles para este token.",
      "success",
    );
  }
}

async function pollUntil(name, predicate, { timeoutMs = 5 * 60 * 1000 } = {}) {
  const started = Date.now();
  let attempt = 0;

  while (Date.now() - started < timeoutMs) {
    const item = await getCodespace(name);
    replaceCodespace(item);
    renderAll();

    if (predicate(item)) return item;
    if (isTerminalErrorState(item.state)) {
      throw new Error(`El Codespace entró en estado ${codespaceStateLabel(item.state)}.`);
    }

    setStatus(
      `Codespace: ${codespaceStateLabel(item.state)}`,
      "Esperando a que GitHub complete la transición…",
      "warning",
    );

    await new Promise((resolve) => setTimeout(resolve, retryDelayMs(attempt)));
    attempt += 1;
  }

  throw new Error("El Codespace no alcanzó el estado esperado dentro de 5 minutos.");
}

function currentPortDomain() {
  return (localStorage.getItem(DOMAIN_KEY) || DEFAULT_PORT_DOMAIN).trim();
}

function openPrivateUi(name) {
  const url = privateWebUiUrl(name, { domain: currentPortDomain(), path: "/" });
  window.location.assign(url);
}

async function startAndOpen() {
  const current = selectedCodespace();
  if (!current) throw new Error("Selecciona un Codespace.");

  setBusy(true);
  try {
    let latest = current;

    if (isStoppedState(latest.state)) {
      setStatus("Iniciando Codespace…", "GitHub está encendiendo el entorno privado.", "warning");
      latest = await transition(latest.name, "start");
      replaceCodespace(latest);
      renderAll();
    }

    if (!isAvailableState(latest.state)) {
      latest = await pollUntil(latest.name, (item) => isAvailableState(item.state));
    }

    setStatus(
      "Codespace disponible",
      "Abriendo la UI privada en el puerto 3000.",
      "success",
    );

    // Give post-start services a small grace period after GitHub reports Available.
    await new Promise((resolve) => setTimeout(resolve, 2500));
    openPrivateUi(latest.name);
  } finally {
    setBusy(false);
  }
}

async function stopSelected() {
  const current = selectedCodespace();
  if (!current) throw new Error("Selecciona un Codespace.");

  setBusy(true);
  try {
    setStatus("Deteniendo Codespace…", "Esperando confirmación de GitHub.", "warning");
    let latest = await transition(current.name, "stop");
    replaceCodespace(latest);
    renderAll();

    if (!isStoppedState(latest.state)) {
      latest = await pollUntil(latest.name, (item) => isStoppedState(item.state));
    }

    setStatus(
      "Codespace detenido",
      "El entorno ya no consume CPU; puedes iniciarlo nuevamente desde este launcher.",
      "success",
    );
  } finally {
    setBusy(false);
  }
}

async function runAction(action) {
  if (busy) return;
  try {
    await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus("No se pudo completar la acción", message, "danger");
  }
}

ui.connect.addEventListener("click", () =>
  runAction(async () => {
    const entered = ui.token.value.trim();
    if (!entered || entered === "••••••••••••••••") {
      throw new Error("Pega un token fine-grained de GitHub.");
    }

    token = entered;
    sessionStorage.setItem(TOKEN_KEY, token);
    setBusy(true);
    try {
      await refreshCodespaces();
    } catch (error) {
      token = "";
      sessionStorage.removeItem(TOKEN_KEY);
      renderAll();
      throw error;
    } finally {
      setBusy(false);
    }
  }),
);

ui.disconnect.addEventListener("click", () => {
  token = "";
  sessionStorage.removeItem(TOKEN_KEY);
  codespaces = [];
  selectedName = "";
  localStorage.removeItem(SELECTED_KEY);
  renderAll();
  setStatus(
    "Sesión local cerrada",
    "El token se eliminó de sessionStorage.",
    "neutral",
  );
});

ui.refresh.addEventListener("click", () =>
  runAction(async () => {
    setBusy(true);
    try {
      await refreshCodespaces();
    } finally {
      setBusy(false);
    }
  }),
);

ui.codespaceSelect.addEventListener("change", () => {
  selectedName = ui.codespaceSelect.value;
  if (selectedName) localStorage.setItem(SELECTED_KEY, selectedName);
  else localStorage.removeItem(SELECTED_KEY);
  renderSelected();
});

ui.start.addEventListener("click", () => runAction(startAndOpen));
ui.open.addEventListener("click", () => {
  const current = selectedCodespace();
  if (!current) return;
  runAction(async () => openPrivateUi(current.name));
});
ui.stop.addEventListener("click", () => runAction(stopSelected));

ui.saveDomain.addEventListener("click", () =>
  runAction(async () => {
    const value = ui.portDomain.value.trim();
    // Validation occurs through URL construction.
    privateWebUiUrl("codespace-check", { domain: value });
    localStorage.setItem(DOMAIN_KEY, value);
    setStatus(
      "Dominio guardado",
      "Se usará para construir el URL privado del puerto 3000.",
      "success",
    );
  }),
);

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
  ui.install.hidden = false;
});

ui.install.addEventListener("click", async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  ui.install.hidden = true;
});

window.addEventListener("appinstalled", () => {
  installPrompt = null;
  ui.install.hidden = true;
});

function updateOnlineStatus() {
  const online = navigator.onLine;
  ui.online.textContent = online ? "Online" : "Sin conexión";
  ui.online.dataset.tone = online ? "success" : "danger";
  if (!online) {
    setStatus(
      "Sin conexión",
      "El launcher está disponible offline, pero GitHub Codespaces requiere red.",
      "danger",
    );
  }
}
window.addEventListener("online", updateOnlineStatus);
window.addEventListener("offline", updateOnlineStatus);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {
    setStatus(
      "PWA disponible sin cache offline",
      "No se pudo registrar el service worker.",
      "warning",
    );
  });
}

ui.portDomain.value = currentPortDomain();
updateOnlineStatus();
renderAll();

if (token && navigator.onLine) {
  runAction(async () => {
    setBusy(true);
    try {
      await refreshCodespaces({ quiet: true });
      setStatus(
        "Sesión recuperada",
        "El token existe solo para esta sesión del navegador.",
        "success",
      );
    } finally {
      setBusy(false);
    }
  });
} else {
  setStatus(
    "Listo para conectar",
    "El token se mantiene únicamente durante esta sesión del navegador.",
    "neutral",
  );
}
