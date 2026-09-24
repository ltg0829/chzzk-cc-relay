const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const server = http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200, {'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify({ok:true, rooms:rooms.size, service:'CHZZK_CC Relay Prototype'})); return; }
  res.writeHead(200, {'Content-Type':'text/plain; charset=utf-8'}); res.end('CHZZK_CC Relay Prototype is running.');
});
const wss = new WebSocketServer({ server });
const rooms = new Map();
const HOST_GRACE_MS = 10000;
function normalizeRoomCode(v){return String(v||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6)}
function normalizeNickname(v){return String(v||'').trim().replace(/[<>]/g,'').slice(0,20)||'참가자'}
function makeRoomCode(){const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';let c;do{c=Array.from({length:6},()=>chars[Math.floor(Math.random()*chars.length)]).join('')}while(rooms.has(c));return c}
function send(ws,p){if(ws&&ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(p))}
function broadcastRoom(room,p){const s=JSON.stringify(p);for(const x of room.participants.values())if(x.ws.readyState===WebSocket.OPEN)x.ws.send(s)}
function roomState(room){return{type:'room_state',roomCode:room.code,hostId:room.hostId,participants:[...room.participants.values()].sort((a,b)=>a.joinSeq-b.joinSeq).map(p=>({participantId:p.id,nickname:p.nickname,joinSeq:p.joinSeq,connected:p.ws.readyState===WebSocket.OPEN,isHost:p.id===room.hostId}))}}
function assignHost(room){const h=room.participants.get(room.hostId);if(h&&h.ws.readyState===WebSocket.OPEN)return;const n=[...room.participants.values()].filter(p=>p.ws.readyState===WebSocket.OPEN).sort((a,b)=>a.joinSeq-b.joinSeq)[0];room.hostId=n?n.id:null}
function removeParticipant(ws){const room=ws.__room,id=ws.__participantId;if(!room||!id)return;const p=room.participants.get(id);if(!p||p.ws!==ws)return;const wasHost=room.hostId===id;clearTimeout(p.removalTimer);p.removalTimer=setTimeout(()=>{if(p.ws.readyState===WebSocket.OPEN)return;room.participants.delete(id);if(wasHost)assignHost(room);broadcastRoom(room,roomState(room));if(room.participants.size===0)rooms.delete(room.code)},HOST_GRACE_MS);broadcastRoom(room,roomState(room))}
function joinRoom(ws,room,id,nickname){const existing=room.participants.get(id);if(existing)clearTimeout(existing.removalTimer);const p=existing||{id,nickname,joinSeq:room.nextJoinSeq++,ws,removalTimer:null};p.nickname=nickname;p.ws=ws;room.participants.set(id,p);ws.__room=room;ws.__participantId=id;ws.__nickname=nickname;if(!room.hostId)room.hostId=id;send(ws,{type:'room_joined',roomCode:room.code,participantId:id,hostId:room.hostId,isHost:id===room.hostId});broadcastRoom(room,roomState(room))}
wss.on('connection',ws=>{ws.__room=null;ws.__participantId=null;ws.__nickname=null;send(ws,{type:'relay_ready',protocol:1});ws.on('message',(raw,isBinary)=>{if(isBinary)return;let m;try{m=JSON.parse(raw.toString())}catch{return}
if(m.type==='create_room'){const id=String(m.participantId||'').slice(0,80);if(!id)return send(ws,{type:'room_error',message:'참가자 ID가 없습니다.'});const room={code:makeRoomCode(),hostId:null,nextJoinSeq:1,participants:new Map()};rooms.set(room.code,room);joinRoom(ws,room,id,normalizeNickname(m.nickname));return}
if(m.type==='join_room'){const code=normalizeRoomCode(m.roomCode),room=rooms.get(code),id=String(m.participantId||'').slice(0,80);if(!room)return send(ws,{type:'room_error',message:'존재하지 않거나 종료된 방입니다.'});if(!id)return send(ws,{type:'room_error',message:'참가자 ID가 없습니다.'});joinRoom(ws,room,id,normalizeNickname(m.nickname));return}
if(m.type==='leave_room'){removeParticipant(ws);send(ws,{type:'room_left'});ws.__room=null;return}
if(m.type==='caption'){const room=ws.__room;if(!room||!room.participants.has(ws.__participantId))return;broadcastRoom(room,{...m,type:'caption',roomCode:room.code,participantId:ws.__participantId,speakerName:ws.__nickname||m.speakerName||'화자',serverReceivedAt:Date.now()});return}
if(m.type==='config'){const room=ws.__room;if(!room)return;broadcastRoom(room,{...m,roomCode:room.code,participantId:ws.__participantId})}});ws.on('close',()=>removeParticipant(ws));ws.on('error',()=>{})});
module.exports=server;
