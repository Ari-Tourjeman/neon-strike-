import * as THREE from './three.module.js';

const $=id=>document.getElementById(id), mobile=matchMedia('(hover:none) and (pointer:coarse)').matches;
const canvas=$('game'), renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,mobile?1.65:2));renderer.setSize(innerWidth,innerHeight);
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.38;
const scene=new THREE.Scene();scene.background=new THREE.Color(0x07151e);scene.fog=new THREE.FogExp2(0x0a2029,.017);
const camera=new THREE.PerspectiveCamera(74,innerWidth/innerHeight,.05,180);camera.rotation.order='YXZ';
scene.add(new THREE.HemisphereLight(0x7ed0ec,0x18312c,2.15));
const moon=new THREE.DirectionalLight(0x9bc7f5,2.3);moon.position.set(-22,38,-24);moon.castShadow=true;moon.shadow.mapSize.set(mobile?1024:2048,mobile?1024:2048);moon.shadow.camera.left=-68;moon.shadow.camera.right=68;moon.shadow.camera.top=68;moon.shadow.camera.bottom=-68;moon.shadow.bias=-.0005;scene.add(moon);
const mat=(color,roughness=.75,metalness=.1)=>new THREE.MeshStandardMaterial({color,roughness,metalness});
const dark=mat(0x192b32), concrete=mat(0x435359), steel=mat(0x172b36,.4,.76), trim=mat(0x788b8d,.35,.5), asphalt=mat(0x26363d), neonC= new THREE.MeshBasicMaterial({color:0x19e4e1}), neonP=new THREE.MeshBasicMaterial({color:0xff4c92});
const obstacles=[], surfaces=[], worldMeshes=[], enemies=[], effects=[], lights=[];let running=false,dead=false,wave=1,kills=0,health=100,ammo=30,reloading=false,lastShot=0,stageTimer=0,elapsed=0,shake=0,flash=0,toastTimer=0,enemyId=0;
let mode='solo',peer=null,conn=null,roomCode='',remote=null,remoteState=null,netClock=0,joined=false;
const send=data=>{if(conn?.open)conn.send(data)};
function roomInfo(message){$('roomInfo').textContent=message;$('netStatus').textContent=mode==='solo'?'':message}
function makeRemote(){if(remote)return;remote=new THREE.Group();const armor=mat(0x276c75,.45,.54),visor=new THREE.MeshBasicMaterial({color:0x42f7e6});
  const body=new THREE.Mesh(new THREE.BoxGeometry(.75,.9,.43),armor);body.position.y=1.16;remote.add(body);
  const head=new THREE.Mesh(new THREE.BoxGeometry(.49,.46,.43),armor);head.position.y=1.91;remote.add(head);
  const face=new THREE.Mesh(new THREE.BoxGeometry(.4,.13,.035),visor);face.position.set(0,1.94,.24);remote.add(face);
  for(const s of [-1,1]){const limb=new THREE.Mesh(new THREE.BoxGeometry(.22,.7,.25),armor);limb.position.set(s*.49,1.12,0);remote.add(limb);const leg=new THREE.Mesh(new THREE.BoxGeometry(.25,.77,.29),armor);leg.position.set(s*.2,.39,0);remote.add(leg)}scene.add(remote)}
function removeRemote(){if(remote){scene.remove(remote);remote=null}remoteState=null}
function disconnectRoom(){const old=conn;conn=null;joined=false;old?.close();peer?.destroy();peer=null;removeRemote();roomCode='';$('hostCode').value='';roomInfo('בחר מצב משחק.')}
function roomError(message){roomInfo(message);$('start').disabled=false}
function bindConnection(c){conn=c;c.on('open',()=>{joined=true;makeRemote();roomInfo('השחקן השני מחובר');send({t:'hello',weapon:selectedWeapon});if(mode==='join'){start();send({t:'ready'})}else sendSnapshot()});
  c.on('data',data=>{if(!data||typeof data!=='object')return;
    if(data.t==='state'&&Number.isFinite(data.x)&&Number.isFinite(data.y)&&Number.isFinite(data.z)&&Math.abs(data.x)<100&&Math.abs(data.z)<100){remoteState=data;makeRemote()}
    if(data.t==='snapshot'&&mode==='join'){wave=data.wave;kills=data.kills;const ids=new Set();for(const item of data.enemies||[]){if(!Number.isFinite(item.id)||!Number.isFinite(item.x)||!Number.isFinite(item.z))continue;ids.add(item.id);let e=enemies.find(e=>e.id===item.id);if(!e)e=makeEnemy(item.x,item.z,item.id);e.group.position.set(item.x,item.y,item.z);e.hp=item.hp}for(const e of [...enemies])if(!ids.has(e.id)){scene.remove(e.group);enemies.splice(enemies.indexOf(e),1)}updateHud()}
    if(data.t==='droneHit'&&mode==='host'&&Number.isFinite(data.id))hitEnemy(enemies.find(e=>e.id===data.id),Math.min(3,Math.max(0,Number(data.damage)||0)),true);
    if(data.t==='damage'&&mode==='join')takeDamage(Math.min(25,Math.max(0,Number(data.amount)||0)));
    if(data.t==='hello'&&mode==='host')sendSnapshot();
  });c.on('close',()=>{if(conn!==c)return;conn=null;joined=false;removeRemote();roomInfo(mode==='host'?'השחקן התנתק · החדר עדיין פתוח':'החיבור נותק · חזור ללובי כדי להצטרף מחדש');if(mode==='join'){mode='solo';roomInfo('החיבור נותק · ממשיך לבד')} });c.on('error',()=>roomError('החיבור נכשל. בדוק את קוד החדר.'))}
