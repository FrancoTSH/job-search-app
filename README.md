# Job Search Codespace Launcher

Live PWA: https://francotsh.github.io/job-search-app/

Public, static PWA that controls only the lifecycle of a private GitHub Codespace.

## Privacy boundary

This repository is intentionally safe to be public.

It contains:

- static HTML/CSS/JavaScript;
- a PWA manifest/service worker;
- lifecycle calls to the official GitHub Codespaces REST API.

It does **not** contain:

- candidate data;
- CVs or cover letters;
- job/application data;
- tracker data;
- private repository contents;
- SMTP secrets;
- Codex authentication;
- GitHub tokens.

The authenticated browser may display the repository name returned by GitHub while the page is open. That API result is never uploaded to this repository or cached by the service worker.

## Authentication

The launcher intentionally does not embed an OAuth client secret or a PAT.

For V1, paste a fine-grained personal access token into the installed PWA. The token is held only in browser `sessionStorage`; closing the browser/PWA session removes it.

Recommended token boundary:

1. resource owner: your GitHub account;
2. repository access: only the private assistant repository;
3. repository permissions:
   - **Codespaces: Read and write**
   - **Codespaces lifecycle admin: Read and write**

The launcher does not need Contents, Issues, Pull requests, Actions, Administration, or workflow permissions.

`Codespaces: write` is used only to create the managed Codespace through GitHub's official API.
The target private repository name is learned from an existing selected Codespace or configured
on-device and stored only in localStorage; it is not hard-coded in this public repository.

## Lifecycle flow

```text
open public PWA
  -> provide session token
  -> GET /user/codespaces
  -> select private assistant Codespace
  -> if no suitable Codespace exists, POST /repos/<owner>/<repo>/codespaces
       with ref=main, devcontainer_path=.devcontainer/devcontainer.json
       and idle_timeout_minutes=150
  -> POST /user/codespaces/<name>/start when stopped
  -> poll GET /user/codespaces/<name>
  -> state == Available
  -> open https://<codespace>-3000.app.github.dev/
```

The private forwarded port remains authenticated by GitHub. The public PWA does not proxy, mirror, or embed the private UI.

A **Stop Codespace** action is also provided for cost/resource control.

The launcher treats a Codespace with an idle timeout below 150 minutes as unsuitable for
long-running search/rank workflows and offers to create a replacement. It never deletes the old
Codespace automatically. When replacing an existing environment it reuses the observed machine
type when GitHub exposes it; otherwise GitHub's repository/account default machine is used.

## Forwarded-port domain

The current documented GitHub Codespaces forwarding format is:

```text
https://CODESPACENAME-PORT.app.github.dev
```

GitHub notes that forwarding domains can change. The launcher therefore keeps the domain configurable on-device instead of treating it as immutable product data.

## PWA behavior

The service worker caches only same-origin static launcher files.

It deliberately does not cache:

- `api.github.com` calls;
- private Codespaces port traffic;
- tokens;
- Codespace metadata returned by the API.

## Local validation

Requires Node.js 22+:

```bash
npm test
npm run check
python3 -m http.server 8080 --directory site
```

Then open `http://127.0.0.1:8080`.

Real lifecycle calls require a valid GitHub token and are intentionally not exercised in public CI.

## GitHub Pages

The repository includes `.github/workflows/deploy-pages.yml`.

GitHub Pages is enabled for this repository with **GitHub Actions** as the publishing source. Pushes to `main` validate and deploy the static `site/` directory.

The deployment publishes only `site/`.

## Android

Phase 16 provides the installable PWA and lifecycle flow. Phase 17 performs the real Android end-to-end validation against the private Codespace, headless Codex runner, generated output, and Phase 15 email notifications.
