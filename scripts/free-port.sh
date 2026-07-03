#!/bin/sh
# Frees a TCP port held by a web server leaked from an interrupted e2e run,
# so the next Playwright webServer start doesn't fail with EADDRINUSE.
# Call sites pass the port literal that also lives in the sibling
# playwright.config.ts: apps/demo-ssr (4181) and apps/demo-client (4182)
# `test:e2e` scripts — keep them in sync.
pids=$(lsof -ti "tcp:$1" 2>/dev/null)
if [ -n "$pids" ]; then
  kill $pids 2>/dev/null
fi
exit 0