function setupPeer(){if(!window.Peer){roomError('שירות החדרים לא נטען. בדוק חיבור לאינטרנט.');return false}return true}
function hostRoom(){disconnectRoom();mode='host';if(!setupPeer())return;roomCode=Array.from(crypto.getRandomValues(new Uint8Array(6)),n=>'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[n%32]).join('');$('hostCode').value=roomCode;roomInfo('פותח חדר...');peer=new Peer('neonstrike-'+roomCode);peer.on('open',()=>roomInfo('קוד החדר: '+roomCode+' · שתף עם חבר'));peer.on('connection',c=>{if(conn?.open){c.on('open',()=>c.close());return}bindConnection(c)});peer.on('error',e=>roomError(e.type==='unavailable-id'?'הקוד תפוס. צור חדר מחדש.':'לא ניתן לפתוח חדר כרגע.'))}
function joinRoom(){if(!setupPeer())return;const code=$('joinCode').value.trim().toUpperCase();if(!/^[A-HJ-NP-Z2-9]{6}$/.test(code)){roomError('יש להזין קוד חדר בן 6 תווים.');return}disconnectRoom();mode='join';roomCode=code;roomInfo('מתחבר לחדר '+code+'...');$('start').disabled=true;peer=new Peer();peer.on('open',()=>{const c=peer.connect('neonstrike-'+code,{reliable:true});bindConnection(c);setTimeout(()=>{if(!c.open&&conn===c)roomError('החדר לא זמין. בדוק את הקוד ונסה שוב.')},12000)});peer.on('error',()=>roomError('החיבור נכשל. בדוק את קוד החדר.'))}
function sendSnapshot(){if(mode==='host'&&conn?.open)send({t:'snapshot',wave,kills,enemies:enemies.map(e=>({id:e.id,x:e.group.position.x,y:e.group.position.y,z:e.group.position.z,hp:e.hp}))})}
function takeDamage(amount){if(!running||dead)return;health=Math.max(0,health-amount);$('damage').style.opacity=.7;setTimeout(()=>$('damage').style.opacity=0,240);updateHud();if(health<=0)end()}
const weapons={rifle:{name:'VX-7 / AUTO',mag:30,delay:100,damage:1,reload:1350},smg:{name:'RAPID-9 / SMG',mag:42,delay:65,damage:.72,reload:1600},marksman:{name:'MK-12 / DMR',mag:12,delay:390,damage:2.5,reload:1850}};let selectedWeapon='rifle';const spec=()=>weapons[selectedWeapon];
const player=new THREE.Vector3(0,1.65,14),horizontalVelocity=new THREE.Vector3();let yaw=0,pitch=0,walkPhase=0,shotHeld=false,sprinting=false,move={x:0,y:0},aimPointer=null,movePointer=null,lastAim={x:0,y:0},vy=0,grounded=true;const keys={};
function tiledBoxGeometry(w,h,d){const geometry=new THREE.BoxGeometry(w,h,d),uv=geometry.getAttribute('uv'),faceSizes=[[d,h],[d,h],[w,d],[w,d],[w,h],[w,h]];
  for(let face=0;face<6;face++)for(let vertex=0;vertex<4;vertex++){const i=face*4+vertex;uv.setXY(i,uv.getX(i)*faceSizes[face][0]/2,uv.getY(i)*faceSizes[face][1]/2)}uv.needsUpdate=true;return geometry}
const box=(w,h,d,m,x,y,z,cast=true)=>{const g=(m===concrete||m===asphalt)?tiledBoxGeometry(w,h,d):new THREE.BoxGeometry(w,h,d);const o=new THREE.Mesh(g,m);o.position.set(x,y,z);o.castShadow=cast;o.receiveShadow=true;scene.add(o);return o};
const cyl=(r,h,m,x,y,z)=>{const o=new THREE.Mesh(new THREE.CylinderGeometry(r,r,h,10),m);o.position.set(x,y,z);o.castShadow=true;o.receiveShadow=true;scene.add(o);return o};
function glow(x,y,z,color,intensity=12,range=13){const l=new THREE.PointLight(color,intensity,range,2);l.position.set(x,y,z);scene.add(l);lights.push(l);return l}
function solid(x,z,w,d,h,y=0){obstacles.push({x,z,w,d,h,y})}
function structure(w,h,d,m,x,y,z){const o=box(w,h,d,m,x,y,z);solid(x,z,w,d,h,y-h/2);worldMeshes.push(o);return o}
function platform(w,d,m,x,y,z){const o=box(w,.22,d,m,x,y-.11,z);surfaces.push({x,z,w,d,y});worldMeshes.push(o);return o}
function groundAt(x,z,feet,maxStep=.65){let level=0;for(const s of surfaces)if(Math.abs(x-s.x)<s.w/2+.31&&Math.abs(z-s.z)<s.d/2+.31&&s.y<=feet+maxStep&&s.y>level)level=s.y;return level}
function collision(x,z,r=.43,feet=player.y-1.65){if(Math.abs(x)>53||Math.abs(z)>53)return true;return obstacles.some(o=>Math.abs(x-o.x)<o.w/2+r&&Math.abs(z-o.z)<o.d/2+r&&feet<o.y+o.h-.05&&feet+1.72>o.y+.05)}
// Layered asphalt, curb cuts and worn lane markings.
box(118,.3,118,asphalt,0,-.18,0,false);for(let i=-5;i<=5;i++){box(.08,.008,118,mat(i%2?0x24343b:0x2a3b43),i*10,.005,0,false);box(118,.008,.08,mat(0x293940),0,.006,i*10,false)}
const dash=mat(0x718584);for(let z=-42;z<48;z+=8){box(.16,.012,3,dash,-17,.012,z,false);box(.16,.012,3,dash,17,.012,z,false)}
for(let x=-56;x<=56;x+=8){box(.18,.018,1.7,dash,x,.012,-16,false);box(.18,.018,1.7,dash,x,.012,16,false)}
for(const s of [-1,1]){box(118,.36,3,concrete,0,.02,s*55);box(3,.36,118,concrete,s*55,.02,0);solid(0,s*55,118,3,1);solid(s*55,0,3,118,1)}
// Neon skyline and far windows.
const seed=(n)=>{let t=n;return()=>((t=(t*1664525+1013904223)>>>0)/4294967296)};const rnd=seed(891732);
function weatherTexture(base,variation,repeat){const c=document.createElement('canvas');c.width=c.height=256;const ctx=c.getContext('2d'),im=ctx.createImageData(256,256),rand=seed(base*39+7);
  for(let y=0;y<256;y++)for(let x=0;x<256;x++){const p=(y*256+x)*4,g=(rand()-.5)*variation+Math.sin(x*.27+y*.12)*2+Math.sin(y*.91)*1.5;im.data[p]=Math.max(0,base+g);im.data[p+1]=Math.max(0,base+g+4);im.data[p+2]=Math.max(0,base+g+6);im.data[p+3]=255}
  ctx.putImageData(im,0,0);ctx.strokeStyle='rgba(7,12,16,.19)';ctx.lineWidth=1;for(let i=0;i<26;i++){let x=rand()*256,y=rand()*256;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+rand()*25-12,y+rand()*40-20);ctx.stroke()}
  const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(repeat,repeat);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=Math.min(renderer.capabilities.getMaxAnisotropy(),8);return t
}
asphalt.map=weatherTexture(92,45,1);asphalt.color.setHex(0xffffff);asphalt.roughness=.87;asphalt.needsUpdate=true;
concrete.map=weatherTexture(137,50,1);concrete.color.setHex(0xbac4c2);concrete.roughness=.94;concrete.needsUpdate=true;
dark.map=weatherTexture(91,34,2);dark.color.setHex(0x9aaab0);dark.needsUpdate=true;
// Photographed CC0 PBR maps. Procedural materials above remain visible while assets load.
const loader=new THREE.TextureLoader();
function photoMap(path,color=false){return loader.load('./assets/'+path,t=>{t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=Math.min(renderer.capabilities.getMaxAnisotropy(),8);if(color)t.colorSpace=THREE.SRGBColorSpace;t.needsUpdate=true})}
function installMaps(material,name){const color=photoMap(name+'_color.jpg',true),normal=photoMap(name+'_normal.jpg'),rough=photoMap(name+'_rough.jpg');
  for(const t of [color,normal,rough]){t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=Math.min(renderer.capabilities.getMaxAnisotropy(),8)}
  material.map=color;material.normalMap=normal;material.normalScale.set(.35,.35);material.roughnessMap=rough;material.color.setHex(0xffffff);material.roughness=1;material.needsUpdate=true
}
installMaps(asphalt,'asphalt');installMaps(concrete,'concrete');
// Glossy patches catch the street lights without adding expensive real-time reflections.
for(let i=0;i<20;i++){const x=(rnd()-.5)*95,z=(rnd()-.5)*95,w=.7+rnd()*2.7,d=.6+rnd()*2.3;
  const puddle=new THREE.Mesh(new THREE.PlaneGeometry(w,d),new THREE.MeshPhysicalMaterial({color:0x172d35,metalness:.38,roughness:.12,clearcoat:1,clearcoatRoughness:.08,transparent:true,opacity:.63,depthWrite:false}));puddle.rotation.x=-Math.PI/2;puddle.rotation.z=rnd()*6.28;puddle.position.set(x,.025,z);scene.add(puddle)
}
const skylineWindows=[[],[]];for(let i=0;i<50;i++){const a=i/50*Math.PI*2,r=70+rnd()*38,x=Math.cos(a)*r,z=Math.sin(a)*r,w=7+rnd()*13,h=13+rnd()*46,d=7+rnd()*13;
  box(w,h,d,mat(new THREE.Color().setHSL(.55,.15,.08+rnd()*.09)),x,h/2-.1,z,false);
  for(let y=4;y<h-1;y+=3.5)for(let u=-w/2+1.4;u<w/2-1;u+=2.4){if(rnd()>.56)skylineWindows[rnd()>.85?0:1].push(new THREE.Vector3(x+u,y,z+d/2+.04))}
}
for(let i=0;i<2;i++){const positions=skylineWindows[i],o=new THREE.InstancedMesh(new THREE.BoxGeometry(.65,1,.03),new THREE.MeshBasicMaterial({color:i?0x718f9a:0x27cad2}),positions.length),m=new THREE.Matrix4();positions.forEach((p,j)=>o.setMatrixAt(j,m.makeTranslation(p.x,p.y,p.z)));o.instanceMatrix.needsUpdate=true;scene.add(o)}
// Warehouse blocks, container stacks, lamps and piping create cover and depth.
function warehouse(x,z,w,d,h,accent){const front=z<0?1:-1,wall=.45,door=4;
  // Four separate walls with a real entrance, interior, stairwell and walkable roof.
  structure(w,h,wall,concrete,x,h/2,z-front*d/2);
  for(const s of [-1,1]){structure(w/2-door/2,h,wall,concrete,x+s*(w+door)/4,h/2,z+front*d/2);structure(wall,h,d,concrete,x+s*w/2,h/2,z)}
  structure(door,h-3.3,wall,concrete,x,3.3+(h-3.3)/2,z+front*d/2);
  box(w-.9,.06,d-.9,mat(0x35434a,.91),x,.035,z,false);
  // Roof opening above the final steps. The other roof sections are solid floors.
  const stairX=x-w/2+2.25,stairW=3.5,roofW=w-stairW-.6;
  platform(roofW,d-.8,steel,x+stairW/2,h,z);
  const openDepth=3.2,roofD=d-.8-openDepth;
  platform(stairW,roofD,steel,stairX,h,z+front*openDepth/2);
  const count=Math.ceil(h/.48),run=d-3,stepDepth=run/count;
  for(let i=0;i<count;i++){const height=h*(i+1)/count,sz=z+front*(d/2-1.5-(i+.5)*stepDepth);
    const mesh=box(stairW,height,stepDepth+.015,concrete,stairX,height/2,sz);worldMeshes.push(mesh);
    surfaces.push({x:stairX,z:sz,w:stairW,d:stepDepth+.02,y:height});
    if(i%4===0)box(stairW,.035,.055,trim,stairX,height+.03,sz+front*stepDepth/2,false)
  }
  // Roof parapet and a few props inside; the entrance itself remains clear.
  for(const s of [-1,1])structure(.25,.8,d,steel,x+s*(w/2-.18),h+.4,z);
  structure(w,.8,.25,steel,x,h+.4,z-front*(d/2-.18));
  structure(w-stairW-.5,.8,.25,steel,x+stairW/2,h+.4,z+front*(d/2-.18));
  structure(2,1.3,2,steel,x+w/4,.65,z-front*d/4);
  for(let u=-w/2+3;u<w/2-1;u+=3){box(1.05,1.35,.09,mat(0x36545c,.27,.6),x+u,h-2,z+front*d/2+front*.05);box(.85,.05,.09,accent,x+u,h-2.8,z+front*d/2+front*.12)}
  box(w,.09,.12,accent,x,h-.65,z+front*d/2+front*.12);glow(x,h-1,z+front*d/2+front*.4,accent===neonC?0x8bdfd8:0xd487a4,5,12);
  glow(x,3,z,0xd7e1d7,5,11);box(2,.08,.5,mat(0xd5ddd2),x,5,z,false)
}
warehouse(-34,-34,22,16,11,neonC);warehouse(34,-31,20,19,14,neonP);warehouse(-36,32,18,21,12,neonP);warehouse(35,34,20,17,10,neonC);
function container(x,z,rot=0,color=0x37546a){const m=mat(color,.52,.55),g=new THREE.Group();g.position.set(x,0,z);g.rotation.y=rot;scene.add(g);const body=new THREE.Mesh(new THREE.BoxGeometry(8,3.2,3.5),m);body.position.y=1.6;body.castShadow=true;body.receiveShadow=true;g.add(body);
  worldMeshes.push(body);
  for(let u=-3.5;u<4;u+=.8){const rib=new THREE.Mesh(new THREE.BoxGeometry(.07,2.7,.05),trim);rib.position.set(u,1.6,1.78);g.add(rib);const back=rib.clone();back.position.z=-1.78;g.add(back)}
  for(const side of [-1,1]){const end=new THREE.Mesh(new THREE.BoxGeometry(.08,2.7,2.7),steel);end.position.set(side*4,1.6,0);g.add(end)}
  solid(x,z,rot?3.5:8,rot?8:3.5,3.2)
}
container(-21,-28,0,0x2c5962);container(19,-30,0,0x586047);container(-31,3,Math.PI/2,0x764841);container(30,2,Math.PI/2,0x325a6e);container(-18,30,0,0x685844);container(17,31,0,0x52616a);
function barrier(x,z,rot=0){const g=new THREE.Group();g.position.set(x,0,z);g.rotation.y=rot;scene.add(g);const b=new THREE.Mesh(new THREE.BoxGeometry(5,1.45,.7),concrete);b.position.y=.73;b.castShadow=true;b.receiveShadow=true;g.add(b);worldMeshes.push(b);const top=new THREE.Mesh(new THREE.BoxGeometry(5,.18,.85),trim);top.position.y=1.4;g.add(top);solid(x,z,rot?.7:5,rot?5:.7,1.45)}
for(const [x,z,r] of [[-9,-11,0],[9,-9,0],[-8,11,0],[9,12,0],[-42,-8,1],[43,12,1]])barrier(x,z,r?Math.PI/2:0);
for(const [x,z] of [[-47,-45],[48,-46],[-48,46],[48,47],[-15,-45],[15,46]]){cyl(.22,9,steel,x,4.5,z);box(1.5,.22,.8,trim,x,9,z);glow(x,8.4,z,0x4ae4de,16,19);box(.9,.07,.5,neonC,x,8.75,z)}
// Center beacon and environmental details.
cyl(3.8,.7,steel,0,.35,0);cyl(2.55,.65,trim,0,.95,0);cyl(1.9,4.5,dark,0,3.5,0);cyl(2.02,.16,neonC,0,3.1,0);cyl(2.02,.16,neonC,0,5.2,0);const beacon=glow(0,5.3,0,0x00e4ee,21,18);solid(0,0,6,6,5.5);
for(let i=0;i<35;i++){let x=(rnd()-.5)*94,z=(rnd()-.5)*94;if(Math.hypot(x,z)<9)continue;box(.4+rnd()*.7,.12,.35+rnd()*.8,mat(0x304148),x,.09,z)}
const decals=[];for(let i=0;i<24;i++){let x=(rnd()-.5)*85,z=(rnd()-.5)*85;const o=new THREE.Mesh(new THREE.PlaneGeometry(.6+rnd()*2,.8+rnd()*3),new THREE.MeshBasicMaterial({color:rnd()>.5?0x44a9a6:0x744a50,transparent:true,opacity:.14,depthWrite:false}));o.rotation.x=-Math.PI/2;o.rotation.z=rnd()*6.28;o.position.set(x,.017,z);scene.add(o);decals.push(o)}
// A detailed first-person weapon, mounted to the camera.
const gun=new THREE.Group();camera.add(gun);scene.add(camera);gun.position.set(.34,-.29,-.52);gun.rotation.set(-.035,-.04,.015);
const gm=mat(0x202f36,.32,.82),grip=mat(0x121b20,.93,.05),edge=mat(0x7d9ca0,.27,.75);
const part=(w,h,d,m,x,y,z)=>{const o=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);o.position.set(x,y,z);o.castShadow=true;gun.add(o);return o};
part(.18,.15,.9,gm,0,.02,-.25);part(.22,.09,.38,edge,0,.12,-.12);part(.19,.19,.45,gm,0,-.11,-.12);part(.11,.3,.18,grip,0,-.32,.13).rotation.x=-.25;part(.15,.28,.18,gm,0,-.3,-.25).rotation.x=.16;
part(.1,.1,.46,gm,0,.02,-.87);part(.14,.14,.13,edge,0,.02,-1.12);part(.045,.08,.15,edge,0,.16,-.88);part(.055,.08,.06,neonC,0,.2,-.67);part(.13,.05,.2,grip,0,.15,.15);part(.075,.03,.35,neonC,0,.135,-.37);
const muzzle=new THREE.PointLight(0xffbb74,0,5);muzzle.position.set(0,.02,-1.13);gun.add(muzzle);
const muzzleMesh=new THREE.Mesh(new THREE.SphereGeometry(.11,8,6),new THREE.MeshBasicMaterial({color:0xffd383,transparent:true,opacity:.8}));muzzleMesh.position.copy(muzzle.position);muzzleMesh.visible=false;gun.add(muzzleMesh);
// Armored training drones, deliberately stylized rather than humanoid.
const enemyBody=mat(0x5a6568,.35,.64),enemyDark=mat(0x182a31,.42,.8),enemyGlow=new THREE.MeshBasicMaterial({color:0xff6372});
function makeEnemy(x,z,id=++enemyId){const group=new THREE.Group();group.position.set(x,0,z);scene.add(group);
  const core=new THREE.Mesh(new THREE.IcosahedronGeometry(.77,1),enemyBody);core.position.y=1.55;core.castShadow=true;group.add(core);
  const shell=new THREE.Mesh(new THREE.BoxGeometry(1.3,.4,.6),enemyDark);shell.position.y=1.55;group.add(shell);
  const eye=new THREE.Mesh(new THREE.BoxGeometry(.42,.11,.07),enemyGlow);eye.position.set(0,1.62,.76);group.add(eye);
  for(let s of [-1,1]){const wing=new THREE.Mesh(new THREE.BoxGeometry(.9,.15,.4),enemyBody);wing.position.set(s*1.04,1.65,0);wing.rotation.z=s*.14;group.add(wing);const fan=new THREE.Mesh(new THREE.CylinderGeometry(.29,.29,.08,12),enemyDark);fan.position.set(s*1.28,1.72,0);group.add(fan);const ring=new THREE.Mesh(new THREE.TorusGeometry(.28,.04,6,14),enemyGlow);ring.rotation.x=Math.PI/2;ring.position.set(s*1.28,1.79,0);group.add(ring)}
  const light=new THREE.PointLight(0xff4255,3,5);light.position.set(0,1.7,.7);group.add(light);
  const e={id,group,core,eye,light,hp:wave>2?3:2,lastAttack:0,bob:rnd()*6.28,speed:2.4+rnd()*.9+wave*.14};enemies.push(e);return e
}
function clearEnemies(){for(const e of enemies)scene.remove(e.group);enemies.length=0}
function spawn(){for(let tries=0;tries<50;tries++){const a=rnd()*6.283,r=23+rnd()*23,x=player.x+Math.cos(a)*r,z=player.z+Math.sin(a)*r;if(!collision(x,z,2,0)&&Math.abs(x)<49&&Math.abs(z)<49){makeEnemy(x,z);return}}}
function updateHud(){ $('hpText').textContent=`${Math.ceil(health)} / 100`;$('hpBar').style.width=`${health}%`;$('ammo').textContent=ammo;$('weaponHud').textContent=spec().name;$('wave').textContent=String(wave).padStart(2,'0');$('kills').textContent=String(kills).padStart(2,'0');$('enemies').textContent=String(enemies.length).padStart(2,'0')}
function toast(msg){$('toast').textContent=msg;$('toast').style.opacity=1;toastTimer=2.1}
function burst(pos,color=0xff7983,n=8){for(let i=0;i<n;i++){const o=new THREE.Mesh(new THREE.BoxGeometry(.08,.08,.18),new THREE.MeshBasicMaterial({color,transparent:true,opacity:1}));o.position.copy(pos);scene.add(o);effects.push({mesh:o,v:new THREE.Vector3((rnd()-.5)*5,(rnd()-.5)*5,(rnd()-.5)*5),life:.55+rnd()*.4,max:1})}}
function tracer(from,to){const d=new THREE.Vector3().subVectors(to,from),o=new THREE.Mesh(new THREE.CylinderGeometry(.012,.012,d.length(),5),new THREE.MeshBasicMaterial({color:0xffd69c,transparent:true,opacity:.8}));o.position.copy(from).addScaledVector(d,.5);o.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize());scene.add(o);effects.push({mesh:o,life:.095,max:.095})}
function hitEnemy(e,damage,credit=false){if(!e||!damage)return;e.hp-=damage;burst(e.group.position.clone().add(new THREE.Vector3(0,1.5,0)),0xff8791,4);if(e.hp<=0){burst(e.group.position.clone().add(new THREE.Vector3(0,1.6,0)),0xff6177,17);scene.remove(e.group);enemies.splice(enemies.indexOf(e),1);kills++;updateHud();if(!enemies.length)stageTimer=2.4}if(credit)sendSnapshot()}
function shoot(){if(!running||dead||reloading)return;const now=performance.now();if(now-lastShot<spec().delay)return;if(!ammo){reload();return}lastShot=now;ammo--;updateHud();flash=.085;shake=.03+spec().damage*.013;
  const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(0,0),camera);ray.far=95;const targets=enemies.flatMap(e=>e.group.children.filter(c=>c.isMesh));const hit=ray.intersectObjects(targets,false)[0],wall=ray.intersectObjects(worldMeshes,false)[0];let end=ray.ray.at(75,new THREE.Vector3());
  if(wall)end=wall.point;
  if(hit&&(!wall||hit.distance<wall.distance)){end=hit.point;const e=enemies.find(e=>e.group.children.includes(hit.object));if(e){if(mode==='join'&&conn?.open)send({t:'droneHit',id:e.id,damage:spec().damage});else hitEnemy(e,spec().damage,true);burst(end,0xff8791,4);$('hit').style.opacity=1;setTimeout(()=>$('hit').style.opacity=0,100)}}
  const origin=new THREE.Vector3();gun.localToWorld(origin.copy(muzzle.position));tracer(origin,end);if(ammo===0)reload()
}
function reload(){if(!running||reloading||ammo===spec().mag)return;reloading=true;toast('טוען מחסנית...');setTimeout(()=>{if(running){ammo=spec().mag;updateHud()}reloading=false},spec().reload)}
function start(){running=true;dead=false;wave=1;kills=0;health=100;ammo=spec().mag;reloading=false;lastShot=0;stageTimer=0;elapsed=0;player.set(mode==='join'?3:0,1.65,14);horizontalVelocity.set(0,0,0);vy=0;grounded=true;yaw=0;pitch=0;clearEnemies();if(mode!=='join')for(let i=0;i<4;i++)spawn();updateHud();$('menu').style.display='none';$('hud').style.display='block';$('pause').style.display='block';if(mobile)$('controls').classList.add('active');else canvas.requestPointerLock?.();toast(mode==='solo'?'גל 01 // הישרדות':'מולטי פלייר // שיתוף פעולה');sendSnapshot()}
function end(){running=false;dead=true;shotHeld=false;document.exitPointerLock?.();$('menuTitle').textContent='המשימה הסתיימה';$('menuDesc').textContent=`הגעת לגל ${wave} וצברת ${kills} חיסולים. אפשר להיכנס שוב לזירה ולשבור את השיא.`;$('start').textContent='נסה שוב ←';$('menu').style.display='flex';$('controls').classList.remove('active');$('pause').style.display='none'}
function pause(){if(dead)return;running=!running;if(!running){shotHeld=false;document.exitPointerLock?.();$('menuTitle').textContent='המשחק מושהה';$('menuDesc').textContent=`גל ${wave} • ${kills} חיסולים. חזור לזירה והמשך בדיוק מאותה נקודה.`;$('start').textContent='המשך במשחק ←';$('menu').style.display='flex';$('controls').classList.remove('active');$('pause').style.display='none'}else{$('menu').style.display='none';$('pause').style.display='block';if(mobile)$('controls').classList.add('active');else canvas.requestPointerLock?.()}}
$('start').addEventListener('click',()=>{if(!dead&&wave&&$('menuTitle').textContent==='המשחק מושהה')pause();else if(mode==='join'&&!joined)joinRoom();else start()});$('pause').addEventListener('click',pause);
for(const b of document.querySelectorAll('.roomModes button'))b.addEventListener('click',()=>{const next=b.dataset.mode;if(mode!==next)disconnectRoom();mode=next;document.querySelectorAll('.roomModes button').forEach(x=>x.classList.toggle('selected',x===b));$('hostLine').hidden=next!=='host';$('joinLine').hidden=next!=='join';$('start').textContent=next==='join'?'הצטרף לחדר ←':'התחל במשחק ←';$('start').disabled=false;if(next==='host')hostRoom();else roomInfo(next==='join'?'הזן קוד שקיבלת מהמארח.':'בחר מצב משחק.')});
$('copyCode').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(roomCode);roomInfo('הקוד הועתק: '+roomCode)}catch{roomInfo('קוד החדר: '+roomCode)}});
for(const b of document.querySelectorAll('.weapon'))b.addEventListener('click',()=>{selectedWeapon=b.dataset.weapon;document.querySelectorAll('.weapon').forEach(x=>x.classList.toggle('selected',x===b));gun.scale.setScalar(selectedWeapon==='smg'?.82:selectedWeapon==='marksman'?1.17:1);gm.color.setHex(selectedWeapon==='smg'?0x364b55:selectedWeapon==='marksman'?0x6a6656:0x202f36);ammo=spec().mag;updateHud()});
function jump(){if(running&&grounded){vy=6.5;grounded=false}}
function look(dx,dy,scale=.0032){yaw-=dx*scale;pitch=Math.max(-1.38,Math.min(1.38,pitch-dy*scale))}
document.addEventListener('keydown',e=>{keys[e.code]=true;if(e.code==='KeyR')reload();if(e.code==='Escape'&&running)pause();if(e.code==='Space'&&running){e.preventDefault();jump()}});document.addEventListener('keyup',e=>{keys[e.code]=false});
document.addEventListener('mousemove',e=>{if(document.pointerLockElement===canvas&&running)look(e.movementX,e.movementY,.0024)});canvas.addEventListener('click',()=>{if(!mobile&&running){if(document.pointerLockElement!==canvas)canvas.requestPointerLock?.();else shoot()}});
document.addEventListener('mousedown',e=>{if(e.button===0&&document.pointerLockElement===canvas)shotHeld=true});document.addEventListener('mouseup',()=>shotHeld=false);
const stick=$('stick'),knob=$('knob');stick.addEventListener('pointerdown',e=>{movePointer=e.pointerId;stick.setPointerCapture(e.pointerId);stickMove(e)});stick.addEventListener('pointermove',e=>{if(movePointer===e.pointerId)stickMove(e)});function stickMove(e){const r=stick.getBoundingClientRect(),dx=e.clientX-(r.left+r.width/2),dy=e.clientY-(r.top+r.height/2),len=Math.max(1,Math.hypot(dx,dy)),k=Math.min(len,43)/len;move.x=dx*k/43;move.y=dy*k/43;knob.style.transform=`translate(${dx*k}px,${dy*k}px)`}
function stopStick(e){if(movePointer===e.pointerId){movePointer=null;move.x=move.y=0;knob.style.transform=''}}stick.addEventListener('pointerup',stopStick);stick.addEventListener('pointercancel',stopStick);
canvas.addEventListener('pointerdown',e=>{if(mobile&&running&&e.clientX>innerWidth*.35){aimPointer=e.pointerId;lastAim={x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId)}});canvas.addEventListener('pointermove',e=>{if(mobile&&aimPointer===e.pointerId){look(e.clientX-lastAim.x,e.clientY-lastAim.y,.005);lastAim={x:e.clientX,y:e.clientY}}});canvas.addEventListener('pointerup',e=>{if(aimPointer===e.pointerId)aimPointer=null});
$('fire').addEventListener('pointerdown',e=>{e.preventDefault();shotHeld=true;shoot();$('fire').setPointerCapture(e.pointerId)});for(const t of ['pointerup','pointercancel'])$('fire').addEventListener(t,()=>shotHeld=false);$('reload').addEventListener('pointerdown',e=>{e.preventDefault();reload()});$('sprint').addEventListener('pointerdown',e=>{sprinting=true;$('sprint').setPointerCapture(e.pointerId)});for(const t of ['pointerup','pointercancel'])$('sprint').addEventListener(t,()=>sprinting=false);
$('jump').addEventListener('pointerdown',e=>{e.preventDefault();jump()});
function update(dt){elapsed+=dt;camera.rotation.y=yaw;camera.rotation.x=pitch;
  let mx=move.x+(keys.KeyD||keys.ArrowRight?1:0)-(keys.KeyA||keys.ArrowLeft?1:0),my=-move.y+(keys.KeyW||keys.ArrowUp?1:0)-(keys.KeyS||keys.ArrowDown?1:0),len=Math.hypot(mx,my);if(len>1){mx/=len;my/=len}
  const speed=sprinting||keys.ShiftLeft?9.2:6.3,desiredX=(Math.cos(yaw)*mx-Math.sin(yaw)*my)*speed,desiredZ=(-Math.sin(yaw)*mx-Math.cos(yaw)*my)*speed;
  const response=1-Math.exp(-(grounded?12:4)*dt);horizontalVelocity.x+=(desiredX-horizontalVelocity.x)*response;horizontalVelocity.z+=(desiredZ-horizontalVelocity.z)*response;
  const dx=horizontalVelocity.x*dt,dz=horizontalVelocity.z*dt;
  let feet=player.y-1.65;
  const tryMove=(x,z)=>{const nextFloor=groundAt(x,z,feet);if(nextFloor>feet+.64)return false;if(collision(x,z,.43,Math.max(feet,nextFloor)))return false;return true};
  if(tryMove(player.x+dx,player.z))player.x+=dx;else horizontalVelocity.x=0;
  if(tryMove(player.x,player.z+dz))player.z+=dz;else horizontalVelocity.z=0;
  const floor=groundAt(player.x,player.z,feet);
  if(grounded&&floor>feet&&floor-feet<=.64){player.y=floor+1.65;feet=floor}
  vy-=16.5*dt;let nextFeet=feet+vy*dt;
  if(vy>0){for(const s of surfaces){if(Math.abs(player.x-s.x)<s.w/2-.15&&Math.abs(player.z-s.z)<s.d/2-.15&&feet+1.65<s.y-.1&&nextFeet+1.65>=s.y-.25){nextFeet=s.y-1.65-.25;vy=0}}}
  const landing=groundAt(player.x,player.z,Math.max(feet,nextFeet),.64);
  if(vy<=0&&nextFeet<=landing){const impact=-vy;nextFeet=landing;vy=0;grounded=true;if(impact>11){health=Math.max(0,health-Math.round((impact-11)*2));updateHud();if(health<=0)end()}}else grounded=false;
  player.y=nextFeet+1.65;
  walkPhase+=len*dt*11;camera.position.copy(player);camera.position.y+=len&&grounded?Math.sin(walkPhase)*.028:Math.sin(elapsed*1.8)*.006;
  gun.position.set(.34+Math.sin(walkPhase)*.009*len,-.29+Math.abs(Math.cos(walkPhase))*.014*len,-.52+Math.min(shake,.06));gun.rotation.x=-.035+shake*2;shake=Math.max(0,shake-dt*.3);
  if(flash>0){flash-=dt;muzzle.intensity=27;muzzleMesh.visible=true}else{muzzle.intensity=0;muzzleMesh.visible=false}
  if(shotHeld)shoot();
  for(const e of enemies){const p=e.group.position;let target=player,guest=false;if(mode==='host'&&remoteState?.health>0&&Math.hypot(remoteState.x-p.x,remoteState.z-p.z)<Math.hypot(player.x-p.x,player.z-p.z)){target=remoteState;guest=true}let dx=target.x-p.x,dz=target.z-p.z,d=Math.hypot(dx,dz);e.group.rotation.y=Math.atan2(dx,dz);
    if(mode!=='join'){e.group.position.y=Math.sin(elapsed*3+e.bob)*.19;
    if(d>3.5){const step=e.speed*dt;if(!collision(p.x+dx/d*step,p.z,1.2,0))p.x+=dx/d*step;if(!collision(p.x,p.z+dz/d*step,1.2,0))p.z+=dz/d*step}
    else if(Math.abs(target.y-1.65)<2.8&&elapsed-e.lastAttack>1.1){e.lastAttack=elapsed;const amount=8+wave*.8;if(guest)send({t:'damage',amount});else takeDamage(amount)}}
    e.core.rotation.y+=dt*1.2;e.light.intensity=2.8+Math.sin(elapsed*6+e.bob)*.8
  }
  if(mode!=='join'&&!enemies.length&&stageTimer>0){stageTimer-=dt;if(stageTimer<=0){wave++;health=Math.min(100,health+20);ammo=spec().mag;for(let i=0;i<Math.min(4+wave*2,14);i++)spawn();updateHud();toast(`גל ${String(wave).padStart(2,'0')} // היזהר!`)}}
  if(remote&&remoteState){remote.position.lerp(new THREE.Vector3(remoteState.x,remoteState.y-1.65,remoteState.z),Math.min(1,dt*12));remote.rotation.y=remoteState.yaw||0}
  if(conn?.open){netClock+=dt;if(netClock>.085){netClock=0;send({t:'state',x:player.x,y:player.y,z:player.z,yaw,health,weapon:selectedWeapon});sendSnapshot()}}
  for(let i=effects.length-1;i>=0;i--){const fx=effects[i];fx.life-=dt;if(fx.v){fx.mesh.position.addScaledVector(fx.v,dt);fx.v.y-=dt*4}fx.mesh.material.opacity=Math.max(0,fx.life/fx.max);if(fx.life<=0){scene.remove(fx.mesh);fx.mesh.geometry.dispose();fx.mesh.material.dispose();effects.splice(i,1)}}
  beacon.intensity=19+Math.sin(elapsed*2)*5;if(toastTimer>0){toastTimer-=dt;if(toastTimer<=0)$('toast').style.opacity=0}
}
let previous=performance.now();function frame(t){requestAnimationFrame(frame);const dt=Math.min((t-previous)/1000,.05);previous=t;if(running)update(dt);else{beacon.intensity=18+Math.sin(t*.002)*4}renderer.render(scene,camera)}requestAnimationFrame(frame);
function resize(){renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix()}addEventListener('resize',resize);
camera.position.copy(player);camera.rotation.y=yaw;
