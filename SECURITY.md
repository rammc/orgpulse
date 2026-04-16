# Security Policy

## Architecture

OrgPulse is a fully client-side web application. There is no backend server, no database, and no server-side processing. The application is hosted as static files on GitHub Pages.

- **Basic Mode:** All processing happens in your browser using Tesseract.js. No data leaves your machine.
- **Deep Analysis Mode:** Screenshots are sent directly from your browser to the Anthropic API using your own API key (BYOK). OrgPulse has no proxy or middleware involved.
- **API Key Storage:** Keys are stored in your browser's LocalStorage only. They are never transmitted to any server controlled by this project.

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do not** open a public issue
2. Email: **christopher.ramm@me.com**
3. Include a description of the vulnerability, steps to reproduce, and any relevant screenshots or logs

We will acknowledge your report within 48 hours and aim to provide a fix or mitigation within 7 days for confirmed issues.

## Scope

Given the client-side architecture, the primary security concerns are:

- XSS vulnerabilities in the UI
- Unsafe handling of user-provided images
- Accidental exposure of API keys (e.g., in logs or error messages)
- Supply chain vulnerabilities in dependencies

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest  | Yes       |

## Acknowledgments

We appreciate responsible disclosure and will credit reporters (with their permission) in our changelog.
