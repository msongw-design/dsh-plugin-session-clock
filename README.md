# dsh-plugin-session-clock

把左侧栏会话列表里的相对时间（`刚刚`、`3小时`、`1天`、`2个月`）改成微信式的绝对时间。

## 效果

| 时间 | 显示 |
|---|---|
| 今天 | `21:12`（24 小时制，补零） |
| 昨天 | `昨天21:12` |
| 今年更早 | `10/27` |
| 往年 | `25/12/31`（两位年份） |

未来时间（时钟偏差）按今天处理，只显示 `HH:MM`。英文界面下「昨天」显示 `Yesterday `，并且同样接管内核原本的 `now` / `5min` / `3h` / `1d` / `2mo` / `2y`。

格式跟随时区与系统时钟；跨过零点后每 30 秒自动刷新一次，所以 `21:12` 会在午夜变成 `10/29`。

## 为什么是 DOM 补丁

这段文案由内核包 `@deepseek-ai/dsh-client-ui-workspace` 的 `timeLabel()` 直接渲染，侧栏没有提供替换该文本的插槽：`sidebar.workspaces` 是单值插槽，替换它等于接管整个会话浏览器（搜索、分组、拖拽、重命名都要重写）。所以本插件走最小侵入路径：

- 注册一个不可见的 `shell.overlay` 座位（只返回 `null`），拿到标准 `useSessions` 快照里的 `updatedAt`
- 用 `MutationObserver` 跟随内核已经发布的 `[data-row-key="session:<id>"]` 行，只改写第三列时间文本
- 只处理两类文本：内核刚写下的相对标签，或本插件自己上一次写的文本；单元格里出现「进行中」这类状态文案时一律不动
- 改写时直接改文本节点的 `nodeValue`，保留 React 持有的那个节点，避免下次重渲染写进已脱离文档的节点
- 观察器把连续变更合并成每 100ms 至多一次重绘，流式回答时不会按帧空转

**代价与失效表现**：这是 DOM 级补丁，不是插槽级扩展。如果内核改掉 `data-row-key` 属性、或调整行的子元素顺序，插件会静默失效——列表退回相对时间，不报错、也不弄坏列表。升级 DSH 后请看一眼列表时间是否还是绝对格式。

## 安装

### 方式一：Plugins 页（推荐）

1. 左侧栏点 **Plugins**
2. 点 **Add plugin**
3. 填 Git 地址 `https://github.com/msongw-design/dsh-plugin-session-clock`，或本仓库克隆后的本地绝对路径
4. 安装完成后在 **Installed** 组里启用

### 方式二：写进 profile

```bash
# 在 profile 目录（~/.dsh/profiles/desktop）里
pnpm add /path/to/dsh-plugin-session-clock
```

然后把包名加进 `package.json` 的 `dsh.profile.bundles`，重启应用。

## 兼容性

开发与使用环境：**DSH 0.2.1-rc.3**（macOS desktop profile）。行结构按该版本的 `SessionRow` 核对：第三个子元素是时间单元格，行上带 `data-row-key="session:<id>"`。更早版本未逐一核对——按上面的失效表现，结构不符时只会退回相对时间。

## 开发

```
node test/smoke.mjs
```

无头冒烟测试：假的 `window.__ModuleLoader__`、假的 Cordis ctx、假的会话行，覆盖 `clockLabel` 的四种时间分支、中英文相对标签的接管与误判防护、状态文案保护、已绘制行的重绘、槽位注册。React 从 DSH 的 `~/.dsh/profiles/node_modules` 取，可用 `DSH_PROFILE_MODULES` 覆盖。

## 已知边界

- 只改会话列表行；悬停卡片里的「创建于 …」和相对时间不动
- 只改左侧栏会话行；搜索结果的元信息行不含时间
- 不做本地化日期顺序：`MM/DD` 固定为月/日，不随语言切换
- 不接管「进行中」这类状态文案，也不插入或隐藏行

## License

[MIT](LICENSE)
