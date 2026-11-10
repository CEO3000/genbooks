// Loaded with --import (see "test" in package.json).
//
// kickoff.js calls `import("next/server")`. Next's bundler resolves that bare name, but plain Node ESM wants the file
// extension and refuses it. This one rule lets the tests load the module as written, so they can then replace it with a
// recorder. It changes nothing in the application.
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier === "next/server" ? "next/server.js" : specifier, context);
  },
});
