# 贡献指南

> 完整设计文档见 [`docs/design.md`](docs/design.md)。本文面向**框架贡献者**——会改 `src/`、`scripts/`、发布流程的人。

## 受众

| 你是 | 读什么 |
|---|---|
| **使用者**:写 mission + ability,使用 `minlo run` | [README.md](README.md) + [docs/design.md](docs/design.md) |
| **贡献者**:改框架代码、加 CLI 子命令、改 loader | [CONTRIBUTING.md](CONTRIBUTING.md)(本文) + [docs/design.md](docs/design.md) |
| **AI 助手**(Claude) | [CLAUDE.md](CLAUDE.md)——只放仓库骨架与导航,不要在里面堆设计内容 |

## 仓库结构

```
.
├── bin/minlo.ts                # CLI 入口(shebang 保留)
│                               # 用「向上找含 name='minlo' 的 package.json」定位包根
│                               # 启动时懒创建 ~/.minlo/ 子目录
├── src/
│   ├── index.ts                # commander 装配；注册所有子命令
│   ├── lib/                    # 框架核心库
│   │   ├── loader.ts           # 扫描 / 校验能力文件,构建注册表
│   │   ├── mission.ts          # 解析 <name[:fb]>、加载 .minlo/missions/<name>.json
│   │   ├── topo.ts             # 按 deps 做拓扑排序
│   │   ├── runtime.ts          # tsx 检测
│   │   └── ability-registry.d.ts   # 共享类型(待补)
│   └── commands/               # commander 子命令
│       ├── init.ts             # `minlo init [--here]`
│       ├── list.ts             # `minlo list`
│       ├── run.ts              # `minlo run [name[:fb]]` — 阶段 1/2/3 全部在这
│       └── version.ts          # `minlo version`
├── templates/
│   └── abilities/default.json  # `minlo init` 复制的模板
├── global-assets/abilities/    # `npm install -g minlo` 的 postinstall 源
│   ├── helloworld.js           # 默认全局能力
│   ├── counter.js              # provide 字段示范: 计数器
│   ├── demo-user.js            # provide 字段示范: process.minlo.call('counter.increment')
│   └── llm.js                  # OpenAI 兼容 LLM 能力
├── scripts/
│   ├── copy-assets.mjs         # tsc 后把 templates/ 和 docs/ 复制到 dist/
│   └── install-global-helloworld.js   # postinstall 钩子
├── docs/
│   ├── design.md               # 完整设计文档
│   └── examples/               # 端到端示例
├── package.json                # bin → dist/bin/minlo.js
└── tsconfig.json               # NodeNext + strict,输出 dist/
```

## 开发命令

```bash
npm install                    # 装 commander/tsx/typescript/@types/node
npm run build                  # tsc + 复制 templates 到 dist/
npm run dev -- list            # 用 tsx 直接跑 .ts,跳过构建
npm run dev -- run             # 开发期调试主循环
npm link                       # 全局链到当前目录,`minlo` 命令即用本仓库代码
npm unlink --global minlo      # 取消全局链
npm run install:global         # 手动跑 postinstall(把 global-assets/abilities 复制到 ~/.minlo/)
```

## 代码规范

### 关键约定(改前必读)

1. **能力文件 schema 严格**(`docs/design.md §3.1`)。7 个允许字段:`name` / `description` / `init` / `execute` / `destroy` / `deps` / `externalDeps`。**多一个就拒**。
2. **`execute` 返回值协议**(`docs/design.md §4.2`)。`{ action: 'continue' | 'break' | 'stop' }`,没有 `action` 字段等价 `continue`;异常 = 退出。
3. **跨能力通信走 `process.minlo.ctx`**(`docs/design.md §3.8`)。**不要**用 `globalThis.ctx` 或 `globalThis.minlo`。
4. **能力 init 用 `deps` 声明拓扑序**(`docs/design.md §3.7`)。**不**传递数据。
5. **`externalDeps` 必须在项目根 `node_modules/`**(`docs/design.md §3.10`)。v1 不从 minlo 自身 `node_modules/` 解析 global 能力依赖。
6. **主循环不监听文件变更**(`docs/design.md §5.6`)。改 ability 文件要等下次 `minlo run` 才生效。
7. **destroy 是"安全网"**(`docs/design.md §5.4`)。Ctrl-C 退出时**不保证**调用——能力作者要保证幂等。
8. **v1 不做的事**(§9.1):任务继承、`type` 字段、method 别名、`order`、`loop`、`maxIterations`/timeout 兜底、文件名排序、子目录、`MINLO_*` 环境变量。**不要**在 PR 里加这些。

### TypeScript 风格

- `strict: true`(已在 `tsconfig.json`)
- 源文件用 `.ts`;源内 import 用 `.js` 后缀(NodeNext 要求)
- 不引入测试框架之外的依赖——保持 `package.json dependencies` 只有 `commander`(用户运行时)

## 发布流程

```bash
# 1. 升 version
npm version patch   # 或 minor / major

# 2. 构建
npm run build       # tsc + copy-assets (templates/, docs/)

# 3. 验证
node dist/bin/minlo.js --version
node dist/bin/minlo.js list  # 在临时目录跑,看 .minlo/abilities/ 是否正常

# 4. 发布
npm publish         # postinstall 钩子会自动跑
```

`postinstall` 钩子(`scripts/install-global-helloworld.js`)的语义:
- 把 `global-assets/abilities/*.js` 复制到 `~/.minlo/abilities/`
- 幂等:目标文件存在则跳过(用户改过的本地副本保留)
- 强制重装:`rm ~/.minlo/abilities/<file>.js && npm install -g minlo`

## 修改某处前

| 改什么 | 先看 |
|---|---|
| CLI 子命令 | `src/commands/<name>.ts` + `src/index.ts`(注册处) |
| 能力加载逻辑 | `src/lib/loader.ts` + `docs/design.md §5` |
| Mission 解析 | `src/lib/mission.ts` + `docs/design.md §6.1.2` |
| 主循环 | `src/commands/run.ts` + `docs/design.md §4` |
| `process.minlo.call` / `provide` 字段 | `src/commands/run.ts` (call 安装 + provides 镜像) + `src/lib/loader.ts` (字段校验) + `docs/design.md §3.12` |
| 全局能力 | `global-assets/abilities/` + `scripts/install-global-helloworld.js` |
| 用户模板 / 文档 | `templates/missions/default.json` + `docs/design.md` → `scripts/copy-assets.mjs` |

## 测试

`npm test` 跑 `node --test test/`。本项目目前测试覆盖度较低,新增能力 / 关键路径前请补 `test/<name>.test.mjs` 形式的 `node:test` 用例。

- 测纯函数 / 模块:**直接**在 `test/<name>.test.mjs` 里 `import` + `node:test`
- 测 `process.minlo.call` 行为:写一个小型能力 export `provide`,在测试 mission JSON 里引用它 + 另一个用 `call` 调用的 ability,跑 `minlo run` 并断言 stderr 输出(端到端风格)

## 报告 issue

描述清楚:
- 复现命令(包括 `minlo` 完整调用)
- 预期 vs 实际
- `minlo list` 输出
- 相关 mission JSON / ability 代码

## 设计变更流程

`docs/design.md` 是定稿文档(v1.0)。**设计变更**(突破 §9.1 的不支持项、改变生命周期协议、加新 CLI 子命令)需要:
1. 先开 issue 讨论(动 v1 的「明确不支持」是 breaking change)
2. 同步改 `docs/design.md` 对应章节
3. 在 commit message 里引用 issue 编号
