// Hello world capability — bundled with minlo, intended to be installed
// into ~/.minlo/abilities/ as a global default. Demonstrates the full
// schema (name / description required; init / execute / destroy all
// present here as a complete example). Counts the number of execute calls
// and returns { action: 'stop' } after 10 to exit the main loop.
let executeCount = 0;

export const name = 'helloworld';
export const description = '👋 示例能力：init/execute/destroy 各打印一行日志，第 11 次 execute 返回 { action: "stop" } 退出主循环';

export async function init() {
  executeCount = 0;
  console.log('  [helloworld] init  (executeCount reset to 0)');
}

export async function execute({ step }) {
  executeCount += 1;
  console.log(`  [helloworld] execute #${executeCount} (step=${step})`);
  if (executeCount > 10) {
    console.log('  [helloworld] returning { action: "stop" } (executed > 10 times)');
    return { action: 'stop' };
  }
  return { action: 'continue' };
}

export async function destroy() {
  console.log(`  [helloworld] destroy (total executes: ${executeCount})`);
}
