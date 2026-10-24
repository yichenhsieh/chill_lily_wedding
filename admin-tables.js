(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const cfg = window.WEDDING_CONFIG;
  const status = (msg, error=false) => { $('status').textContent=msg; $('status').className='status'+(error?' error':' ok'); };
  const number = x => Number.isFinite(Number(x)) ? Number(x) : 0;
  if (!cfg?.supabaseUrl || !cfg?.supabasePublishableKey || !window.supabase) { status('無法載入 Supabase 設定。',true); return; }
  const db = window.supabase.createClient(cfg.supabaseUrl,cfg.supabasePublishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  let guests=[];
  function render(){
    const term=$('filter').value.trim().toLowerCase();
    const grid=$('tableGrid');grid.replaceChildren();
    const groups=new Map(Array.from({length:30},(_,i)=>[i+1,[]]));
    for(const g of guests){ if(groups.has(number(g.table_number)))groups.get(number(g.table_number)).push(g); }
    $('tablesCount').textContent=[...groups.values()].filter(a=>a.length).length;
    $('expected').textContent=guests.reduce((s,g)=>s+number(g.expected_count),0);
    $('arrived').textContent=guests.reduce((s,g)=>s+(g.is_checked_in?number(g.checked_in_count):0),0);
    for(const [table,people] of groups){
      if(term && !String(table).includes(term) && !people.some(g=>String(g.guest_name||'').toLowerCase().includes(term)))continue;
      const card=document.createElement('section');card.className='table-box';
      const heading=document.createElement('h3');heading.textContent=`第 ${table} 桌`;card.append(heading);
      const total=people.reduce((s,g)=>s+number(g.expected_count),0);
      const arrived=people.reduce((s,g)=>s+(g.is_checked_in?number(g.checked_in_count):0),0);
      const meta=document.createElement('div');meta.className='table-meta';meta.textContent=`預計 ${total} 人｜已到 ${arrived} 人｜${people.length} 筆名單`;card.append(meta);
      if(!people.length){const empty=document.createElement('div');empty.className='empty';empty.textContent='目前沒有安排賓客';card.append(empty);}
      else {const ul=document.createElement('ul');ul.className='guest-list';for(const g of people){
        const li=document.createElement('li');const name=document.createElement('span');name.textContent=g.guest_name||'未命名';
        const count=document.createElement('span');count.className=g.is_checked_in?'arrived':'pending';count.textContent=g.is_checked_in?`已到 ${number(g.checked_in_count)}/${number(g.expected_count)}`:`未到 · ${number(g.expected_count)} 人`;
        li.append(name,count);ul.append(li);
      }card.append(ul);}
      grid.append(card);
    }
    if(!grid.childElementCount){const empty=document.createElement('p');empty.textContent='找不到符合的桌次或賓客。';grid.append(empty);}
  }
  async function refresh(){
    try{
      const {data,error}=await db.rpc('admin_wedding_table_guests');if(error)throw error;
      guests=Array.isArray(data)?data:[];render();$('lastUpdated').textContent=new Date().toLocaleTimeString('zh-TW');status('桌次資料已更新。');
    }catch(e){status('無法載入桌次：'+(e?.message||String(e)),true);}
  }
  async function init(){
    const {data:{user},error}=await db.auth.getUser();
    if(error||!user){status('尚未登入，請先使用管理員帳號登入報到系統。',true);return;}
    const {data,error:profileError}=await db.rpc('get_my_staff_profile');
    const p=Array.isArray(data)?data[0]:data;
    if(profileError||p?.staff_role!=='admin'){status('此頁僅供管理員查看，請改用管理員帳號登入。',true);return;}
    $('content').classList.remove('hidden');$('filter').addEventListener('input',render);$('refresh').addEventListener('click',refresh);
    $('logout').addEventListener('click',async()=>{await db.auth.signOut();location.href='staff.html';});
    await refresh();setInterval(()=>{if(document.visibilityState==='visible')refresh();},30000);
  }
  init().catch(e=>status(e?.message||String(e),true));
})();
