import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
const origin='http://localhost:3000';
const directory='.wrangler/state/v3/d1/miniflare-D1DatabaseObject';
const files=fs.readdirSync(directory).filter(f=>f.endsWith('.sqlite')&&f!=='metadata.sqlite');
assert.equal(files.length,1,'Expected one local development database');
const db=new DatabaseSync(path.join(directory,files[0]));
db.exec('CREATE TABLE IF NOT EXISTS local_test_migrations (name TEXT PRIMARY KEY)');
for(const name of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())if(!db.prepare('SELECT name FROM local_test_migrations WHERE name=?').get(name)){db.exec(fs.readFileSync(path.join('drizzle',name),'utf8'));db.prepare('INSERT INTO local_test_migrations(name) VALUES (?)').run(name);}
const id='test-'+randomUUID(),other='test-'+randomUUID(),token=randomUUID(),guideId=randomUUID();
db.prepare('INSERT INTO users(id,name,email) VALUES (?,?,?)').run(id,'Test visitor','test@example.invalid');
db.prepare('INSERT INTO sessions(hash,user_id,expires) VALUES (?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+60000);
db.prepare('INSERT INTO guides(id,user_id,title,data,created,version,deleted) VALUES (?,?,?,?,?,1,0)').run(guideId,other,'Other user','{}',new Date().toISOString());
const headers={Cookie:`tf_session=${token}`,Origin:origin,'Content-Type':'application/json'};
try{
 await test('public config never returns keys',async()=>{const r=await fetch(origin+'/api/config');assert.equal(r.status,200);const c=await r.json();assert.equal(c.user,null);assert.ok(!JSON.stringify(c).includes('API_KEY'));});
 await test('anonymous cannot access history',async()=>{const r=await fetch(origin+'/api/history');assert.equal(r.status,401);});
 await test('cross-origin mutation rejected before session use',async()=>{const r=await fetch(origin+'/api/auth/logout',{method:'POST',headers:{...headers,Origin:'https://evil.example'}});assert.equal(r.status,403);});
 await test('history is scoped to authenticated user',async()=>{const r=await fetch(origin+'/api/history',{headers});assert.equal(r.status,200);assert.deepEqual(await r.json(),[]);});
 await test('other user record cannot be renamed or deleted',async()=>{const r=await fetch(origin+'/api/history/'+guideId,{method:'PATCH',headers,body:JSON.stringify({title:'stolen',version:1})});assert.equal(r.status,404);const d=await fetch(origin+'/api/history/'+guideId,{method:'DELETE',headers});assert.equal(d.status,200);assert.equal(db.prepare('SELECT deleted FROM guides WHERE id=?').get(guideId).deleted,0);});
 await test('stale title version returns conflict and delete cannot be resurrected',async()=>{db.prepare('UPDATE guides SET user_id=? WHERE id=?').run(id,guideId);const save=await fetch(origin+'/api/history/'+guideId,{method:'PATCH',headers,body:JSON.stringify({title:'我的作品',version:1})});assert.equal(save.status,200);const stale=await fetch(origin+'/api/history/'+guideId,{method:'PATCH',headers,body:JSON.stringify({title:'旧标题',version:1})});assert.equal(stale.status,409);await fetch(origin+'/api/history/'+guideId,{method:'DELETE',headers});const retry=await fetch(origin+'/api/history/'+guideId,{method:'PATCH',headers,body:JSON.stringify({title:'恢复',version:2})});assert.equal(retry.status,404);});
 await test('image proxy rejects arbitrary host',async()=>{const r=await fetch(origin+'/api/image?url='+encodeURIComponent('http://127.0.0.1/private'));assert.equal(r.status,400);});
 await test('image repair requires a session and same-origin requests',async()=>{const anonymous=await fetch(origin+'/api/history/'+guideId+'/image',{method:'POST',headers:{Origin:origin}});assert.equal(anonymous.status,401);const cross=await fetch(origin+'/api/history/'+guideId+'/image',{method:'POST',headers:{...headers,Origin:'https://evil.example'}});assert.equal(cross.status,403);});
 await test('deleted guide image cannot be repaired or resurrected',async()=>{const r=await fetch(origin+'/api/history/'+guideId+'/image',{method:'POST',headers});assert.equal(r.status,404);});
 await test('missing provider configuration never produces fake content',async(t)=>{const config=await (await fetch(origin+'/api/config')).json();if(config.generationReady){t.skip('Provider is configured; never spend credits in an API regression test.');return;}const r=await fetch(origin+'/api/jobs',{method:'POST',headers,body:JSON.stringify({id:randomUUID(),kind:'resolve',query:'维纳斯'})});assert.equal(r.status,503);});
 await test('logout invalidates session',async()=>{const r=await fetch(origin+'/api/auth/logout',{method:'POST',headers});assert.equal(r.status,200);const again=await fetch(origin+'/api/history',{headers});assert.equal(again.status,401);});
}finally{db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);db.prepare('DELETE FROM users WHERE id=?').run(id);db.prepare('DELETE FROM guides WHERE id=?').run(guideId);db.close();}
