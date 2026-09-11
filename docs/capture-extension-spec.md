# Capture — 浏览器扩展规格说明 / Browser Extension Specification

> 本文档面向实现该扩展的 coding agent。读完本文档应当足以从零写出扩展，无需再阅读主应用源码。
>
> This document is written for the coding agent implementing the extension. Reading it should be enough to write the extension from scratch, without reading the main application's source.

---

## 1. 项目背景 / Project context

**中文**

Capture 是一个单用户的本地招聘工作台，使用 Next.js 14（App Router）+ Prisma + SQLite。它的使用者是 Paul，一位英国的猎头顾问。

这个工具有一条不可动摇的设计原则：**应用本身从不访问 LinkedIn**。它只做三件事——生成一个 LinkedIn 搜索 URL 供用户点击、把用户手动粘贴的资料存进本地数据库、把消息文本放进剪贴板。所有与 LinkedIn 的接触都由使用者本人完成。代码里对此有明确注释，测试也断言了浏览器不会向应用与用户主动打开的标签页之外的任何主机发起请求。

**English**

Capture is a single-user, locally-run recruiting workbench built on Next.js 14 (App Router), Prisma and SQLite. Its user is Paul, a UK recruitment consultant.

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

## 3. 核心设计原则 / The core design principle

> **本节与第 4 节共同决定了整个产品的形态。任何新功能都应先按本节判断归属，再动手实现。**
>
> **This section and section 4 together determine the shape of the whole product. Any new feature should be placed by this rule before it is built.**

**中文**

这个产品的每一个功能，都由同一条原则决定形态：

> **在不危及用户 LinkedIn 账号安全的前提下，用户自己范围内的工作，尽可能自动化到底；凡是要与外部对象对接的动作，则在把准备工作自动化到极致之后，把最后一步的控制权完整交给用户。**

判断某个动作属于哪一边，只问一个问题：**这个动作的后果落在哪里？**

- **只落在用户自己的机器和数据里** → 全自动，不要问，不要让用户重复输入任何机器已经知道的东西。让用户手工做机器能做的事，是这个产品要消灭的浪费。
- **会被外部的人看到、收到，或被外部平台记录** → 自动化仍然要做满，但停在最后一步。由用户看过、可以改、然后亲自触发。

必须强调：**给控制权不等于少做自动化。** 两者不是取舍。正确的做法是把准备工作做到最完整——消息填好、长度算好、链接备好、判重做完——只把「按下发送」这一个动作留给人。做少了准备工作，不叫尊重用户，叫偷懒。

**English**

Every feature in this product takes its shape from one rule:

> **Within the bounds of keeping the user's LinkedIn account safe: automate the work that happens entirely on the user's own side as completely as possible; for any action that reaches an outside party, automate the preparation to the hilt and then hand the final step to the user, whole.**

To decide which side an action falls on, ask one question: **where does the consequence land?**

- **Only on the user's own machine and data** → automate it fully. Do not ask, and never make the user retype something the machine already knows. Making a person do by hand what the machine can do is precisely the waste this product exists to remove.
- **Seen or received by someone outside, or recorded by an outside platform** → still automate everything up to the last step, then stop. The user reviews it, can change it, and triggers it themselves.

To be explicit: **giving control is not the same as automating less.** They are not a trade-off. The correct move is to make the preparation as complete as possible — message filled in, length counted, link ready, duplicates checked — and leave only the act of sending to the human. Doing less preparation is not deference to the user; it is laziness.

### 3.1 这条原则在现有产品中的体现 / How the rule already shows up

