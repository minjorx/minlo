Minlo 框架设计文档
版本: v1.0
状态: 设计定稿
定位: 轻量级、可热插拔的 LLM Agent 运行时编排框架

一、项目概述
1.1 什么是 Minlo？
Minlo 是一个面向 LLM Agent 开发的轻量级编排框架。它通过 "能力（Capability）" 与 "任务（Mission）" 两个核心概念，让开发者能够以"写 JS 逻辑 + 配 JSON 清单"的方式，快速组装和调试具备不同能力的 AI 智能体。

1.2 核心设计理念
| 理念 | 说明 |
|---|---|
| 能力驱动 | 一切功能单元都是"能力"——能力导出 `init` / `execute` / `destroy` 三个固定函数，框架据此调用 |
| 严格 schema | 能力文件只能导出 `name` / `description` / `init` / `execute` / `destroy` 五项；多出任何字段即拒绝该文件 |
| 声明式编排 | 通过 JSON 清单组装"任务"，无需修改框架源码 |
| 启动期注册 | 文件改动在下一次 `minlo run` 之间生效；主循环期间能力集锁定 |
| 会话即状态 | （v1 移除——会话能力由用户实现） |
| 空循环默认 | 无配置时仅做 I/O，不预设任何行为，最大化灵活性 |
| 代码与配置分离 | 逻辑（JS）放 `abilities/`，编排（JSON）放 `missions/`，数据放 `workspace/` |
| 显式优于隐式 | 任务通过 `name` 显式引用能力；不通过 `type` / `order` 等隐式字段决定行为 |
1.3 技术选型
组件	技术方案	说明
框架核心（CLI）	TypeScript 编写，编译发布为 JavaScript	保证内部逻辑严谨，附带 .d.ts 类型定义
用户能力代码	默认 JavaScript，无缝支持 TypeScript	零配置上手，高级用户可升级到 TS
TypeScript 支持	运行时通过 tsx 动态加载 .ts 文件	需用户自行安装 tsx，框架自动识别
热插拔机制	原生 fs.watch + 动态 import() + 缓存清除	无需外部工具，开发环境默认启用
二、目录结构规范
项目经 minlo init 初始化后，生成如下标准结构：

```
my-mission-project/
├── package.json                      # 项目依赖（含 minlo 框架）
└── .minlo/                           # Minlo 核心工作目录（隐藏）
    ├── missions/                     # 🧠 任务定义（配置清单）
    │   └── default.json              # 默认任务（fallback；由 minlo 模板带入）
    ├── abilities/                    # ⚙️ 能力文件（JS/TS，平铺，不支持子目录）
    └── workspace/                    # 📦 能力私有数据层（缓存/索引/临时文件）
```

> v1 移除 `sessions/` —— 会话作为能力的运行态（详见 §3.4 设计动机），不再由 minlo 框架提供目录。

2.1 目录职责矩阵
| 目录 | 归属权 | 内容性质 | 生命周期 | 版本控制 |
|---|---|---|---|---|
| `missions/` | 开发者 | 声明式配置（JSON） | 长期演进 | 建议提交 |
| `abilities/` | 开发者 | 可执行逻辑（JS/TS） | 长期演进 | 建议提交 |
| `workspace/` | 各能力 | 缓存、索引、临时数据 | 可随时重建 | 建议忽略（.gitignore） |
workspace/	各能力	缓存、索引、临时数据	可随时重建	建议忽略（.gitignore）
三、核心概念定义
3.1 能力（Capability）
能力是最小功能单元，是一个遵循**严格 schema** 导出的 JavaScript/TypeScript 文件。**能力不允许 `type` 字段**——它的所有行为由它导出的函数决定。

