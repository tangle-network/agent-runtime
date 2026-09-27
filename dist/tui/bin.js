#!/usr/bin/env node
import { n as runTopApp } from "../top-app-VAOrBskv.js";
//#region src/tui/bin.ts
/**
* `agent-runtime-top` — watch the supervisor runs of one workspace.
*
*   agent-runtime-top [root] [--once] [--no-color] [--detail] [--log]
*
* `root` is the workspace whose `.agent/supervisor/` runs are shown; it defaults to the current
* directory. With a TTY on both ends the view refreshes every second and takes the keys it prints
* in its header; otherwise (a pipe, `--once`) it writes one frame and exits.
*
* @experimental
*/
runTopApp();
//#endregion
export {};

//# sourceMappingURL=bin.js.map