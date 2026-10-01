# Quorum

Quorum is a local TypeScript CLI under development for isolated coding workflows with revision-bound QA and security approval gates. The implemented foundation provides versioned runtime record contracts, task-graph validation, candidate hashing, conservative budget accounting, event replay, host evidence/ballot evaluation, and read-only CLI diagnostics.

The first integrations target **Antigravity (`agy`) and Codex**, prioritizing daily-driver workflows. Each session selects one runner. Both integrations require independent capability validation and conformance tests before support is advertised; neither is implemented yet. Claude Code and other runners are deferred.

- [Product requirements](PRD.md)
- [System design](SYSTEM_DESIGN.md)
- [Implementation strategy](IMPLEMENTATION_STRATEGY.md)
- [Development instructions](AGENTS.md)
- [Foundation implementation report](docs/implementation/foundation.md)
- [Contracts and ballot implementation report](docs/implementation/contracts-and-ballots.md)

Development requires Node.js 24 or newer and npm. This slice was tested on Node.js 25.9.0 and npm 11.12.1; these are development observations, not a production supported-version manifest.

```sh
npm ci --ignore-scripts
npm run check
node dist/src/cli/main.js --help
node dist/src/cli/main.js config --config tests/fixtures/config.json --json
node dist/src/cli/main.js doctor --config tests/fixtures/config.json --json
```

The fixture uses deliberately unverified adapter/model/image identifiers. `config` validates structure and reports no runtime capability. `doctor` always exits 3 with unverified capabilities; neither command executes configured programs or makes model calls. Other workflow commands, including `init`, report that they are unimplemented. An application-level offline workflow and recoverable private Git finalization exist with explicitly fake host ports; no production coding workflow is available.

Scripts: `format:check`, `lint`, `typecheck`, `size`, `build`, `test:unit`, and `test:integration` run individual checks. The two test scripts require a preceding build; `test` builds and runs both. `schemas:generate` regenerates published JSON Schemas after contract changes, while `schemas:check` verifies they match the compiled contracts. `check` runs all routine offline checks. `format` formats implementation files and new documentation; governing specifications are excluded from automatic formatting. `test:conformance` and `eval` explicitly fail as unavailable until their release-only harnesses exist.

The package remains private during development. Durable storage, locks, workspace creation, scoped broker reads, exact-tree freezing, and recoverable Git finalization have offline implementations. Initialization, complete broker enforcement, production prerequisite verification, sandboxed checks, workflow recovery, and real runner integration remain pending. The ballot application API uses injected artifact/prerequisite ports; only synthetic test implementations exist, and it is not wired to CLI approval or commit commands. See [the enforcement correction report](docs/implementation/enforcement-corrections.md) and [the offline workflow report](docs/implementation/offline-vertical-slice.md).

Repeatable runner probes are described in [the runner probe report](docs/implementation/runner-probes.md) and [the M0 control probe report](docs/implementation/m0-control-probes.md). `npm run check` includes offline probe regression tests. `probe:controls` performs read-only pinned runner metadata discovery with no model calls; `probe:container` tests a synthetic isolated container using an already local image. Neither establishes runner conformance. `npm run probe:runners -- --live ...` is a separate manual connectivity/structured-output experiment, consumes provider usage, and does not establish enforced conformance or change `doctor` readiness.
