# minlo

> 轻量级、可热插拔的 LLM Agent 运行时编排框架。

Minlo 通过 **能力（Ability）** 与 **任务（Mission）** 两个核心概念,让你用"写 JS 逻辑 + 配 JSON 清单"的方式快速组装 AI 智能体。

- 能力 = 一个导出 `name` / `description` / `init` / `execute` / `destroy` 的 JS 文件
- 任务 = 一个 JSON 文件,按 `name` 引用若干能力,可选传入 `config`
- 框架在两次 `minlo run` 之间重新发现能力;主循环期间能力集锁定

## 设计理念

| 理念 | 含义 |
|---|---|
| **能力驱动** | 一切功能单元都是"能力"——每个能力导出 `init` / `execute` / `destroy` 三个固定函数,框架据此调用。**不**预设 tool / hook / retriever 等角色——能力做什么由它自己决定 |
| **严格 schema** | 能力文件只允许 8 个字段(`name` / `description` / `init` / `execute` / `destroy` / `deps` / `externalDeps` / `provide`)。多一个就拒——把"约定俗成"挡在框架外 |
| **声明式编排** | 任务 = 一份 JSON 清单,按 `name` 引用若干能力。**不**改框架源码就能组合出不同的 agent |
| **代码与配置分离** | 逻辑(JS)放 `abilities/`,编排(JSON)放 `missions/`,运行时数据放 `workspace/`。三个目录,三种归属,三种版本控制策略 |
| **热插拔** | 改能力文件无需重启 daemon——下次 `minlo run` 自动重发现。主循环一旦开始,能力集就**锁定**,运行中不变(避免"半新半旧"的不一致) |
| **显式优于隐式** | 任务通过 `name` 显式引用能力;不通过 `type` / `order` 等隐式字段决定行为。能力间依赖单向声明(`deps`),不靠"魔法"注入 |
| **空循环默认** | 无配置时框架只做 I/O,不预设任何"主对话 / 主 agent"行为。业务流程由你写的第一个能力定义 |

**这意味着什么**——和常见框架的对比:

- 不同于 LangChain:你**不**继承 `BaseTool`、**不**写 `Runnable` 链——只 export 三个函数
- 不同于 `type: "tool" | "agent"` 的隐式分类:能力**没有**"角色",只看 `init` / `execute` / `destroy` 在不在
- 不同于 `loop.maxIterations` 兜底:v1 主循环是死循环,**由能力自己决定何时返回 `{ action: 'stop' }`**
- 不同于继承式 agent 框架:任务**不能** extends 别的任务,每个完全自包含——避免隐式依赖和配置漂移

