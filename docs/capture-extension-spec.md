# Basanite Capture — 浏览器扩展规格说明 / Browser Extension Specification

> 本文档面向实现该扩展的 coding agent。读完本文档应当足以从零写出扩展，无需再阅读主应用源码。
>
> This document is written for the coding agent implementing the extension. Reading it should be enough to write the extension from scratch, without reading the main application's source.

---

## 1. 项目背景 / Project context

**中文**

Basanite Recruiter Workbench 是一个单用户的本地招聘工作台，使用 Next.js 14（App Router）+ Prisma + SQLite。它的使用者是 Paul，一位英国的猎头顾问。

这个工具有一条不可动摇的设计原则：**应用本身从不访问 LinkedIn**。它只做三件事——生成一个 LinkedIn 搜索 URL 供用户点击、把用户手动粘贴的资料存进本地数据库、把消息文本放进剪贴板。所有与 LinkedIn 的接触都由使用者本人完成。代码里对此有明确注释，测试也断言了浏览器不会向应用与用户主动打开的标签页之外的任何主机发起请求。

**English**

Basanite Recruiter Workbench is a single-user, locally-run recruiting workbench built on Next.js 14 (App Router), Prisma and SQLite. Its user is Paul, a UK recruitment consultant.

The tool has one non-negotiable design principle: **the application itself never contacts LinkedIn**. It does three things only — build a LinkedIn search URL for the user to click, store details the user pasted in by hand, and put message text on the clipboard. Every LinkedIn touch is performed by the human. This is stated in code comments and asserted by a test that the browser reaches no host other than the app and the tabs the user opened themselves.

---

## 2. 要解决的问题 / The problem being solved

**中文**

Paul 的工作流是「先找人，再批量发消息」。找人阶段他会打开一个又一个 LinkedIn 个人主页，判断是否合适。要把一个人存进工作台，他目前必须手动做三件事：复制个人主页 URL、输入姓名、输入职位头衔——而这三样都明明白白显示在他正看着的页面上。

一小时的搜寻可能要处理几十个人。这是整个流程中最机械、最浪费的一段。

扩展要解决的就是这一段：**把「抄写」自动化，而不是把「浏览」自动化**。

**English**

Paul's workflow is "source first, message in a batch". During sourcing he opens one LinkedIn profile after another and judges fit. To store someone in the workbench he currently has to do three things by hand: copy the profile URL, type the name, and type the headline — all three of which are plainly visible on the page he is already looking at.

An hour of sourcing can mean dozens of people. This is the most mechanical, most wasteful part of the process.

The extension addresses exactly that: **automate the transcription, not the browsing.**

---

## 3. 合规立场——最重要的约束 / Compliance stance — the most important constraint

**中文**

这是整份规格中最重要的一节。如果实现与本节冲突，以本节为准。

LinkedIn 的用户协议禁止使用自动化手段抓取数据，且执法是账号级的。承担风险的是 Paul 本人的账号，也就是他的生计。因此扩展必须满足：

1. **必须使用 `activeTab` 权限，禁止对 `linkedin.com` 声明 `host_permissions`。**
   这一条是结构性保证：Chrome 只在用户点击扩展图标之后才授予对当前标签页的访问权。这意味着扩展在用户浏览期间**在技术上无法**读取任何页面——这由浏览器强制执行，而不是靠代码里的一句承诺。
2. **manifest 中不得注册 content script，不得有 background service worker 做任何页面读取。**
3. **一次点击只处理一个页面。** 不做列表页批量抓取，不做后台轮询，不做爬取。
4. **除用户自己的工作台（localhost）之外，不向任何地方发送数据。**

一句话概括：读取页面的动作，必须由 Paul 的一次点击触发，一次一个人。

**English**

This is the most important section in this document. If an implementation conflicts with it, this section wins.

LinkedIn's User Agreement prohibits automated data collection, and enforcement is account-level. The account at risk is Paul's own — his livelihood. The extension must therefore satisfy:

