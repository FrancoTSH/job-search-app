import {
  DEFAULT_CODESPACE_REF,
  DEFAULT_DEVCONTAINER_PATH,
  DEFAULT_PORT_DOMAIN,
  GITHUB_API_BASE,
  GITHUB_API_VERSION,
  TARGET_IDLE_TIMEOUT_MINUTES,
  buildCodespaceCreatePayload,
  codespaceCreatePath,
  codespaceDefaultsPath,
  codespaceStateLabel,
  hasSufficientIdleTimeout,
  isAvailableState,
  isStoppedState,
  isTerminalErrorState,
  normalizeCodespace,
  privateWebUiUrl,
  retryDelayMs,
  sanitizeRepositoryFullName,
  stateTone,
} from "./lib.js";

const TOKEN_KEY = "job-search-launcher-token";
const SELECTED_KEY = "job-search-launcher-selected";
const DOMAIN_KEY = "job-search-launcher-port-domain";
const TARGET_REPOSITORY_KEY = "job-search-launcher-target-repository";
const TARGET_MACHINE_KEY = "job-search-launcher-target-machine";
const TARGET_DEVCONTAINER_KEY = "job-search-launcher-target-devcontainer";

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
  selectedIdleTimeout: document.querySelector("#selected-idle-timeout"),
  selectedMachine: document.querySelector("#selected-machine"),
  createCard: document.querySelector("#create-card"),
  createRepo: document.querySelector("#create-repo"),
  createDetail: document.querySelector("#create-detail"),
  create: document.querySelector("#create"),
  start: document.querySelector("#start"),
  open: document.querySelector("#open"),
  stop: document.querySelector("#stop"),
  status: document.querySelector("#status"),
  statusTitle: document.querySelector("#status-title"),
  statusDetail: document.querySelector("#status-detail"),
  targetRepository: document.querySelector("#target-repository"),
  saveTargetRepository: document.querySelector("#save-target-repository"),
  portDomain: document.querySelector("#port-domain"),
  saveDomain: document.querySelector("#save-domain"),
  online: document.querySelector("#online-indicator"),
};

let token = sessionStorage.getItem(TOKEN_KEY) || "";
let codespaces = [];
let selectedName = localStorage.getItem(SELECTED_KEY) || "";
let targetRepository = localStorage.getItem(TARGET_REPOSITORY_KEY) || "";
let rememberedMachine = localStorage.getItem(TARGET_MACHINE_KEY) || "";
let rememberedDevcontainer =
  localStorage.getItem(TARGET_DEVCONTAINER_KEY) || DEFAULT_DEVCONTAINER_PATH;
let busy = false;
let installPrompt = null;

function setStatus(title, detail = "", tone = "neutral") {
  ui.status.dataset.tone = tone;
  ui.statusTitle.textContent = title;
  ui.statusDetail.textContent = detail;
}

function setBusy(value) {
  busy = value;
  for (const button of [
    ui.connect,
    ui.refresh,
    ui.create,
    ui.start,
    ui.open,
    ui.stop,
    ui.saveTargetRepository,
  ]) {
    button.disabled = value;
  }
  ui.codespaceSelect.disabled = value;
}

function selectedCodespace() {
  return codespaces.find((item) => item.name === selectedName) || null;
}

function targetCodespaces() {
  if (!targetRepository) return [];
  return codespaces.filter((item) => item.repository === targetRepository);
}

function suitableTargetCodespace() {
  return targetCodespaces().find((item) => hasSufficientIdleTimeout(item)) || null;
}

