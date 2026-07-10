# minlo

> 轻量级、可热插拔的 LLM Agent 运行时编排框架。

Minlo 通过 **能力（Capability）** 与 **任务（Mission）** 两个核心概念,让你用"写 JS 逻辑 + 配 JSON 清单"的方式快速组装 AI 智能体。

- 能力 = 一个导出 `name` / `description` / `init` / `execute` / `destroy` 的 JS 文件
- 任务 = 一个 JSON 文件,按 `name` 引用若干能力,可选传入 `config`
- 框架在两次 `minlo run` 之间重新发现能力;主循环期间能力集锁定

## 设计理念

| 理念 | 含义 |
|---|---|
| **能力驱动** | 一切功能单元都是"能力"——每个能力导出 `init` / `execute` / `destroy` 三个固定函数,框架据此调用。**不**预设 tool / hook / retriever 等角色——能力做什么由它自己决定 |
| **严格 schema** | 能力文件只允许 7 个字段(`name` / `description` / `init` / `execute` / `destroy` / `deps` / `externalDeps`)。多一个就拒——把"约定俗成"挡在框架外 |
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
| `minlo mission list` | 列出所有任务文件 |
| `minlo mission show <name>` | 打印任务的完整 JSON |
| `minlo mission validate <name>` | 校验任务 JSON 格式及引用的能力是否存在 |

## 仓库布局

```
.
├── bin/minlo.ts                # CLI 入口(shebang 保留)
├── src/                        # 框架核心
│   ├── lib/                    # loader, mission 解析, topo 排序, runtime
│   └── commands/               # init / list / run / version
├── templates/abilities/        # `minlo init` 复制的 default.json
├── global-assets/abilities/    # helloworld + llm 装到 ~/.minlo/
├── scripts/                    # 构建 & postinstall
├── docs/                       # 设计文档 & 示例
└── package.json
```

## 文档导航

| 文档 | 受众 | 内容 |
|---|---|---|
| [README.md](README.md) | 使用者 | 介绍、安装、快速开始、CLI、第一个能力 |
| [docs/design.md](docs/design.md) | 高级用户 / 能力作者 | 完整设计文档(能力 schema、生命周期、配置、依赖、CLI) |
| [docs/examples/weather.md](docs/examples/weather.md) | 使用者 | 端到端:开发 + 调试一个能力 |
| [docs/examples/multi-mission.md](docs/examples/multi-mission.md) | 使用者 | 多 mission + 跨 run 持久化 |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 贡献者 | 仓库结构、开发命令、修改规范、测试 |
| [CLAUDE.md](CLAUDE.md) | Claude(AI 助手) | 仓库速记,只放骨架和导航 |

## 反馈 / 问题

直接在仓库开 issue。框架的「已知 UX 权衡」在 [docs/design.md §9](docs/design.md#9-设计约束与边界) 有说明。

## License

未声明(待定)。
