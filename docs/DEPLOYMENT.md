# Build verification and GitHub Pages deployment

The repository is `Berkopan/NandForge`. Its case-sensitive project path is `/NandForge/`, and the verified public URL is <https://berkopan.github.io/NandForge/>. The deployment workflow uploads the production `dist` directory after all validation gates succeed. A checked-in workflow by itself does not establish that the site is live; check the actual deployment run and public URL.

## Observed publication

On **17 October 2026**, [Actions run 39064679103](https://github.com/Berkopan/NandForge/actions/runs/39064679103) for final source `fcb591e061d429e183aa68011d356b795eea5e07` completed **successfully**. The [validation job](https://github.com/Berkopan/NandForge/actions/runs/39064679103/job/117489719266) passed **14/14 steps**, including the production-browser gate. The [Pages publication job](https://github.com/Berkopan/NandForge/actions/runs/39064679103/job/117490439008) passed **4/4 steps**. Repository Pages settings already use **GitHub Actions**, so no owner configuration change is required.

The remote validation recorded **218 unit tests passed in 2.82 s** and **60 browser executions passed in 2.1 min**. These remote durations are separate from the local results below.

The deployed site at **[https://berkopan.github.io/NandForge/](https://berkopan.github.io/NandForge/)** was then opened and exercised in a browser:

| Public page | Observed behavior |
| --- | --- |
| Home | Initial A=0, B=1 produced OUT=0; toggling to 11 produced 1, 10 produced 0, and 00 produced 0. |
| `#/lab` | Open in Circuit Lab created the actual two-NAND AND circuit: 2 NAND gates, 5 wires, depth 2 and zero diagnostics. Its generated truth table was 00→0, 01→0, 10→0, 11→1. |
| `#/cpu` | The mandatory six-word 3 + 4 program ran to Halted at cycle 6 with A=7, OUT=7, PC=0x05 and PC HOLD. The waveform panel contained 13 actual samples for CLK, A, PC, A.write and OUT. |

A hard reload directly on public `#/cpu` reopened the CPU route in Ready state, with the exact six-instruction source retained. Running again halted successfully; accessible controls showed `PROGRAM COUNTER 0x05 HOLD` and I/O `0x00 → 0x07`. The runtime reset matches the documented transient-session boundary. The browser console inspection returned no warnings or errors (query limit 20), and the post-reload console inspection was also empty. This was a deployed browser smoke check of those observed workflows; the three-engine suite above remains separately identified. [Public CPU screenshot](screenshots/public-cpu-lab.jpg).

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

On 17 October 2026, the final production build served under `/NandForge/` passed all 20 browser scenarios in each engine:

| Browser engine | Scenarios passed |
| --- | ---: |
| Chromium 156 | 20 / 20 |
| Firefox 157 | 20 / 20 |
| WebKit 27.2 | 20 / 20 |
| **Total** | **60 / 60** |

The scenarios cover actual palette placement and canvas/Inspector wiring, LED signals, all four AND and XOR truth-table rows, inspection of XOR's four real NAND gates, undo/redo, custom-chip reuse and live internal signals, clocked register enable behavior, JSON export/import, compressed share links restored in a fresh browser context, project management, IndexedDB reload, recoverable drafts with a width error, unsafe import rejection, Academy verification and retained completion, English/Turkish switching, CPU assembly and execution, source breakpoints, RAM watchpoints, backward stepping, exported real clock-edge traces, and narrow-screen CPU use. Turkish checks include visible CPU register labels, ALU names, instruction-specific explanations, lesson content and behavioral results, followed by switching back to English. Resetting a completed lesson clears its current verification result while preserving earned progress.

The CPU scheduling regression runs a real loop and checks that pause, snapshot restoration, reset, source editing and reassembly synchronously cancel pending clock ticks. The gate also checks the accessible CPU subsystem buttons, PC hold behavior at HLT, and desktop editor height before and after opening an internal circuit. Every scenario rejects unhandled page errors. These counts describe the local production-browser run. The successful remote validation and Pages publication are recorded separately above.

Five visually reviewed production screenshots are saved in `docs/screenshots`. Desktop captures use a 1440 × 1000 viewport; the mobile CPU capture uses 390 × 844. The Circuit Lab shows a live half-adder and its complete truth table, and the CPU captures show actual latched outputs of 7 and 42. A separate mobile Circuit Lab check confirms that a switch drives the output and the editor fits its 844-pixel viewport.

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