function rememberTargetFromCodespace(item) {
  if (!item?.repository) return;
  targetRepository = sanitizeRepositoryFullName(item.repository);
  localStorage.setItem(TARGET_REPOSITORY_KEY, targetRepository);

  if (item.machineName) {
    rememberedMachine = item.machineName;
    localStorage.setItem(TARGET_MACHINE_KEY, rememberedMachine);
  }
  if (item.devcontainerPath) {
    rememberedDevcontainer = item.devcontainerPath;
    localStorage.setItem(TARGET_DEVCONTAINER_KEY, rememberedDevcontainer);
  }
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
        "El token no tiene permisos suficientes. Para crear y administrar el entorno necesita Codespaces: Read and write y Codespaces lifecycle admin: Read and write.",
      );
    }
    if (response.status === 404) {
      throw new Error("GitHub no encontró el Codespace solicitado.");
    }
    if (response.status === 409) {
      throw new Error("GitHub rechazó la transición de estado del Codespace. Actualiza e inténtalo de nuevo.");
    }
    if (response.status === 422) {
      throw new Error(
        "GitHub rechazó la configuración del Codespace. Verifica el repositorio, permisos y límites de Codespaces.",
      );
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

async function getCreateDefaults(repository) {
  return apiRequest(codespaceDefaultsPath(repository, DEFAULT_CODESPACE_REF));
}

async function createCodespace(repository) {
  const defaults = await getCreateDefaults(repository);
  const selected = selectedCodespace();
  const source =
    selected?.repository === repository
      ? selected
      : targetCodespaces().find((item) => item.machineName || item.devcontainerPath) || null;

  const devcontainerPath =
    (typeof defaults?.defaults?.devcontainer_path === "string" &&
      defaults.defaults.devcontainer_path) ||
    source?.devcontainerPath ||
    rememberedDevcontainer ||
    DEFAULT_DEVCONTAINER_PATH;

  const machine = source?.machineName || rememberedMachine || null;
  const payload = buildCodespaceCreatePayload({
    ref: DEFAULT_CODESPACE_REF,
    idleTimeoutMinutes: TARGET_IDLE_TIMEOUT_MINUTES,
    devcontainerPath,
    machine,
    displayName: "Job Search",
  });

  const body = await apiRequest(codespaceCreatePath(repository), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const normalized = normalizeCodespace(body);
  if (!normalized) throw new Error("GitHub devolvió un Codespace recién creado inválido.");
  return normalized;
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
  ui.selectedIdleTimeout.textContent =
    current.idleTimeoutMinutes == null
      ? "—"
      : `${current.idleTimeoutMinutes} min${
          hasSufficientIdleTimeout(current) ? "" : " · insuficiente"
        }`;
  ui.selectedMachine.textContent =
    current.machineCpus
      ? `${current.machineCpus} cores`
      : current.machineName || "—";

  ui.start.hidden = isAvailableState(current.state);
  ui.start.textContent = isStoppedState(current.state)
    ? "Iniciar y abrir"
    : "Esperar y abrir";

  ui.open.hidden = !isAvailableState(current.state);
  ui.stop.hidden = !isAvailableState(current.state);
}

function renderCreateCard() {
  const suitable = suitableTargetCodespace();
  const canCreate = Boolean(token && targetRepository && !suitable);

  ui.createCard.hidden = !canCreate;
  if (!canCreate) return;

  ui.createRepo.textContent = targetRepository;
  const existing = targetCodespaces()[0] || null;
  ui.createDetail.textContent = existing
    ? `El Codespace existente tiene ${existing.idleTimeoutMinutes ?? "un"} timeout insuficiente. El reemplazo conservará la máquina cuando GitHub lo permita.`
    : `Se creará desde ${DEFAULT_CODESPACE_REF} con timeout de ${TARGET_IDLE_TIMEOUT_MINUTES} minutos.`;
  ui.create.textContent = existing
    ? `Crear reemplazo de ${TARGET_IDLE_TIMEOUT_MINUTES} min`
    : `Crear Codespace de ${TARGET_IDLE_TIMEOUT_MINUTES} min`;
}

function renderTargetConfig() {
  ui.targetRepository.value = targetRepository;
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
  renderCreateCard();
  renderTargetConfig();
}

async function refreshCodespaces({ quiet = false } = {}) {
  if (!token) return;
  if (!quiet) setStatus("Consultando GitHub…", "Leyendo tus Codespaces.", "warning");

  codespaces = await listCodespaces();

  const current = selectedCodespace();
  if (current) rememberTargetFromCodespace(current);

  renderAll();

  if (!quiet) {
    setStatus(
      "Codespaces actualizados",
      codespaces.length
        ? "Selecciona el Codespace que contiene la UI privada."
        : targetRepository
          ? "No hay Codespaces disponibles. Puedes crear el entorno administrado desde este launcher."
          : "No hay Codespaces disponibles. Configura el repositorio objetivo en Configuración avanzada.",
      "success",
    );
  }
}

async function pollUntil(
  name,
  predicate,
  { timeoutMs = 5 * 60 * 1000, timeoutLabel = "5 minutos" } = {},
) {
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

  throw new Error(`El Codespace no alcanzó el estado esperado dentro de ${timeoutLabel}.`);
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

async function createAndOpen() {
  if (!targetRepository) {
    throw new Error("Configura primero el repositorio objetivo en Configuración avanzada.");
  }

  const existingSuitable = suitableTargetCodespace();
  if (existingSuitable) {
    selectedName = existingSuitable.name;
    localStorage.setItem(SELECTED_KEY, selectedName);
    renderAll();
    return startAndOpen();
  }

  setBusy(true);
  try {
    setStatus(
      "Creando Codespace…",
      `GitHub está creando el entorno desde ${DEFAULT_CODESPACE_REF} con timeout de ${TARGET_IDLE_TIMEOUT_MINUTES} minutos.`,
      "warning",
    );

    let created = await createCodespace(targetRepository);
    replaceCodespace(created);
    selectedName = created.name;
    localStorage.setItem(SELECTED_KEY, selectedName);
    rememberTargetFromCodespace(created);
    renderAll();

    if (!isAvailableState(created.state)) {
      created = await pollUntil(created.name, (item) => isAvailableState(item.state), {
        timeoutMs: 15 * 60 * 1000,
        timeoutLabel: "15 minutos",
      });
    }

    replaceCodespace(created);
    rememberTargetFromCodespace(created);
    renderAll();

    setStatus(
      "Codespace creado",
      `Entorno disponible con timeout objetivo de ${TARGET_IDLE_TIMEOUT_MINUTES} minutos. Abriendo la UI privada.`,
      "success",
    );

    await new Promise((resolve) => setTimeout(resolve, 2500));
    openPrivateUi(created.name);
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
  if (selectedName) {
    localStorage.setItem(SELECTED_KEY, selectedName);
    const current = selectedCodespace();
    if (current) rememberTargetFromCodespace(current);
  } else {
    localStorage.removeItem(SELECTED_KEY);
  }
  renderAll();
});

ui.create.addEventListener("click", () => runAction(createAndOpen));
ui.start.addEventListener("click", () => runAction(startAndOpen));
ui.open.addEventListener("click", () => {
  const current = selectedCodespace();
  if (!current) return;
  runAction(async () => openPrivateUi(current.name));
});
ui.stop.addEventListener("click", () => runAction(stopSelected));

ui.saveTargetRepository.addEventListener("click", () =>
  runAction(async () => {
    const value = sanitizeRepositoryFullName(ui.targetRepository.value);
    const changed = value !== targetRepository;
    targetRepository = value;
    localStorage.setItem(TARGET_REPOSITORY_KEY, targetRepository);

    if (changed) {
      rememberedMachine = "";
      rememberedDevcontainer = DEFAULT_DEVCONTAINER_PATH;
      localStorage.removeItem(TARGET_MACHINE_KEY);
      localStorage.removeItem(TARGET_DEVCONTAINER_KEY);
    }

    renderAll();
    setStatus(
      "Repositorio objetivo guardado",
      "Solo se almacena en este dispositivo y se usa para crear o reutilizar el Codespace del asistente.",
      "success",
    );
  }),
);

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

ui.targetRepository.value = targetRepository;
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
