#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- Preview tests spawn this fixture as a standalone CommonJS process. */
// Mock dev server for preview tests.
// Args:
//   --port <n>           port to listen on (required)
//   --ready-msg "<str>"  message to print after delay (default: "ready in 12 ms")
//   --delay <ms>         delay before printing ready msg (default: 200)
//   --output-stream out|err  which stream to print to (default: out)
//   --exit-after <ms>    exit after N ms (default: forever)
const http = require("http");

function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i].replace(/^--/, "");
    a[k] = argv[i + 1];
    i++;
  }
  return a;
}
const args = parseArgs(process.argv);
const port = parseInt(args.port ?? "5173", 10);
const readyMsg = args["ready-msg"] ?? "ready in 12 ms";
const delay = parseInt(args.delay ?? "200", 10);
const stream = args["output-stream"] === "err" ? process.stderr : process.stdout;
const exitAfter = args["exit-after"] ? parseInt(args["exit-after"], 10) : null;

const server = http.createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("mock dev server");
});
server.listen(port, () => {
  setTimeout(() => stream.write(readyMsg + "\n"), delay);
  if (exitAfter) setTimeout(() => process.exit(0), exitAfter);
});
