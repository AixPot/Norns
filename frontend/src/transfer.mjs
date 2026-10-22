// The caller owns the draft/IME/upload leave barrier and the identity lifetime.
// The command borrows the existing writer; it never creates a second CAS channel.
export function createTransferCommand({queue,preview,send,snapshot,readCard}){
 let state='idle',confirmed=null;
 return {state:()=>state,async prepare(card,board,list){
  if(state==='unknown'||state==='sending')throw Error('请先只读核对上次转移结果');
  await queue.idle();const fresh=await preview(card,board,list);if(state==='stale')queue.reset();confirmed=fresh;state='ready';return fresh;
 },async commit(){
  if(state!=='ready')throw Error('请重新预览并确认');state='sending';
  try{const result=await queue.run(async()=>{await send({ack_visibility:true,preview:confirmed});const readback=await Promise.all(confirmed.cards.map(async c=>[await readCard(confirmed.source_board_id,c.id),await readCard(confirmed.target_board_id,c.id)]));if(!readback.every(([s,t])=>s.status===404&&t.status===200))throw Error('转移提交后归属待核对');return await snapshot(confirmed.source_board_id)});state='success';return result}
  catch(e){state=!e.status||e.status>=500?'unknown':'stale';throw e}
 },async verify(){
  if(state!=='unknown')throw Error('没有待核对的转移');
  const statuses=await Promise.all(confirmed.cards.map(async c=>[await readCard(confirmed.source_board_id,c.id),await readCard(confirmed.target_board_id,c.id)]));
  if(statuses.every(([s,t])=>s.status===404&&t.status===200))return 'moved';
  if(statuses.every(([s,t])=>s.status===200&&t.status===404))return 'source';
  return 'uncertain';
 }};
}
