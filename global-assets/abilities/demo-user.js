// demo-user.js — example caller. Reaches the counter ability's API
// through `process.minlo.call('counter.<fn>', ...args)`. Declares
// `deps: ['counter']` so the framework's topo sort guarantees
// counter.init has run before this ability's execute fires.

export const name = 'demo-user';
export const description = '示例能力:通过 process.minlo.call 调用 counter 提供的函数';
export const deps = ['counter'];

let step = 0;

export async function execute() {
  // Note: process.minlo.call returns the function's return value
  // (or rethrows its error). The dot path is '<ability>.<fn>'.
  const n = process.minlo.call('counter.increment');
  // Print to stderr so it doesn't pollute whatever the agent
  // streams to stdout.
  step += 1;
  process.stderr.write(`[demo-user] step=${step} counter=${n}\n`);
  if (step >= 5) {
    process.minlo.call('counter.reset');
    return { action: 'stop' };
  }
  return { action: 'continue' };
}