| 用户自己的工作 → 全自动 / User's own side → fully automated | 对外的动作 → 保留控制权 / Reaches outside → control kept |
| --- | --- |
| 从职位描述自动生成简报：日常工作、关键技能与识别话术、别名职位、目标公司、薪资区间、首轮问题 / Briefing generated from the job description | 搜索只打开一个标签页，筛选条件由用户在 LinkedIn 界面里自己施加，保存的条件以清单形式提示 / Search only opens a tab; filters are applied by the user inside LinkedIn, with saved chips as a checklist |
| 搜索关键词由简报预填 / Search keywords pre-filled from the briefing | 消息只进剪贴板，由用户自己粘贴发送 / The message only reaches the clipboard; the user pastes and sends it |
| 模板占位符自动填充：名字、职位、日历链接、署名 / Template placeholders filled in automatically | 「标记为已发送」由用户点击，应用无从知道是否真的发出 / "Mark as sent" is the user's click; the app cannot know whether it was really sent |
| 冠词按读音自动纠正（an Operations Director / a UX Designer）/ Articles corrected by sound | 打开个人主页只是打开标签页 / Opening a profile only opens a tab |
| 主页链接自动补全协议头并规范化 / Profile links normalised | 扩展读取页面必须由点击触发，一次一人 / The extension reads a page only on a click, one person at a time |
| 同一职位下重复链接自动拦截 / Duplicate links blocked automatically | 候选人备注留给用户自己写 / The note on a candidate is left for the user to write |
| 跟进分桶完全由时间戳与阶段自动计算 / Follow-up buckets computed from timestamps and stage | |
| 重复催促自动防护 / The double-nudge guard | |
| 连接邀请字数自动计数并在超限时拒绝保存 / Connection-note length counted, and saving refused when over | |
| 扩展自动提取姓名、头衔、链接，并记住上次使用的职位 / The extension extracts name, headline and link, and remembers the last role | |

### 3.2 一个精确的例子 / A precise example

**中文**

当消息里还有未填的空缺（`[MISSING: calendar_link]`）时：

- **「标记为已发送」被禁用** —— 这会写进本地记录，是用户自己范围内的事，规则可以严格，不给出错的机会。
- **「复制消息」仍然可用** —— 复制之后要发给真人，是对外的动作。用户可能就是想复制出来手动补全再发。禁止他复制，是替他做他自己该做的决定。界面因此改为在复制后提示「已复制，但仍有空缺」。

同一条原则也解释了长度检查的两种处理：模板保存时超限**直接拒绝**（本地记录，可以严格），而预览页面超限只**警告不阻止复制**（对外动作，保留控制权）。

**English**

When a message still has an unfilled gap (`[MISSING: calendar_link]`):

- **"Mark as sent" is disabled** — that writes to the local record, which is entirely the user's own side, so the rule can be strict and simply not offer the chance to get it wrong.
- **"Copy message" stays enabled** — what is copied goes to a real person, which is an outward action. The user may well intend to copy it and finish it by hand. Blocking the copy would be making their decision for them. So the interface instead says "Copied, but it still has gaps."

The same rule explains the two treatments of the length check: saving an over-length template is **refused outright** (a local record, so strictness is free), while an over-length preview only **warns without blocking the copy** (an outward action, so control is kept).

---

## 4. 合规立场——自动化的硬边界 / Compliance stance — the hard limit on automation

**中文**

本节是第 3 节原则中「不危及账号安全」这一前提的具体落实，也是自动化边界的硬约束。如果实现与本节冲突，以本节为准。

LinkedIn 的用户协议禁止使用自动化手段抓取数据，且执法是账号级的。承担风险的是 Paul 本人的账号，也就是他的生计。因此扩展必须满足：

1. **必须使用 `activeTab` 权限，禁止对 `linkedin.com` 声明 `host_permissions`。**
   这一条是结构性保证：Chrome 只在用户点击扩展图标之后才授予对当前标签页的访问权。这意味着扩展在用户浏览期间**在技术上无法**读取任何页面——这由浏览器强制执行，而不是靠代码里的一句承诺。
2. **manifest 中不得注册 content script，不得有 background service worker 做任何页面读取。**
3. **一次点击只处理一个页面。** 不做列表页批量抓取，不做后台轮询，不做爬取。
4. **除用户自己的工作台（localhost）之外，不向任何地方发送数据。**

