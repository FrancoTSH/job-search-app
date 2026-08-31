import test from "node:test";
import assert from "node:assert/strict";

import {
  codespaceStateLabel,
  isAvailableState,
  isStoppedState,
  normalizeCodespace,
  privateWebUiUrl,
  retryDelayMs,
  sanitizeCodespaceName,
  sanitizePortDomain,
  stateTone,
} from "../site/lib.js";

test("builds the private forwarded-port URL", () => {
  assert.equal(
    privateWebUiUrl("silver-space-123", {
      port: 3000,
      domain: "app.github.dev",
    }),
    "https://silver-space-123-3000.app.github.dev/",
  );
});

test("rejects unsafe codespace names and port domains", () => {
  assert.throws(() => sanitizeCodespaceName("../secret"));
  assert.throws(() => sanitizeCodespaceName("space name"));
  assert.throws(() => sanitizePortDomain("https://evil.example/path"));
  assert.throws(() => sanitizePortDomain("app..github.dev"));
});

test("normalizes only bounded lifecycle metadata", () => {
  const normalized = normalizeCodespace({
    name: "sample-space-123",
    state: "Available",
    repository: { full_name: "private-owner/private-repo" },
    last_used_at: "2026-08-31T12:00:00Z",
    web_url: "https://sample-space-123.github.dev",
    secrets: { should_not_copy: "x" },
  });

  assert.deepEqual(normalized, {
    name: "sample-space-123",
    state: "Available",
    repository: "private-owner/private-repo",
    lastUsedAt: "2026-08-31T12:00:00Z",
    webUrl: "https://sample-space-123.github.dev",
  });
});

test("handles lifecycle state semantics", () => {
  assert.equal(isAvailableState("Available"), true);
  assert.equal(isStoppedState("Shutdown"), true);
  assert.equal(isStoppedState("Stopped"), true);
  assert.equal(codespaceStateLabel("Starting"), "Iniciando");
  assert.equal(stateTone("Failed"), "danger");
});

test("retry polling delay remains bounded", () => {
  assert.equal(retryDelayMs(0), 1800);
  assert.ok(retryDelayMs(50) <= 5000);
});
