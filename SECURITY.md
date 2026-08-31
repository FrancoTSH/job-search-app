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

Use the minimum GitHub permissions documented in `README.md`.

## Dependencies

The production launcher uses no external JavaScript, CSS, fonts, analytics, telemetry, or CDN resources.

GitHub Actions are used only to validate and deploy the public static site.
