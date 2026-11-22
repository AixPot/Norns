// Run with PLAYWRIGHT_MODULE, CHROMIUM_PATH, EVIDENCE_ROOT and NORNS_BINARY.
// Uses a fresh SQLite database and an exclusively bound loopback port.
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {once} from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';

const {PLAYWRIGHT_MODULE, CHROMIUM_PATH, EVIDENCE_ROOT, NORNS_BINARY, NORNS_TEST_PORT = '49932'} = process.env;
assert.ok(PLAYWRIGHT_MODULE && CHROMIUM_PATH && EVIDENCE_ROOT && NORNS_BINARY, 'Set the four browser test environment variables');
assert.match(NORNS_TEST_PORT, /^\d{4,5}$/);
const {chromium} = await import(PLAYWRIGHT_MODULE);
const out = fs.mkdtempSync(path.resolve(EVIDENCE_ROOT, 'unskip-history-'));
const db = path.join(out, 'synthetic.sqlite');
const base = `http://127.0.0.1:${NORNS_TEST_PORT}`;
const binary = path.resolve(NORNS_BINARY);
const dist = process.env.NORNS_TEST_DIST ?? fileURLToPath(new URL('../dist', import.meta.url));
const expectedHtml = fs.readFileSync(path.join(dist, 'index.html'));
const browserEnv = {PATH: process.env.PATH, HOME: out, TMPDIR: process.env.TMPDIR ?? out};
const env = {...browserEnv, TZ: 'UTC', DATABASE_URL: `sqlite://${db}`, STATIC_DIR: path.resolve(dist), APP_ORIGIN: base, BIND_ADDR: new URL(base).host, COOKIE_SECURE: 'false'};
const password = randomBytes(24).toString('base64url');
const trace = {requests: [], responses: [], pageErrors: []};
let server, browser, page;
try {
  const listeners = () => {
    const r = spawnSync('ss', ['-H', '-ltnp', `sport = :${NORNS_TEST_PORT}`], {encoding: 'utf8'});
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  assert.equal(listeners(), '', 'test port must be free');
  assert.equal(spawnSync(binary, ['init-admin', 'audit'], {env, cwd: out, input: password, timeout: 10000}).status, 0);
  const log = fs.openSync(path.join(out, 'server.log'), 'a');
  try { server = spawn(binary, {env, cwd: out, stdio: ['ignore', log, log]}); }
  finally { fs.closeSync(log); }
  for (let i = 0; i < 100; i++) {
    assert.equal(server.exitCode, null);
    if (listeners().includes(`pid=${server.pid},`)) break;
    await delay(50);
  }
  const socket = listeners();
  assert.equal(socket.split('\n').length, 1);
  assert.ok(socket.includes(`127.0.0.1:${NORNS_TEST_PORT}`) && socket.includes(`pid=${server.pid},`), socket);
  browser = await chromium.launch({executablePath: CHROMIUM_PATH, env: browserEnv, args: ['--no-sandbox', '--no-proxy-server']});
  page = await browser.newPage({viewport: {width: 1440, height: 900}, serviceWorkers: 'block', reducedMotion: 'reduce'});
  page.setDefaultTimeout(5000);
  page.on('pageerror', e => trace.pageErrors.push(e.message));
  assert.deepEqual(await (await page.goto(base)).body(), expectedHtml);
  await page.getByLabel('用户名', {exact: true}).fill('audit');
  await page.getByLabel('密码', {exact: true}).fill(password);
  const button = (name, root = page) => root.getByRole('button', {name, exact: true});
  await button('登录 Norns').click();
  await page.getByRole('heading', {name: '今天', exact: true}).waitFor();

  const request = page.context().request;
  const csrf = (await (await request.get(`${base}/api/me`)).json()).csrf;
  async function api(endpoint, data) {
    const res = await request.fetch(base + endpoint, data ? {method: 'POST', data, headers: {Origin: base, 'X-CSRF-Token': csrf}} : {});
    assert.ok(res.ok(), `${endpoint}: ${res.status()} ${await res.text()}`);
    return res.json();
  }
  const title = 'Unskip history regression';
  const {id: boardId} = await api('/api/boards', {title});
  const board = `/api/boards/${boardId}`;
  const mutate = (snapshot, data) => api(`${board}/mutate`, {...data, expected_revision: snapshot.revision});
  let snapshot = await mutate(await api(board), {action: 'list_create', title: 'Recurring'});
  snapshot = await mutate(snapshot, {action: 'card_create', title: 'Recurring task', list_id: snapshot.lists[0].id,
    schedule: {start_date: '2030-01-31', timezone: 'Asia/Shanghai', repeat: {unit: 'month', interval: 1, mode: 'calendar', count: 3, weekdays: []}}});
  const original = snapshot.cards[0].id;
  const preview = await api(`${board}/cards/${original}/skip-preview`);
  snapshot = await mutate(snapshot, {action: 'card_skip', card_id: original, preview});
  const successor = snapshot.cards.find(card => card.predecessor_id === original).id;
  const oldPrefix = `${board}/cards/${successor}`;
  const history = `${board}/cards/${original}/history`;
  await page.reload();
  await button(title).click();
  await page.locator(`.board-scroll .card[data-card-id="${successor}"] .card-content`).click();
  await page.locator('.task-more').getByLabel('更多操作', {exact: true}).click();
  await button('重复记录', page.locator('.task-more')).click();
  const dialog = page.getByRole('dialog', {name: '重复记录', exact: true});
  const oldRow = dialog.locator(`[data-history-id="${original}"]`);
  await oldRow.getByText(`#${original} · 已跳过`, {exact: true}).waitFor();
  await dialog.getByText(`#${successor} · 未完成`, {exact: true}).waitFor();

  // Record requests (including ones that never receive a response).
  const pathname = r => new URL(r.url()).pathname;
  page.on('request', r => trace.requests.push([r.method(), pathname(r), r.postDataJSON()?.action ?? null]));
  page.on('response', r => trace.responses.push([r.request().method(), pathname(r), r.status()]));
  const undo = page.waitForResponse(r => pathname(r) === `${board}/mutate` && r.request().postDataJSON()?.action === 'card_unskip');
  await button(`撤销跳过 #${original}`, oldRow).click();
  const ack = await undo;
  assert.equal(ack.status(), 200);
  assert.equal(ack.request().postDataJSON().card_id, original);
  const reload = button('重新读取重复记录', dialog);
  // It is enabled again only after the automatic refresh settles.
  await reload.click({trial: true});
  const withdrawnReads = () => trace.requests.filter(([method, url]) => method === 'GET' && (url === oldPrefix || url.startsWith(`${oldPrefix}/`)));
  assert.deepEqual(withdrawnReads(), [], 'must not request the withdrawn successor after undo');
  const feedback = dialog.getByText('已撤销跳过', {exact: true});
  assert.equal(await feedback.isVisible(), true, 'keep acknowledged success after refresh');
  assert.equal(await dialog.getByText('资源不存在或无权访问', {exact: true}).isVisible(), false);
  await oldRow.getByText(`#${original} · 未完成`, {exact: true}).waitFor();
  assert.deepEqual(await dialog.locator('[data-history-id]').evaluateAll(rows => rows.map(row => Number(row.dataset.historyId))), [original]);
  assert.deepEqual(trace.responses.filter(([, url]) => url === history), [['GET', history, 200]]);

  // Inject only a read failure. It must surface without obscuring the acknowledged write or locking further reads.
  const readError = '测试：历史暂时无法读取';
  await page.route(base + history, route => route.fulfill({status: 503, json: {message: readError}}), {times: 1});
  await reload.click();
  await dialog.getByText(readError, {exact: true}).waitFor();
  assert.equal(await feedback.isVisible(), true);
  const reread = page.waitForResponse(r => pathname(r) === history);
  await reload.click();
  assert.equal((await reread).status(), 200);
  await reload.click({trial: true});
  assert.equal(await dialog.getByText(readError, {exact: true}).isVisible(), false);
  assert.equal(await feedback.isVisible(), true);
  assert.deepEqual(withdrawnReads(), []);
  assert.deepEqual(trace.requests.filter(([method, url]) => method === 'POST' && url === `${board}/mutate`), [['POST', `${board}/mutate`, 'card_unskip']]);
  const persisted = await api(board);
  assert.equal(persisted.revision, snapshot.revision + 1);
  assert.deepEqual(persisted.cards.map(c => [c.id, c.skipped, c.completed]), [[original, false, false]]);
  assert.deepEqual(trace.pageErrors, []);
  trace.status = 'passed';
} catch (e) {
  trace.status = 'failed';
  trace.error = e.stack;
  await page?.screenshot({path: path.join(out, 'failure.png'), timeout: 2000}).catch(() => {});
  throw e;
} finally {
  try { await browser?.close(); }
  finally {
    if (server?.pid && server.exitCode === null && server.signalCode === null) {
      const exited = once(server, 'exit');
      server.kill('SIGTERM');
      const timer = setTimeout(() => server.kill('SIGKILL'), 3000);
      try { await exited; } finally { clearTimeout(timer); }
    }
    fs.writeFileSync(path.join(out, 'evidence.json'), JSON.stringify(trace, null, 2) + '\n');
    console.log(`${trace.status}: ${out}/evidence.json`);
  }
}
