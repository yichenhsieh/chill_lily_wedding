/* Chill & Lily staff app. All writes go through authenticated, role-checked RPCs. */
(() => {
'use strict';
const $ = id => document.getElementById(id);
const cfg = window.WEDDING_CONFIG;
let db, currentUser=null, staff=null, selected=null, stream=null, detector=null, scanLoop=false, html5Scanner=null, scannerBusy=false, searchTimer=null, dashboardTimer=null;
const page = document.body.dataset.page;
const setStatus=(message,isError=false,ok=false)=>{const el=$('status');if(!el)return;el.textContent=message;el.className='status'+(isError?' error':ok?' ok':'');};
const show=(id,yes)=>{const el=$(id);if(el)el.classList.toggle('hidden',!yes);};
const val=id=>$(id)?.value?.trim()||'';
const errorText=e=>e?.message||String(e);
const rpc=async(name,args={})=>{const {data,error}=await db.rpc(name,args);if(error)throw error;return data;};
const number=v=>Number.isFinite(Number(v))?Number(v):0;
const checkAuth=async()=>{
 const {data:{user},error}=await db.auth.getUser();if(error||!user){currentUser=null;staff=null;show('loginCard',true);show('workspace',false);show('logoutBtn',false);show('adminTabs',false);return;}
 currentUser=user;
 try{const profiles=await rpc('get_my_staff_profile');const p=Array.isArray(profiles)?profiles[0]:profiles;
 if(!p||!['admin','reception'].includes(p.staff_role))throw new Error('此帳號沒有有效的婚禮工作人員權限。');
 staff=p;show('loginCard',false);show('workspace',true);show('logoutBtn',true);show('adminTabs',page==='staff'&&p.staff_role==='admin');$('staffName').textContent=p.display_name+' · '+(p.staff_role==='admin'?'管理員':'招待');
 if(page==='dashboard'&&p.staff_role!=='admin'){show('workspace',false);setStatus('即時看板僅開放管理員查看。',true);return;}
 setStatus('登入成功',false,true);if(page==='dashboard'){await refreshDashboard();startDashboardRefresh();}
 }catch(e){show('loginCard',false);show('workspace',false);show('logoutBtn',true);show('adminTabs',false);setStatus(errorText(e),true);}
};
const login=async(e)=>{e.preventDefault();$('loginBtn').disabled=true;try{const {error}=await db.auth.signInWithPassword({email:val('email'),password:$('password').value});if(error)throw error;await checkAuth();}catch(e){setStatus(errorText(e),true);}finally{$('loginBtn').disabled=false;}};
// Name + existing Supabase password. Email aliases are public identifiers, never passwords.
const quickLogin=async(e)=>{
 e.preventDefault();
 const select=$('staffSelect');
 const email=select?.value||'';
 const password=$('quickPassword')?.value||'';
 if(!email){setStatus('請先選擇工作人員。',true);return;}
 if(email.includes('YOUR_GMAIL')){setStatus('請先在 staff.html 設定四位工作人員的實際 Gmail 別名。',true);return;}
 if(!password){setStatus('請輸入原本的 Supabase 登入密碼。',true);return;}
 const button=$('quickLoginBtn');
 button.disabled=true;
 try{
   const {error}=await db.auth.signInWithPassword({email,password});
   if(error)throw error;
   $('quickPassword').value='';
   await checkAuth();
 }catch(err){setStatus('登入失敗：'+errorText(err),true);}
 finally{button.disabled=false;}
};
const logout=async()=>{stopScanner();stopDashboardRefresh();await db.auth.signOut();selected=null;await checkAuth();setStatus('已安全登出。');};
const guestName=g=>g.name||'未命名賓客';
const displayGuest=(g)=>{
 selected=g;show('selectedGuest',true);$('guestName').textContent=guestName(g);$('guestTable').textContent=g.actual_table_number??'未安排';$('guestExpected').textContent=number(g.expected_count);
 $('guestChecked').textContent=number(g.checked_in_count);const done=!!g.checked_in_at||g.checkin_status===true||g.checkin_status==='checked_in';
 $('guestState').textContent=done?'已報到':'尚未報到';$('guestState').className='pill'+(done?' done':'');
 $('checkinCount').value=done?number(g.checked_in_count):Math.max(1,number(g.expected_count));$('checkinCount').max=number(g.expected_count);
 $('checkinBtn').disabled=done;$('changeTable').value=g.actual_table_number??'';
 $('seatSection').classList.toggle('hidden',staff?.staff_role!=='admin');
};
// Existing invitation QR codes contain a seat-lookup URL with ?token=...
// Accept either that exact URL format or a raw token. Never navigate to scanned URLs.
const extractGuestToken = raw => {
 const value=String(raw??'').trim();
 if(!value)throw new Error('QR Code 沒有內容。');
 if(/^https?:\/\//i.test(value)){
   let url;
   try{url=new URL(value);}catch(e){throw new Error('QR Code 網址格式不正確。');}
   if(url.protocol!=='https:' || url.hostname!=='yichenhsieh.github.io' ||
      !['/chill_lily_wedding/','/chill_lily_wedding/index.html'].includes(url.pathname)){
     throw new Error('這不是 Chill & Lily 的婚禮賓客 QR Code。');
   }
   const token=url.searchParams.get('token');
   if(!token?.trim())throw new Error('QR Code 網址缺少 token，請檢查原始 QR Code。');
   return token.trim();
 }
 if(value.includes('://') || value.includes('?') || value.includes('#'))throw new Error('QR Code 格式無法辨識。');
 return value;
};
 const findByToken = async (raw) => {   const token = extractGuestToken(raw);    const rows = await rpc('lookup_wedding_guest', {     p_token: token   });    const g = Array.isArray(rows) ? rows[0] : rows;    if (!g) {     throw new Error('查無此 QR Code 對應的賓客。');   }    const guest = {     name: g.guest_name,     actual_table_number: g.table_number,     expected_count: g.expected_count,     checked_in_count: g.checked_count,     checked_in_at: g.checkin_time,     checkin_status: g.is_checked_in,     qr_token: token   };    displayGuest(guest);   $('searchResults').replaceChildren();    setStatus(     '已找到賓客，請核對姓名與人數。',     false,     true   ); };
const search=async()=>{const q=val('searchInput');if(q.length<1){$('searchResults').replaceChildren();return;}try{const rows=await rpc('search_wedding_guests',{p_query:q});const list=$('searchResults');list.replaceChildren();if(!rows?.length){list.textContent='找不到符合的賓客。';return;}
 rows.forEach(g=>{const item=document.createElement('div');item.className='guest';const label=document.createElement('div');label.textContent=`${guestName(g)} · 第 ${g.actual_table_number??'—'} 桌 · ${g.expected_count??0} 人`;
 const btn=document.createElement('button');btn.type='button';btn.className='btn secondary small';btn.textContent='選取賓客';btn.addEventListener('click',()=>{displayGuest(g);setStatus('已選取賓客，請核對資訊。');});item.append(label,btn);list.append(item);});
 }catch(e){setStatus('搜尋失敗：'+errorText(e),true);}};
const checkin=async()=>{if(!selected)return;const n=Number($('checkinCount').value);if(!Number.isInteger(n)||n<1||n>number(selected.expected_count)){setStatus('報到人數必須介於 1 與預計人數之間。',true);return;}
 if(!window.confirm(`確認「${guestName(selected)}」報到 ${n} 人？`))return;
 $('checkinBtn').disabled=true;try{await rpc('check_in_wedding_guest',{p_token:selected.qr_token,p_count:n});await findByToken(selected.qr_token);setStatus('報到成功！',false,true);}catch(e){setStatus('報到失敗：'+errorText(e),true);$('checkinBtn').disabled=false;}};
const changeSeat=async()=>{if(!selected||staff?.staff_role!=='admin')return;const table=Number(val('changeTable'));if(!Number.isSafeInteger(table)||table<1){setStatus('請輸入正確的新桌號（正整數）。',true);return;}
 if(!window.confirm(`確定將「${guestName(selected)}」改至第 ${table} 桌？`))return;
 $('seatBtn').disabled=true;try{await rpc('change_wedding_guest_table',{p_token:selected.qr_token,p_new_table:table});await findByToken(selected.qr_token);setStatus('桌次已更新。',false,true);}catch(e){setStatus('換桌失敗：'+errorText(e),true);}finally{$('seatBtn').disabled=false;}};
const stopScanner=async()=>{
 scanLoop=false;
 if(html5Scanner){
   const scanner=html5Scanner; html5Scanner=null;
   try{await scanner.stop();}catch(e){}
   try{scanner.clear();}catch(e){}
 }
 if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}
 show('scannerBox',false);
};
const startScanner=async()=>{
 if(scannerBusy||html5Scanner)return;
 if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia){
   setStatus('無法使用相機：請使用 HTTPS 網址並允許瀏覽器相機權限。',true);return;
 }
 if(!window.Html5Qrcode){setStatus('QR 掃描程式庫載入失敗，請確認網路連線並重新整理。',true);return;}
 scannerBusy=true;
 show('scannerBox',true);
 setStatus('正在啟動相機，請允許相機權限……');
 try{
   const scanner=new Html5Qrcode('qrReader',{verbose:false});
   html5Scanner=scanner;
   const onScan=async raw=>{
     if(!html5Scanner||scannerBusy)return;
     scannerBusy=true;
     await stopScanner();
     $('tokenInput').value=raw;
     try{await findByToken(raw);}catch(e){setStatus('QR Code 查詢失敗：'+errorText(e),true);}
     finally{scannerBusy=false;}
   };
   await scanner.start({facingMode:'environment'}, {fps:10,qrbox:(w,h)=>({width:Math.min(240,w),height:Math.min(240,h)})},onScan,()=>{});
   setStatus('相機已開啟，請將賓客 QR Code 對準畫面。',false,true);
 }catch(e){await stopScanner();setStatus('無法開啟相機：'+errorText(e)+'。請檢查相機權限，或改用手動輸入。',true);}
 finally{scannerBusy=false;}
};
const refreshDashboard=async()=>{try{const data=await rpc('wedding_dashboard_stats');const d=Array.isArray(data)?data[0]:data;if(!d)throw new Error('無法取得統計資料');
 $('totalGuests').textContent=number(d.total_guests);$('arrivedGuests').textContent=number(d.arrived_guests);$('expectedPeople').textContent=number(d.expected_people);$('arrivedPeople').textContent=number(d.arrived_people);
 $('remainingPeople').textContent=Math.max(0,number(d.expected_people)-number(d.arrived_people));$('updatedAt').textContent=new Date().toLocaleTimeString('zh-TW');setStatus('統計已更新。',false,true);
 }catch(e){setStatus('看板更新失敗：'+errorText(e),true);}};