一句话概括：读取页面的动作，必须由 Paul 的一次点击触发，一次一个人。

**English**

This section is where the "keeping the account safe" precondition of section 3 becomes concrete, and it is the hard limit on how far automation may go. If an implementation conflicts with it, this section wins.

LinkedIn's User Agreement prohibits automated data collection, and enforcement is account-level. The account at risk is Paul's own — his livelihood. The extension must therefore satisfy:

1. **Use the `activeTab` permission. Do NOT declare `host_permissions` for `linkedin.com`.**
   This is a structural guarantee: Chrome grants access to the current tab only after the user clicks the extension's toolbar button. The extension is therefore **technically incapable** of reading pages while the user browses — enforced by the browser, not promised in a comment.
2. **Register no content script in the manifest, and no background service worker that reads pages.**
3. **One click handles one page.** No bulk capture from search-result pages, no background polling, no crawling.
4. **Send data nowhere except the user's own workbench on localhost.**

In one line: reading a page must be triggered by a click from Paul, one person at a time.

---

## 5. 用户故事 / User story

**中文**

Paul 正在看一个 LinkedIn 个人主页，判断这个人合适。他点击浏览器工具栏上的扩展图标，弹窗中已经填好了姓名、职位头衔和主页链接。他从下拉框里选一个职位（默认是上次用过的），在备注框里写下自己的判断（例如「ACCA 在读，月结经验扎实」），点击保存。弹窗提示已保存。他关掉弹窗，继续看下一个人。

备注框必须留给他自己填。他对候选人的判断是页面无法提供的东西，也正是这份候选人列表比 LinkedIn 的「关注」列表更有价值的原因。

**English**

Paul is looking at a LinkedIn profile and decides the person is a fit. He clicks the extension's toolbar icon; the popup already has the name, headline and profile link filled in. He picks a role from a dropdown (defaulting to the last one he used), types his own read in the notes box (e.g. "ACCA part-qualified, solid month-end ownership"), and clicks save. The popup confirms. He closes it and moves to the next person.

The notes box must be left for him to fill in. His judgement of a candidate is the one thing the page cannot supply, and it is exactly what makes this candidate list worth more than LinkedIn's Follow list.

---

## 6. 扩展需求 / Extension requirements

### 6.1 manifest

**中文** — Manifest V3。权限仅限 `activeTab`、`scripting`、`storage`。`host_permissions` 只包含本地工作台地址。使用 `action.default_popup` 打开弹窗。

**English** — Manifest V3. Permissions limited to `activeTab`, `scripting`, `storage`. `host_permissions` covers only the local workbench address. Use `action.default_popup` for the popup.

```json
{
  "manifest_version": 3,
  "name": "Capture",
  "version": "1.0.0",
  "description": "Save the LinkedIn profile you are looking at to Capture, in one click.",
  "permissions": ["activeTab", "scripting", "storage"],
  "host_permissions": ["http://localhost/*", "http://127.0.0.1/*"],
  "action": {
    "default_title": "Save this profile to Capture",
    "default_popup": "popup.html"
  }
}
```

### 6.2 首次连接 / First-run connection

**中文**

首次打开弹窗时，若 `chrome.storage.local` 中没有 `url` 或 `token`，显示连接表单：

- 工作台地址，默认 `http://localhost:3000`
- 采集密钥（capture key），由用户在工作台的「设置」页生成后粘贴过来
- 「连接」按钮：保存到 `chrome.storage.local`，随即请求角色列表；成功则进入采集界面，失败则显示可操作的错误信息
- 「打开工作台设置」按钮：在新标签页打开该地址的 `/settings`，密钥就在那里生成，不必手工输网址
- 「返回」按钮：已连接时才出现；进入设置界面不应变成有去无回的死路
- 「忘记此密钥」按钮：清除已存的密钥并回到未连接状态，用于换账号或交出这台电脑

