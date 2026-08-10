import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWebviewSocket } from "./cdp.mjs";

// Sample /proc/net/unix lines: the last two columns are flags and the path.
// Abstract sockets are prefixed with '@'.
const SAMPLE = `Num       RefCount Protocol Flags    Type St Inode Path
0000: 00000002 00000000 00010000 0001 01 12345 @webview_devtools_remote_2749
0000: 00000002 00000000 00010000 0001 01 12346 /dev/socket/foo
0000: 00000002 00000000 00010000 0001 01 12999 @webview_devtools_remote_3120`;

test("parses the last webview_devtools_remote socket, without the @", () => {
  assert.equal(parseWebviewSocket(SAMPLE), "webview_devtools_remote_3120");
});

test("returns null when no webview socket present", () => {
  assert.equal(parseWebviewSocket("Num RefCount\n0000: ... /dev/socket/x"), null);
});
