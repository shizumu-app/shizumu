import { test } from "node:test";
import assert from "node:assert/strict";
import { isBootComplete, hasOnlineEmulator } from "./emulator.mjs";

test("isBootComplete true only for '1'", () => {
  assert.equal(isBootComplete("1\n"), true);
  assert.equal(isBootComplete(" 1 "), true);
  assert.equal(isBootComplete("0\n"), false);
  assert.equal(isBootComplete(""), false);
});

test("hasOnlineEmulator detects an online emulator line only", () => {
  assert.equal(hasOnlineEmulator("List of devices attached\nemulator-5554\tdevice\n"), true);
  assert.equal(hasOnlineEmulator("List of devices attached\nemulator-5554\toffline\n"), false);
  assert.equal(hasOnlineEmulator("List of devices attached\n"), false);
  // a non-emulator device does not count
  assert.equal(hasOnlineEmulator("List of devices attached\nABC123\tdevice\n"), false);
});
