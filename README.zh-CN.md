# ChatGPT → Obsidian Inbox

[English](README.md)

一个轻量级的 Chrome 扩展，能把你的 ChatGPT 对话直接存入 Obsidian vault —— 不用手动复制粘贴，不用手动排版。

在任意 ChatGPT 对话页面点一下扩展图标，它会读取完整对话、清理格式，然后作为一份规范的 markdown 文件存入你指定的 vault 文件夹，带有 YAML frontmatter（标题、来源链接、抓取日期、`inbox` 标签）——可以直接接入你已有的归档或整理流程。目标文件夹由你自己决定（默认是 `inbox/`），而且每次保存都可以直接在弹窗里临时改。

**设计理念：** 这个工具只负责"抓取和清理"，从不总结、改写或解读你的对话——那部分判断留给你自己（或者你自己的下游流程）来做。你在 ChatGPT 里看到的内容，原样落到你的 vault 里，包括代码块和排版格式都会保留。

**工作原理：** 扩展直接读取 ChatGPT 自己的数据接口（而不是抓取页面可见内容），这样更准确，也不容易因为 ChatGPT 改版而失效——如果这条路径失败，还有基于 DOM 抓取的备用方案。整个过程完全在本地完成：你的对话数据通过 Local REST API 这个 Obsidian 社区插件，直接从浏览器发到你自己的 vault，全程不出这台电脑。没有云服务，没有第三方服务器，除了你已有的 ChatGPT 和 Obsidian 账号外不需要任何额外账号。

## 功能

- 手动一键抓取——由你决定哪些对话值得保存
- 目标文件夹随你选——可以从 vault 里已有的文件夹中自动补全、可以手动输入任意路径（支持 `notes/ChatGPT` 这样的多级路径），也可以留空直接存到 vault 根目录；你的选择会被记住
- 文件名带抓取日期前缀（`YYYY-MM-DD 标题.md`），在 vault 的文件列表里可以按日期排序
- 自动、安全地处理文件名冲突（标题重复时自动加 `-2`、`-3` 后缀）
- Obsidian 连不上或 API key 不对时，会给出清晰的报错提示
- 零外部依赖，零构建步骤——加载即用

## 环境要求

- Google Chrome
- 已安装并启用 **Local REST API** 社区插件的 Obsidian
- 一个可用的 ChatGPT 账号

## 一次性设置

1. 在 Chrome 里打开 `chrome://extensions`，开启**开发者模式**，点击 **"Load unpacked"**（加载已解压的扩展程序），选择这个项目的目录。
2. 在 Obsidian 里安装并启用社区插件 **Local REST API**。
3. 在插件设置里开启 **"Enable Non-encrypted (HTTP) Server"**（绑定到 `http://127.0.0.1:27123`），这样就不用处理插件自签名 HTTPS 证书的问题，因为流量完全不出这台机器。
4. 从插件设置里复制生成的 **API key**。
5. 右键点击扩展的工具栏图标，选择 **"Options"**（或者在 `chrome://extensions` 的扩展卡片上打开），粘贴 API key 并保存。也可以在这里顺便设置一个**默认文件夹**（默认为 `inbox`）。

## 使用方法

1. 打开 `chatgpt.com` 或 `chat.openai.com` 上的一个对话（网址应该长得像 `.../c/<某个id>`）。
2. 点击扩展的工具栏图标。
3. （可选）调整 **"Save to folder"** 文件夹输入框（已自动填入你上次的选择；会自动补全 vault 里的文件夹；留空则存到 vault 根目录）。
4. 点击 **"Save to Obsidian"**。
5. 弹窗会先显示对话标题，文件保存成功后会显示提示，并给出文件保存到的完整路径。你这次用的文件夹会被记住，作为下次的默认值。

如果出现报错，弹窗里的提示信息会说明具体原因（连不上 Obsidian、API key 无效，或者当前标签页不是 ChatGPT 对话）——当问题跟 API key 有关时，会额外出现一个 "Open Settings" 按钮。

## 开发

```bash
npm test   # 用 Node 内置的测试运行器跑 lib/*.js 的单元测试
```

核心逻辑（文件名清洗、frontmatter 拼装、对话解析、请求构造）都写在无外部依赖的 `lib/*.js` 文件里，所以可以脱离 Chrome 环境，直接用 Node 测试。
