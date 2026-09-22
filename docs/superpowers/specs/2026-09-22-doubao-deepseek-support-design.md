# 设计文档：新增豆包与 DeepSeek 支持

日期：2026-09-22

## 背景与目标

当前扩展只支持从 ChatGPT（chatgpt.com / chat.openai.com）抓取对话并存入 Obsidian `inbox/`。目标是新增两个来源：

- 豆包（`www.doubao.com`）
- DeepSeek（`chat.deepseek.com`）

保持现有的产品哲学不变：只做"抓取 + 清洗"，不做总结/改写；用户在页面上点击即可保存；本地直连 Obsidian Local REST API，不经过任何第三方服务。

## 与 ChatGPT 路径的关键差异

ChatGPT 的实现是"私有 API 优先 + DOM 兜底"：`content.js` 先尝试调用 ChatGPT 自己的 `/backend-api/conversation/<id>`，拿到结构化 JSON 后用 `lib/conversation.js` 解析；失败了才退化到扫描 `[data-message-author-role]` 的 DOM 兜底。

调研确认豆包和 DeepSeek 都**没有可行的私有 API 路径**：

- 豆包的消息接口（`/im/chain/recent_conv` 等）需要字节跳动的反爬签名（`a_bogus` + `msToken`），签名算法由混淆 JS 在浏览器里动态生成，无法在轻量 content script 里复现。
- DeepSeek 的接口除了 bearer token，还需要解出一个工作量证明（Proof-of-Work）挑战（`x-ds-pow-response`），且没有确认过是否存在不需要 PoW 的"只读历史"端点。

因此这两个站点**只走 DOM 抓取**，没有 API 优先路径，也没有"失败退化"的概念——DOM 抓取就是唯一路径。

## 架构改动

### 1. `manifest.json`

新增两个独立的 `content_scripts` 条目（各自的 `matches`，各自的 JS 文件列表），不与 ChatGPT 那份合并：

```json
{
  "matches": ["https://www.doubao.com/*"],
  "js": ["lib/content-harness.js", "content-doubao.js"]
},
{
  "matches": ["https://chat.deepseek.com/*"],
  "js": ["lib/content-harness.js", "content-deepseek.js"]
}
```

不需要新增 `host_permissions`：两个站点都是纯 DOM 抓取，不发起跨域请求。

### 2. 共享 content script 壳：`lib/content-harness.js`

三个站点的 content script 都有一段重复的样板逻辑：监听 `EXTRACT_CONVERSATION` 消息、调用各自的 `extractConversation()`、把结果/错误通过 `sendResponse` 传回，并暴露一个 `window.__xxxExtract` 调试入口。抽成一个共享函数：

```js
// lib/content-harness.js
function registerExtractor(extractConversation, debugGlobalName) {
  window[debugGlobalName] = extractConversation;
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type !== 'EXTRACT_CONVERSATION') return undefined;
    extractConversation()
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  });
}
```

`content.js`（ChatGPT）本次不强制迁移到这个壳上，避免无关 diff；豆包和 DeepSeek 的新 content script 直接使用它。

### 3. `content-doubao.js`

- **对话页判断**：`window.location.pathname` 匹配 `/\/chat\/([a-zA-Z0-9]+)/`（对应 `doubao.com/chat/<id>`）；不匹配则抛错提示"不在豆包对话页"。
- **消息节点定位**：`document.querySelectorAll('[data-streaming].md-box-root')`。这个组合在用户消息和助手回复的真实 DOM 样本中都稳定出现，是双方共用的"正文渲染根节点"；搜索摘要一类的 UI 噪音块（`data-plugin-identifier="block_type:10025"`）在结构上是旁支，不会被选中。
- **角色判断**：对每个命中节点向上遍历祖先，若任一祖先的 `classList` 中存在包含子串 `send-msg-bubble` 的类名（对应真实样本中的 `bg-g-send-msg-bubble-bg`），判定为 `user`；否则判定为 `assistant`。
- **正文提取**：取节点的 `.innerText.trim()`，与 ChatGPT 现有 DOM 兜底路径的做法一致，不逐层解析内部的 hash 类名。
- **标题**：`document.title` 去除已知的品牌后缀后作为标题；取不到时退到 `untitled-conversation`。

已知风险（留待联调验证）：`send-msg-bubble` 子串判断角色的方式基于两段真实样本推断，如果豆包还存在系统消息/工具卡片等第三种形态，可能被误判为 assistant。

### 4. `content-deepseek.js`

- **对话页判断**：路径匹配 `/\/a\/chat\/s\/([a-zA-Z0-9-]+)/`（对应 `chat.deepseek.com/a/chat/s/<uuid>`）。
- **消息节点定位**：`document.querySelectorAll('.ds-message, .ds-collapsible-text')`，按 DOM 树顺序遍历（等价于对话时间顺序）：
  - 命中 `.ds-collapsible-text` → 用户消息，取 `.innerText.trim()`。
  - 命中 `.ds-message` → 助手消息，内部再定位：
    - 可选的 `.ds-think-content`（存在则取其 `.innerText.trim()` 作为思考内容）
    - 必须的 `.ds-markdown.ds-assistant-message-main-content`（正式回答正文）
