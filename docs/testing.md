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

`card-schedule.mjs` 使用当前默认「今天」、私人收集箱预留后的普通看板／列表和稳定卡片 ID 选择器；离开看板时进入「账号管理」，避免把目标智能视图自身的 visibility 监听误认为看板泄漏。验证日期标签、完整 tooltip、无日期省略、完成勾选独立、北京时间跨午夜、恢复可见时刷新、卸载清理，以及 320/375 宽、844/440 高视口的字段和长卡片边界。它固定使用项目 release 二进制，须与集成验收指定的二进制一致。

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

`list-ab.mjs` verifies Things-like borderless Inbox/Assigned to Me task rows and Today/Next Seven Days date groups using the actual API and a fresh synthetic database. Spanning tasks appear once on their first visible date, ungenerated recurrence is not expanded, and counts reflect the full server result. It checks explicit private undated/unassigned capture, rejected input retention, IME submit/navigation barriers, detail autosave, completed-bottom undo, 1440/375/320 light/dark screenshots, transparent borderless rows, whitespace separation, quiet hover/focus surfaces, first-line checkbox/title alignment, aligned wrapped title lines, desktop right-column dates, no standing shadow, unclamped titles, checkbox/detail 44px hot areas, checkbox completion without opening details, exact 16px mobile title size, no horizontal overflow and computed text/token contrast. `frontend/tests/task-groups.test.mjs` covers the pure grouping projection. This does not constitute release approval.

The runner checks default Today after login/restore, overdue and interval boundaries for Tomorrow/Next Seven Days, explicitly expanded completed groups, private unassigned/undated capture, archived inbox access, calendar inbox details, unsent input/IME barriers, smart completions and ten-second latest-item undo across authorized board scopes. It creates an actual repeated chain with archived history, comments and checklists; server preview cancellation, target-version 409, pending-attachment rejection, local-S3 quota 413, committed response loss and exact source/destination readback are exercised without automatic replay. The acknowledged success path also reads every preview ID in destination and verifies source 404.

With the optional local S3 module, actual browser upload, download and sandboxed text preview preserve exact bytes after the archived task moves. Attachment URLs are checked under the new board scope. This is not evidence about real B2 credentials, CORS or retention.

Theme acceptance includes light/dark/system, media changes, browser account isolation, the first authenticated workspace render after session restoration, native `color-scheme`/meta, real localStorage read/write failures, computed token contrast and 320/375 screenshots. Anonymous loading follows system or its anonymous preference; an unknown account preference cannot be applied before `/me` identifies the account. Theme preferences do not store task data; the separately bounded draft-recovery feature uses same-tab sessionStorage as described in README.

The six representative regressions remain independently executable: `completed-bottom-undo`, `drag-order`, `schedule-autosave`, `calendar`, `poll-revision`, `task-filter-metadata` under `frontend/test-browser/`. Their selectors use the new sidebar/drawer and reserved system inbox board/list IDs, retaining the business assertions. Explicit retry after an unknown autosave now opens read-only latest-version review before the user chooses to preserve local fields and write again.

All browser runners own and close their browser and test server in `finally`. The new runner also closes its local S3 instance. Screenshots, JSON results and logs belong in the external evidence directory, not in this repository. Chromium CDP touch tests are not physical iPhone/Safari or Android coverage. Run `npm --prefix frontend test`, `npm --prefix frontend run check`, and `npm --prefix frontend run build` separately; a front-end-only change does not warrant unrelated Rust rebuilds after the verified backend binary is hash-pinned.

## Four orthogonal color palettes

`node frontend/test-browser/color-themes.mjs` reuses the loopback synthetic-server pattern from `list-ab.mjs` (port 48771, so run sequentially). It requires the same existing Playwright/Chromium paths and built application; no `.env`, production SQLite or B2 access is used. It checks blue/iris/clay/graphite × light/dark core tokens and semantic states (normal text >=4.5, focus >=3), actual enabled completion-button foreground/background, the existing BoardView/calendar/search/detail surfaces, mobile drawer/picker and realistic long titles. Keyboard selection, legacy mode preservation, system media response, refresh, anonymous/account separation, storage denial, dirty IME draft DOM/selection/autosave, and completion undo after palette switching are representative workflow checks. The frontend unit suite retains representative theme-helper tests rather than expanding a backend matrix. `three-pane.mjs` uses the current AppearancePicker buttons for mode selection and checks the selected button, preserving its security and workflow assertions.

Palette keys add `.palette` to the original per-account mode keys. Palette and mode are independent; palette preferences never contain task data; eligible draft fields are stored separately for same-tab recovery. Anonymous preferences are all that bootstrap can know before `/api/me`. Bootstrap remains synchronous, same-origin and CSP compatible. PDF paper remains white by design. Disabled buttons intentionally retain the existing opacity treatment; contrast claims apply to enabled text and controls. Native platform picker popup rendering is not physical-device coverage.

## 当前批次：同一构建的集成验收

