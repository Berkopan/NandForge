# Build verification and GitHub Pages deployment

The repository is `Berkopan/NandForge`. Its case-sensitive project path is `/NandForge/`, and the intended public URL is <https://berkopan.github.io/NandForge/>. The deployment workflow uploads the production `dist` directory after all validation gates succeed. A checked-in workflow by itself does not establish that the site is live; check the actual deployment run and public URL.

## Local production verification

Use Node.js 24 and the lockfile:

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Playwright starts `vite preview` on port 4174 and uses `http://127.0.0.1:4174/NandForge/` as its base URL. These tests exercise built assets under the deployment subpath. Port 4174 is separate from the development server on 4173, so a running development server cannot accidentally satisfy the production test server check.

Chromium is the default local test project. To run the three browser engines used in CI:

```sh
npx playwright install --with-deps chromium firefox webkit
PLAYWRIGHT_ALL_BROWSERS=1 npm run test:e2e
```

For an already running server, set `PLAYWRIGHT_BASE_URL` to its complete URL including the trailing `/NandForge/` path. This disables automatic server startup. Each test uses an isolated browser context with its own local project storage.

The application uses hash navigation, so a route such as `/NandForge/#/cpu` still requests the static `index.html` under the project path. Vite's `base` also applies to compiled scripts, CSS and imported assets. If hosting elsewhere, explicitly set `NANDFORGE_BASE` during the build and verify the resulting path.

### Browser verification recorded during implementation

On 17 October 2026, the production build served under `/NandForge/` passed all 18 browser scenarios in each engine:

| Browser engine | Scenarios passed |
| --- | ---: |
| Chromium 156 | 18 / 18 |
| Firefox 157 | 18 / 18 |
| WebKit 27.2 | 18 / 18 |
| **Total** | **54 / 54** |

The scenarios cover actual palette placement and canvas/Inspector wiring, LED signals, exhaustive truth-table generation, undo/redo, custom-chip reuse and live internal signals, clocked register enable behavior, JSON export/import, project management, IndexedDB reload, recoverable drafts with a width error, unsafe import rejection, Academy verification and retained completion, English/Turkish switching, CPU assembly and execution, source breakpoints, RAM watchpoints, backward stepping, exported real clock-edge traces, and narrow-screen CPU use. The tests also reject unhandled page errors. This is local production-browser evidence; the repository's Actions run and Pages deployment remain separate checks.

## CI and deployment gates

`.github/workflows/ci.yml` runs on pushes, pull requests and manual dispatch. The validation job installs locked dependencies, runs strict type checking, ESLint, unit/exhaustive/differential tests, builds the application, installs Chromium/Firefox/WebKit, and executes the browser workflow suite against that production build. Browser reports and failure traces are retained as workflow artifacts for 14 days.

Only a successful run on the repository's current default branch uploads the Pages artifact and enables the dependent deployment job. Pull requests cannot enter the deployment job. The deployment uses the `github-pages` environment, respects its protection rules and does not require a personal access token. Build/test jobs have `contents: read`; only the deployment job obtains `pages: write` and `id-token: write`.

The workflow uses official GitHub actions: `checkout@v7`, `setup-node@v7`, `upload-artifact@v7`, `configure-pages@v5`, `upload-pages-artifact@v4`, and `deploy-pages@v4`. These major versions were checked against the maintainers' repositories and GitHub's Pages documentation during implementation. Dependabot proposes future npm and Actions updates weekly; such changes must pass the same validation before deployment.

## Repository setup

If Pages has not been enabled, open the repository's **Settings → Pages → Build and deployment → Source**, and select **GitHub Actions**. Keep the site in the `github-pages` environment and configure any desired deployment approval/protection rules there. Selecting a source branch is not the deployment mode used by this project.

After a validated change reaches the default branch, open **Actions → Validate and deploy**. Confirm both the validation and deployment jobs succeed. The deployment job exposes GitHub's actual `page_url` output. Open that URL, verify assets load from `/NandForge/`, and test at least the home screen, Circuit Lab and the first CPU program.

A failed build/test prevents artifact publication. A Pages setup or permission error can occur after validation: fix the repository setting or environment policy and rerun the workflow. The application itself needs no backend, account, API key, database service or custom secret.

## Official references

- [GitHub: custom Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [GitHub: checkout action](https://github.com/actions/checkout)
- [GitHub: setup-node action](https://github.com/actions/setup-node)
- [GitHub: artifact uploads](https://github.com/actions/upload-artifact)
- [GitHub: Pages artifact packaging](https://github.com/actions/upload-pages-artifact)
- [GitHub: Pages deployment action](https://github.com/actions/deploy-pages)
- [Playwright: setting up CI](https://playwright.dev/docs/ci-intro)
