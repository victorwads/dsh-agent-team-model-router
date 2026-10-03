import test from 'node:test';
import assert from 'node:assert/strict';
import {displayNamesProjection as projection,normalizeDisplayName} from '../lib/display-names/state.js';
const receipt=(seq,id,value)=>({seq,type:'tool/ptc-dispatch',data:{name:'set_teammate_display_name',isError:false,content:[{type:'text',text:JSON.stringify({displayNames:{version:1,teamId:'lead',names:{}},aliasOperation:{memberId:id,value}})}]}});
test('PTC display alias operations merge, reset and exclude inherited/foreign receipts',()=>{
 let state=projection.init({id:'lead'},5);
 state=projection.apply(state,receipt(4,'old','inherited'));assert.deepEqual(state.names,{});
 state=projection.apply(state,receipt(5,'a','Admin'));state=projection.apply(state,receipt(6,'b','Revisão'));
 assert.deepEqual(state.names,{a:'Admin',b:'Revisão'});
 state=projection.apply(state,receipt(7,'a',null));assert.deepEqual(state.names,{b:'Revisão'});
 const foreign=receipt(8,'a','wrong');foreign.data.content[0].text=foreign.data.content[0].text.replace('"lead"','"other"');
 assert.equal(projection.apply(state,foreign),state);
});
test('display aliases normalize without allowing control/bidi injection',()=>{
 assert.equal(normalizeDisplayName('  ADMIN — Ágil  '),'ADMIN — Ágil');
 assert.throws(()=>normalizeDisplayName('bad\u202ename'),/without control/);
 assert.throws(()=>normalizeDisplayName('x'.repeat(121)),/1–120/);
});
