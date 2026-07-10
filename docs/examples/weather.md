# 示例：开发天气查询能力并调试

> 完整设计文档见 [`../design.md`](../design.md)。本示例展示"开发一个能力"的标准流程。

## 目标

写一个 `weather` 能力,接受 `{ city }` 参数返回 `{ temp, city }`。验证从 init 到 run 的端到端流程。

## 步骤

### 1. 新建项目并初始化

```bash
mkdir weather-mission && cd weather-mission
minlo init
npm install
```

### 2. 编写能力：`.minlo/abilities/weather.js`

```javascript
// 必须导出 name / description；至少导出 init / execute / destroy 之一
export const name = 'weather';
export const description = '查询城市天气';

export async function execute({ city }) {
  return { temp: 22, city };
}
```

### 3. 查看能力是否被识别

```bash
minlo list
# 输出显示：weather    [execute]    查询城市天气    (local)
```

### 4. 创建调试任务：`.minlo/missions/weather.json`

```json
{
  "name": "天气助手",
  "abilities": ["weather"]
}
```

### 5. 用该任务跑一次

```bash
minlo run weather
```

框架进入主循环,按 `abilities` 中的 name 逐个调用 `execute`。`weather.execute` 返回普通对象(没有 `action` 字段),等价 `action: 'continue'`,主循环会一直转——用 Ctrl-C 退出。

> v1 不创建会话文件——状态由能力自己写到 `workspace/`,下次 `init` 时可以读取。

### 6. 修改 `weather.js` 的实现,保存文件

主循环期间改文件**不会**被自动拾取(框架不监听运行中变更——见 `design.md §5.6`)。

```bash
# Ctrl-C 退出当前 minlo run
# 改 weather.js
# 再 minlo run weather 看到新逻辑生效
```

### 7. 调试完成后,将 `weather` 添加到 `default.json` 的 abilities 中

编辑 `.minlo/missions/default.json`:

```json
{
  "name": "默认任务",
  "abilities": ["weather"]
}
```

### 8. 走 default 跑

```bash
minlo run
# 无参 = 走 default.json；需要 default 存在并包含 weather
```
