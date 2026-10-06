// Loads frontend scripts into a sandbox the way a page does: plain <script> files,
// run in order, sharing one global scope (so tracker-csv.js can use util.js's
// functions). Only for scripts that don't touch the DOM while loading.
import vm from 'node:vm';

const FRONTEND = new URL('../../frontend/', import.meta.url);

// deno-lint-ignore no-explicit-any
export type Sandbox = Record<string, any>;

export function loadScripts(...files: string[]): Sandbox {
  const sandbox = vm.createContext({});
  for (const file of files) {
    vm.runInContext(Deno.readTextFileSync(new URL(file, FRONTEND)), sandbox, { filename: file });
  }
  return sandbox;
}

// Reads a top-level `const` (those aren't properties of the sandbox, unlike functions).
export function constOf(sandbox: Sandbox, name: string): unknown {
  return vm.runInContext(name, sandbox);
}

// Values made inside the sandbox have its own Array/Object types, which deep-equality
// checks treat as different from the test's. A JSON round trip makes plain copies.
export function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

export function readFrontend(file: string): string {
  return Deno.readTextFileSync(new URL(file, FRONTEND));
}
