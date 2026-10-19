/* Public sample data only. This is a presentation, not authentication or payment processing. */
(()=>{
  const key='bliss-demo-v1',roleKey='bliss-demo-role';
  const date=new Date().toISOString().slice(0,10),month=date.slice(0,7);
  const uid=()=>crypto.randomUUID();
  const seed=()=>({
    residents:[{user_id:'sample-resident',name:'Aanya Shah',email:'aanya@example.com',room_number:'A-101',bed:1,sharing:'two-sharing',move_in:month+'-01',rent:8500,deposit:8500,active:true},
      {user_id:'sample-resident-2',name:'Diya Patel',email:'diya@example.com',room_number:'B-201',bed:1,sharing:'four-sharing',move_in:month+'-01',rent:6500,deposit:6500,active:true}],
    rooms:[{slug:'two-sharing',name:'Two sharing',rent:8500,photos:[]},{slug:'four-sharing',name:'Four sharing',rent:6500,photos:[]}],
    charges:[{id:'sample-charge',user_id:'sample-resident',name:'Aanya Shah',room_number:'A-101',month,amount:8500,due_date:month+'-05',status:'pending'},
      {id:'sample-charge-2',user_id:'sample-resident-2',name:'Diya Patel',room_number:'B-201',month,amount:6500,due_date:month+'-05',status:'under-review',reference:'DEMO-12345'}],
    complaints:[{id:'sample-request',user_id:'sample-resident',name:'Aanya Shah',room_number:'A-101',title:'Study light needs replacing',category:'Maintenance',description:'The light above the study desk is flickering.',status:'Acknowledged',admin_note:'A technician will visit tomorrow.',created_at:date}],
    notices:[{id:'sample-notice',title:'Welcome to Bliss',body:'This is a sample notice. Explore your room, rent history and requests using the demo.',author:'Bliss Demo Admin',created_at:date,archived:false}]
  });
  let db;
  try{db=JSON.parse(localStorage.getItem(key));}catch{}
  if(!db||!['residents','rooms','charges','complaints','notices'].every(k=>Array.isArray(db[k])))db=seed();
  let role=null;try{role=sessionStorage.getItem(roleKey);}catch{}
  const save=()=>{try{localStorage.setItem(key,JSON.stringify(db));}catch{throw new Error('Browser storage is full or unavailable. Reset the demo or try a smaller photo.');}};
  const user=()=>role==='admin'?{id:'sample-admin',name:'Bliss Demo Admin',email:'admin@example.com',role:'admin'}:role==='resident'&&db.residents[0]?.active?{id:db.residents[0].user_id,name:db.residents[0].name,email:db.residents[0].email,role:'resident'}:null;
  const enter=value=>{try{sessionStorage.setItem(roleKey,value);}catch{}location.href=value==='admin'?'/admin':'/resident';};
  const photo=async file=>{
    if(!(file instanceof File)||!file.size||!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('Choose a JPG, PNG or WebP demo image.');
    if(file.size>1024*1024)throw new Error('For this browser demo, choose an image up to 1 MB.');
    const url=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);});
    return {id:uid(),url,caption:'Sample room photo'};
  };
  async function request(path,data={},method='POST'){
    const result=await perform(path,data,method);return structuredClone(result);
  }
  async function perform(path,data={},method='POST'){
    if(path==='/api/rooms')return {rooms:db.rooms};
    if(path==='/api/me')return {user:user(),needsSetup:false};
    if(path==='/api/logout'){role=null;try{sessionStorage.removeItem(roleKey);}catch{}return {};}
    if(path==='/api/login'||path==='/api/setup'||path==='/api/accept-invite')throw new Error('Use Try admin or Try resident above. No real accounts are created.');
    const current=user();if(!current)throw new Error('Choose Try admin or Try resident above.');
    const admin=current.role==='admin',owner=row=>row.user_id===current.id;
    if(path==='/api/state')return {user:current,residents:admin?db.residents:[],stay:admin?null:db.residents.find(owner),rooms:db.rooms,charges:admin?db.charges:db.charges.filter(owner),complaints:admin?db.complaints:db.complaints.filter(owner),notices:admin?db.notices:db.notices.filter(n=>!n.archived)};
    if(path==='/api/account/password')throw new Error('Passwords are disabled in the demo. Use the role buttons to switch views.');
    if(path.startsWith('/api/admin/')&&!admin)throw new Error('Choose Try admin to explore this action.');
    let match;
    if(path==='/api/admin/rooms'){const room=db.rooms.find(r=>r.slug===data.slug);if(!room)throw new Error('Choose a room type.');room.rent=data.rent;}
    else if(path==='/api/admin/photos'&&method==='DELETE'){db.rooms.forEach(r=>{r.photos=r.photos.filter(p=>p.id!==data.id);});}
    else if(path==='/api/admin/photos'){
      const room=db.rooms.find(r=>r.slug===data.get('slug'));if(!room||room.photos.length>=6)throw new Error('Choose a room with fewer than six photos.');
      const p=await photo(data.get('photo'));p.caption=String(data.get('caption')||'Sample room photo');room.photos.push(p);
    }
    else if(path==='/api/admin/residents'||(match=path.match(/^\/api\/admin\/residents\/([^/]+)$/))){
      const existing=match?db.residents.find(r=>r.user_id===match[1]):null;
      if(match&&!existing)throw new Error('Sample resident not found.');
      if(data.bed<1||data.bed>(data.sharing==='two-sharing'?2:4))throw new Error('Choose a bed within the room capacity.');
      if(db.residents.some(r=>r.active&&r!==existing&&r.room_number===data.roomNumber&&r.bed===data.bed))throw new Error('This sample bed is already occupied.');
      const stay={room_number:data.roomNumber,bed:data.bed,sharing:data.sharing,move_in:data.moveIn,rent:data.rent,deposit:data.deposit};
      if(existing)Object.assign(existing,stay);else db.residents.push({user_id:uid(),name:data.name,email:data.email,...stay,active:true,pending_invite:true});
    }
    else if((match=path.match(/^\/api\/admin\/residents\/([^/]+)\/(invite|end-stay)$/))){const r=db.residents.find(r=>r.user_id===match[1]);if(!r)throw new Error('Sample resident not found.');if(match[2]==='invite')throw new Error('Invitations are simulated. Residents can use Try resident without an account.');r.active=false;}
    else if(path==='/api/admin/charges'){
      let count=0;for(const r of db.residents.filter(r=>r.active&&r.move_in.slice(0,7)<=data.month)){if(!db.charges.some(c=>c.user_id===r.user_id&&c.month===data.month)){db.charges.push({id:uid(),user_id:r.user_id,name:r.name,room_number:r.room_number,month:data.month,amount:r.rent,due_date:data.dueDate,status:'pending'});count++;}}
      save();return {count};
    }
    else if((match=path.match(/^\/api\/resident\/charges\/([^/]+)\/payment$/))){
      if(admin)throw new Error('Choose Try resident to simulate a payment.');
      const c=db.charges.find(c=>c.id===match[1]&&owner(c));if(!c||c.status==='paid')throw new Error('Choose an unpaid sample charge.');
      const proof=data.get('proof');if(proof?.size)await photo(proof);c.reference=String(data.get('reference')||'DEMO-PAYMENT');c.status='under-review';
    }
    else if((match=path.match(/^\/api\/admin\/charges\/([^/]+)$/))){const c=db.charges.find(c=>c.id===match[1]);if(!c)throw new Error('Sample rent not found.');c.status=data.status;c.admin_note=data.note;}
    else if(path==='/api/resident/complaints'){
      if(admin)throw new Error('Choose Try resident to create a request.');
      db.complaints.unshift({id:uid(),user_id:current.id,name:current.name,room_number:db.residents.find(owner).room_number,...data,status:'New',created_at:date});
    }
    else if((match=path.match(/^\/api\/admin\/complaints\/([^/]+)$/))){const c=db.complaints.find(c=>c.id===match[1]);if(!c)throw new Error('Sample request not found.');c.status=data.status;c.admin_note=data.note;}
    else if(path==='/api/admin/notices')db.notices.unshift({id:uid(),...data,author:current.name,created_at:date,archived:false});
    else if((match=path.match(/^\/api\/admin\/notices\/([^/]+)$/))){const n=db.notices.find(n=>n.id===match[1]);if(!n)throw new Error('Sample notice not found.');n.archived=data.archived;}
    else throw new Error('This action is unavailable in the demo.');
    save();return {saved:true};
  }
  window.blissDemo={request};
  document.addEventListener('DOMContentLoaded',()=>{
    const bar=document.createElement('aside');bar.className='demo-bar';bar.setAttribute('aria-label','Demo controls');
    bar.innerHTML='<strong>BLISS · DEMO</strong><span>Sample rooms, prices & residents</span><button data-demo="admin">Try admin</button><button data-demo="resident">Try resident</button><button data-demo="reset">Reset demo</button><small>Practice only · Changes stay in this browser · No real bookings, accounts or payments. Use fictional details.</small>';
    bar.addEventListener('click',event=>{const action=event.target.dataset.demo;if(!action)return;if(action==='reset'){try{localStorage.removeItem(key);sessionStorage.removeItem(roleKey);}catch{}location.reload();}else enter(action);});
    document.body.prepend(bar);
    // Replace the password form after the existing portal has resolved its initial state.
    const app=document.getElementById('app');
    if(app){const showChoices=()=>{
      const form=app.querySelector('.auth-card form');if(!form)return;
      app.innerHTML='<section class="auth-card"><span class="eyebrow">EXPLORE BLISS</span><h1>A little space.<br>A demo to explore.</h1><p>Choose a view to try sample rooms, rent and resident requests. No sign-up or password needed.</p><div class="demo-choices"><button class="button" id="demo-admin">Try admin ↗</button><button class="quiet-button" id="demo-resident">Try resident ↗</button></div><a href="/">← Back to Bliss</a></section>';
      document.getElementById('demo-admin').onclick=()=>enter('admin');document.getElementById('demo-resident').onclick=()=>enter('resident');
    };const observer=new MutationObserver(showChoices);observer.observe(app,{childList:true,subtree:true});showChoices();}
    document.querySelectorAll('form input[type="file"]').forEach(input=>input.title='Demo image limit: 1 MB');
  });
})();
