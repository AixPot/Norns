import test from 'node:test';import assert from 'node:assert/strict';import {lifetime} from '../src/attachment-life.mjs';
test('detached attachment work cannot publish or start PUT after init',()=>{const life=lifetime();assert.equal(life.current(),true);life.stop();assert.equal(life.current(),false)});