1. **Use the `activeTab` permission. Do NOT declare `host_permissions` for `linkedin.com`.**
   This is a structural guarantee: Chrome grants access to the current tab only after the user clicks the extension's toolbar button. The extension is therefore **technically incapable** of reading pages while the user browses — enforced by the browser, not promised in a comment.
2. **Register no content script in the manifest, and no background service worker that reads pages.**
3. **One click handles one page.** No bulk capture from search-result pages, no background polling, no crawling.
4. **Send data nowhere except the user's own workbench on localhost.**

In one line: reading a page must be triggered by a click from Paul, one person at a time.

---

## 4. 用户故事 / User story

**中文**

Paul 正在看一个 LinkedIn 个人主页，判断这个人合适。他点击浏览器工具栏上的扩展图标，弹窗中已经填好了姓名、职位头衔和主页链接。他从下拉框里选一个职位（默认是上次用过的），在备注框里写下自己的判断（例如「ACCA 在读，月结经验扎实」），点击保存。弹窗提示已保存。他关掉弹窗，继续看下一个人。

备注框必须留给他自己填。他对候选人的判断是页面无法提供的东西，也正是这份候选人列表比 LinkedIn 的「关注」列表更有价值的原因。

**English**

Paul is looking at a LinkedIn profile and decides the person is a fit. He clicks the extension's toolbar icon; the popup already has the name, headline and profile link filled in. He picks a role from a dropdown (defaulting to the last one he used), types his own read in the notes box (e.g. "ACCA part-qualified, solid month-end ownership"), and clicks save. The popup confirms. He closes it and moves to the next person.

The notes box must be left for him to fill in. His judgement of a candidate is the one thing the page cannot supply, and it is exactly what makes this candidate list worth more than LinkedIn's Follow list.

---

## 5. 扩展需求 / Extension requirements

### 5.1 manifest

**中文** — Manifest V3。权限仅限 `activeTab`、`scripting`、`storage`。`host_permissions` 只包含本地工作台地址。使用 `action.default_popup` 打开弹窗。

**English** — Manifest V3. Permissions limited to `activeTab`, `scripting`, `storage`. `host_permissions` covers only the local workbench address. Use `action.default_popup` for the popup.

```json
{
  "manifest_version": 3,
  "name": "Basanite Capture",
  "version": "1.0.0",
  "description": "Save the LinkedIn profile you are looking at to your Basanite workbench, in one click.",
  "permissions": ["activeTab", "scripting", "storage"],
  "host_permissions": ["http://localhost/*", "http://127.0.0.1/*"],
  "action": {
    "default_title": "Save this profile to Basanite",
    "default_popup": "popup.html"
  }
}
```

### 5.2 首次连接 / First-run connection

**中文**

首次打开弹窗时，若 `chrome.storage.local` 中没有 `url` 或 `token`，显示连接表单：

- 工作台地址，默认 `http://localhost:3000`
- 采集密钥（capture key），由用户在工作台的「设置」页生成后粘贴过来
- 「连接」按钮：保存到 `chrome.storage.local`，随即请求角色列表；成功则进入采集界面，失败则显示可操作的错误信息

**English**

On first open, if `chrome.storage.local` holds no `url` or `token`, show a connection form:

- Workbench address, defaulting to `http://localhost:3000`
- Capture key, which the user generates on the workbench's Settings page and pastes here
- A "Connect" button: stores both in `chrome.storage.local`, then requests the role list; on success show the capture screen, on failure show an actionable error

### 5.3 采集界面 / Capture screen

**中文**

打开时按以下顺序工作：

1. 向工作台请求开放职位列表，填充下拉框；若 `chrome.storage.local.lastRoleId` 在列表中，则默认选中它。
2. 通过 `chrome.scripting.executeScript` 向当前标签页注入一次提取函数，读取姓名、职位头衔、主页 URL，填入表单。
3. 焦点落在备注框。

字段：职位（下拉，必填）、姓名（文本，必填）、职位头衔（文本，可空）、主页链接（URL，可空）、备注（多行文本，可空）。

**所有字段都必须可编辑。** LinkedIn 的页面结构会变；某个字段没抓到时，行为应当降级为「用户自己输入」，而不是「扩展坏了」。

