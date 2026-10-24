import {groupSmartTasks} from './task-groups.mjs';
/** Pure display projection. Returns {groups: [{key,label,tasks}], completed: tasks[]}.
 * Input records retain identity; arrays are new. Never expands recurrence or changes
 * server membership. Completed records are a separate bottom section, not groups.
 * Options: route is the existing smart route (or 'search'); today is the caller's
 * YYYY-MM-DD civil day, required for Today/next7 default grouping. group supports
 * default (existing smart grouping), none (one all group), date (effective date,
 * first visible date for next7; undated last), board (board:<id> groups, physical board order). sort supports
 * manual (board_position/board_id/list_position/list_id/position/id hierarchy)
 * or date (schedule.start_date || due_date, undated last, manual tie break).
 * Group headings do not change matching/filtering; caller supplies server results.
 * Completed results from a separate request may be concatenated before projection.
 * Example: projectTaskView(response.tasks, {route:'today', today:'2026-10-22',
 *   ...preferences.get({surface:'smart',scope:'today'})}).
 */
export function projectTaskView(tasks,{route='search',today,group='default',sort='manual'}={}){
 const compare=sort==='date'?byDate:physical;
 const open=tasks.filter(t=>!t.completed).sort(compare),completed=tasks.filter(t=>t.completed).sort(compare);
 let groups;
 if(group==='none')groups=[{key:'all',label:'',tasks:open}];
 else if(group==='board'){
  const boards=new Map();
  for(const t of open){const key=`board:${t.board_id}`;if(!boards.has(key))boards.set(key,{key,label:t.board_title||'',tasks:[]});boards.get(key).tasks.push(t)}
  groups=[...boards.values()].sort((a,b)=>physical(a.tasks[0],b.tasks[0]));
 }else if(group==='date'){
  const dates=new Map();
  for(const t of open){const date=effectiveDate(t);const key=(route==='next7'&&date&&date<today?today:date)||'undated';if(!dates.has(key))dates.set(key,{key,label:key==='undated'?'无日期':key,tasks:[]});dates.get(key).tasks.push(t)}
  groups=[...dates.values()].sort((a,b)=>a.key.localeCompare(b.key));
 }else groups=groupSmartTasks(open,route,today);
 return {groups:groups.map(g=>({...g,tasks:[...g.tasks]})),completed};
}

const number=v=>Number.isFinite(v)?v:0;
const effectiveDate=t=>t.schedule?.start_date||t.due_date||'';
// A hierarchy, not a flat position sort: positions are local to each parent.
// Discovery records may supply board_position, list_position, position; older
// responses fall back to IDs. Do not confuse display indexes with write positions.
function physical(a,b){return number(a.board_position)-number(b.board_position)||number(a.board_id)-number(b.board_id)||number(a.list_position)-number(b.list_position)||number(a.list_id)-number(b.list_id)||number(a.position)-number(b.position)||number(a.id)-number(b.id)}
function byDate(a,b){const x=effectiveDate(a),y=effectiveDate(b);return (x&&y?x.localeCompare(y):x?-1:y?1:0)||physical(a,b)}
/** Board projection returns {columns:[{list,tasks}]}; real list records, including
 * empty columns, are retained and ordered by position/id. tasks excludes archived
 * cards and concatenates sorted open then sorted completed cards in each column.
 * Example: projectBoardView(board, preferences.get({surface:'board',scope:String(board.id)})).
 * Only sort applies: grouping never replaces a board's persisted list columns.
 */
export function projectBoardView(board,{sort='manual'}={}){
 const compare=sort==='date'?byDate:physical;
 return {columns:[...board.lists].sort((a,b)=>number(a.position)-number(b.position)||number(a.id)-number(b.id)).map(list=>{
  const tasks=board.cards.filter(t=>t.list_id===list.id&&!t.archived);
  return {list,tasks:[...tasks.filter(t=>!t.completed).sort(compare),...tasks.filter(t=>t.completed).sort(compare)]};
 })};
}
