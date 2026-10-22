# 测试

从项目根目录执行命令。先运行 `sh scripts/verify.sh` 构建 release 二进制和前端。HTTP 冒烟使用 Python 标准库：`python3 tests/http_smoke.py`。

## 浏览器

另行安装 Playwright / playwright-core 和 Chromium；这些不是应用运行依赖。提供已安装模块的绝对路径与浏览器路径，以及新建的隔离输出目录：

```sh
mkdir -p "$HOME/norns-test-output"
chmod 700 "$HOME/norns-test-output"
export EVIDENCE_ROOT="$HOME/norns-test-output"
export PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs
export CHROMIUM_PATH=/path/to/chromium
npm --prefix frontend run test:browser
npm --prefix frontend run test:completion
node frontend/test-browser/completed-bottom-undo.mjs
node frontend/test-browser/drag-order.mjs
node frontend/test-browser/schedule-autosave.mjs
node frontend/test-browser/card-schedule.mjs
node frontend/test-browser/task-discovery.mjs
node frontend/test-browser/task-filter-metadata.mjs
node frontend/test-browser/calendar.mjs
node frontend/test-browser/poll-revision.mjs
```

每个脚本自建数据库与随机合成账号，启动并清理自己的服务。脚本使用 loopback 端口（当前界面回归为 48759，脚本运行时会先探测占用），请串行运行且保证端口未占用。输出可能含测试密码、数据库和截图，不要上传到公开仓库。Chromium 的触屏模拟不能替代物理手机或 Safari 测试。

`completed-bottom-undo.mjs` 验证同列显示分组（未完成在前、已完成在后，数据库 position 不动）、最近一项确认成功后的 10 秒悬浮撤销、真实 CAS 排队、最新真实位置回位、重复任务安全拒绝及 320/375 窄屏。计时使用 Playwright fake clock；拖放索引用真实鼠标输入验证，不代表物理触摸拖拽验收。

`tests/browser.mjs`、`tests/phase2-browser.mjs`、`tests/refresh-race-browser.mjs` 和 `tests/save-race.mjs` 保留早期界面的回归场景；部分选择器对应旧版显式保存或详情弹窗，不能当成当前界面全部通过的保证。`tests/browser.mjs` 默认使用 debug 二进制，需先 `cargo build --locked`。

`calendar.mjs` 固定浏览器北京时间在闰年二月底（服务器仍用真实时间），验证跨看板月/周、跨月含边界、仅标题、全天/时间与重叠分栏、单板筛选、原详情标题/日期自动保存与完成撤销、真实 409 手动重试、迟到响应、撤权与 401 清理、隐藏暂停/恢复，以及 320/375 窄屏。时间轴的最小展示时长只影响布局，不改数据；日期投影与 partial time 规则另有纯函数测试。`poll-revision.mjs` 不依赖已隐藏的内部版本号，而读取真实轮询响应来验证 idle writer、active queue 和 dirty draft 的 CAS 基线。

## S3 模拟器

另外安装 s3rver 3.7.1，并设置 `S3RVER_MODULE` 为该模块的绝对路径，然后执行 `node tests/attachments-browser.mjs`。它只使用 loopback 48746/48747 和本地测试桶，不验证真实提供商行为。早期详情选择器可能需要随界面更新。

## 真实 B2（可选、有费用及写入）

此测试会向明确指定的私有测试桶上传及删除对象，产生请求/流量费用；**不要使用生产桶**。只清理本次独立 SQLite 记录的 key，不修改桶 ACL、CORS 或生命周期，也不 purge 历史版本。旧版本仍需桶管理员的生命周期规则清理。

安装 Python `boto3`；将五个 `S3_*` 变量经安全方式注入进程环境（不会自动读 `.env`），并显式设置 `B2_TEST_BUCKET` 为同一专用测试桶以确认写入目标。`EVIDENCE_DIR` 必须是不存在的新目录，runner 会以 0700 创建它；提供 `PLAYWRIGHT_MODULE` 与 `CHROMIUM_PATH`。然后运行：

```sh
python3 tests/b2-attachments-acceptance.py
```

桶 CORS 必须提前精确允许 `http://127.0.0.1:48748` 的 PUT 和 Content-Type（可通过 `B2_TEST_PORT` 更改端口）。该脚本仍保留早期详情选择器，最终应同时验证当前附件交互。不会为通过测试放宽生产桶设置。结构化结果写入 `EVIDENCE_DIR`，原始含签名 URL 的诊断不持久化。

## 看板拖放与列表排序

`drag-order.mjs` 使用真实鼠标及 Chromium CDP `Input.dispatchTouchEvent` 触点序列，不以 DOM dispatchEvent 代替手势。覆盖列表首尾移动与刷新持久化、卡片同列/跨空列落点、唯一占位、完成分组边界、正常内容滑动和短点详情、第二指/取消、固定指针边缘自动滚动与 scroll-snap 恢复、同版本轮询不打断/新版本取消、真实 409 与提交后丢响应不重放，以及 320/375 窄屏。列表标题拖动；详情移动菜单和列表更多菜单是键盘后备。后端 `list_move` 经现有整板 CAS 原子重排，不迁移 schema、不修改卡片字段。