保存成功后：记录 `lastRoleId`，清空备注框，显示成功信息。保存失败：显示服务端返回的 `error` 文本，并让保存按钮重新可用。

**English**

On open, in this order:

1. Request the list of open roles from the workbench and populate the dropdown; if `chrome.storage.local.lastRoleId` is in the list, select it by default.
2. Inject an extraction function into the active tab once via `chrome.scripting.executeScript`, reading name, headline and profile URL into the form.
3. Put focus in the notes box.

Fields: role (select, required), name (text, required), headline (text, optional), profile link (url, optional), notes (textarea, optional).

**Every field must remain editable.** LinkedIn's markup changes; a missed field must degrade to "the user types it" rather than "the extension is broken."

On success: store `lastRoleId`, clear the notes box, show a confirmation. On failure: show the server's `error` text and re-enable the save button.

### 5.4 页面提取 / Page extraction

**中文**

提取函数在页面上下文中运行，必须写得能容错。建议策略：

- **URL**：从 `location.pathname` 匹配 `/in/([^/]+)`，规范化为 `https://<origin>/in/<slug>/`。去掉查询参数与多余路径，使同一个人始终产出同一个 URL——工作台的重复检查依赖于此。
- **姓名**：优先 `main h1`，回退到 `h1`；再回退到解析 `document.title`（形如 `姓名 | LinkedIn`，可能带 `(3)` 之类的通知计数前缀，需剥离）。
- **职位头衔**：优先 `main .text-body-medium`；回退到 `meta[name="description"]` 的内容并截断。
- 返回一个 `isProfile` 布尔值（`location.pathname` 是否包含 `/in/`），供弹窗提示用户当前页面可能不是个人主页。

若 `chrome.scripting.executeScript` 抛错（Chrome 拒绝注入自身页面与应用商店页面），捕获并提示用户手动填写。

**English**

The extraction function runs in the page context and must be written defensively. Suggested strategy:

- **URL**: match `/in/([^/]+)` from `location.pathname` and normalise to `https://<origin>/in/<slug>/`. Strip query parameters and trailing segments so the same person always yields the same URL — the workbench's duplicate check depends on this.
- **Name**: prefer `main h1`, fall back to `h1`, then fall back to parsing `document.title` (of the form `Name | LinkedIn`, possibly with a notification-count prefix such as `(3)` that must be stripped).
- **Headline**: prefer `main .text-body-medium`; fall back to the content of `meta[name="description"]`, truncated.
- Return an `isProfile` boolean (whether `location.pathname` contains `/in/`) so the popup can warn that this may not be a profile page.

If `chrome.scripting.executeScript` throws (Chrome refuses injection into its own pages and the Web Store), catch it and tell the user to type the details in.

---

## 6. 服务端 API 契约 / Server API contract

**中文** — 端点已在主应用中实现：`app/api/capture/route.ts`。扩展必须按此契约调用。所有请求都必须带 `X-Capture-Token` 请求头。

**English** — The endpoint already exists in the main application at `app/api/capture/route.ts`. The extension must call it per this contract. Every request must carry the `X-Capture-Token` header.

### 6.1 `GET /api/capture`

**中文** — 返回开放状态的职位列表（已关闭的职位不返回）。

**English** — Returns the list of open roles (closed roles are excluded).

```json
{ "roles": [{ "id": "c...", "title": "Finance Analyst", "client": "Confidential - UK aerospace manufacturer" }] }
```

`client` 可能为 `null` / `client` may be `null`.

### 6.2 `POST /api/capture`

**中文** — 请求体 / **English** — Request body:

```json
{
  "roleId":     "必填 / required",
  "fullName":   "必填 / required",
  "profileUrl": "可空 / optional",
  "headline":   "可空 / optional",
  "notes":      "可空 / optional"
}
```

成功 / Success — `201`:

```json
{ "ok": true, "candidateId": "c...", "fullName": "Priya Kaur", "warning": null }
```

