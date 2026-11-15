# dsh-effort-slider

在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）输入框底部，用一条滑条直接拖动调节模型的**思考强度**（reasoning effort）。

滑条与原生模型选择器**合并为一个控件**：

```
[ High ] [ ━━━●────── ] [⌄]
```

左侧是当前档位，中间拖动调档，右侧箭头展开的仍然是 DSH **原生的模型菜单**（模型列表、搜索、分组、Agent Teams 开关一个不少）。

## 为什么

DSH 默认把推理等级放在「模型菜单 → 推理等级」两级菜单里，每次调档都要点两次、再选一次。这个插件把档位提到输入框上，一次拖动即可完成。

## 特性

- **一次拖动调档**，不必再进菜单
- **与原生菜单完全同步**：滑条读写的是与菜单同一个会话级模型目录，拖完菜单里是新档位，菜单里改完滑条跟着动
- **按模型记忆**：每个模型最近一次选的档位记在本地，切回该模型时自动恢复
- **颜色档位化**：非最高档为 DeepSeek 品牌蓝，最高档切换为蓝紫渐变；颜色取自 DSH 主题变量，深浅色主题自动适配
- **自动隐藏**：当前模型没有思考档位（或只有一档）时整个控件不渲染，原生选择器保持原样
- **零依赖**：没有构建步骤、没有第三方依赖、不发任何网络请求

## 安装

插件是一个标准的 DSH bundle（`package.json` 里声明了 `dsh.bundle` 与 `dsh.client`），安装方式与其它本地插件一致。

### 桌面端

1. 打开 **插件 → 添加插件**
2. 填入本仓库目录的**绝对路径**（或先 `git clone` 再选目录）
3. 按提示重新加载，然后**刷新页面**（⌘R / Ctrl+R）

### 命令行

```bash
dsh plugin --profile desktop add /path/to/dsh-effort-slider
```

`--profile` 之后的值请换成你实际使用的 profile（桌面端通常是 `desktop`，Web 端是 `web`）。装好后刷新页面。

## 使用

| 操作 | 效果 |
| --- | --- |
| 拖动滑条 | 改变当前会话的思考强度，松手生效 |
| 点按滑条任意位置 | 直接跳到对应档位 |
| 点击右侧箭头 | 展开原生模型菜单（选模型、搜索、Agent Teams 等） |

调节结果是**会话级**的，和原生菜单里改「推理等级」等价。

## 自定义

尺寸都收敛在 `client.js` 顶部的常量里，改一处即可整体缩放：

```js
const TRACK_H = 26;   // 轨道高度
const THUMB = 24;     // 圆钮直径（建议 TRACK_H - 2）
const TRACK_W = 108;  // 轨道宽度
const LABEL_W = 30;   // 左侧档位文字的固定宽度
```

配色：

- 普通档取 `--dsw-alias-button-info-fill`（DSH 的 DeepSeek 蓝，浅色 `#4176e6` / 深色 `#7aaaff`）
- 最高档渐变在 `.desl[data-max="true"] .desl__fill` 规则里，改 `#6a4bf0`、`#8b5cf6` 两个色标即可

## 兼容性

在 **DSH 0.2.2-rc.3（macOS 桌面端）** 上开发并验证。

插件依赖两个稳定接口：插槽 `conversation.input.model.label` 与客户端服务 `ctx.get('modelDirectories')`。若未来的 DSH 版本移除或改名，插件会安静地不渲染（不会影响原生选择器），届时需要跟进适配。

## 实现要点

- 注册 `conversation.input.model.label` 插槽——该插槽渲染在**原生模型触发按钮内部**，因此滑条与原生箭头天然是同一个控件，原生菜单一行代码都不用重写
- 数据与写回都走 `ctx.modelDirectories.directoryFor(sessionId)`，拿到的是与原生菜单**同一个** `ModelDirectory` 实例（同一份 store、同一个 `select()`）
- 滑条嵌在按钮里，所以 `pointerdown / pointermove / pointerup / click` 全部 `stopPropagation`，拖动不会误触展开菜单
- 圆钮位置用 `calc()` 按档位线性插值，填充止于圆钮中心并裁成「左圆右平」，避免相切处的抗锯齿蓝边

## 已知限制

- 滑条位于原生按钮内部，键盘操作仍走原生路径（回车打开菜单，在「推理等级」中方向键选择），滑条本身面向指针拖动
- 隐藏原生档位文案依赖一条结构化选择器（`button:has(.desl) > span:has(.desl) + span`）。如果 DSH 调整了触发按钮内部结构，最坏情况是右侧多出一个重复的档位文字，功能不受影响
- `package.json` 中 `"private": true` 保留原样；若要发布到 npm，需要改包名并移除该字段

## 项目结构

```
package.json        bundle 清单（dsh.bundle / dsh.client）
cordis.patch.yml    把插件挂到 profile 的 loader 补丁
index.js            Host 侧（空实现，纯 UI 插件）
client.js           浏览器侧：滑条组件、样式、档位记忆
locale/en.json      插件市场里的英文标题与描述
locale/zh.json      插件市场里的中文标题与描述
docs/DETAIL.md      插件详情页正文
icon.svg            插件图标
```

## 许可证

[MIT](LICENSE) © 2026 陈一鸽 (yuyeyubee)
