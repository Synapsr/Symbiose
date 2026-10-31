# Security policy

Symbiose holds personal health data: meals, weight, sleep, blood pressure,
journal notes. Self-hosters trust it with their family's data, so we take
security reports seriously. Thank you for helping keep it safe.

## Reporting a vulnerability

**Please don't open a public issue.** Report it privately through GitHub:
[**Report a vulnerability**](https://github.com/Synapsr/Symbiose/security/advisories/new)
(the *Security* tab of this repository, then *Report a vulnerability*). Only
the maintainers can read it.

Helpful details:

- The server version (shown on its home page and at `/health`) or the commit
  you built from, and how you run it (Docker image, compose, from source).
- The app version and platform, if the app is involved.
- What an attacker could do, and what they need to do it (an account on the
  server, network access, a stolen phone…).
- Steps to reproduce, or a proof of concept.
- Whether you've shared the issue with anyone else.

Never include real health data, a real account token or an AI provider key
in a report. If logs help, check them for anything private first.

## What happens next

Symbiose is maintained by a small team, so we can't promise fixed deadlines.
We'll do our best to:

- acknowledge your report within a week;
- tell you whether we can reproduce it, and keep you posted while we fix it;
- publish the fix in a new image and credit you in the advisory, if you'd like.

Please give us a reasonable time to ship a fix before disclosing the issue
publicly.

## Supported versions

Security fixes go into the `main` branch and the `latest` image
(`ghcr.io/synapsr/symbiose:latest`), then into the next tagged release.
Update with `docker pull` and a restart.

## Scope

In scope: the code in this repository, including:

- the server: sign-up modes, passwords and tokens, the admin view, access to
  meals and photos between accounts, the data export and account deletion;
- what the server sends to the AI provider and to Open Food Facts;
- the mobile app, its widgets and its Apple Watch app: how they store and
  share the session, and the `symbiose://` links they open;
- the Docker image and the CI workflow that builds it.

Out of scope, please report them to the right place:

- The AI providers (Anthropic, OpenAI, Mistral, Google, OpenRouter, a local
  model server) and Open Food Facts.
- Apple Health, Health Connect, and dependencies: report to their
  maintainers. Tell us too if Symbiose is affected.
- A server exposed on the internet without TLS, or other choices of the
  person hosting it. A dangerous default is in scope, though.
- Attacks that require an already compromised phone, computer or server.
