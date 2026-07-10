# 示例：多智能体 A/B 测试（v1 无会话）

> 完整设计文档见 [`../design.md`](../design.md)。本示例展示"同一项目跑多个 mission"的标准做法。

## v1 没有"会话"概念

每次 `minlo run` 都是**新的"循环"**。框架不维护跨次 run 的状态。状态由能力自己写到 `workspace/<name>/`,下次 run 时能力 `init` 可以读取。

> 若需要"跨次 run 保留上下文"——自己设计一个**会话能力**(用 `init/execute/destroy` 三函数实现),写到 `workspace/<name>/`。这是 v2 的事,v1 不内置。

## 场景

有 `mission_a` 和 `mission_b` 两个 mission 共享同一组 abilities,你想用不同 mission 配置对比行为。

## 步骤

### 1. 创建两个 mission

`.minlo/missions/mission_a.json`:

```json
{
  "name": "Mission A",
  "description": "测试组",
  "abilities": [
    "counter",
    {
      "name": "logger",
      "config": { "prefix": "[A]" }
    }
  ]
}
```

`.minlo/missions/mission_b.json`:

```json
{
  "name": "Mission B",
  "description": "对照组",
  "abilities": [
    "counter",
    {
      "name": "logger",
      "config": { "prefix": "[B]" }
    }
  ]
}
```

### 2. 跑 mission_a

```bash
minlo run mission_a
```

> 注意:用 `<name>` 形式(不带 `:default`)时,mission 不存在会**直接报错退出**——不会回退到 default(见 `design.md §7.1`)。

### 3. 跑 mission_b

```bash
minlo run mission_b
```

`counter` 状态会**重新初始化**——它写在 `workspace/counter/`,但每次 `minlo run` 都是新的进程、新的 `init`,状态从 0 开始。

### 4. 跨次 run 保留状态

如果想让 counter 跨次保留,需要把 `counter.js` 改成读写 `workspace/counter/state.json`:

```javascript
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export const name = 'counter';
export const description = '提供计数器（跨 run 持久）';

const stateFile = (wsPath) => join(wsPath, 'state.json');

export async function init({ workspacePath }) {
  if (!existsSync(workspacePath)) mkdirSync(workspacePath, { recursive: true });
  let n = 0;
  if (existsSync(stateFile(workspacePath))) {
    n = JSON.parse(readFileSync(stateFile(workspacePath), 'utf8')).n ?? 0;
  }
  process.minlo.ctx.counter = {
    _n: n,
    increment() {
      this._n += 1;
      writeFileSync(stateFile(workspacePath), JSON.stringify({ n: this._n }));
      return this._n;
    },
  };
}

export async function execute() {
  console.log(`counter is now ${process.minlo.ctx.counter.increment()}`);
}
```

> 注:v1 框架**不**自动把 `workspacePath` 透传给 `init` 的第一参数——`init({ workspacePath })` 解构即可。如果能力的 init/destroy 签名不收这个参数,直接读 `process.minlo.ctx` 也行(完整签名见 `design.md §3.2`)。
