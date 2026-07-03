#!/bin/sh
# Frees a TCP port held by a web server leaked from an interrupted e2e run,
# so the next Playwright webServer start doesn't fail with EADDRINUSE.
pids=$(lsof -ti "tcp:$1" 2>/dev/null)
if [ -n "$pids" ]; then
  kill $pids 2>/dev/null
fi
exit 0
