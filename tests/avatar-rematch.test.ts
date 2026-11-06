import {test} from 'node:test';import assert from 'node:assert/strict';
import {makeApp} from '../src/server/app';import {hash} from '../src/server/rooms';import {guest,testConfig} from './helpers';
test('room avatar sync uses the caller account, stores only a safe image URL and denies non-members',async()=>{
 let requests=0;const {app,store,rooms}=await makeApp({config:testConfig({qqAppId:'app',qqAppKey:'key'}),fetch:async()=>{requests++;return new Response(JSON.stringify({ret:0,user_info:{nickname:'测试用户',headimgurl:'https://thirdqq.qlogo.cn/g?b=qq&k=test&s=100'}}));}});
 try{const a=await guest(app,'甲'),outsider=await guest(app,'外部'),session=hash(a.cookie.split('=')[1]!);store.setAuth(session,{openId:'only-A',accessToken:'never-share',expiresAt:Date.now()+3600000});const {room}=rooms.create(session,'甲','qq',false);
 assert.equal((await app.inject({method:'POST',url:'/api/rooms/'+room.id+'/avatar',headers:outsider,payload:{}})).statusCode,403);assert.equal(requests,0);
 const result=await app.inject({method:'POST',url:'/api/rooms/'+room.id+'/avatar',headers:a,payload:{}});assert.equal(result.statusCode,200);assert.equal(result.json().updated,true);const view=JSON.stringify(rooms.view(rooms.get(room.id),session));assert.ok(view.includes('thirdqq.qlogo.cn'));assert.ok(!view.includes('only-A')&&!view.includes('never-share'));
 }finally{await app.close();}
});
