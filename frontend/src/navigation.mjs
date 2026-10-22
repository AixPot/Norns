export const initialRoute=()=> 'today';
export function smartFilters(route,inboxId){return {q:'',view:route==='inbox'?'all':route,status:'incomplete',assignee_id:'',board_id:route==='inbox'?String(inboxId):'',from:'',to:''}}
export function createIdentityGate(){let generation=0,identity=null;return {switch(id){identity=id;++generation},ticket(){return {identity,generation}},accept(t){return t.identity===identity&&t.generation===generation}}}
