#!/usr/bin/env node
import { startStaticServer } from "./static-server.mjs";

startStaticServer({
  logger: {
    line(_label, line, output = process.stdout) {
      output.write(`${line}\n`);
    },
  },
  port: process.env.PORT,
  publicUrl: process.env.PORTLESS_URL,
  root: process.cwd(),
});
