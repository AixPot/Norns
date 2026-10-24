import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sourceTemplate,templateReplacement,templateApply,unknownOutcome,templateUncertainty} from '../src/templates.mjs';
test('persisted source requires exact acknowledged fields and whitelist',()=>{
 const card={id:4,title:'Saved',description:'Body',touch_version:9,completed:true};
 const board={id:2,revision:7,cards:[card],checklist:[{id:5,card_id:4,title:'Step',position:0,checked:true}]};
 const source=sourceTemplate(board,{...card,revision:7},'Name');
 assert.deepEqual(source,{name:'Name',source_board_id:2,source_card_id:4,expected_revision:7,expected_touch_version:9});
 assert.throws(()=>sourceTemplate(board,{...card,description:'Unsaved',revision:7},'Name'));
 assert.throws(()=>sourceTemplate(board,{...card,revision:6},'Name'));
});
test('replacement strips lifecycle identity and keeps ordered checklist titles',()=>{
 assert.deepEqual(templateReplacement({id:1,revision:3,name:'N',title:'T',description:'D',checklist:[{id:9,title:'a',checked:true,position:4}]}),{expected_revision:3,name:'N',title:'T',description:'D',checklist:[{title:'a'}]});
});
test('ordinary board including one member requires explicit visibility acknowledgement',()=>{
 const t={id:3,revision:8};assert.throws(()=>templateApply({id:1},4,t,false));
 assert.deepEqual(templateApply({id:1},4,t,true),{action:'card_from_template',list_id:4,template_id:3,expected_template_revision:8,ack_shared_content:true});
 assert.equal(templateApply({id:2,inbox_owner_id:7},4,t,false).ack_shared_content,false);
});
test('unknown writes cannot be replayed; explicit server rejection can be reviewed',()=>{
 assert.equal(unknownOutcome(new TypeError('network')),true);assert.equal(unknownOutcome({status:500}),true);assert.equal(unknownOutcome({status:409}),false);assert.equal(unknownOutcome({status:422}),false);
});
test('unknown outcome block survives reload and is account-scoped without content',()=>{
 const values=new Map(),storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 const a=templateUncertainty(1,storage);assert.equal(a.blocked(),false);a.mark();assert.equal(templateUncertainty(1,storage).blocked(),true);assert.equal(templateUncertainty(2,storage).blocked(),false);assert.equal([...values.values()].join(''),'unknown');a.clear();assert.equal(templateUncertainty(1,storage).blocked(),false);
});
test('denied sessionStorage getter retains a working memory-only safety gate',()=>{
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'sessionStorage');Object.defineProperty(globalThis,'sessionStorage',{configurable:true,get(){throw new Error('denied')}});
 try{const gate=templateUncertainty(3);gate.mark();assert.equal(gate.blocked(),true);gate.clear();assert.equal(gate.blocked(),false)}finally{if(descriptor)Object.defineProperty(globalThis,'sessionStorage',descriptor);else delete globalThis.sessionStorage}
});
