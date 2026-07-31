import { spawn } from "node:child_process";

const commands = [
  ["pnpm", ["dev:api"]],
  ["pnpm", ["dev:web"]],
];

const children = commands.map(([command, args]) =>
  spawn(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
  }),
);

let stopping = false;
function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    child.kill("SIGTERM");
  }
  process.exit(exitCode);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => stop());
}

for (const child of children) {
  child.on("exit", (code, signal) => {
    if (stopping) return;
    stop(code ?? (signal ? 1 : 0));
  });
}
