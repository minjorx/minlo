# Minlo 现状(Status)

> **这是"现状"文档,不是"设计"文档。**
>
> | 文档 | 角色 | 更新频率 |
> |---|---|---|
> | [`docs/design.md`](./design.md) | 设计定稿(v1.0,稳定) | 几乎不变 |
> | **本文档** | 当前版本能做什么(随实现变) | 每个 minor version 更新 |
>
> 当你说"minlo 现在能不能做 X"——**查本文档**;当你说"X 的设计动机是什么"——**查 design.md**。

## 当前版本:v1.0.0

- **npm 名**:`minlo`
- **版本**:`1.0.0`
- **license**:MIT
- **Node**:`>=20`
- **仓库**:[github.com/minjorx/minlo](https://github.com/minjorx/minlo)
- **dist 大小**:轻量(只依赖 `commander`)
- **CLI 命令数**:5 个(`init` / `run` / `list` / `docs` / `version`)

## 现在能做什么 ✅

### 安装 / 启动

- `npm install -g minlo` 装到全局,`minlo` 命令可用
- `postinstall` 自动把 `helloworld` 复制到 `~/.minlo/abilities/`
- `minlo init` 在空目录生成 `.minlo/{missions,abilities,workspace}` + `default.json` mission
- `minlo init --here` 在已有项目里只生成 `.minlo/` + 合并 `package.json`

### 编写能力

- 8 字段严格 schema:`name` / `description` / `init` / `execute` / `destroy` / `deps` / `externalDeps` / `provide`
- 任何字段多了 / 写错类型 / 缺 `name` 或 `description` → 整个文件被拒
- 多一个字段也拒(防止"约定俗成"蔓延)
- `.ts` 能力支持(若项目装了 `tsx`)
- `externalDeps` 启动期预检查,缺包时给清晰 `npm install` 提示

### 编写任务(mission)

- JSON 3 字段:`name` / `description` / `abilities[]`
- `abilities` 数组每项是字符串 `"name"` 或 `{ name, config }` 对象
- 引用不存在的 ability → 启动期 `references unknown ability` 错误
- 循环 `deps` → 启动期 `cyclic dependency` 错误

### 运行时

- 拓扑序 init:`deps` 声明谁先 init
- 主循环:按 `mission.abilities` 顺序每轮调用每个 `execute`
- `execute` 返回值协议:`{ action: 'continue' | 'break' | 'stop' }`
- 抛异常 → 主循环退出 + exit 1
- 倒序 destroy:每个有 `destroy` 的能力被调用一次
- Ctrl-C 不保证调 `destroy`(能力作者要保证幂等)

### 能力间互调

- `provide` 字段声明对外暴露的 API
- `process.minlo.call('<name>.<fn>', ...args)` 调任意 ability 的 API
- 写错 ability 名 / 函数名 → 运行时**抛清晰错误**(列出可用的)

### 状态存储

- 闭包变量(模块顶层 `let`)—— 该 ability 内共享
- `process.minlo.ctx.<name>` —— 跨 ability 共享
- `.minlo/workspace/<name>/` 落盘 —— 跨 `minlo run` 持久

### CLI

| 命令 | 作用 |
|---|---|
| `minlo init [--here]` | 初始化工作区 |
| `minlo run [name[:fb]]` | 启动主循环 |
| `minlo list` | 列出已注册 ability |
| `minlo docs` | 打印 docs/design.md(给 LLM agent 用) |
| `minlo --version` / `minlo -V` | 打印版本号 |

### 文档

- `docs/design.md`(1005 行)—— 完整设计文档
- `docs/examples/` —— 3 篇端到端 walkthrough:
  - `weather.md`:开发 + 调试一个能力
  - `multi-mission.md`:多 mission + 跨 run 持久
  - `provide-and-call.md`:`provide` + `process.minlo.call` 互相调用
- `README.md` —— 用户入口
- `CONTRIBUTING.md` —— 贡献者入口
- `CLAUDE.md` —— 给 AI 助手的项目速记

## 现在**不**支持 ❌

以下是 v1.0 **明确不做**的(详见 [docs/design.md §9.1](design.md#91-明确不支持的设计)):

- 任务继承(`extends`)—— 避免隐式依赖
- 能力的 `type` 字段 —— 能力没有"角色"
- 方法名别名(`chat` / `get` / `beforeStep` 等)—— 仅识别 3 个固定函数
- `order` 字段 —— 按 `mission.abilities` 数组顺序
- mission 的 `loop` 字段 —— 主循环是死循环,能力自己控制退出
- `maxIterations` / `timeout` 兜底 —— 没有,作者要保证 `execute` 不会永远不返回
- 文件名排序 —— 避免 `01_xxx.js` 命名约定
- 能力递归扫描 —— `abilities/` 只扫一层
- 能力运行时变更 —— 主循环期间锁定
- `MINLO_*` 环境变量 —— 配置只来自命令行 / 文件
- 双向依赖(循环) —— 直接报错退出
- 内置 session / conversation 概念 —— 业务层概念,由用户实现
- LLM SDK 集成 —— `llm` 是 global ability,用户自己装 `openai` 包
- TS 能力用 `process:minlo` 虚拟模块(被否决)—— 改用 `provide` 字段
- SDK for LangChain/Autogen 等其他 agent 框架 —— 不做(用 `minlo docs` 即可)

## 已知 UX 权衡(有意为之,见 design.md §9.2)

- 调用方写 `process.minlo.call('a.b', x)` 而不是 `a.b(x)` —— 牺牲 5 字符换"无 loader hook、Node ≥ 20 兼容、IDE 完整补全"
- `externalDeps` 必须装在**项目根** `node_modules/` —— 不用 `.minlo/node_modules/`
- global ability 的 npm 依赖也得装在项目根(用户机器上的 `~/.minlo/` 不带 `node_modules`)

## 已知 Bug / 不完美

目前**没有**已知的功能性 bug。文档、CHANGELOG、PR 流程、issue 模板都**还没建**(基础够用,但不完善)。

## 下一版计划

- **v1.1** 的设计已经讨论过(详见 git log `c5ccbbe`、`75d1289`),但被回滚到 A 方案(`c5ccbbe` 当前实现)。如果未来要进 v1.1,可能加:
  - `process.minlo.use(name)` 解构直调(已讨论,被否决,需要重提)
  - `minlo list --format=md / --for-agent`(给 agent 看的格式)
- **v1.2+**:不预测,等用户反馈

## 历史 / 迁移

- v1.0.0 是第一个**稳定**版本
- 之前 commit 都标 0.1.0(实际上是 v1.0-rc),1.0.0 commit 见 `cf99468`
- 0.x → 1.0 没有任何 API 变化(只是 v1.0 设计定稿前期的开发)
- 升级:`npm install -g minlo@latest` 即可