先完成一次前端和后端构建，再固定同一二进制及 `frontend/dist` 运行以下命令。当前批次 runner 支持 `NORNS_BINARY` 绝对路径；未指定时仍使用项目的 `target/release/norns`（`exports.mjs`、`organization-view.mjs`、`templates.mjs` 和 `bulk-actions.mjs` 要求明确指定；`card-schedule.mjs` 固定读取项目 release 路径）。不要在运行期间重新构建或替换静态文件。保留二进制 SHA-256、dist 文件清单及每次进程的可执行文件哈希，避免把旧 debug 或其他构建的结果混为当前验收。

```sh
export NORNS_BINARY="$PWD/target/release/norns"
# 使用上文已有 Playwright / Chromium / EVIDENCE_ROOT 配置；不自动安装依赖。
# ZIP 原件下载与转移回归使用已安装的本地 s3rver：
export LOCAL_S3_MODULE=/path/to/s3rver/lib/s3rver.js
python3 tests/http_smoke.py
node frontend/test-browser/task-capture.mjs
node frontend/test-browser/draft-recovery.mjs
node frontend/test-browser/exports.mjs
node frontend/test-browser/organization-view.mjs
node frontend/test-browser/templates.mjs
node frontend/test-browser/bulk-actions.mjs
node frontend/test-browser/completed-bottom-undo.mjs
node frontend/test-browser/schedule-autosave.mjs
node frontend/test-browser/card-schedule.mjs
node frontend/test-browser/poll-revision.mjs
node frontend/test-browser/calendar.mjs
node frontend/test-browser/task-filter-metadata.mjs
node frontend/test-browser/transfer-blur.mjs
node frontend/test-browser/three-pane.mjs
```

串行执行；各 runner 会探测并独占其 loopback 测试端口，不是全部使用同一端口。`task-capture` / `draft-recovery` 使用 48786（可选 S3 为 48772），`exports` 使用 48871/48872；其余端口由各脚本定义。不要传生产数据库或桶。`http_smoke.py` 固定读取项目 release 二进制，因此该命令应与上述 `NORNS_BINARY` 指向同一文件。

`task-capture` 验证候选日期明确采用、直接提交原文、修改后失效、IME、失败保留和各新增任务入口。`draft-recovery` 验证首次加载竞态、刷新、明确恢复与另行保存、无效日期编辑缓冲、独立评论/清单输入、账号隔离、权限撤销及未知创建不重放；不宣称恢复新建看板/列表缓冲或文件。

`exports` 必须提供本地 S3 模块，实际经界面下载 CSV / JSON / ZIP 并解析任务 ID、Unicode、多行、CSV 公式保护和附件原件字节/哈希；同时检查范围、独立完成/归档选项、过期预览、取消及身份变化。下载内容与上限见[导出说明](exports.md)。它不是生产对象存储或灾难恢复备份验收。

代表性 1440 / 375 截图、深浅色、长内容、键盘操作和缩短视口由实际浏览器 runner 留存；须人工查看截图，不能只根据无横向溢出断言宣布视觉验收。Chromium 窄屏及触屏模拟不是物理 Safari / iPhone 测试。本文列的是本地可执行命令，不声称存在未配置的 CI 工作流。

## Private template UI

`frontend/tests/templates.test.mjs` verifies strict source/edit/apply payloads, persisted acknowledgement checks, shared acknowledgement, and account-scoped unknown-outcome markers. Run the full unit suite, `npm run check` and `npm run build` from `frontend`.

`frontend/test-browser/templates.mjs` uses a fresh synthetic SQLite database, an explicitly supplied current template-capable `NORNS_BINARY`, built `frontend/dist`, `PLAYWRIGHT_MODULE`, `CHROMIUM_PATH`, and `EVIDENCE_ROOT`. It exercises persisted-task save/edit/apply, clean fresh identities, own-inbox/shared-board acknowledgement, conflicts, unknown committed responses, account switch, draft/IME protections and bounded 1440/375 dialogs. Existing `task-capture.mjs`, `draft-recovery.mjs`, `exports.mjs` and `organization-view.mjs` cover representative neighbouring regressions. Exports additionally needs `LOCAL_S3_MODULE`. No production database is used and no dependencies are installed by these runners.

## 本地显示与批量操作

`node frontend/test-browser/organization-view.mjs` 验证分组／日期排序零共享写入、切回真实手动顺序、跨日去重、已完成分离，以及详情／快速记录 DOM 和未保存输入保留、正常自动保存与无效日期离开屏障。

`node frontend/test-browser/bulk-actions.mjs` 验证选择与完成独立、同板可见原任务上限、预览确认、原子独立字段修改、真实 CAS 冲突全不写、重复后继安全、提交后响应丢失不重放、账号切换、详情焦点恢复和 320/375 弹窗／底部按钮可达。它同时检查未提交表单和隐藏日期缓冲的刷新警告、恢复默认后不再警告、脏表单 Escape 放弃确认及取消后保留精确输入；不承诺刷新后恢复批量表单。

这两项均使用上述已安装模块、当前 `NORNS_BINARY`、固定 `frontend/dist` 和独立 `EVIDENCE_ROOT`，只写合成数据库，不自动安装依赖。与模板、导出和既有日程回归串行运行。