**English**

On first open, if `chrome.storage.local` holds no `url` or `token`, show a connection form:

- Workbench address, defaulting to `http://localhost:3000`
- Capture key, which the user generates on the workbench's Settings page and pastes here
- A "Connect" button: stores both in `chrome.storage.local`, then requests the role list; on success show the capture screen, on failure show an actionable error
- An "Open workbench settings" button: opens `/settings` at that address in a new tab, where the key is generated, so nobody has to retype a URL to find it
- A "Back" button, shown only while an account is connected: opening settings must not be a one-way trip
- A "Forget this key" button: clears the stored key and returns to the unconnected state, for switching accounts or handing the machine on

### 6.3 采集界面 / Capture screen

**中文**

打开时按以下顺序工作：

1. 向工作台请求开放职位列表，填充下拉框；若 `chrome.storage.local.lastRoleId` 在列表中，则默认选中它。
2. 通过 `chrome.scripting.executeScript` 向当前标签页注入一次提取函数，读取姓名、职位头衔、主页 URL，填入表单。
3. 焦点落在备注框。

字段：职位（下拉，必填）、姓名（文本，必填）、职位头衔（文本，可空）、主页链接（URL，可空）、备注（多行文本，可空）。

**所有字段都必须可编辑。** LinkedIn 的页面结构会变；某个字段没抓到时，行为应当降级为「用户自己输入」，而不是「扩展坏了」。

保存成功后：记录 `lastRoleId`，清空备注框，显示成功信息，并提供「在工作台中打开该职位」的按钮。保存失败：显示服务端返回的 `error` 文本，并让保存按钮重新可用。

**English**

On open, in this order:

1. Request the list of open roles from the workbench and populate the dropdown; if `chrome.storage.local.lastRoleId` is in the list, select it by default.
2. Inject an extraction function into the active tab once via `chrome.scripting.executeScript`, reading name, headline and profile URL into the form.
3. Put focus in the notes box.

Fields: role (select, required), name (text, required), headline (text, optional), profile link (url, optional), notes (textarea, optional).

**Every field must remain editable.** LinkedIn's markup changes; a missed field must degrade to "the user types it" rather than "the extension is broken."

On success: store `lastRoleId`, clear the notes box, show a confirmation and a button that opens that role in the workbench. On failure: show the server's `error` text and re-enable the save button.

### 6.4 页面提取 / Page extraction

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

## 7. 服务端 API 契约 / Server API contract

**中文** — 端点已在主应用中实现：`app/api/capture/route.ts`。扩展必须按此契约调用。所有请求都必须带 `X-Capture-Token` 请求头。

**English** — The endpoint already exists in the main application at `app/api/capture/route.ts`. The extension must call it per this contract. Every request must carry the `X-Capture-Token` header.

### 7.1 `GET /api/capture`

**中文** — 返回开放状态的职位列表（已关闭的职位不返回）。

**English** — Returns the list of open roles (closed roles are excluded).

```json
{ "roles": [{ "id": "c...", "title": "Finance Analyst", "client": "Confidential - UK aerospace manufacturer" }] }
```

`client` 可能为 `null` / `client` may be `null`.

### 7.2 `POST /api/capture`

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

### 7.3 状态码 / Status codes

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

### 7.4 认证与 CORS / Auth and CORS

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

## 8. 服务端已有行为，扩展不要重复实现 / Server behaviour the extension must not duplicate

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

## 9. 验收标准 / Acceptance criteria

### 9.1 边界（第 3、4 节）/ The boundary (sections 3 and 4)

**中文**

1. `manifest.json` 中不包含针对 `linkedin.com` 的 `host_permissions`，不包含 `content_scripts`，不包含读取页面的 `background`。
2. 未点击扩展图标时，扩展不读取任何页面内容。
3. 除工作台地址外，扩展不向任何主机发起请求。

