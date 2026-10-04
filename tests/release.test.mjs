import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
test('release declares actual browser entry and exact rc.2 host integration peers',async()=>{
 const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
 assert.equal(pkg.exports['./client'],'./lib/client.js');assert.equal(pkg.dsh.client.platform,'web');
 const browser=await readFile(new URL('../lib/client.js',import.meta.url),'utf8');
 assert.ok(browser.includes('id: "dsh-agent-team-model-router"'));assert.ok(browser.includes('agentTeamDisplayNames'));
 assert.ok(browser.includes('const NS = "agent-team-model-router";'));
 assert.ok(!browser.includes('const NS = "agent-team";'));
 for(const [name,version] of Object.entries(pkg.peerDependencies))if(name.startsWith('@deepseek-ai/dsh-'))assert.equal(version,'0.2.0-rc.2');
});
