// Physical order includes both completion groups and skipped cards.
export function physicalCards(cards,list,moving){
 return cards.filter(c=>c.list_id===list&&!c.archived&&c.id!==moving).sort((a,b)=>a.position-b.position||a.id-b.id);
}
