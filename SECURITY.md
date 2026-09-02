# Security

## Public/private boundary

This launcher is public by design. Treat every committed file as internet-visible.

Never commit:

- GitHub tokens or PATs;
- private repository data;
- Codespace runtime data;
- candidate/profile/application data;
- Codex credentials;
- SMTP credentials.

## Browser token handling

The launcher accepts a user-provided fine-grained PAT only at runtime and stores it in `sessionStorage`.

The token is sent only in the `Authorization` header of requests to `https://api.github.com`.

The service worker ignores cross-origin requests and therefore does not cache GitHub API responses.

Use the minimum GitHub permissions documented in `README.md`. Codespace creation requires
the repository-scoped `Codespaces: write` permission; lifecycle start/stop remains covered by
`Codespaces lifecycle admin: write`.

The private target repository name may be stored in browser `localStorage` so the PWA can
recreate the environment after deletion. It is never committed to this public repository or
sent anywhere except the GitHub Codespaces API path selected by the user.

## Dependencies

The production launcher uses no external JavaScript, CSS, fonts, analytics, telemetry, or CDN resources.

GitHub Actions are used only to validate and deploy the public static site.
