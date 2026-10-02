# Offline Antigravity Protocol and Capability Probe

Implemented and exercised on 2026-10-02 against Antigravity (`agy`) 1.2.14. **M0 remains blocked.**

This probe establishes the headless protocol, effective tool inventory, and credential behavior of Antigravity 1.2.14 under local process isolation without external network access or paid model invocations.

## Reproduce

With installed project dependencies and the pinned executable, on macOS:

```sh
npm run probe:agy:offline -- --executable /Users/eltonjames/.local/bin/agy --expected-version 1.2.14
```

The command reserves a private intent directory, records `intent.json` with `external_model_attempts: 0`, configures a local macOS sandbox denying network egress (permitting loopback bind only), and executes `agy` in headless stream-json mode:

```sh
agy --input-format stream-json --output-format stream-json -p ""
```

## Observed Results

1. **Protocol Transport:**
   - `agy` accepts `--input-format stream-json --output-format stream-json` in headless print mode.
   - On startup, `agy` emits an `init` event containing `conversation_id`, working directory `cwd`, and the array of registered tools.
   - Read-only slash commands (e.g. `agy -p "/help" --output-format stream-json`) emit `command_result` and terminal `result` events with zero tokens consumed (`usage: { input_tokens: 0, output_tokens: 0, ... }`) without making provider requests.

2. **Tool Inventory and Broker Enforcement:**
   - The emitted `init` event lists **57 native tools** unconditionally:
     `["ask_custom_permission", "ask_permission", "ask_question", "browser_click_element", "browser_drag_pixel_to_pixel", "browser_get_dom", "browser_get_network_request", "browser_input", "browser_list_network_requests", "browser_mouse_down", "browser_mouse_up", "browser_move_mouse", "browser_press_key", "browser_refresh_page", "browser_resize_window", "browser_scroll", "browser_scroll_dom", "browser_select_option", "browser_subagent", "call_mcp_tool", "capture_browser_console_logs", "capture_browser_screenshot", "click_browser_pixel", "command_status", "define_subagent", "delete_knowledge", "execute_browser_javascript", "find_by_name", "finish", "generate_image", "grep_search", "invoke_subagent", "list_browser_pages", "list_dir", "list_permissions", "list_resources", "manage_inbox", "manage_subagents", "manage_task", "multi_replace_file_content", "notebook_edit", "notebook_execution", "open_browser_url", "read_browser_page", "read_resource", "read_url_content", "replace_file_content", "run_command", "run_workflow", "schedule", "search_web", "sed_file", "send_command_input", "send_message", "view_file", "wait", "wait_5_seconds", "write_to_file"]`.
   - Native tools include arbitrary command execution (`run_command`), filesystem writes (`write_to_file`, `sed_file`), browser automation, and web searching.
   - Unlike Codex (which allows disabling built-in tools in `config.toml`), `agy` has no configuration setting, CLI flag, or dynamic protocol mechanism to omit these tools and restrict execution exclusively to Quorum's 7 broker tools.
   - **Capability Status:** `Broker-only tools` is **FAILED / BLOCKED**.

3. **Credential Isolation:**
   - `agy` requires Google OAuth authentication, loaded via system Keyring/Keychain or `~/.gemini/oauth_creds.json`.
   - In an isolated environment (empty `HOME` without inherited credentials), `agy` cannot perform keyless local provider substitution. It blocks on an interactive OAuth login prompt or fails closed (`authentication failed or timed out`) with zero token usage.
   - When user credentials are present, `agy` attaches `Authorization: Bearer ya29...` directly in process network requests.
   - **Capability Status:** `Credential isolation` is **FAILED / BLOCKED**.

4. **Descendant Cancellation and Containment:**
   - Both runners share the same macOS host limitation: process-group termination (`process.kill(-pgid, 'SIGKILL')`) does not terminate detached subprocesses (`setsid`).
   - Production runner containment requires Linux container cgroups.

## Repeatable Coverage

- `tests/integration/agy-offline.test.ts` provides deterministic coverage of `AgyOfflineProtocol`, `agyOfflineEnvironment`, synthetic process lifecycle, output overflow, timeout, cancellation, and report validation.
- All tests run offline with synthetic subprocesses and local fixtures; zero paid model calls are made.
