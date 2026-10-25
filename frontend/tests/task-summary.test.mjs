import test from 'node:test';
import assert from 'node:assert/strict';
import * as summary from '../src/task-summary.mjs';
const card={id:7,title:'买牛奶',description:'第一行\n第二行',list_id:3,completed:false,archived:false,assignee_id:2,due_date:null,schedule:{start_date:'2026-10-24',end_date:'2026-10-25',start_time:'09:00',end_time:'10:00',timezone:'Asia/Shanghai',repeat:{unit:'week',interval:2,mode:'calendar',weekdays:[0,4],count:4}}};
const board={id:1,title:'家庭',cards:[card],lists:[{id:3,title:'采购'}],members:[{user_id:2,username:'小林'}],checklist:[{id:9,card_id:7,title:'全脂',checked:false,position:1},{id:8,card_id:7,title:'带袋子',checked:true,position:0},{id:10,card_id:99,title:'不可复制',position:0}],comments:[{body:'未纳入评论'}],attachments:[{url:'https://signed.invalid/?secret=secret'}]};
test('saved summary is readable, ordered and allowlisted rather than serializing a board',()=>{
 assert.equal(typeof summary.taskSummary,'function');
 assert.equal(summary.taskSummary(board,7),`买牛奶

第一行
第二行

看板：家庭
列表：采购
状态：未完成 · 未归档
负责人：小林
日期：2026-10-24 09:00 — 2026-10-25 10:00 · Asia/Shanghai
重复：每 2 周 · 按日历 · 周一、周五 · 共 4 次

清单：
[x] 带袋子
[ ] 全脂`);
 assert.throws(()=>summary.taskSummary(board,99),/任务已不可用/);
 assert.match(summary.taskSummary({...board,cards:[{...card,description:'',schedule:null,due_date:'2026-10-26',assignee_id:null,completed:true,archived:true}],checklist:[]},7),/状态：已完成 · 已归档\n负责人：未分配\n日期：2026-10-26/);
});

test('clipboard acknowledgement waits for success, exposes denial and ignores stale ownership',async()=>{
 assert.equal(typeof summary.copyTaskSummary,'function');
 let finish,body;const pending=new Promise(resolve=>finish=resolve);let current=true;
 const copying=summary.copyTaskSummary(board,7,{clipboard:{writeText(text){body=text;return pending}},isCurrent:()=>current});
 assert.equal(body,summary.taskSummary(board,7));current=false;finish();assert.equal(await copying,false);
 assert.equal(await summary.copyTaskSummary(board,7,{clipboard:{async writeText(){}},isCurrent:()=>true}),true);
 await assert.rejects(summary.copyTaskSummary(board,7,{clipboard:{async writeText(){throw Error('denied')}},isCurrent:()=>true}),/复制失败.*权限.*重试/);
 await assert.rejects(summary.copyTaskSummary(board,7,{clipboard:null,isCurrent:()=>true}),/剪贴板不可用.*HTTPS/);
});