**中文** — `warning` 在同一职位下已存在同名候选人时为一段提示文本（此时仍然会保存），否则为 `null`。扩展应当把 `warning` 显示出来。

**English** — `warning` is a string when the role already had a candidate with the same name (the save still happens), otherwise `null`. The extension should display it.

### 6.3 状态码 / Status codes

| 状态码 / Code | 含义 / Meaning | 扩展应当 / Extension should |
| --- | --- | --- |
| `201` | 已保存 / Saved | 显示成功；记录 `lastRoleId`；清空备注 / Confirm, store `lastRoleId`, clear notes |
| `400` | 缺少职位或姓名，或 JSON 无法解析 / Missing role or name, or unparseable JSON | 显示 `error`，保留表单内容 / Show `error`, keep the form |
| `401` | 密钥缺失或错误 / Key missing or wrong | 回到连接界面并提示重新粘贴密钥 / Return to the connect screen and ask for the key again |
| `404` | 职位已不存在 / Role no longer exists | 重新拉取职位列表 / Re-fetch the role list |
| `409` | 同一职位下该主页链接已存在 / That profile link is already on this role | 显示 `error`；这是正常情况，不是故障 / Show `error`; this is expected, not a fault |

失败响应体统一为 / Failure bodies are uniformly:

```json
{ "error": "一句可操作的说明 / one actionable sentence" }
```

### 6.4 认证与 CORS / Auth and CORS

**中文**

- 密钥由用户在「设置 → 浏览器扩展」中生成，存于数据库 `Settings.captureToken`。
- 空密钥表示采集功能关闭；此时即使扩展提交空字符串也不会通过验证。
- 服务端使用等长 + 恒定时间比较。
- `Access-Control-Allow-Origin` 只回显 `chrome-extension://`、`moz-extension://`、`safari-web-extension://` 开头的来源。普通网页拿不到允许，因此即使猜到密钥也读不到响应。
- 需要处理 `OPTIONS` 预检（返回 `204`）。

**English**

- The key is generated by the user under Settings → Browser extension and stored in `Settings.captureToken`.
- An empty key means capture is switched off; an empty presented key must not then count as a match.
- The server compares with an equal-length, constant-time comparison.
- `Access-Control-Allow-Origin` echoes only origins beginning `chrome-extension://`, `moz-extension://` or `safari-web-extension://`. An ordinary web page gets no allowance, so it cannot read a response even if it guessed the key.
- `OPTIONS` preflight must be handled, returning `204`.

---

## 7. 服务端已有行为，扩展不要重复实现 / Server behaviour the extension must not duplicate

**中文**

以下逻辑已经在服务端，扩展只需原样提交用户看到的内容：

- **URL 规范化**：缺少协议头的链接（如 `www.linkedin.com/in/x`）会被补成 `https://`。非 URL 的文本会原样保存，但在界面上不会被渲染成链接。
- **重复检查**：同一职位下若已存在相同 `profileUrl` 的候选人，返回 `409` 且不写入。一键保存让误重复变得更容易，所以这条比表单时更重要。
- **默认阶段**：新候选人进入 `sourced` 阶段。
- **字段清洗**：所有字符串会被 trim，空字符串转为 `null`。

**English**

The following already lives on the server; the extension should submit what the user sees and nothing more:

- **URL normalisation**: a link missing its scheme (e.g. `www.linkedin.com/in/x`) gets `https://` added. Text that is not a URL is stored verbatim but is never rendered as a link in the UI.
- **Duplicate check**: if the role already has a candidate with the same `profileUrl`, the server returns `409` and writes nothing. One-click saving makes accidental duplicates easier, so this matters more here than it did on the form.
- **Default stage**: new candidates enter the `sourced` stage.
- **Field cleaning**: all strings are trimmed; empty strings become `null`.

---

## 8. 验收标准 / Acceptance criteria

**中文**

