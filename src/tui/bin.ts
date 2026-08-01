#!/usr/bin/env node

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

import { runTopApp } from './top-app'

runTopApp()
