const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");
const path = require("path");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));

const rooms = new Map();
const alphabet="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function code(){
  let c="";
  do { c=Array.from({length:5},()=>alphabet[Math.floor(Math.random()*alphabet.length)]).join(""); }
  while(rooms.has(c));
  return c;
}
function send(ws,msg){ if(ws && ws.readyState===1) ws.send(JSON.stringify(msg)); }
function broadcast(room,msg,except=null){
  for(const p of room.players.values()) if(p.ws!==except) send(p.ws,msg);
}
function publicRoom(room){
  return {
    code:room.code, host:room.host,
    phase:room.phase, round:room.round,
    players:[...room.players.values()].map(p=>({
      id:p.id,name:p.name,avatar:p.avatar,role:p.role,stats:p.stats,
      ready:p.ready,score:p.score,alive:p.alive,last:p.last
    }))
  };
}
function cleanPlayer(p){ return {id:p.id,name:p.name,avatar:p.avatar,role:p.role,stats:p.stats,ready:p.ready,score:p.score,alive:p.alive,last:p.last}; }

wss.on("connection",(ws)=>{
  ws.id = Math.random().toString(36).slice(2,10);

  ws.on("message",(raw)=>{
    let m; try{m=JSON.parse(raw)}catch{return}
    if(m.type==="create"){
      const room={code:code(),host:ws.id,phase:"lobby",round:0,game:null,players:new Map()};
      rooms.set(room.code,room);
      const p={id:ws.id,ws,name:m.name||"מארח",avatar:m.avatar||{},role:m.role||"",stats:m.stats||{},ready:true,score:0,alive:true,last:0};
      room.players.set(ws.id,p); ws.room=room.code;
      send(ws,{type:"created",room:publicRoom(room),host:true});
      return;
    }
    if(m.type==="join"){
      const room=rooms.get(String(m.code||"").toUpperCase());
      if(!room){send(ws,{type:"error",message:"החדר לא נמצא"});return}
      if(room.players.size>=10){send(ws,{type:"error",message:"החדר מלא"});return}
      if(room.phase!=="lobby"){send(ws,{type:"error",message:"המשחק כבר התחיל"});return}
      const p={id:ws.id,ws,name:m.name||"שחקן",avatar:m.avatar||{},role:m.role||"",stats:m.stats||{},ready:false,score:0,alive:true,last:0};
      room.players.set(ws.id,p);ws.room=room.code;
      send(ws,{type:"joined",room:publicRoom(room),host:false});
      broadcast(room,{type:"room",room:publicRoom(room)},ws);
      return;
    }
    const room=rooms.get(ws.room); if(!room)return;
    const me=room.players.get(ws.id); if(!me)return;

    if(m.type==="ready"){
      me.ready=!!m.ready;
      broadcast(room,{type:"room",room:publicRoom(room)});
    }
    if(m.type==="start" && room.host===ws.id){
      if(room.players.size<2)return send(ws,{type:"error",message:"צריך לפחות 2 שחקנים"});
      if([...room.players.values()].some(p=>!p.ready))return send(ws,{type:"error",message:"לא כולם מוכנים"});
      room.phase="game";room.round=1;room.game=m.game;
      for(const p of room.players.values()){p.score=0;p.alive=true;p.last=0}
      broadcast(room,{type:"start",room:publicRoom(room),game:m.game});
    }
    if(m.type==="answer"){
      // relay individual answers to the server/host logic; the client calculates simple mini-games.
      broadcast(room,{type:"playerAnswer",id:ws.id,answer:m.answer,at:Date.now()},ws);
    }
    if(m.type==="score"){
      me.score+=Number(m.points)||0;me.last=Number(m.points)||0;
      broadcast(room,{type:"room",room:publicRoom(room)});
    }
    if(m.type==="next" && room.host===ws.id){
      const alive=[...room.players.values()].filter(p=>p.alive);
      if(alive.length<=1){
        room.phase="lobby"; room.round=0;
        broadcast(room,{type:"winner",room:publicRoom(room),winner:alive[0]?.name||""});
      }else{
        const lowest=alive.sort((a,b)=>a.score-b.score)[0];
        lowest.alive=false;
        room.round++;
        room.game=m.game;
        broadcast(room,{type:"eliminate",room:publicRoom(room),eliminated:lowest.name});
        setTimeout(()=>broadcast(room,{type:"start",room:publicRoom(room),game:m.game}),500);
      }
    }
  });

  ws.on("close",()=>{
    const room=rooms.get(ws.room);if(!room)return;
    room.players.delete(ws.id);
    if(room.host===ws.id){
      const next=room.players.values().next().value;
      if(next){room.host=next.id;send(next.ws,{type:"promoted"});}
      else {rooms.delete(room.code);return}
    }
    broadcast(room,{type:"room",room:publicRoom(room)});
  });
});

server.listen(PORT,()=>console.log(`CHAOSCREW online on port ${PORT}`));
