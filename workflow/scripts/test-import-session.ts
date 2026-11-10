import { ImportSessionController } from "../shared/core/import-session";

let failures = 0;
function expect(value: boolean, message: string) {
  if (!value) { failures++; console.error(`[FAIL] ${message}`); }
  else console.log(`[PASS] ${message}`);
}

const controller = new ImportSessionController();
const first = controller.start();
expect(first !== null, "first import receives a lease");
expect(controller.start() === null, "concurrent import is rejected while a lease is active");
controller.cancel();
expect(first !== null && !controller.isActive(first), "clearing a session invalidates the in-flight import");
const second = controller.start();
expect(second !== null, "a new import may start immediately after clearing");
expect(first !== null && !controller.finish(first), "a stale import cannot clear the newer importing state");
expect(second !== null && controller.finish(second), "the active import can finish normally");
expect(controller.start() !== null, "a completed import releases the lock");
if (failures) process.exitCode = 1;
