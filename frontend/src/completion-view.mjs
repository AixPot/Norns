// Completion is a display partition; persisted position remains the move/undo authority.
export function displayCards(cards,list){
 return cards.filter(c=>c.list_id===list&&!c.archived&&!c.skipped).sort((a,b)=>Number(a.completed)-Number(b.completed)||a.position-b.position||a.id-b.id);
}
export function physicalCards(cards,list,moving){
 return cards.filter(c=>c.list_id===list&&!c.archived&&c.id!==moving).sort((a,b)=>a.position-b.position||a.id-b.id);
}
export function dropIndex(cards,list,moving,before){
 const ordered=physicalCards(cards,list,moving);
 return before==null?ordered.length:ordered.findIndex(c=>c.id===before);
}