这仅证明 Chromium 原生输入管线；物理 iPhone Safari、Android Chrome、系统长按菜单、切后台和软键盘仍需实机验收。当前纵向边缘滚动对应文档，不新增列内滚动。已完成卡片继续置底，不能在异完成分组区域宣称任意落点。


## Three-pane workspace, private inbox and theme acceptance

`frontend/test-browser/three-pane.mjs` uses a unique synthetic SQLite database, randomly generated test credentials and loopback-only owned processes. It does not read `.env` or a production database. Set `PLAYWRIGHT_MODULE`, `CHROMIUM_PATH` and an existing disposable `EVIDENCE_ROOT`; optionally set `LOCAL_S3_MODULE` to an existing `s3rver` module entry to exercise actual private attachment bytes. No dependency is installed automatically.

```sh
node frontend/test-browser/three-pane.mjs
node frontend/test-browser/transfer-blur.mjs
node frontend/test-browser/list-ab.mjs
```

`list-ab.mjs` verifies individual lightweight Inbox/Assigned to Me task cards and Today/Next Seven Days date groups using the actual API and a fresh synthetic database. Spanning tasks appear once on their first visible date, ungenerated recurrence is not expanded, and counts reflect the full server result. It checks explicit private undated/unassigned capture, rejected input retention, IME submit/navigation barriers, detail autosave, completed-bottom undo, 1440/375/320 light/dark screenshots, visible individual 1px card borders, 8px card gaps/radii, no standing shadow, unclamped titles, checkbox/detail 44px hot areas, checkbox completion without opening details, exact 16px mobile title size, no horizontal overflow and computed text/token contrast. `frontend/tests/task-groups.test.mjs` covers the pure grouping projection. This does not resolve the separately tracked historical `undefined.filter` quality blocker or constitute release approval.

The runner checks default Today after login/restore, overdue and interval boundaries for Tomorrow/Next Seven Days, explicitly expanded completed groups, private unassigned/undated capture, archived inbox access, calendar inbox details, unsent input/IME barriers, smart completions and ten-second latest-item undo across authorized board scopes. It creates an actual repeated chain with archived history, comments and checklists; server preview cancellation, target-version 409, pending-attachment rejection, local-S3 quota 413, committed response loss and exact source/destination readback are exercised without automatic replay. The acknowledged success path also reads every preview ID in destination and verifies source 404.

With the optional local S3 module, actual browser upload, download and sandboxed text preview preserve exact bytes after the archived task moves. Attachment URLs are checked under the new board scope. This is not evidence about real B2 credentials, CORS or retention.

Theme acceptance includes light/dark/system, media changes, browser account isolation, the first authenticated workspace render after session restoration, native `color-scheme`/meta, real localStorage read/write failures, computed token contrast and 320/375 screenshots. Anonymous loading follows system or its anonymous preference; an unknown account preference cannot be applied before `/me` identifies the account. Task data is not stored in browser storage.

The six representative regressions remain independently executable: `completed-bottom-undo`, `drag-order`, `schedule-autosave`, `calendar`, `poll-revision`, `task-filter-metadata` under `frontend/test-browser/`. Their selectors use the new sidebar/drawer and reserved system inbox board/list IDs, retaining the business assertions. Explicit retry after an unknown autosave now opens read-only latest-version review before the user chooses to preserve local fields and write again.

All browser runners own and close their browser and test server in `finally`. The new runner also closes its local S3 instance. Screenshots, JSON results and logs belong in the external evidence directory, not in this repository. Chromium CDP touch tests are not physical iPhone/Safari or Android coverage. Run `npm --prefix frontend test`, `npm --prefix frontend run check`, and `npm --prefix frontend run build` separately; a front-end-only change does not warrant unrelated Rust rebuilds after the verified backend binary is hash-pinned.

## Four orthogonal color palettes

`node frontend/test-browser/color-themes.mjs` reuses the loopback synthetic-server pattern from `list-ab.mjs` (port 48771, so run sequentially). It requires the same existing Playwright/Chromium paths and built application; no `.env`, production SQLite or B2 access is used. It checks blue/iris/clay/graphite × light/dark core tokens and semantic states (normal text >=4.5, focus >=3), actual enabled completion-button foreground/background, the existing BoardView/calendar/search/detail surfaces, mobile drawer/picker and realistic long titles. Keyboard selection, legacy mode preservation, system media response, refresh, anonymous/account separation, storage denial, dirty IME draft DOM/selection/autosave, and completion undo after palette switching are representative workflow checks. The 58-case frontend unit suite retains two representative theme-helper tests rather than expanding a backend matrix. `three-pane.mjs` changes only its obsolete green meta-color expectation; all security and workflow assertions remain.

Palette keys add `.palette` to the original per-account mode keys. Palette and mode are independent; task data is never added to storage. Anonymous preferences are all that bootstrap can know before `/api/me`. Bootstrap remains synchronous, same-origin and CSP compatible. PDF paper remains white by design. The current N/dot placeholders follow brand tokens; the B2 logo is integrated and C2 remains a resource only. Disabled buttons intentionally retain the existing opacity treatment; contrast claims apply to enabled text and controls. Native platform picker popup rendering is not physical-device coverage.

The historical `undefined.filter` Q1 remains **OPEN**; its root cause is not proven. Test passes do not establish a fix. The runner records exact unexpected stacks and retains expected unauthenticated `/api/me` 401 and missing `/favicon.ico` 404 diagnostics separately from application failures.
