# minlo

Minlo — 轻量级、可热插拔的 LLM Agent 运行时编排框架。

> 完整设计文档见 [CLAUDE.md](./CLAUDE.md)。

## Install (local dev)

```bash
npm install      # pulls commander, typescript, tsx, @types/node
                 # also runs `prepare` → tsc → dist/
npm link         # creates a global symlink so `minlo` is on PATH
```

After `npm link`, the `minlo` command resolves to `dist/bin/minlo.js` and source changes become effective after a rebuild:

```bash
npm run build    # tsc → dist/
minlo --version  # → 0.1.0
```

## Quick start (user perspective)

```bash
mkdir my-mission && cd my-mission
minlo init                 # scaffolds .minlo/ with default mission + abilities
minlo list                 # see registered capabilities
minlo run                  # run the default mission
```

## Layout

```
.
├── bin/minlo.ts            # CLI entry, shebang preserved by tsc
│                           # also reads package.json (walks up from
│                           # import.meta.url until it finds a package.json
│                           # with "name": "minlo" — works in both source
│                           # and dist without hard-coded `..`s)
├── src/
│   ├── index.ts            # wires commander, registers commands
│   ├── lib/                # loader, mission parser, topo sort, runtime
│   └── commands/           # init / list / run / version
├── templates/              # files copied by `minlo init` into user projects
│   └── missions/default.json
├── global-assets/          # abilities shipped to ~/.minlo/abilities/ on `npm i -g minlo`
│   └── abilities/helloworld.js
├── scripts/                # build & postinstall helpers
├── tsconfig.json           # NodeNext + strict, outputs to dist/
├── package.json            # bin → dist/bin/minlo.js
└── dist/                   # build output (gitignored)
```

## Unlink

```bash
npm unlink --global minlo
```
