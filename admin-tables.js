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
  // Export the full authorized dataset, independent of the on-screen search filter.
  // Escape formula-like cells to prevent spreadsheet formula injection.
  function csvCell(value){
    let str=String(value ?? '');
    if (/^[\s\u0000-\u001f]*[=+@-]/.test(str)) str="'"+str;
    return '"'+str.replace(/"/g,'""')+'"';
  }
  async function exportCsv(){
    const btn=$('exportCsv');btn.disabled=true;
    try{
      // Fetch fresh data with the same admin-only RPC used by the overview.
      const {data,error}=await db.rpc('admin_wedding_table_guests');
      if(error)throw error;
      const rows=Array.isArray(data)?data:[];
      const ordered=[...rows].sort((a,b)=>number(a.table_number)-number(b.table_number)||String(a.guest_name||'').localeCompare(String(b.guest_name||''),'zh-Hant'));
      const header=['桌次','賓客姓名','預計人數','已報到人數','報到狀態'];
      const records=ordered.map(g=>[
        g.table_number??'',g.guest_name??'',number(g.expected_count),
        g.is_checked_in?number(g.checked_in_count):0,g.is_checked_in?'已報到':'未報到'
      ]);
      // Include an empty reserve table row when no guests are assigned to table 30.
      if(!ordered.some(g=>number(g.table_number)===30)) records.push([30,'（預備桌／尚未安排）',0,0,'']);
      const csv='\uFEFF'+[header,...records].map(r=>r.map(csvCell).join(',')).join('\r\n');
      const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
      const url=URL.createObjectURL(blob);
      const link=document.createElement('a');
      const now=new Date();const stamp=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('');
      link.href=url;link.download=`Chill_Lily_全桌次_${stamp}.csv`;
      document.body.appendChild(link);link.click();link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),1500);
      status(`已匯出 ${records.length} 筆資料（含空白預備桌）。`);
    }catch(e){status('匯出失敗：'+(e?.message||String(e)),true);}
    finally{btn.disabled=false;}
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
    $('content').classList.remove('hidden');$('filter').addEventListener('input',render);$('refresh').addEventListener('click',refresh);$('exportCsv').addEventListener('click',exportCsv);
    $('logout').addEventListener('click',async()=>{await db.auth.signOut();location.href='staff.html';});
    await refresh();setInterval(()=>{if(document.visibilityState==='visible')refresh();},30000);
  }
  init().catch(e=>status(e?.message||String(e),true));
})();