存放位置：.minlo/abilities/*.js 或 *.ts（平铺，不支持子目录）

允许且仅允许的导出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | ✅ | 全局唯一标识符（用于被任务 JSON 引用） |
| `description` | string | ✅ | 一句话描述（用于 `minlo list` 展示） |
| `init` | function | ❌（三 选一至少一个） | 生命周期钩子：能力加载时调用一次 |
| `execute` | function | ❌（三选一至少一个） | 业务方法：被框架按需调用（详见 §3.2） |
| `destroy` | function | ❌（三选一至少一个） | 生命周期钩子：主循环结束时由加载器显式调用（详见 §5.4） |
| `deps` | `string[]` | ❌ | 依赖的能力 `name` 列表（详见 §3.7）——只控制 `init` 顺序，不传递数据 |
| `externalDeps` | `string[]` | ❌ | 依赖的 npm 包名列表（详见 §3.10）——框架启动时检查 node_modules 是否安装，**不**自动 npm install |

**严格 schema 校验**（加载时由框架执行，详见 §5.3）：

- 缺少 `name` 或 `description` → 该文件被忽略，stderr 输出警告，进程**不**退出
- 同时缺失 `init` / `execute` / `destroy` 三者 → 该文件被忽略，stderr 输出警告
- 导出 6 个允许字段之外的任何字段 → 该文件被忽略，stderr 输出警告
- 框架不解释能力的"角色"——能力作者决定 `init` / `execute` / `destroy` 的语义；智能体只通过 `name` 引用能力

**v1 不再保留的字段**：

- `type` 字段
- `order` 字段
- 任何"约定俗成"的方法别名（`chat` / `get` / `beforeStep` / `afterStep` / `retrieve` / `render` 等都不再被识别）—— 只能从 `init` / `execute` / `destroy` 中选择

导出方式：

- 支持 `export` 具名导出
- 支持 `export default` 对象导出
- 不强制 Class，普通函数/对象即可

设计约束：

- 文件名不参与排序或加载逻辑，仅作为人类阅读标识
- 框架启动时扫描所有 JS/TS 文件，建立 `name → CapabilityRecord` 的内存注册表
- `name` 全局唯一——同目录内重名时后者覆盖前者并警告；本地与全局重名时**本地覆盖全局**并警告（详见 §3.6）
- 支持 TypeScript：若项目安装了 `tsx`，框架自动加载 `.ts` 文件

示例（calculator.js）：

```javascript
// 严格 5 字段：name / description 必填；init / execute / destroy 至少有一个
export const name = 'calculator';
export const description = '🧮 数学计算，支持加减乘除和幂运算。参数: expression (string)';

// 可选：加载时执行一次（连接、读取配置等）
export async function init(ctx, workspacePath) {
  ctx.calcPrecision = 2;
}

// 可选：业务入口
export async function execute(params) {
  try {
    return { result: eval(params.expression) };
  } catch (e) {
    return `计算错误: ${e.message}`;
  }
}
```
3.2 生命周期与执行方法
能力通过**三个固定函数**与框架交互，没有其他"角色"或"方法名"：

| 函数 | 何时被调用 | 调用方 |
|---|---|---|
| `init(ctx, workspacePath)` | 主循环开始时，对每个有 `init` 的能力调用**一次** | 加载器（详见 §4.1） |
| `execute(params)` | 框架在合适的时机调用——可能每轮调用一次，可能根据用户输入调用多次 | 框架业务逻辑 |
| `destroy(ctx)` | 主循环结束时，对每个有 `destroy` 的能力调用**一次** | 加载器（详见 §4.3） |

**`execute(params)` 是一切"做事"的方法**。框架怎么调它、调几次、传什么 `params`，由框架与智能体共同决定（例如智能体可在 `loop` 字段里声明最大循环次数）。能力作者**不需要关心**"我是 tool 还是 hook"——这是 v1 框架不再区分的语义。

加载器检测逻辑（伪代码）：

```javascript
const mod = await import(filePath);
const instance = mod.default || mod;

// 1. schema 校验：name / description 必填；三函数至少有一个；不允许其他字段
//    详见 §5.3
const hasInit    = typeof instance.init    === 'function';
const hasExecute = typeof instance.execute === 'function';
const hasDestroy = typeof instance.destroy === 'function';
if (!hasInit && !hasExecute && !hasDestroy) {
  // 该文件被忽略
}

// 2. 字段白名单检查：除 name/description 外，只允许 init/execute/destroy
//    其他键（含 type/order/config 等）出现即拒绝该文件
const ALLOWED = new Set(['name', 'description', 'init', 'execute', 'destroy']);
for (const k of Object.keys(instance)) {
  if (!ALLOWED.has(k)) {
    // 警告，拒绝该文件
  }
}

// 3. 框架不关心能力的"角色"——它只看 init/execute/destroy 在不在
//    主循环开始时遍历注册表，调用有 init 的；结束时调用有 destroy 的
```

3.3 任务（Mission）
任务是一组能力的编排清单——v1 极简：仅含 `name` / `description` / `abilities` 三个字段。**没有 `loop` 字段**——主循环的退出/继续由能力的 `execute` 返回值控制（详见 §4.2）。

存放位置：.minlo/missions/*.json（v1 不带 .agent.json 后缀——目录名已分类，文件名仅 `default.json` 等）

文件结构（v1）：

```json
{
  "name": "智能体显示名称",
  "description": "智能体功能描述",
  "abilities": ["calculator", "logger"]
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | ✅ | 智能体的显示名称 |
| `description` | string | ❌ | 智能体的功能描述 |
| `abilities` | array | ✅ | 能力引用列表，每项为字符串 `"name"` 或 `{ name, config? }` 对象（详见 §3.9） |

设计约束：

- 不支持继承（extends），每个智能体完全自包含
- `abilities` 数组中每项是能力 `name` 字符串——框架**不**区分"哪个是 tool、哪个是 hook"
- 若引用的 `name` 在注册表中不存在，框架启动时报错并退出
- 可通过在 `abilities` 中临时注释/删除某个能力来禁用
- **v1 不提供** `loop` 字段——主循环是死循环，由能力返回 `{ action: 'stop' }` 或抛异常退出（详见 §4.2）

3.4 （已移除）会话
> v1 移除"会话"作为框架内置子系统。理由：会话是"循环需要的运行时状态"，属于业务层概念，不该由 minlo 框架内核强约束。后续会话将由一个**会话能力**（`init/execute/destroy` 实现）提供——具体设计留到 v2。

3.5 工作区（Workspace）
工作区为每个能力提供私有的数据沙箱。

存放位置：.minlo/workspace/{能力名称}/

使用场景：

RAG 能力的向量索引文件

Memory 能力的持久化快照（如 Redis dump）

Tool 能力的缓存目录（如网页抓取缓存）

设计约束：

子目录名称与能力的 name 字段一一对应

若能力首次运行时工作区子目录不存在，框架自动创建

框架不关心工作区内的具体文件格式，完全由能力自己管理

清理工作区数据不会影响其他能力的运行（能力之间通过 `workspace/<name>/` 共享数据，删除某个子目录只影响对应能力）

3.6 全局能力（Global Capabilities）
能力可在两个位置声明：

| 位置 | 作用范围 | 谁来写 |
|---|---|---|
| `<项目根>/.minlo/abilities/` | 单个项目 | 项目开发者 |
| `~/.minlo/abilities/` | 当前用户的所有项目 | 框架/用户全局安装 |

发现与覆盖规则：

1. 框架启动时**同时**扫描两个目录，构建一份统一的 `name → instance` 注册表
2. `name` 跨目录、跨 type **全局唯一**（同 type 不必同命名空间——重名即冲突）
3. **本地优先**：若本地与全局有同名能力，**本地胜出**，全局同名文件被忽略并输出警告
4. 启动期扫描是一次性的；主循环开始后，能力集锁定，运行中不再变化

`~/.minlo/` 的初始化是隐式的：用户执行任意 `minlo` 子命令时，若 `~/.minlo/` 不存在则自动创建空目录（含 `abilities/.gitkeep`）。当前未内置任何默认能力——未来 `npm install -g minlo` 引入官方能力包时，会落入 `~/.minlo/abilities/`。

3.7 能力间依赖（`deps`）
能力可以 export 一个 `deps: string[]` 字段，声明"我依赖哪些能力"——按能力 `name` 字符串引用。

**`deps` 的语义**：**只控制 `init` 调用的拓扑顺序**。框架在 `init` 之前根据所有能力的 `deps` 做拓扑排序：

1. 被依赖的先 init
2. 依赖方后 init（确保被依赖能力的 `init` 已跑完）

**注意**：
- `deps` **不传递数据**——被依赖能力 init 设的状态，不会自动注入到依赖方的 `params`
- 能力间数据传递走 `globalThis.ctx`（详见 §3.8）
- 循环依赖（A 依赖 B 且 B 依赖 A）→ 启动期报错退出
- `deps` 里的 name 在注册表里找不到 → 启动期报错退出

**示例**：

```js
// 能力 counter.js —— 底层数据源
export const name = 'counter';
export const description = '提供计数器';

export const deps = [];

export async function init() {
  // 框架在阶段 1 步骤 4 已经创建了 process.minlo.ctx（详见 §4.1）
  process.minlo.ctx.counter = { _n: 0, increment() { return ++this._n; } };
}

export async function execute() {
  console.log(`counter is now ${process.minlo.ctx.counter._n}`);
}

export async function destroy() {
  delete process.minlo.ctx.counter;
}
```

```js
// 能力 logger.js —— 依赖 counter
export const name = 'logger';
export const description = '打印日志';
export const deps = ['counter'];  // ← 声明：logger 先等 counter.init 跑完

export async function execute() {
  // init 顺序保证 counter.init 先跑完，所以 process.minlo.ctx.counter 一定存在
  process.minlo.ctx.counter.increment();
  console.log(`counter incremented to ${process.minlo.ctx.counter._n}`);
}
```

**核心设计原则**：
- 能力**不感知**谁依赖它——A 只 export `share` / 写 globalThis，不知道 B 用了 A
- 能力**显式声明**它依赖谁——B 写 `deps: ['counter']`，框架按这个排序
- 这是单向声明——`deps` 是依赖方的事，不是被依赖方的事

3.8 跨能力通信（`process.minlo.ctx`）

minlo 在 Node 进程对象 `process` 上挂一个**命名空间** `minlo`：

```js
process.minlo = {
  ctx: {},   // 跨能力通信的共享对象
  // 未来可能扩展: log, config, ...
};
```

能力可以在 `init` / `execute` / `destroy` 里直接读写 `process.minlo.ctx`：

```js
// 能力 A 设
export async function init() {
  process.minlo.ctx.foo = 1;
}

// 能力 B 读
export const deps = ['a'];
export async function execute() {
  console.log(process.minlo.ctx.foo);  // 1
}
```

**为什么用 `process.minlo` 而非 `globalThis.minlo` / `globalThis.ctx`**：
- `process` 是 Node.js 进程对象，**不是**用户变量空间
- 不污染 `globalThis`，不与用户的 `ctx` 变量名冲突
- TypeScript 项目可加 `declare global { namespace NodeJS { interface Process { minlo: { ctx: Record<string, any> } } } }`
- 未来 `process.minlo` 可挂更多共享工具（`log`、`config` 等）

**约束**：
- 框架**不**对 ctx 做类型检查或字段名校验——由能力作者自己保证
- 同一主循环内 `process.minlo.ctx` 是同一对象引用
- 主循环结束后框架**清理** `process.minlo.ctx = {}`（不保留到下次 run；但 `process.minlo` 命名空间本身保留）

3.9 能力配置（`process.minlo.configs`）

任务引用能力时可以给每个能力传一份**配置对象**。配置存在 `process.minlo.configs[name]`，能力在 `init` / `execute` / `destroy` 里读取。

**任务 JSON 语法**（`abilities` 数组的每项可以是两种形式之一）：

| 形式 | 示例 | 含义 |
|---|---|---|
| 字符串 | `"openai"` | 引用能力 `openai`，**不传配置** |
| 对象 | `{ "name": "openai", "config": { ... } }` | 引用能力 `openai`，**传入 config** |

`config` 必须是普通对象（不能是数组、null、基本类型）。框架**不**做 schema 校验——能力作者自己文档说明接受的字段。

**示例任务**：

```json
{
  "name": "天气助手",
  "description": "...",
  "abilities": [
    "counter",
    "logger",
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

**能力访问自己的 config**：

```js
// 能力 openai.js
export const name = 'openai';
export const description = 'OpenAI provider';

export async function init() {
  // 框架在阶段 1 步骤 4 已经把 config 放进 process.minlo.configs.openai
  const config = process.minlo.configs.openai;
  if (!config) {
    throw new Error('openai capability requires config (model, apiKeyEnv)');
  }
  // 用 config.model / config.temperature / config.apiKeyEnv
  // ... 创建 client ...
}
```

**约束**：
- 字符串 `"openai"` 等价 `{ "name": "openai" }`（保留兼容）
- 同一 `name` 在 abilities 数组中**不能出现两次**（启动期报错退出）
- 框架**不**做 config 字段校验——能力运行时自己读 `process.minlo.configs[name]` 时如果缺字段，自己报错
- `process.minlo.configs` 同样在主循环结束时被清空（不保留到下次 run）

3.10 外部依赖（`externalDeps`）

能力可以 import 外部 npm 包（如 `lodash`、`chalk`）。能力用 `externalDeps` 字段**声明**自己依赖哪些 npm 包；**框架不自动安装**，但**启动时检查**——缺包则报错退出，提示用户 `npm install`。

**为什么用 `externalDeps` 声明而不是直接 import**：
- 启动期能**早发现**缺包（import 失败报错时机不固定，错误信息也不友好）
- 用户得到**明确**的修复指引："Run: npm install lodash chalk"
- 能力作者**不**需要把 `package.json` 嵌进能力文件

**声明语法**：

```js
// 能力 my-cap.js
export const name = 'my-cap';
export const description = '...';
export const externalDeps = ['lodash', 'chalk'];  // ← 声明 npm 依赖

import _ from 'lodash';  // 正常使用

export async function execute() {
  console.log(_.chunk([1, 2, 3], 2));
}
```

**框架检查逻辑**（启动期，阶段 1 步骤 0）：
1. 遍历 `registry` 中所有能力的 `externalDeps`（同时扫本地 + 全局两个目录）
2. 用 `createRequire(projectRoot/package.json)` 检查每个包能否解析
3. 任何缺包 → 收集 `{ cap, pkg, source }` 列表（`source` 标记是 local 还是 global 能力）
4. 报错退出：
   ```
   minlo: missing external dependencies:
     - lodash (required by "my-cap" — local ability)
     - openai (required by "llm" — global ability)
          Run: npm install lodash openai
          (This installs into the project's node_modules, which is required
           even for global abilities — see CLAUDE.md §3.10.)
   ```
5. exit code 1

**如果跳过预扫描**（例如 `minlo list` 这类不走 `run` 主流程的命令），仍然会触发 `import()` 副作用；此时 Node 抛 `Cannot find package 'X' imported from <url>`，minlo 在错误信息里解析出缺失包名并补出同样的安装提示：
```
minlo: cannot import llm.js (global ability): missing npm package "openai"
       Cannot find package 'openai' imported from ...\.minlo\abilities\llm.js
       Install it in your project's node_modules:
         npm install openai
       (This is required even for global abilities — see CLAUDE.md §3.10.)
```

**约束**：
- `externalDeps` 必须是 `string[]`，元素是合法 npm 包名
- 框架**不**自动 `npm install`——**用户**手动装
- 框架**不**装在 `.minlo/node_modules/`——装在**项目根 `node_modules/`**（即与 `minlo run` 执行时的 cwd 对应的 `node_modules`）
- **global 能力同样必须在项目根安装依赖**——minlo **不**从自身 `node_modules` 解析 global 能力的 deps（v1 简化：统一从项目根解析）。这是 §11 全局默认能力（如 `llm`）的一个已知 UX 权衡：使用全局能力前先在项目根 `npm install <deps>`
- `externalDeps` 与 `deps`（能力依赖）的区别：
  - `deps`: 能力 `name` 字符串数组，框架内置，**控制 init 顺序**
  - `externalDeps`: npm 包名字符串数组，**不**控制 init 顺序，只是声明"我 import 它"

**典型工作流**：

```bash
# 用户写完能力，发现 minlo run 报错
minlo run
#   minlo: missing external dependencies:
#     - lodash (required by "my-cap")
#          Run: npm install lodash

# 用户装包
npm install lodash

# 再跑就 OK
minlo run
```

3.11 例子：`llm` 能力（OpenAI 兼容 chat completion）

`llm` 能力作为**全局默认**能力随 `npm install -g minlo` 一起装到 `~/.minlo/abilities/llm.js`。它展示了一个**真实可用的能力**如何写：读 config、用 fetch 调外部 API、REPL 模式读 stdin、维护会话状态。

**能力特性**：
- config 字段：`url` / `apiType` / `model` / `apiKey` / `temperature` / `maxTokens` / `prompt`
- `apiType` v1 只支持 `"openai"`（未来扩 anthropic）
- `apiKey` 支持 `${ENV_NAME}` 语法（运行时读 `process.env.ENV_NAME`）
- **状态存 `process.minlo.ctx.llm`**（key = 能力名；其他能力可读 `ctx.llm.messages.length` 等）
- **每轮从 stdin 读一行**用户输入，调用 LLM，打印回复到 stdout
- **stdin EOF**（Ctrl-D / 管道结束）→ 返回 `{ action: 'stop' }` 干净退出
- **init 失败**（如 `${ENV}` 不存在）→ minlo 直接 exit 1，不进主循环
- **不依赖 npm 包**（用原生 fetch）

**任务 JSON 例子**：

```json
{
  "name": "chat",
  "abilities": [
    {
      "name": "llm",
      "config": {
        "url": "https://api.openai.com/v1/chat/completions",
        "apiType": "openai",
        "model": "gpt-4",
        "apiKey": "${OPENAI_API_KEY}",
        "temperature": 0.7
      }
    }
  ]
}
```

**典型工作流**：

```bash
# 1. 设置环境变量
export OPENAI_API_KEY=sk-...

# 2. 跑
minlo run chat
#   [llm] ready — model=gpt-4 url=https://api.openai.com/v1/chat/completions
#   [llm] type a message and press Enter (Ctrl-C to abort)
#     ✓ init llm
#   minlo: main loop (Ctrl-C to abort)...
#   ▸ hello
#   Hi there! How can I help you today?
#   ▸ what's the weather?
#   ...

# Ctrl-D (EOF) → 干净退出
# Ctrl-C → SIGINT 路径退出
```

**关键设计点**（与 §3.1 §3.7 §3.8 §3.9 §3.10 的对应关系）：
- 5 字段：name / description / **init** / **execute** / **destroy** 全有
- 0 deps（不依赖其他能力）
- 0 externalDeps（用原生 fetch）
- 状态通过 `process.minlo.ctx.llm` 暴露
- config 注入 `process.minlo.configs.llm`
- 多轮对话由闭包里的 `messages` 数组累积；用 `ctx.llm` 暴露给其他能力观察
- execute 总是返回 `{ action: 'continue' }`（除非 stdin 关闭）—— 退出靠 Ctrl-C 或 Ctrl-D

四、执行生命周期与顺序界定
`minlo run` 启动后，严格按照以下阶段顺序执行。**跨阶段顺序由框架固写**（不可用户修改）；**同阶段内（init / 死循环 / destroy）多个能力的顺序**按 mission.abilities 数组的顺序（不是注册表扫描顺序）。

4.1 阶段一：初始化（执行一次）
| 步骤 | 操作 | 依赖条件 |
|---|---|---|
| 1 | 解析任务名 | 详见 §6.1.2（无参 → `default`；`<name>` → 严格匹配；`<name:default>` → fallback） |
| 2 | 加载任务 JSON | 从 `.minlo/missions/<name>.json` 读；缺失则报错退出 |
| 3 | 解析 mission.abilities | 把 `abilities` 数组里的 `name` 在注册表中逐个查找；**任一找不到** → 报错退出 |
| 4 | 创建 `process.minlo.ctx = {}` | 跨能力通信的共享对象（详见 §3.8） |
| 5 | 拓扑序 init | 按能力 `deps` 字段做拓扑排序，被依赖的先 init；对**有 `init` 函数**的能力调用一次（详见 §3.7）。**任一 init 抛错 → stderr 报错 + exit 1**（v1 设计：init 失败意味着配置错或资源不可用，进主循环无意义；直接退出） |
| 6 | 进入主循环 | 此时能力集 + 任务配置均已就绪，**能力集锁定**，运行中不再变化 |

4.2 阶段二：主循环（v1 死循环，无 maxIterations）

每轮循环按 abilities 顺序对**有 `execute` 函数**的能力调用一次 `execute({ cwd, mission, workspacePath, step })`。`step` 从 0 起每轮 +1。

**`execute` 的循环控制信号**（v1 协议）：

`execute` 的返回值是**循环控制对象**——通过 `action` 字段决定本轮后续行为：

| 返回值（`result.action`） | 行为 |
|---|---|
| `'continue'`（**默认**） | 本能力完成；继续调本轮下一个能力 |
| `'break'` | 本轮后续能力**跳过**；下一轮 `while` 顶部重新开始（仍调本能力 + 本轮后续） |
| `'stop'` | **整个主循环退出**；进入 §4.3 destroy |
| 不返回 / 返回 `undefined` / `null` / `{}` / 任何不含 `action` 字段的对象 | 等价 `'continue'` |
| 抛出任意异常 | **整个主循环退出**；stderr 打印错误；进入 §4.3 destroy；进程 exit 1 |

**为什么 `break` 和 `stop` 分开**：

- `break`：本能力是个**轻量级"跳过后续"信号**——例如"我处理完了，这一轮其他能力不必重复劳动"；下一轮再决定
- `stop`：永久退出。`{ action: 'stop' }` 表明"我已经完成所有该做的事"——LLM 决定调用工具后工具可以返回 stop，告知主循环"对话已结束"
- 异常：能力代码**未预期错误**——退出循环并 stderr 报告

`mission.loop` 字段 v1 不存在（v1 整个 mission JSON 不含 loop）——以上行为**不**通过任务 JSON 配置。能力想"达到某条件退出循环"由 `execute` 内部决定返回什么。

> **v1 无任何死循环兜底**（无 maxIterations、无 timeout）。如果能力的 `execute` 永远不返回 `stop` 且不抛异常，进程会真挂死——只能 Ctrl-C 退出。能力作者必须保证 `execute` 在合理条件下终止。

4.3 阶段三：清理（执行一次）

**倒序 destroy**——按 abilities 数组的**逆序**，对**有 `destroy` 函数**的能力调用一次 `destroy({ cwd, mission, workspacePath })`。

- 任一 `destroy` 抛异常 → stderr 报告但**继续**后续 destroy（确保资源清理尽量完成）
- 全部 destroy 后进程退出：
  - `execute` 返回 `'stop'` → exit 0
  - `execute` 抛异常 → exit 1

4.4 顺序界定规则总结
| 维度 | 规则 |
|---|---|
| 跨阶段 | 框架硬编码：任务解析 → 能力 init → 主循环（execute ×N） → 倒序 destroy |
| 同阶段内 | **按 mission.abilities 数组顺序**（不是注册表扫描顺序）—— `init` 正序，`destroy` 倒序 |
| 主循环 | 死循环；`step` 从 0 起每轮 +1 |

五、能力发现与启动期注册
"热插拔"在 Minlo 中的含义：**在两次 `minlo run` 之间**改动能力文件无需额外步骤；下一次启动会自动发现新文件、移除已删除的文件、重建注册表。**主循环一旦开始，能力集锁定，运行中不变。**

5.1 扫描范围（启动期，一次性）
| 目录 | 内容 |
|---|---|
| `<项目根>/.minlo/abilities/` | 本地能力（平铺，仅一层） |
| `~/.minlo/abilities/` | 用户全局能力（详见 §3.6） |

合并策略：先扫描全局，再扫描本地；**本地同名能力覆盖全局**（同名即冲突，本地胜出并对全局文件输出警告）。同目录内 `name` 重复 → 后扫到的胜出，并输出警告。

5.2 注册表结构
启动期构建一份 `name → CapabilityRecord` 的内存注册表，存于运行时进程内：

| 字段 | 说明 |
|---|---|
| `name` | 能力的全局唯一标识（从 `export.name` 读取） |
| `description` | 展示用文本（从 `export.description` 读取） |
| `hasInit` | 布尔：能力是否导出 `init` |
| `hasExecute` | 布尔：能力是否导出 `execute` |
| `hasDestroy` | 布尔：能力是否导出 `destroy` |
| `instance` | 能力模块导出对象（懒求值，仅在被 `init` 时才真正 `import`） |
| `source` | `'local' \| 'global'`，便于错误信息定位 |
| `filePath` | 能力文件绝对路径，便于堆栈定位 |

5.3 启动期加载顺序（含严格 schema 校验）
1. 解析 cwd → 定位 `.minlo/abilities/` 与 `~/.minlo/abilities/`
2. 扫描两目录，列出 `.js` / `.ts` 文件
3. 对每个文件用 `import()` 解析 export（**不执行** `init` 等副作用函数）
4. **严格 schema 校验**（任一失败即拒绝该文件，stderr 输出警告，继续处理下一个）：
   - `name` 必填且为 string
   - `description` 必填且为 string
   - `init` / `execute` / `destroy` 至少有一个为 function
   - 导出对象的键**只能是** `name` / `description` / `init` / `execute` / `destroy`——任何其他键（含 `type` / `order` / `config` / `chat` 等）出现即拒绝
5. 冲突处理：本地覆盖全局；同目录重名时后者覆盖前者并警告
6. 通过校验的能力进入注册表；未通过的从注册表中移除

5.4 destroy 调用责任
`destroy(ctx)` **不是**由 Node 进程退出事件触发的（`beforeExit` 不会在重载/重启时按能力粒度触发）。`destroy` 的调用责任在加载器：
- 主循环正常结束（阶段三 §4.3 第 1 步）→ 加载器遍历注册表，对**有定义** `destroy` 的能力调用一次
- 主循环异常中断（Ctrl-C、未捕获异常）→ 加载器**不保证** `destroy` 被调用；能力作者需在 `destroy` 中实现幂等清理

能力作者应将 `destroy` 视为"释放资源的安全网"——能调最好，没调到也不应产生脏数据（例如：先写日志再清连接，而不是先清连接再写日志）。

5.5 TypeScript 能力文件
若 `cwd` 的 `package.json` `dependencies` 中有 `tsx`，框架使用 `tsx` 加载 `.ts` 文件；否则 `.ts` 被忽略并提示"未安装 tsx，TS 能力未加载"。这与 §8.2 一致——`.ts` 始终是用户的主动选择。

5.6 不监听运行中变更
Minlo **不**对 `abilities/` `missions/` 做 `fs.watch`：
- 主循环期间改文件，**不会**被自动拾取
- 下一次 `minlo run` 启动时一次性重新发现与注册

这避免了运行期"半新半旧"能力集的不一致状态——所见即所得（看到新文件 = 下次启动生效）。
六、CLI 命令规范
6.1 全局命令
| 命令 | 说明 |
|---|---|
| `minlo init [--here]` | 初始化当前目录为 Minlo 工作区：创建 3 个空目录（`missions/` / `abilities/` / `workspace/`）+ 复制 `default.json` 模板 + 创建/合并 `package.json`。详见 §6.1.1 |
| `minlo run [mission_name[:default]]` | 启动主循环。详见 §6.1.2 |
| `minlo list` | 列出 `abilities/` 中所有已注册的能力。详见 §6.1.3 |

6.1.1 `minlo init`
- 默认：要求目录为空（无 `package.json` / `.minlo/`）；生成完整脚手架
- 复制 `default.json` 模板到 `.minlo/missions/default.json`（**不**复制其他任务）
- `--here`：在已有项目里运行，**只**生成 `.minlo/` 3 个空目录 + 复制 default 模板；**合并** `package.json`（添加 `dependencies.minlo` 与 `minlo:list` / `minlo:run` 脚本，不覆盖用户已有键）

6.1.2 `minlo run [mission_name[:default]]`
四种调用模式：

,
|---|---|---|
| `minlo run` | 走 `default` 任务 | `.minlo/missions/default.json` 必须存在，否则报错 |
| `minlo run <name>` | 走 `<name>` 任务 | 严格匹配；`.minlo/missions/<name>.json` 不存在 → 报错退出 |
| `minlo run <name:default>` | 走 `<name>`，不存在时 fallback | `<name>` 存在用之；不存在用 `default`；都找不到 → 报错 |
| `minlo run <name:x>` | 走 `<name>`，fallback 到 `x` | 同上，`x` 是任意任务名（不一定叫 default） |

`<name>` 解析规则：去掉 `.json` 后缀的文件名（指向 `.minlo/missions/<name>.json`）。

执行细节见 §4（init 顺序、死循环、`execute` 返回值协议、倒序 destroy）。

6.1.3 `minlo list`
输出格式（每行一条能力）：

```
<name>     [init] [execute] [destroy]   <description>   (local|global)
```

标签出现规则（v1）：
- `[init]`：能力导出 `init` 函数时显示
- `[execute]`：能力导出 `execute` 函数时显示
- `[destroy]`：能力导出 `destroy` 函数时显示

> 这三个标签**不是**"角色"标识——能力**没有角色**。它们只是告诉用户"这个文件**有**哪些函数"，让用户对"这个能力能否做某件事"有直观看法。

6.2 任务管理（`minlo mission`）
| 子命令 | 说明 |
|---|---|
| `minlo mission list` | 列出 `missions/` 目录下所有可用的任务文件（显示 `name` 和 `description`） |
| `minlo mission show <name>` | 打印指定任务的完整 JSON 配置 |
| `minlo mission validate <name>` | 校验指定任务的 JSON 格式及引用的能力是否存在 |

> v1 移除 `minlo session *` 子命令。会话是能力层概念，由用户实现的"会话能力"管理，不属于 minlo 框架内核。

七、配置优先级

7.1 智能体选择优先级（`minlo run`）
优先级是**互斥**的（不是回退链）——`minlo run` 的三种形式在 §6.1.2 已经确定。

| 命令形式 | 选择的 任务 | 找不到时的行为 |
|---|---|---|
| `minlo run` | `default`（固定） | 报错退出 |
| `minlo run <name>` | `<name>` | 报错退出（**不**回退到 default） |
| `minlo run <name:fb>` | `<name>` 优先；不存在则 `<fb>` | 两者都找不到时报错退出 |

> v1 移除所有 `MINLO_*` 环境变量（`MINLO_AGENT` / `MINLO_PROVIDER` / `MINLO_MEMORY` / `MINLO_SESSION_ID`）。配置只来自两处：命令行参数、文件。
>
> v1 移除"空循环"作为 fallback——v1 严格要求任务文件存在，否则直接退出。空循环由能力自己实现（`abilities: []` 配一个能 `execute({ stop: true })` 的能力即可）。

八、TypeScript 支持策略
8.1 框架核心
开发：使用 TypeScript 编写，严格约束接口

发布：编译为 JavaScript，附带 .d.ts 类型定义

用户感知：完全透明，用户安装的是纯 JS 包

8.2 用户能力代码
用户类型	推荐做法	操作
快速体验 / 新手	纯 JavaScript	minlo init 直接上手，保持 .js 后缀
追求类型安全 / 团队协作	迁移到 TypeScript	1. npm install -D tsx @types/node
2. 将 .js 改为 .ts
3. 添加 tsconfig.json
不想装 TS，但想要提示	JavaScript + JSDoc	在 .js 文件顶部添加 // @ts-check
8.3 加载器自动适配
框架在加载能力文件时，自动识别文件扩展名：

.js：使用原生 import()

.ts：检测是否安装了 tsx，若已安装则使用 tsx 动态加载，否则输出提示并忽略

九、端到端工作流示例

9.1 场景：开发天气查询能力并调试
```bash
# 1. 新建项目并初始化
mkdir weather-mission && cd weather-mission
minlo init
npm install

# 2. 编写能力：.minlo/abilities/weather.js
# （必须导出 name / description；至少导出 init / execute / destroy 之一）
# 例：
#   export const name = 'weather';
#   export const description = '查询城市天气';
#   export async function execute({ city }) { return { temp: 22, city }; }

# 3. 查看能力是否被识别
minlo list
# 输出显示：weather    [execute]    查询城市天气    (local)

# 4. 创建调试智能体：.minlo/missions/weather.json
{
  "name": "天气助手",
  "abilities": ["weather"]
}

# 5. 用该 任务 跑一次
minlo run weather
# 框架进入主循环，按 abilities 中的 name 逐个调用 execute
# （v1 不创建会话文件——状态由能力自己写到 workspace/）

# 6. 修改 weather.js 的实现，保存文件
# （v1 不监听运行中变更——下次启动才生效）

# 7. 调试完成后，将 weather 添加到 default.json 的 abilities 中

# 8. 走 default 跑
minlo run
# （无参 = 走 default.json；需要 default 存在并包含 weather）
```

9.2 场景：多智能体 A/B 测试（v1 无会话）
```bash
# 1. 创建两个智能体
# .minlo/missions/mission_a.json
# .minlo/missions/mission_b.json

# 2. 跑 mission_a
minlo run mission_a

# 3. 跑 mission_b（每次 run 都是新的"循环"——v1 无会话概念）
minlo run mission_b

# 4. 状态由能力自己写到 workspace/，下次 run 时能力 init 可以读取
```

> v1 不提供"跨次 run 保留上下文"的能力。能力作者若需要该能力——自己设计"会话能力"（一个 init/execute/destroy 三函数能力），写到 `workspace/<name>/`。

十、设计约束与边界

10.1 明确不支持的设计
| 特性 | 原因 |
|---|---|
| 任务继承（extends） | 避免隐式依赖和配置漂移，保持配置完全自包含 |
| 能力的 `type` 字段 | v1 能力没有"角色"——接口严格 5 字段（详见 §3.1） |
| 能力方法名别名（`chat` / `get` / `retrieve` / `beforeStep` 等） | 仅识别 `init` / `execute` / `destroy` 三个固定函数名 |
| 能力的 `order` 字段 | v1 不保留——同阶段内多能力顺序按 mission.abilities 数组顺序 |
| mission.json 的 `loop` 字段 | v1 不存在——主循环是死循环；退出由能力 `execute` 返回值或异常控制（详见 §4.2） |
| 主循环的 `maxIterations` / `timeout` 兜底 | v1 不提供——能力作者必须保证 `execute` 不会永远不返回（详见 §4.2 警告） |
| 文件名排序 | 避免热插拔时需重命名文件，不依赖 `01_xxx.js` 等命名约定 |
| 能力递归扫描 | `abilities/` 仅扫描一层，简化加载逻辑 |
| 能力运行时变更 | 主循环期间能力集锁定，避免"半新半旧" |
| `MINLO_*` 环境变量 | v1 移除所有环境变量配置，配置只来自命令行、文件、文件系统约定 |
| 跨能力依赖声明 | 由能力自己通过 `ctx` 共享状态 |

10.2 安全考虑
| 关注点 | 措施 |
|---|---|
| 能力执行沙箱 | `execute` 运行在 Node.js 主进程，建议用户自行实现安全校验（如白名单、参数校验） |
| 配置文件校验 | 加载任务 JSON 时进行严格校验，防止非法引用导致崩溃 |
| 能力 schema 校验 | 加载时按 §5.3 严格校验 5 字段；多出字段（含 `type` / `order` 等）拒绝该文件 |
| 凭据管理 | 会话数据不存储 API Key 等敏感信息，凭据应放在 `.env` 中（v1 由用户自管） |
| 路径遍历 | 工作区路径严格限制在 `.minlo/workspace/` 内，防止能力读写任意系统文件 |
十一、快速开始

### 全局安装

```bash
npm install -g minlo
```

`npm install -g minlo` 的副作用：
- 把 `minlo` 包装到全局 `node_modules/`，暴露 `minlo` 命令
- **`postinstall` 钩子自动执行**（详见 §11.1）——把包内 `global-assets/abilities/helloworld.js` 复制到 `~/.minlo/abilities/`

11.1 `postinstall` 行为

minlo 包附带一份"开箱即用"的能力文件 `helloworld.js`，作为全局默认能力示例。`npm install -g minlo` 触发 `postinstall` 钩子执行 `scripts/install-global-helloworld.js`：

```bash
# postinstall 干的事：
node scripts/install-global-helloworld.js
#   from: <minlo>/global-assets/abilities/helloworld.js
#   to:   ~/.minlo/abilities/helloworld.js
```

**幂等性**：如果 `~/.minlo/abilities/helloworld.js` 已经存在（用户改过、之前装过等），`postinstall` **不会覆盖**。要强制重装：

```bash
rm ~/.minlo/abilities/helloworld.js
npm install -g minlo   # 重装即重新触发 postinstall
```

如果想跳过 `postinstall`：

```bash
npm install -g minlo --ignore-scripts
```

### 创建第一个项目

```bash
# 创建项目目录
mkdir my-mission && cd my-mission

# 初始化工作区
minlo init

# 查看可用能力（应能看到 helloworld）
minlo list

# 启动运行（default 任务 包含 helloworld）
minlo run
#   [helloworld] init  (executeCount reset to 0)
#     ✓ init helloworld
#   [helloworld] execute #1 (step=0)
#   ...
#   [helloworld] execute #11 (step=10)
#   [helloworld] returning { action: "stop" } (executed > 10 times)
#   [helloworld] destroy (total executes: 11)
```