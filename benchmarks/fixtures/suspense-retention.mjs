import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { clientScenariosForRows } from "../scenarios/client.mjs";

// Run in a subprocess with --expose-gc so the test checks reachability instead
// of depending on heap-size thresholds or the timing of automatic collection.
for (const scenario of clientScenariosForRows(64).filter(
  (scenario) => scenario.group === "suspense",
)) {
  for (const runtime of scenario.runtimes) {
    const containers = [];
    const trackedRuntime = {
      ...runtime,
      createRenderer() {
        const renderer = runtime.createRenderer();
        return {
          ...renderer,
          createRoot(container) {
            containers.push(new WeakRef(container));
            return renderer.createRoot(container);
          },
        };
      },
    };
    for (let sample = 0; sample < 3; sample += 1) {
      scenario.measure(trackedRuntime, 4);
    }
    assert.equal(containers.length, 12);
    let retained;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      // A WeakRef target stays alive until the end of the job that derefs it.
      await setImmediate();
      global.gc();
      retained = containers.filter((ref) => ref.deref() !== undefined).length;
      if (retained === 0) break;
    }
    assert.equal(
      retained,
      0,
      `${runtime.id} ${scenario.name} retained unmounted sample containers`,
    );
  }
}