const startDashboardRefresh=()=>{stopDashboardRefresh();dashboardTimer=setInterval(()=>{if(document.visibilityState==='visible')refreshDashboard();},15000);};
const stopDashboardRefresh=()=>{if(dashboardTimer){clearInterval(dashboardTimer);dashboardTimer=null;}};
const init=async()=>{if(!cfg?.supabasePublishableKey||cfg.supabasePublishableKey.startsWith('PASTE_')){setStatus('請先在 config.js 填入現有 Supabase Publishable Key（不是 Secret Key）。',true);return;}
 if(!window.supabase){setStatus('無法載入 Supabase 程式庫，請檢查網路。',true);return;}
 db=window.supabase.createClient(cfg.supabaseUrl,cfg.supabasePublishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
 $('loginForm').addEventListener('submit',login);
  if($('quickLoginForm'))$('quickLoginForm').addEventListener('submit',quickLogin);
  $('logoutBtn').addEventListener('click',logout);
 if(page==='staff'){
 $('searchInput').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(search,350);});
 $('tokenForm').addEventListener('submit',async e=>{e.preventDefault();try{await findByToken(val('tokenInput'));}catch(err){setStatus(errorText(err),true);}});
 $('checkinBtn').addEventListener('click',checkin);$('seatBtn').addEventListener('click',changeSeat);$('scanBtn').addEventListener('click',startScanner);$('stopScanBtn').addEventListener('click',stopScanner);
 }else{$('refreshBtn').addEventListener('click',refreshDashboard);}
 db.auth.onAuthStateChange((event)=>{if(event==='SIGNED_OUT'){stopScanner();stopDashboardRefresh();currentUser=null;staff=null;show('loginCard',true);show('workspace',false);show('logoutBtn',false);show('adminTabs',false);}});
 await checkAuth();
};
window.addEventListener('pagehide',()=>{stopScanner();stopDashboardRefresh();});
init().catch(e=>setStatus(errorText(e),true));
})();