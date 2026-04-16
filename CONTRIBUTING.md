# Contributing to OrgPulse

Thank you for your interest in contributing! OrgPulse is a community-driven project and we welcome contributions of all kinds.

## Getting Started

```bash
# Clone the repository
git clone https://github.com/rammc/orgpulse.git
cd orgpulse

# Install dependencies
npm install

# Start the dev server
npm run dev
```

The dev server will open at `http://localhost:5173`.

## Three Ways to Contribute

### 1. Code Contributions

Improve OCR accuracy, add features, fix bugs, or enhance the UI.

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Make your changes
4. Run linting: `npm run lint`
5. Format code: `npm run format`
6. Test the build: `npm run build`
7. Commit and push
8. Open a Pull Request

### 2. Recommendation Contributions (No Coding Required!)

The 9-field matrix is powered by `src/data/recommendations.json`. You can contribute new recommendations by editing this JSON file.

See [docs/contributing-recommendations.md](docs/contributing-recommendations.md) for a detailed guide on the JSON schema and how to add new entries.

**Quick overview of the JSON schema:**

Each entry in `recommendations.json` represents one cell in the 9-field matrix and follows this structure:

| Field               | Type     | Description                                                |
|---------------------|----------|------------------------------------------------------------|
| `id`                | string   | Unique identifier for the matrix cell (e.g. `"quick-wins"`) |
| `matrix_position`   | object   | `{ "impact": "high"|"medium"|"low", "effort": "low"|"medium"|"high" }` |
| `color`             | string   | Color code: `"green"`, `"yellow"`, `"orange"`, or `"red"`  |
| `icon`              | string   | Emoji icon displayed in the matrix cell                    |
| `title`             | string   | English title for the matrix cell                          |
| `priority_label`    | string   | German priority label (e.g. `"Sofort umsetzen"`)           |
| `subtitle`          | string   | German description of the cell's meaning                   |
| `scale_center_hint` | string   | German hint on which Scale Center section is relevant      |
| `trigger_signals`   | array    | Metrics and keywords that trigger this cell                |
| `recommendations`   | array    | Array of recommendation objects (see below)                |
| `contributors`      | array    | GitHub handles of contributors                             |
| `added`             | string   | Date the entry was added (YYYY-MM-DD)                      |

Each recommendation object:

| Field        | Type   | Description                                                   |
|--------------|--------|---------------------------------------------------------------|
| `title`      | string | German title of the recommendation                            |
| `body`       | string | German body text with actionable advice                       |
| `tags`       | array  | Technology area tags (e.g. `["Apex", "SOQL"]`)                |
| `references` | array  | Array of `{ "url": "...", "type": "official_docs" }` objects  |

When contributing recommendations, always reference official Salesforce documentation where possible.

### 3. Issue Reports

- **Bug reports:** Use the [Bug Report template](.github/ISSUE_TEMPLATE/bug_report.md)
- **Feature requests:** Use the [Feature Request template](.github/ISSUE_TEMPLATE/feature_request.md)
- **New matrix recommendations:** Use the [Matrix Recommendation template](.github/ISSUE_TEMPLATE/matrix_recommendation.md)

## Coding Standards

- **Formatting:** We use Prettier with the config in `.prettierrc`
- **Linting:** ESLint is configured for the project
- **Language:** Vanilla JavaScript (ES Modules), no TypeScript
- **Styling:** Plain CSS with CSS Variables — no preprocessors
- **Dependencies:** Keep them minimal. Discuss new dependencies in an issue first.

Run before committing:
```bash
npm run format
npm run lint
```

## PR Process

1. Ensure your PR has a clear description of what it does and why
2. Reference any related issues (e.g. `Closes #12`)
3. Make sure `npm run build` succeeds
4. Keep PRs focused — one feature or fix per PR
5. Wait for a review from a maintainer

## Recommendation Content Guidelines

- Recommendation bodies should be in **German** (we will add i18n later)
- UI labels and titles are in **English**
- Include Salesforce documentation links where possible
- Be specific and actionable — avoid vague advice
- Tag recommendations with relevant technology areas (Apex, LWC, Integration, etc.)

## Code of Conduct

Please read and follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## Questions?

Open an issue or reach out to the maintainer [@cramm](https://github.com/cramm).
