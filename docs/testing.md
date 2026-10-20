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
