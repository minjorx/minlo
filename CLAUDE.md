# CLAUDE.md

> 给 Claude(AI 助手)的项目速记。**只放仓库特定信息 + 文档导航;不在此堆设计内容**。

## 仓库

- **npm 名**:`minlo`
- **类型**:CLI 工具(`minlo run` / `init` / `list`)
- **owner**:minjorx
- **本机开发**:`d:/Projects/minlo`(Windows)
- **运行时**:`.minlo/abilities/`(本地) + `~/.minlo/abilities/`(全局)
- **关键约定**:能力文件 schema 严格 7 字段(`name`/`description`/`init`/`execute`/`destroy`/`deps`/`externalDeps`),多一个就拒
- **不要做的事**(v1 明确不支持):任务继承、`type` 字段、method 别名、`order`、`loop`、`maxIterations`、文件名排序、`MINLO_*` 环境变量。完整列表见 [docs/design.md §9.1](docs/design.md#91-明确不支持的设计)

## 文档导航

| 我想了解 | 看 |
|---|---|
| 框架是什么、怎么用 | [README.md](README.md) |
| 完整设计文档(能力 schema / 生命周期 / 依赖 / CLI) | [docs/design.md](docs/design.md) |
| 端到端示例(写能力、跑多 mission) | [docs/examples/](docs/examples/) |
| 仓库结构、开发命令、发布流程 | [CONTRIBUTING.md](CONTRIBUTING.md) |
| 自己写能力时 `execute` 该返回什么 | [docs/design.md §4.2](docs/design.md#42-阶段二主循环v1-死循环无-maxiterations) |
| global 能力依赖为什么解析不到 | [docs/design.md §3.10](docs/design.md#310-外部依赖externaldeps) |

## 命令速查

```bash
# 改源码后
npm run build                          # tsc + copy templates
npm run dev -- list                    # 不构建,tsx 直接跑

# 全局 link
npm link && npm unlink --global minlo  # 开发/取消开发链

# 测试
npm test
```

## 占位规则(给 Claude 自己)

- 用户提"加个能力"→ 写到 `.minlo/abilities/<name>.js`,然后改 mission JSON,跑 `minlo list` 验证
- 用户提"改框架"→ 优先看 `src/lib/loader.ts` + `src/commands/run.ts` + `docs/design.md`
- 用户提"文档不清楚"→ 优先改 `docs/design.md`(权威源);README 改完要同步检查导航一致
- 涉及 v1 不支持的设计项(见上)→ 先在回复里说明"v1 故意不支持",不要直接做