- **思考过程处理**：按产品决定完整保留。若某条助手消息存在思考内容，拼装为：

  ```
  > 已深度思考：
  > <思考内容，按行加 `> ` 前缀>

  <正式回答内容>
  ```

  没有思考内容时只输出正式回答。
- **引用脚注**：助手正文中的 `.ds-markdown-cite` 角标背后是真实的 `<a href>`。提取时将其转换为 Markdown 脚注（`[^n]`，文末追加 `[^n]: [来源](url)`），复用与 ChatGPT 侧类似的"文末脚注收集"思路（各自独立实现，不共享 ChatGPT 那套针对 `content_references` 元数据的专用逻辑，因为数据来源结构完全不同）。
- **虚拟列表兜底**：DeepSeek 页面样式变量里出现 `--dsl-virtual-list-transform-y`，强烈暗示消息列表使用虚拟滚动，滚出视口的历史消息可能不在 DOM 里。抓取前执行：
  1. 定位消息所在的可滚动祖先容器（从任一已知消息节点向上找 `scrollHeight > clientHeight` 的祖先）。
  2. 将其 `scrollTop` 设为 0（滚动到最顶部/最早消息）。
  3. 按容器可视高度逐段向下滚动，每段之间等待一小段时间（如一次 `requestAnimationFrame` 加短延时）以便虚拟列表挂载新节点。
  4. 每段停顿后重新执行第 2 步的选择器查询，按"角色 + 文本内容"去重后累积收集，直至 `scrollTop + clientHeight` 达到 `scrollHeight` 附近。
  5. 按收集顺序（自顶向下）拼出完整对话。

  这是本次改动中最复杂、风险最高的一块：没有确认过的"每条消息稳定 ID"，去重只能靠角色+文本内容，理论上如果两条消息内容完全相同会被误当作同一条丢弃（可接受的边缘情况）。

### 5. `lib/conversation.js` 的 `assembleTranscript` 泛化

现有签名：

```js
function assembleTranscript(messages) {
  const label = m.role === 'user' ? 'You' : 'ChatGPT'; // 写死
  ...
}
```

改为：

```js
function assembleTranscript(messages, assistantLabel = 'ChatGPT') {
  const label = m.role === 'user' ? 'You' : assistantLabel;
  ...
}
```

默认值保证现有 ChatGPT 相关测试不受影响。豆包/DeepSeek 站点调用时传入各自的 `assistantLabel`（如 `'豆包'` / `'DeepSeek'`）。

`resolveCitations` 部分（依赖 ChatGPT 专有的 `content_references` 结构）豆包/DeepSeek 不复用；DeepSeek 自己的脚注转换在 `content-deepseek.js` 内部完成后再传入 `assembleTranscript`（即 `references` 参数留空数组，`resolveCitations` 直接跳过）。

### 6. `popup.js` 的动态注入文件选择

现状：重试注入时写死 `files: ['lib/conversation.js', 'content.js']`。

改为：根据当前活动标签页 URL 的 host，从一张小映射表里选出对应的注入文件列表：

```js
const SITE_FILES = {
  'chatgpt.com': ['lib/conversation.js', 'content.js'],
  'chat.openai.com': ['lib/conversation.js', 'content.js'],
  'www.doubao.com': ['lib/content-harness.js', 'content-doubao.js'],
  'chat.deepseek.com': ['lib/content-harness.js', 'content-deepseek.js']
};
```

找不到匹配 host 时，沿用现有报错文案（"确认这是一个受支持的对话页"，措辞按三站点更新）。

## 测试策略

与项目现有约定一致：`lib/*.js` 中不依赖 DOM/浏览器 API 的纯逻辑继续用 Node 内置 test runner 覆盖（`assembleTranscript` 新增的 `assistantLabel` 参数需要补测试用例）。

豆包/DeepSeek 的 DOM 抓取逻辑（选择器匹配、角色判断、虚拟列表滚动）依赖真实 DOM，与现有 ChatGPT 的 `scrapeDomFallback` 一样不做 Node 单元测试，改为加载未打包扩展后在真实页面手动验证——这是本次改动中沿用的现有先例，不是新引入的降级。

## 已知风险 / 需要联调验证的点

1. 豆包"角色判断"依赖 `send-msg-bubble` 子串匹配，样本量有限。
2. DeepSeek 虚拟列表滚动收集依赖启发式去重（角色+文本），没有稳定消息 ID。
3. 两站点的 `document.title` 品牌后缀清洗规则是按常见模式猜测的，可能需要按实际标题格式微调正则。
4. 两站点选择器都基于当前版本页面的真实 DOM 样本，页面改版后可能失效——这是 DOM 抓取方案的固有风险，与现有 ChatGPT DOM 兜底路径面临的风险一致。

## 范围之外

- 不实现豆包/DeepSeek 的私有 API 路径（已确认不可行）。
- 不处理豆包/DeepSeek 的图片、文件附件等非文本内容。
- 不做自动化的选择器失效检测/告警，出问题时用户会看到"未找到对话内容"之类的错误提示（复用现有错误处理约定）。
