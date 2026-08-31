const SELECTED_KEY = "job-search-launcher-selected";
const DOMAIN_KEY = "job-search-launcher-port-domain";
const DEFAULT_DOMAIN = "app.github.dev";

const ui = {
  codespace: document.querySelector("#codespace"),
  target: document.querySelector("#target"),
  run: document.querySelector("#run"),
  status: document.querySelector("#status"),
  statusTitle: document.querySelector("#status-title"),
  statusDetail: document.querySelector("#status-detail"),
  getResult: document.querySelector("#get-result"),
  simplePostResult: document.querySelector("#simple-post-result"),
  postResult: document.querySelector("#post-result"),
};

function validCodespaceName(value) {
  return /^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/.test(value);
}

function validDomain(value) {
  return /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(value) && !value.includes("..");
}

function selectedTarget() {
  const name = (localStorage.getItem(SELECTED_KEY) || "").trim();
  const domain = (localStorage.getItem(DOMAIN_KEY) || DEFAULT_DOMAIN).trim().toLowerCase();

  if (!validCodespaceName(name)) {
    throw new Error("No hay un Codespace seleccionado en el launcher.");
  }
  if (!validDomain(domain)) {
    throw new Error("El dominio de forwarded ports guardado no es válido.");
  }

  return {
    name,
    url: `https://${name}-3000.${domain}/api/cors-probe`,
  };
}

function setStatus(title, detail, tone = "neutral") {
  ui.status.dataset.tone = tone;
  ui.statusTitle.textContent = title;
  ui.statusDetail.textContent = detail;
}

function formatSuccess(response, body) {
  return JSON.stringify(
    {
      fetchResolved: true,
      status: response.status,
      ok: response.ok,
      redirected: response.redirected,
      responseType: response.type,
      url: response.url,
      body,
    },
    null,
    2,
  );
}

function formatFailure(error) {
  return JSON.stringify(
    {
      fetchResolved: false,
      errorName: error instanceof Error ? error.name : typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
    },
    null,
    2,
  );
}

async function readBody(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text.slice(0, 500);
  }
}

async function runProbe() {
  let target;
  try {
    target = selectedTarget();
  } catch (error) {
    setStatus("No se puede ejecutar", error.message, "danger");
    return;
  }

  ui.codespace.textContent = target.name;
  ui.target.textContent = target.url;
  ui.run.disabled = true;
  ui.getResult.textContent = "Ejecutando…";
  ui.simplePostResult.textContent = "Ejecutando…";
  ui.postResult.textContent = "Ejecutando…";
  setStatus(
    "Probando acceso cross-origin…",
    "GET simple y POST JSON con credentials=include.",
    "warning",
  );

  let getPassed = false;
  let simplePostPassed = false;
  let postPassed = false;

  try {
    const response = await fetch(target.url, {
      method: "GET",
      mode: "cors",
      credentials: "include",
      cache: "no-store",
    });
    const body = await readBody(response);
    getPassed =
      response.ok &&
      body?.ok === true &&
      body?.method === "GET" &&
      body?.authenticatedEdgeReachedApplication === true;
    ui.getResult.textContent = formatSuccess(response, body);
  } catch (error) {
    ui.getResult.textContent = formatFailure(error);
  }

  try {
    const nonce = crypto.randomUUID();
    const response = await fetch(target.url, {
      method: "POST",
      mode: "cors",
      credentials: "include",
      cache: "no-store",
      headers: {
        "Content-Type": "text/plain;charset=UTF-8",
      },
      body: JSON.stringify({ nonce }),
    });
    const body = await readBody(response);
    simplePostPassed =
      response.ok &&
      body?.ok === true &&
      body?.method === "POST" &&
      body?.requestKind === "text-simple" &&
      body?.authenticatedEdgeReachedApplication === true &&
      body?.echoedNonce === nonce;
    ui.simplePostResult.textContent = formatSuccess(response, body);
  } catch (error) {
    ui.simplePostResult.textContent = formatFailure(error);
  }

  try {
    const nonce = crypto.randomUUID();
    const response = await fetch(target.url, {
      method: "POST",
      mode: "cors",
      credentials: "include",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ nonce }),
    });
    const body = await readBody(response);
    postPassed =
      response.ok &&
      body?.ok === true &&
      body?.method === "POST" &&
      body?.authenticatedEdgeReachedApplication === true &&
      body?.echoedNonce === nonce;
    ui.postResult.textContent = formatSuccess(response, body);
  } catch (error) {
    ui.postResult.textContent = formatFailure(error);
  }

  if (getPassed && postPassed) {
    setStatus(
      "CORS privado viable con preflight",
      "GET y POST JSON cross-origin funcionan; el navegador también completó OPTIONS.",
      "success",
    );
  } else if (getPassed && simplePostPassed) {
    setStatus(
      "CORS viable solo sin preflight",
      "GET y POST simple funcionan, pero POST JSON/OPTIONS no. La PWA podría usar una mutación text/plain con Origin estricto.",
      "warning",
    );
  } else if (getPassed) {
    setStatus(
      "Solo lectura cross-origin",
      "GET funciona, pero ninguna variante POST fue utilizable.",
      "danger",
    );
  } else {
    setStatus(
      "CORS privado no viable",
      "La PWA no pudo leer el endpoint privado de Codespaces desde JavaScript.",
      "danger",
    );
  }

  ui.run.disabled = false;
}

try {
  const target = selectedTarget();
  ui.codespace.textContent = target.name;
  ui.target.textContent = target.url;
} catch (error) {
  ui.codespace.textContent = "No seleccionado";
  ui.target.textContent = "—";
  setStatus("Falta selección", error.message, "warning");
}

ui.run.addEventListener("click", runProbe);
