/** End-to-end verification of the private test instance. Never prints credentials. */
import {readFileSync,writeFileSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import WebSocket from 'ws';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const state=JSON.parse(readFileSync(join(root,'artifacts/playtest/current.json'),'utf8'));
if(!state.active)throw new Error('No active test instance');
const url=state.url,password=readFileSync(join(state.runDir,'访问说明.txt'),'utf8').match(/测试口令：([^\r\n]+)/)?.[1];
if(!password)throw new Error('Private access instructions unavailable');
const check=(condition,message)=>{if(!condition)throw new Error(message)};
const sockets=[];const results={url,checkedAt:new Date().toISOString(),checks:[]};
const pass=message=>{results.checks.push(message);console.log(message)};
const request=(path,options={})=>fetch(url+path,{...options,signal:AbortSignal.timeout(15000),redirect:'manual'});
function cookies(response){return response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')}
async function client(name){
 const login=await request('/test-login',{method:'POST',headers:{origin:url,'content-type':'application/json'},body:JSON.stringify({password})});check(login.status===200,'Test password login failed');
 const firstCookie=cookies(login);const session=await request('/api/session',{headers:{cookie:firstCookie}});check(session.status===200,'Guest session failed');const sessionInfo=await session.json();check(sessionInfo.qqAuthorized===false,'Unexpected inherited QQ authorization');
 const cookie=firstCookie+'; '+cookies(session);
 const apiResponse=(path,body)=>request('/api'+path,{method:body===undefined?'GET':'POST',headers:{cookie,origin:url,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const api=async(path,body)=>{const response=await apiResponse(path,body);check(response.status===200,`Game API failed: ${path.split('?')[0]} (${response.status})`);return response.json()};
 await api('/session',{name});return {cookie,api,apiResponse};
}
function connect(id,cookie){return new Promise((accept,reject)=>{
 const socket=new WebSocket(url.replace('https:','wss:')+`/api/rooms/${id}/socket`,{origin:url,headers:{cookie}});sockets.push(socket);
 const timer=setTimeout(()=>{socket.terminate();reject(new Error('Public WebSocket timeout'))},15000);
 socket.once('error',()=>{clearTimeout(timer);reject(new Error('Public WebSocket handshake failed'))});
 socket.once('message',data=>{clearTimeout(timer);accept({socket,view:JSON.parse(data.toString()).room})});
})}
try{
 check((await request('/api/health')).status===401,'Health leaked through unauthenticated gate');
 const entry=await request('/');check(entry.status===401&&(await entry.text()).includes('乐友测试入口'),'Password entry page unavailable');
 for(const path of ['/.env','/api/admin/status','/lab','/artifacts/playtest/current.json'])check((await request(path)).status===404,'Private route was exposed');
 pass('Unauthenticated HTTP and private routes are blocked');
 const a=await client('链路验证甲'),b=await client('链路验证乙');pass('Two independent password logins and guest sessions work, without inherited QQ authorization');
 const created=await a.api('/rooms',{mode:'fixture',bot:false}),id=created.room.id;
 let room=(await b.api(`/rooms/${id}/join`,{invite:created.invite})).room;
 room=(await a.api(`/rooms/${id}/song`,{songId:'wish',version:room.version})).room;
 room=(await b.api(`/rooms/${id}/song`,{songId:'coral',version:room.version})).room;
 room=(await a.api(`/rooms/${id}/start`,{version:room.version})).room;
 const [wa,wb]=await Promise.all([connect(id,a.cookie),connect(id,b.cookie)]);
 check(wa.view.me==='a'&&wb.view.me==='b','WebSocket seat isolation failed');
 check(!JSON.stringify(wa.view).includes('珊瑚海')&&!JSON.stringify(wb.view).includes('愿与愁'),'Hidden song leaked');
 pass('Public WSS, invitation, selection, start and per-player hidden views work');
 for(const player of [a,b]) {const own=(await player.api('/rooms/'+id)).room;room=(await player.api('/rooms/'+id+'/action',{id:randomUUID(),version:own.version,action:{type:'chooseEvent',eventId:own.game.stageEvent.options[0].id}})).room;}
 pass('Both players select private no-effect phase placeholders');
 room=(await a.api(`/rooms/${id}/action`,{id:randomUUID(),version:room.version,action:{type:'endTurn'}})).room;
 const command={id:randomUUID(),version:room.version,action:{type:'guess',answer:{title:'愿与愁'}}};
 const finished=await b.api(`/rooms/${id}/action`,command);check(finished.room.game.outcome.winner==='b','Guest match did not finish');
 check((await b.api(`/rooms/${id}/action`,command)).replayed===true,'Command retry was not deduplicated');pass('Remote guest match finishes and command retries are deduplicated');
 const search=await a.api('/music/search?mode=qq&q='+encodeURIComponent('晴天'));
 check(search.provider==='qq'&&search.songs.some(s=>s.title==='晴天'),'Official anonymous search unavailable');
 const actual=search.songs.find(s=>s.providerMid==='0039MnYb0qxYhV')||search.songs.find(s=>s.title==='晴天');
 const qqRoom=await a.api('/rooms',{mode:'qq',bot:false});
 const selectedResponse=await a.apiResponse('/rooms/'+qqRoom.room.id+'/song',{songId:actual.id,version:0});
 const selected=await selectedResponse.json();
 if(selectedResponse.status===200){check(selected.room.ownSong?.provider==='qq','Official selection failed');pass('Official anonymous selection with preview metadata succeeds');}
 else {check(selectedResponse.status===403&&selected.error?.code==='PREVIEW_REQUIRED','Unexpected official selection failure');pass('Missing anonymous preview correctly blocks selection; authorization still needs a separate check');}
 results.ok=true;writeFileSync(join(state.runDir,'verification.json'),JSON.stringify(results,null,2));
 console.log('Protected public playtest verification passed');
}catch(error){results.ok=false;results.error=error.message;writeFileSync(join(state.runDir,'verification.json'),JSON.stringify(results,null,2));console.log('Verification incomplete: '+error.message);process.exitCode=1}
finally{for(const socket of sockets)socket.terminate()}
