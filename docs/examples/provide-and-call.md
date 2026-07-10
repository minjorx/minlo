# 示例:能力间互相调用(provide / call)

> 完整设计文档见 [`../design.md §3.12`](../design.md#312-跨能力-api-调用provide-字段--processminlocall)。

本示例演示两个能力如何用 `provide` + `process.minlo.call` 协议互相协作:

- `counter` —— 提供 `increment` / `get` / `reset` 三个 API
- `demo-user` —— 通过 `process.minlo.call('counter.<fn>', ...)` 调用 counter 的 API

## 目标

让两个**不同的 ability** 共享状态(一个写、一个读),且**不**走 `process.minlo.ctx` 这种隐式通道。

## 步骤

### 1. 看 counter 的实现

`global-assets/abilities/counter.js` 已经存在,这里给完整代码:

```javascript
// counter.js — 提供计数器 API(供其他能力调用)
export const name = 'counter';
export const description = '提供计数器 API(供其他能力调用)';

let n = 0;     // 闭包状态,所有调用方共享同一个 counter

export const provide = {
  increment() {
    n += 1;
    return n;
  },
  get() {
    return n;
  },
  reset() {
    n = 0;
  },
};

// 必须有 init/execute/destroy 之一(8 字段 schema 要求)
export async function init() {
  // no-op
}
```

要点:
- `let n = 0` 是**模块级**的闭包变量,因为每个 `import` 在 Node ESM 里只执行一次,所有调用方共享
- `export const provide = { ... }` —— 显式声明本能力对外暴露什么 API
- 三个函数都是普通 function,不带 `async`(它们不需要等异步操作)

### 2. 看 demo-user 的实现

`global-assets/abilities/demo-user.js`:

```javascript
// demo-user.js — 通过 process.minlo.call 调 counter 提供的函数
export const name = 'demo-user';
export const description = '示例能力:通过 process.minlo.call 调用 counter 提供的函数';
export const deps = ['counter'];   // ← 必须声明,否则拓扑序不保证 counter.init 先跑

let step = 0;

export async function execute() {
  const n = process.minlo.call('counter.increment');
  step += 1;
  process.stderr.write(`[demo-user] step=${step} counter=${n}\n`);
  if (step >= 5) {
    process.minlo.call('counter.reset');
    return { action: 'stop' };
  }
  return { action: 'continue' };
}
```

要点:
- `deps: ['counter']` —— 框架的拓扑序保证 `counter.init` 在 `demo-user` 之前跑完
- `process.minlo.call('counter.increment')` 等价于 `process.minlo.provides.counter.increment()`(只是路径形式更短)
- 路径用点分,第一段是 ability 的 `name`,后面是 `provide` 对象里的 key

### 3. 写 mission JSON

`.minlo/missions/demo.json`:

```json
{
  "name": "counter demo",
  "description": "Run demo-user 5 times, then exit. Counter resets on exit.",
  "abilities": ["counter", "demo-user"]
}
```

`abilities` 数组的**顺序**就是 init 顺序(也是同轮 execute 顺序)。counter 必须先,否则 demo-user 找不到它。

### 4. 跑

```bash
minlo run demo
```

预期输出(stderr):

```
minlo: loading abilities...
minlo: mission "counter demo" loaded (abilities: counter, demo-user)
minlo: init order: counter → demo-user
minlo: init phase...
  ✓ init counter
minlo: main loop (Ctrl-C to abort)...
[demo-user] step=1 counter=1
[demo-user] step=2 counter=2
[demo-user] step=3 counter=3
[demo-user] step=4 counter=4
[demo-user] step=5 counter=5
minlo: execute "demo-user" returned stop — exiting loop
minlo: destroy phase...
minlo: done (exit 0)
```

## 调试提示

**写错时常见的错**:

| 错误 | 现象 |
|---|---|
| 写错 ability 名,比如 `'conters.increment'` | `process.minlo.call: no ability "conters" has registered a provide. Available: counter, ...` |
| 写错函数名,比如 `'counter.incrementt'` | `process.minlo.call: ability "counter" provides no function "incrementt". Available on this ability: increment, get, reset.` |
| `provide` 字段值不是 function,比如 `{ log: 42 }` | 整个 ability 被 loader 拒绝:reject ... provide["log"] must be a function |
| `deps` 漏写,但 execute 里 `call` 了别人 | **运行时**崩(不会启动期报错)。调试:看 `minlo: init order:` 那一行,确认依赖方在被依赖方**之后** |
| 循环依赖(A deps B、B deps A) | 启动期 `cyclic dependency: ...` 错误,exit 1 |

**与 `process.minlo.ctx` 的区别**:`provide` + `call` 是 v1.1 的推荐方式——显式、可静态校验、IDE 可补全。`ctx` 仍可工作,但**不要**在新能力里混用两种机制(读者会困惑)。

## 完整端到端(30 秒试一遍)

```bash
mkdir /tmp/demo && cd /tmp/demo
minlo init
# 把 global-assets/abilities/counter.js + demo-user.js 复制到 .minlo/abilities/
# (如果你全局装过 minlo,counter.js + demo-user.js 已经在 ~/.minlo/abilities/,
#  本地也复制一份可以优先用本地的)
cp ~/.minlo/abilities/counter.js .minlo/abilities/
cp ~/.minlo/abilities/demo-user.js .minlo/abilities/
# 写 mission
cat > .minlo/missions/demo.json <<'EOF'
{
  "name": "counter demo",
  "abilities": ["counter", "demo-user"]
}
EOF
minlo run demo
# 看到 5 步 step + clean stop
```
