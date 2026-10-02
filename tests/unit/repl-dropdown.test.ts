import assert from "node:assert/strict";
import test from "node:test";
import { PassThrough } from "node:stream";
import {
  getMatchingSlashCommands,
  SLASH_COMMAND_DEFINITIONS,
} from "../../src/cli/repl-commands-def.js";
import {
  clearDropdown,
  formatDropdownRow,
  renderDropdown,
} from "../../src/cli/repl-dropdown.js";

await test("getMatchingSlashCommands filters commands dynamically as user types", () => {
  assert.equal(getMatchingSlashCommands("").length, 0);
  assert.equal(getMatchingSlashCommands("add auth").length, 0);

  const allMatches = getMatchingSlashCommands("/");
  assert.equal(allMatches.length, SLASH_COMMAND_DEFINITIONS.length);

  const dMatches = getMatchingSlashCommands("/d");
  assert.deepEqual(
    dMatches.map((m) => m.name),
    ["/doctor", "/diff"],
  );

  const docMatches = getMatchingSlashCommands("/doc");
  assert.deepEqual(
    docMatches.map((m) => m.name),
    ["/doctor"],
  );

  const nonMatches = getMatchingSlashCommands("/unknown");
  assert.equal(nonMatches.length, 0);

  // Once a space is typed after command, dropdown should close
  const withArgs = getMatchingSlashCommands("/doctor --verbose");
  assert.equal(withArgs.length, 0);
});

await test("formatDropdownRow marks selected row with cursor pointer", () => {
  const item = {
    name: "/doctor",
    syntax: "/doctor",
    description: "Check runtime capabilities",
    needsArg: false,
  };

  const selected = formatDropdownRow(item, true, false);
  assert.match(selected, /❯ \/doctor/);
  assert.match(selected, /Check runtime capabilities/);

  const unselected = formatDropdownRow(item, false, false);
  assert.match(unselected, /  \/doctor/);
  assert.doesNotMatch(unselected, /❯/);
});

await test("renderDropdown and clearDropdown output expected terminal sequences", () => {
  const stdout = new PassThrough();
  let captured = "";
  stdout.on("data", (chunk: Buffer) => {
    captured += chunk.toString("utf-8");
  });

  const matches = getMatchingSlashCommands("/d");
  const count = renderDropdown(stdout, matches, {
    selectedIndex: 0,
    cursorCol: 10,
  });

  assert.equal(count, 2);
  assert.match(captured, /\/doctor/);
  assert.match(captured, /\/diff/);

  clearDropdown(stdout, count, 10);
  assert.match(captured, /\x1b\[B\x1b\[J\x1b\[A/);
});
