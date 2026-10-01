# M0 control probe implementation

Status: repeatable metadata discovery and synthetic container boundary fixture implemented. M0 remains blocked. Neither runner has passed enforced conformance.

Requirements: PRD Section 7, SYSTEM_DESIGN Section 2, and M0 in IMPLEMENTATION_STRATEGY. The intended proof is runner-specific broker-only effects, credential and network separation, a hard provider request ceiling with complete usage, structured output, container isolation, and descendant cancellation.

Implemented:

- `probe:controls` validates an exact pinned executable version, hashes the binary before and after inspection, and retains intent and result records. Codex feature registry and generated protocol field presence are captured as selected facts. Antigravity version/help is captured. It accepts no live flag or prompt. Fixed report fields remain `UNVERIFIED` for every enforced capability.
- A visibly synthetic inert broker fixture rejects unauthorized tool names, path escapes, and forged authority. Its success cannot prove either runner exposes only broker tools.
- `probe:container` uses a pinned local image and a disposable canary directory. It checks read access to the fixture, denied writes to the read-only mount, absence of source/artifact paths and runtime socket, no inherited host marker (verified in the final run with a harmless marker in the Docker client environment), scratch availability, denied network access, and owned-container cleanup. It does not launch a runner. Raw container output is interpreted as fixed tokens and excluded from retained reports.
- All command arguments are arrays with explicit executables. Each probe uses bounded output and time limits, retains intent before launching, and writes a result atomically after completion. Failure reports remain visible, including the container cleanup parser failure and its one corrected retry.

Reproduce metadata discovery without model usage:

```sh
npm run probe:controls -- --runner codex --executable /Users/eltonjames/.local/bin/codex --expected-version 0.159.3
npm run probe:controls -- --runner agy --executable /Users/eltonjames/.local/bin/agy --expected-version 1.2.14
```

Reproduce the synthetic container fixture only after confirming the listed image ID exists locally and Docker is running:

```sh
npm run probe:container -- --image-id sha256:2ba9ca5f2e7daa0f0e7723cba1ee9167bab54efd3640516a44ac1a928dd67e7a
```

These commands write private report directories under the system temp directory unless an existing absolute `--report-dir` is provided. No network image pull is allowed. The image is a local fixture dependency, not a release runtime choice.

Remaining runner-specific acceptance evidence:

1. Run each pinned runner inside the isolated role profile with only the inert broker tool. Capture its effective tool inventory and actual attempted tool events. Attempt direct shell, file, Git, network, socket, artifact, and delegation effects; every path must remain blocked outside the broker.
2. Keep credentials solely in the broker, and verify model endpoint routing separately from offline check networking. The synthetic container proves only this mount profile on this machine.
3. Identify an actual request-level token cap before dispatch for each runner. Exercise a multi-call invocation, tool iteration, retry, cancellation, and missing-usage cases. Track input, output, cached, and reasoning fields without treating timeout, feature labels, or post-hoc totals as a cap.
4. Run adversarial schema and usage probes on the final pinned surfaces. Antigravity's corrected structured-output parser has offline tests but no corrected live observation. Keep both earlier failed reports unchanged.
5. Launch a stubborn descendant inside the runner profile, cancel the role, verify every process is gone, and test restart recovery. Only then implement and run the full release-only `test:conformance` command.

The previous live allowances were consumed. No model generation occurred in this change. Observed metadata and the synthetic container result leave the feasibility table unchanged. A product scope revision would require explicit user direction and corresponding PRD/design changes; no fallback is implicit.

Verification: `npm run check` passed after the probe additions (format, lint, strict typecheck, size, build, 27 unit tests, 37 integration tests, and generated-schema consistency). The manual metadata probes against both pinned local executables completed without model generation. The Docker fixture completed on Engine 29.6.2 with eight passing observations and confirmed cleanup in the final two runs. The first failed cleanup classification remains recorded. The full release-only `test:conformance` was not run because its runner harness is unavailable.
