# dsh-session-grid

把一个页面的主区域切成 n 个并列 pane，每格渲染一条**完全独立**的会话 —— 对话、轨迹、上下文、编队、composer 全部是原生 UI，不是缩略图预览。

## 功能

- 横向单行排列，不换行
- 每格左上角 `⠿` 拖动手柄，可重排顺序
- 侧边栏每一行有 `⊞`（加入网格）/ `▦`（移出网格）
- 布局写入 `localStorage`，刷新后恢复
- 在网格页点「新会话」→ 最左边开一格（不跳回原生单页）
- `pruneBlankPanes()`：自动清理累积的未命名空白格 —— 有内容的格一律保留，空白格只留最左那一个

## 安装

### ① 通过插件市场（推荐）

在 [awesome-dsh-plugin](https://awesome-dsh-plugin.com) 的目录里找到本插件，
或在 dsh 的 **插件 → 发现** 里搜索 `dsh-session-grid`，点安装。

### ② 手动安装

任选一种，**不要两种同时用**：

**A. 复制 + 手写 insert（适合本地开发）**

1. 把本目录复制到 `$DSH_HOME/profiles/web/node_modules/dsh-session-grid/`
2. 在 `$DSH_HOME/profiles/web/cordis.patch.yml` 加：

   ```yaml
   - insert:
       - id: session-grid
         name: 'dsh-session-grid'
   ```

3. 重启 dsh，或让 Loader 重载配置

**B. `dsh plugin add`（需要包已发布到 npm）**

```sh
dsh plugin --profile web add dsh-session-grid
```

> ⚠ 用 B 之后，包名会进 `dsh.profile.bundles`，bundles 层会读本包自带的
> `cordis.patch.yml`；此时**不要**再做 A 的第 2 步 —— 同一个 id 会被插两次，
> DSH 启动会直接失败。

## 文件

| 文件 | 作用 |
|---|---|
| `index.js` | Host 入口（空壳） |
| `lib/client.js` | 全部 UI 逻辑 |

## 已知限制

- `TurnNavigator` 在 pane 宽度小于 900px 时自动隐藏 —— 这是原生组件的设计，不是本插件的 bug
- 拖放图片会同时附加到所有 pane —— DSH 原生行为，与网格无关

## 环境

- DSH ≥ 0.2.1
