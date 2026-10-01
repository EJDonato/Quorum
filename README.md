# Quorum

Quorum is a local TypeScript CLI under development for isolated coding workflows with revision-bound QA and security approval gates. The first foundation slice provides strict configuration/session/event contracts, a pure session reducer, conservative budget accounting, event replay, and read-only CLI diagnostics.

The first integrations target **Antigravity (`agy`) and Codex**, prioritizing daily-driver workflows. Each session selects one runner. Both integrations require independent capability validation and conformance tests before support is advertised; neither is implemented yet. Claude Code and other runners are deferred.

- [Product requirements](PRD.md)
- [System design](SYSTEM_DESIGN.md)
- [Implementation strategy](IMPLEMENTATION_STRATEGY.md)
- [Development instructions](AGENTS.md)
- [Foundation implementation report](docs/implementation/foundation.md)

Development requires Node.js 24 or newer and npm. This slice was tested on Node.js 25.9.0 and npm 11.12.1; these are development observations, not a production supported-version manifest.

```sh
npm ci --ignore-scripts
npm run check
node dist/src/cli/main.js --help
node dist/src/cli/main.js config --config tests/fixtures/config.json --json
node dist/src/cli/main.js doctor --config tests/fixtures/config.json --json
```

The fixture uses deliberately unverified adapter/model/image identifiers. `config` validates structure and reports no runtime capability. `doctor` always exits 3 with unverified capabilities; neither command executes configured programs or makes model calls. Other workflow commands, including `init`, report that they are unimplemented. There is no runnable coding workflow or verified finalization yet.

Scripts: `format:check`, `lint`, `typecheck`, `size`, `build`, `test:unit`, and `test:integration` run individual checks. The two test scripts require a preceding build; `test` builds and runs both. `schemas:generate` regenerates published JSON Schemas after contract changes, while `schemas:check` verifies they match the compiled contracts. `check` runs all routine offline checks. `format` formats implementation files and new documentation; governing specifications are excluded from automatic formatting. `test:conformance` and `eval` explicitly fail as unavailable until their release-only harnesses exist.

The package remains private during development. Initialization, durable storage, locks, safe workspace creation, broker enforcement, candidate/evidence contracts, ballot computation, Git finalization, and real runner integration remain pending.

Repeatable runner probes are described in [the runner probe report](docs/implementation/runner-probes.md). `npm run check` includes offline probe regression tests. `npm run probe:runners -- --live ...` is a separate manual connectivity/structured-output experiment, consumes provider usage, and does not establish enforced conformance or change `doctor` readiness.
