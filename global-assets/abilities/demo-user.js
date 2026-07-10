// demo-user.js — example ability that uses another ability's API
// through process:minlo. After declaring `deps: ['counter']`, the
// framework guarantees counter.init runs first, so by the time this
// ability's execute fires, `use('counter')` resolves to the live
// { increment, get, reset } object provided by counter.js.

import { use } from 'process:minlo';

export const name = 'demo-user';
export const description = '示例能力：通过 process:minlo 调用 counter 提供的函数';
export const deps = ['counter'];

let step = 0;

export async function execute() {
  const counter = use('counter');
  step += 1;
  const n = counter.increment();
  // Print to stderr so it doesn't pollute whatever the agent streams
  // to stdout (LLM replies, etc.).
  process.stderr.write(`[demo-user] step=${step} counter=${n}\n`);
  if (step >= 5) {
    counter.reset();
    return { action: 'stop' };
  }
  return { action: 'continue' };
}