**English**

1. `manifest.json` contains no `host_permissions` for `linkedin.com`, no `content_scripts`, and no page-reading `background`.
2. With the toolbar icon unclicked, the extension reads no page content.
3. The extension makes no request to any host other than the workbench address.

### 9.2 该自动的必须自动 / What must be automated

**中文**

4. 在一个 LinkedIn 个人主页点击图标后，姓名、职位头衔、主页链接三项均已填好，用户无需输入任何页面上已有的信息。
5. 职位下拉默认选中上次使用的职位，用户在同一职位下连续采集时无需每次重选。
6. 保存成功后备注框自动清空，可直接进入下一个人。
7. 主页链接在提交前已规范化为同一形式，使同一个人始终产出同一个 URL。

**English**

4. Clicking the icon on a LinkedIn profile leaves name, headline and profile link already filled in; the user types nothing that is already on the page.
5. The role dropdown defaults to the last role used, so consecutive captures onto one role need no reselection.
6. After a successful save the notes box is cleared, ready for the next person.
7. The profile link is normalised to a single form before submission, so the same person always yields the same URL.

### 9.3 该留给人的必须留住 / What must stay with the human

**中文**

8. 扩展不得自动保存。填好之后必须由用户点击保存。
9. 扩展不得代写备注，也不得用页面内容预填备注框。
10. 所有字段在保存前均可编辑；某个字段没抓到时，行为降级为用户自己输入，而不是报错或阻断。
11. 在非个人主页（例如搜索结果页）点击图标时，界面给出提示但仍允许手动填写并保存——提示，而不是禁止。

**English**

8. The extension must not save automatically. After the fields are filled, the user clicks save.
9. The extension must not write the note, nor pre-fill the notes box from page content.
10. Every field is editable before saving; a field that could not be read degrades to the user typing it, rather than to an error or a block.
11. Clicking the icon on a non-profile page (e.g. a search-results page) warns the user but still allows manual entry and saving — a warning, not a prohibition.

### 9.4 其余行为 / Remaining behaviour

**中文**

12. 未配置密钥时显示连接界面；密钥错误时返回连接界面并给出可操作提示。
13. 职位下拉只显示开放职位。
14. 重复保存同一主页链接时，显示服务端的 `409` 提示，且不产生第二条记录。

**English**

12. With no key configured, the connect screen shows; with a wrong key, it returns to the connect screen with an actionable message.
13. The role dropdown lists open roles only.
14. Saving the same profile link twice shows the server's `409` message and creates no second record.

---

## 10. 安装与调试 / Installing and debugging

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

## 11. 已知边界 / Known limits

**中文**

- 仅在工作台于本机运行时可用。若将来部署到线上，密钥需要走 HTTPS，`host_permissions` 与 CORS 白名单都要相应调整。
- 主应用目前没有任何登录机制，仅适合本机使用。
- LinkedIn 的 DOM 结构随时可能变化，提取选择器属于需要维护的部分；界面必须始终允许手动修正。

**English**

- Works only while the workbench runs on the same machine. If it is ever deployed, the key must travel over HTTPS and both `host_permissions` and the CORS allowlist need adjusting.
- The main application currently has no authentication at all and is only suitable for local use.
- LinkedIn's DOM changes without notice, so the extraction selectors are a maintenance item; the UI must always allow manual correction.

---

## 12. 参考实现 / Reference implementation

**中文** — 本仓库 `extension/` 目录下已有一份符合本规格的实现，可作对照。服务端端点见 `app/api/capture/route.ts`，认证与 CORS 见 `lib/capture.ts`，端点测试见 `tests/04-capture-api.spec.ts`。

**English** — A working implementation that satisfies this specification already exists in this repository under `extension/`. The server endpoint is `app/api/capture/route.ts`, auth and CORS are in `lib/capture.ts`, and the endpoint tests are in `tests/04-capture-api.spec.ts`.
