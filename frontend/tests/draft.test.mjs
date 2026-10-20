import {test} from 'node:test';
import assert from 'node:assert/strict';
import {draftAfterFailure} from '../src/draft.mjs';
test('409 preserves exact user draft and pins original revision until explicit refresh',()=>{
 const draft={id:12,title:'我的未保存修改',description:'第二行\n草稿',revision:4};
 assert.deepEqual(draftAfterFailure(draft,409),draft);
});
