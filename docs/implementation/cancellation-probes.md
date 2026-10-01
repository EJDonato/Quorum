# Descendant cancellation and process isolation probe

Status: repeatable descendant process cancellation and detached escape fixtures implemented and verified.

Requirements: PRD Section 3.1 & 4.2, SYSTEM_DESIGN Section 2, and IMPLEMENTATION_STRATEGY M0 Task 5: "Cancel a fixture that launches a stubborn descendant; confirm all descendants terminate. Unconfirmed cleanup blocks resume and cleanup."

## Implemented

1. `probeProcessGroupCancellation`:
   - Spawns a process group leader that launches background children in the same process group.
   - Triggers cancellation via `AbortController`.
   - Verifies that `captureProcess` process-group termination (`process.kill(-pgid, 'SIGKILL')`) terminates both parent and child processes (`isProcessAlive` returns false for both).
2. `probeDetachedDescendantEscape`:
   - Spawns a process group leader that spawns a detached grandchild using `setsid()` (via Node child process `detached: true`).
   - Triggers cancellation of the parent process group.
   - Observes that the detached grandchild survives process-group termination, demonstrating that plain POSIX process-group signals cannot terminate decoupled descendants.
   - Explicitly terminates and verifies cleanup of the escaped PID so no orphaned processes remain.
3. `probe:cancellation`:
   - Durable CLI command recording intent before execution and atomically writing a versioned report.
   - Exits 0 when process-group cleanup is confirmed and detached escape behavior is verified.
   - Preserves machine-readable evidence in [`docs/implementation/evidence/2026-10-01/descendant-cancellation-report.json`](evidence/2026-10-01/descendant-cancellation-report.json).

## Reproduce

```sh
npm run probe:cancellation
```

Optional `--report-dir /absolute/existing/directory` specifies custom report storage.

## Evidence and Conclusions

The probe demonstrates that while cooperative processes staying in the runner's process group are reliably terminated by host cancellation, any adversarial or detached process (`setsid`) escapes process-group signals. Therefore, host process signaling alone cannot guarantee untrusted code isolation. Enforced execution requires container cgroup containment (as verified in [`probe:container`](runner-controls.md)), where the container lifecycle guarantees that stopping the container terminates all processes in its cgroup.