1. `manifest.json` 中不包含针对 `linkedin.com` 的 `host_permissions`，不包含 `content_scripts`，不包含读取页面的 `background`。
2. 未点击扩展图标时，扩展不读取任何页面内容。
3. 在一个 LinkedIn 个人主页点击图标后，姓名、职位头衔、主页链接被填入，且全部可编辑。
4. 未配置密钥时显示连接界面；密钥错误时返回连接界面并给出可操作提示。
5. 职位下拉只显示开放职位，默认选中上次使用的职位。
6. 保存成功后备注框清空，`lastRoleId` 被记录。
7. 重复保存同一主页链接时，显示服务端的 `409` 提示，且不产生第二条记录。
8. 在非个人主页（例如搜索结果页）点击图标时，界面给出提示但仍允许手动填写并保存。
9. 除工作台地址外，扩展不向任何主机发起请求。

**English**

1. `manifest.json` contains no `host_permissions` for `linkedin.com`, no `content_scripts`, and no page-reading `background`.
2. With the toolbar icon unclicked, the extension reads no page content.
3. Clicking the icon on a LinkedIn profile fills in name, headline and profile link, all of which remain editable.
4. With no key configured, the connect screen shows; with a wrong key, it returns to the connect screen with an actionable message.
5. The role dropdown lists open roles only and defaults to the last used one.
6. After a successful save the notes box is cleared and `lastRoleId` is stored.
7. Saving the same profile link twice shows the server's `409` message and creates no second record.
8. Clicking the icon on a non-profile page (e.g. a search-results page) warns the user but still allows manual entry and saving.
9. The extension makes no request to any host other than the workbench address.

---

## 9. 安装与调试 / Installing and debugging

**中文**

1. 在工作台运行 `npx prisma migrate deploy`，然后启动 `npm run dev`。
   **注意**：若开发服务器在生成 Prisma 客户端之前就已启动，它会持有旧的客户端，导致所有正确密钥都被拒绝。改动数据库结构后务必重启开发服务器。
2. 在「设置 → 浏览器扩展」生成采集密钥。
3. 打开 `chrome://extensions`，开启「开发者模式」，选择「加载已解压的扩展程序」，指向扩展目录。
4. 点击扩展，填入地址与密钥。

由于扩展会读取 LinkedIn 页面，Chrome 应用商店很可能不予上架，因此预期长期以「已解压」方式加载。

**English**

1. In the workbench run `npx prisma migrate deploy`, then `npm run dev`.
   **Note**: if the dev server was started before the Prisma client was regenerated, it holds the old client and will reject every valid key. Always restart the dev server after a schema change.
2. Generate a capture key under Settings → Browser extension.
3. Open `chrome://extensions`, enable Developer mode, choose "Load unpacked", and point it at the extension directory.
4. Click the extension and enter the address and key.

Because the extension reads LinkedIn pages, the Chrome Web Store is unlikely to approve it, so loading unpacked is expected to remain the long-term arrangement.

---

## 10. 已知边界 / Known limits

**中文**

- 仅在工作台于本机运行时可用。若将来部署到线上，密钥需要走 HTTPS，`host_permissions` 与 CORS 白名单都要相应调整。
- 主应用目前没有任何登录机制，仅适合本机使用。
- LinkedIn 的 DOM 结构随时可能变化，提取选择器属于需要维护的部分；界面必须始终允许手动修正。

**English**

- Works only while the workbench runs on the same machine. If it is ever deployed, the key must travel over HTTPS and both `host_permissions` and the CORS allowlist need adjusting.
- The main application currently has no authentication at all and is only suitable for local use.
- LinkedIn's DOM changes without notice, so the extraction selectors are a maintenance item; the UI must always allow manual correction.

---

## 11. 参考实现 / Reference implementation

**中文** — 本仓库 `extension/` 目录下已有一份符合本规格的实现，可作对照。服务端端点见 `app/api/capture/route.ts`，认证与 CORS 见 `lib/capture.ts`，端点测试见 `tests/04-capture-api.spec.ts`。

**English** — A working implementation that satisfies this specification already exists in this repository under `extension/`. The server endpoint is `app/api/capture/route.ts`, auth and CORS are in `lib/capture.ts`, and the endpoint tests are in `tests/04-capture-api.spec.ts`.