完整设计动机与边界见 [docs/design.md §1](docs/design.md#1-项目概述) 和 [§9](docs/design.md#9-设计约束与边界)。

## 快速开始

### 安装

```bash
npm install -g minlo    # 暴露 `minlo` 命令；postinstall 把 helloworld 复制到 ~/.minlo/abilities/
```

### 30 秒上手

```bash
mkdir my-mission && cd my-mission
minlo init              # 生成 .minlo/{missions,abilities,workspace} + default.json
minlo list              # 应该看到 helloworld (global)
minlo run               # 跑默认任务
```

> 第一个项目用默认 mission 即可,会看到 helloworld 在第 11 次 `execute` 返回 `{ action: 'stop' }` 退出。

## 写你的第一个能力

在 `.minlo/abilities/` 下新建一个 JS 文件,导出 `name` / `description` + 至少一个生命周期函数:

```javascript
// .minlo/abilities/calculator.js
export const name = 'calculator';
export const description = '🧮 加减乘除 + 幂运算';

// 业务入口
export async function execute({ expression }) {
  try {
    return { result: eval(expression) };
  } catch (e) {
    return `计算错误: ${e.message}`;
  }
}
```

在 `.minlo/missions/calc.json` 引用它:

```json
{
  "name": "计算器",
  "abilities": ["calculator"]
}
```

跑:

```bash
minlo run calc
```

主循环会一直调用 `calculator.execute`(返回普通对象,等价 `action: 'continue'`)。Ctrl-C 退出。

## 能力间互相调用(provide / call)

> v1.1 引入,见 [docs/design.md §3.12](docs/design.md#312-跨能力-api-调用provide-字段--processminlocall)。

如果你的能力想暴露 API 给其他能力,或想用其他能力的 API,**别**在 `process.minlo.ctx` 里手挂对象 —— 改用 `provide` 字段 + `process.minlo.call`:

```js
// .minlo/abilities/logger.js
export const name = 'logger';
export const description = '提供 log / warn';

export const provide = {
  log:  (m) => process.stderr.write(`[log]  ${m}\n`),
  warn: (m) => process.stderr.write(`[warn] ${m}\n`),
};

// 必须有 init/execute/destroy 之一(8 字段 schema 要求)
export async function init() { /* no-op */ }
```

```js
// .minlo/abilities/other.js
export const name = 'other';
export const deps = ['logger'];   // ← 拓扑序保证 logger.init 先跑完

export async function execute() {
  process.minlo.call('logger.log', 'hi');
}
```

**约束**:
- `call('<name>.<fn>', ...)` 写错名字 / 函数名时,运行时**抛清晰错误**(列出该 ability 提供什么)
- `provide` 字段值必须全是 function(否则整个 ability 被 loader 拒)
- 完整设计动机 / 工作原理 / 已知限制见 [`docs/design.md §3.12`](docs/design.md#312-跨能力-api-调用provide-字段--processminlocall)

## `execute` 的返回值协议

> 完整规范见 [docs/design.md §4.2](docs/design.md#42-阶段二主循环v1-死循环无-maxiterations)。这里给出 ability 作者**必读**的总结。

每轮主循环会按 `mission.abilities` 顺序,对你能力的 `execute` 调用一次。你的 `execute` **必须**返回下列之一:

| 返回值 | 框架后续行为 |
|---|---|
| `undefined` / `null` / `{}` / 任何不含 `action` 的对象 | 等价 `continue`——继续调本轮下一个能力 |
| `{ action: 'continue' }` | 同上(显式) |
| `{ action: 'break' }` | 本轮后续能力**跳过**;下一轮从你开始重跑 |
| `{ action: 'stop' }` | **整个主循环退出**;进入 destroy 阶段 |
| 抛异常 | **整个主循环退出**;stderr 打印错误;exit 1 |

**`break` vs `stop` 的区别**:
- `break` = "我处理完了,这一轮其他能力不用重复劳动",下一轮**还会**调你
- `stop` = "对话结束 / 任务完成",永久退出

**简单例子**:

```javascript
// .minlo/abilities/echo.js
export const name = 'echo';
export const description = '回显用户输入(3 轮后退出)';

let round = 0;
export async function execute() {
  round += 1;
  console.log(`round ${round}`);
  if (round >= 3) return { action: 'stop' };
  return { action: 'continue' };   // 等价于不返回
}
```

## 能力间依赖:用 `deps` 声明拓扑序

> 完整规范见 [docs/design.md §3.7](docs/design.md#37-能力间依赖deps)。

当能力 A 在 `init` 里**需要**能力 B 已经完成 `init`,在 A 的 `deps` 里写 `['B']` —— 框架会保证 B 先 `init`:

```javascript
// .minlo/abilities/logger.js
export const name = 'logger';
export const description = '提供 log API';
let prefix = '[main]';
export const provide = {
  log: (m) => process.stderr.write(`${prefix} ${m}\n`),
};
export async function init() {
  const cfg = process.minlo.configs.logger;
  if (cfg?.prefix) prefix = cfg.prefix;   // ← init 阶段读 config
}
```

```javascript
// .minlo/abilities/worker.js
export const name = 'worker';
export const deps = ['logger'];          // ← 框架保证 logger.init 先跑完
export const description = '用 logger 打印';

export async function execute() {
  process.minlo.call('logger.log', 'working...');
  return { action: 'continue' };
}
```

**常见错误**:
- 忘了写 `deps` 但 execute 里用别的 ability → **运行时**才崩(不会启动期报错)。调试时 Ctrl-C 重启看 init 顺序
- 写循环依赖(A deps B,B deps A)→ 启动期 `cyclic dependency` 错误并 exit 1

## 状态怎么存

minlo 给了你 3 个等级的存储——按"活多久 / 谁能看到"挑:

| 方式 | 生命周期 | 谁能看到 | 典型场景 |
|---|---|---|---|
| 闭包变量 | 该 ability 进程内(每次 `minlo run` 结束就没了) | 只有该 ability 自己 | 计数器、临时缓存 |
| `process.minlo.ctx.<name>` | 同闭包变量 | 该 ability 自己 + **任何能 import 的 ability** | 跨能力共享状态 |
| `.minlo/workspace/<name>/` 落盘 | **跨 `minlo run` 持久** | 任何 ability | 历史日志、用户偏好、向量索引 |

**闭包变量**最简单——能力顶层的 `let count = 0`。

**`process.minlo.ctx`** —— 跨 ability 共享状态。在 `init` 里写,其他 ability 在 `execute` 里读:

```javascript
// counter.js
export const name = 'counter';
export const description = '计数器';
let n = 0;
export const provide = { increment() { n += 1; return n; } };
export async function init() {
  process.minlo.ctx.counter = { get: () => n };   // 显式挂到 ctx
}
export async function execute() {
  process.minlo.call('counter.increment');
}
```

> v1.1 推荐用 `provide` + `process.minlo.call`,**不**直接在 `ctx` 里手挂对象。详见上面"能力间互相调用"。

**workspace 持久化** —— 跨 `minlo run` 保留状态(写文件即可):

```javascript
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export const name = 'history';
export const description = '历史消息持久化';

export async function init({ workspacePath }) {
  // workspacePath 是 .minlo/workspace/history/,主循环 init 前已经确保存在
  if (!existsSync(workspacePath)) mkdirSync(workspacePath, { recursive: true });
}

export async function execute() {
  const file = join(process.minlo.ctx.workspacePath, 'history.json');
  // ...读写
}
```

详细示例见 [docs/examples/multi-mission.md](docs/examples/multi-mission.md)(`counter` 改造版)。

## 给能力传配置

任务 JSON 里把字符串换成 `{ "name": ..., "config": ... }`:

```json
{
  "name": "天气助手",
  "abilities": [
    {
      "name": "openai",
      "config": {
        "model": "gpt-4",
        "temperature": 0.7,
        "apiKeyEnv": "OPENAI_API_KEY"
      }
    }
  ]
}
```

能力侧读 `process.minlo.configs[name]`:

```javascript
export const name = 'openai';
export const description = 'OpenAI provider';

export async function init() {
  const config = process.minlo.configs.openai;
  // ...用 config 建 client
}
```

## 需要外部 npm 包

能力 `import` 外部包时,用 `externalDeps` 字段**声明**(框架不自动 `npm install`):

```javascript
// .minlo/abilities/logger.js
import _ from 'lodash';

export const name = 'logger';
export const description = 'Lodash 工具函数';
export const externalDeps = ['lodash'];   // ← 声明

export async function execute() {
  return _.chunk([1, 2, 3, 4, 5], 2);
}
```

然后在**项目根**手动装:

```bash
npm install lodash
minlo run
```

> ⚠️ `externalDeps` 必须在**项目根的 `node_modules/`**(v1 简化:统一从项目根解析)。
> 详见 [docs/design.md §3.10](docs/design.md#310-外部依赖externaldeps)。

## CLI

| 命令 | 说明 |
|---|---|
| `minlo init [--here]` | 初始化工作区(创建 `.minlo/` 3 个目录 + default mission) |
| `minlo run [name[:fb]]` | 启动主循环。无参 = `default`;`<name>` 严格匹配;`<name:fb>` 失败 fallback |
| `minlo list` | 列出已注册的能力(local / global) |
| `minlo docs` | 把 [docs/design.md](docs/design.md) 全文打印到 stdout — 给 LLM agent / 外部工具读 minlo 规范用 |

## 仓库布局

```
.
├── bin/minlo.ts                # CLI 入口(shebang 保留)
├── src/                        # 框架核心
│   ├── lib/                    # loader, mission 解析, topo 排序, runtime
│   └── commands/               # init / list / run / version / docs
├── templates/missions/        # `minlo init` 复制的 default.json
├── global-assets/abilities/    # helloworld + llm + counter + demo-user 装到 ~/.minlo/
├── scripts/                    # 构建 + postinstall + asset copy
├── docs/                       # 设计文档 & 示例
└── package.json
```

## 反馈 / 问题

直接在仓库开 issue。框架的「已知 UX 权衡」在 [docs/design.md §9](docs/design.md#9-设计约束与边界) 有说明。LLM agent 想读完整规范见 [docs/design.md](docs/design.md)(或跑 `minlo docs`)。

## License

未声明(待定)。
