/* =====================================================
   SHE OUT — Classic Edition (app.js)
   BLACK & GOLD theme — Google Sheets Backend.
   ===================================================== */
"use strict";

const API_URL = "https://script.google.com/macros/s/AKfycbzsELwDcxB1N-0sjO8q76rk-x5gt9z7mf3SVulxjd4P0dKtKWsmwAZAqg38t4DRG9YQ/exec";
const LOGO_SRC = "https://drive.google.com/thumbnail?id=1ld30HdqgSQJIw0PKwXDPGnUA8mXgE438&sz=w400";

const ALL_PERMS = { inventory: true, orders: true, viewOrders: true, reports: true, accounts: true };
const STATUSES = ["pending", "ready", "shipped", "delivered", "returned"];
const CITIES = ["CAIRO","GIZA","ALEXANDRIA","BEHIRA","QALIUBIA","GHARBIA","MONOUFIA","DOMITTA","DAKAHLIA","KAFR EL SHEIKH","MARSA MATROUH","ISMAILIA","SUEZ","PORT SAID","SHARKIA","FAYOUM","BANI SWEIF","MENIA","ASSIUT","SOUHAGE","QENA","ASWAN","LOUXOR","RED SEA","NEW VALLLEY","NOURTH SINAI","SOUTH SINAI"];
const NEXT_ACTIONS = {
  pending: [
    { to: "ready", label: "Mark Ready", icon: "package-check", cls: "btn-dark" },
    { to: "shipped", label: "Mark Shipped", icon: "send", cls: "btn-ghost" },
    { to: "returned", label: "Return", icon: "undo-2", cls: "btn-danger" },
  ],
  ready: [
    { to: "shipped", label: "Mark Shipped", icon: "send", cls: "btn-dark" },
    { to: "returned", label: "Return", icon: "undo-2", cls: "btn-danger" },
  ],
  shipped: [
    { to: "delivered", label: "Mark Delivered", icon: "check-circle-2", cls: "btn-primary" },
    { to: "returned", label: "Return", icon: "undo-2", cls: "btn-danger" },
  ],
  delivered: [],
  returned: [],
};
const SHIP_LABEL = { free: "Free shipping", extra_free: "Extra Free shipping", normal: "Standard shipping" };

/* =====================================================
   1) DATA — Google Sheets + local cache for speed
   ===================================================== */
let DB = {
  products: [], variants: [], orders: [], orderItems: [],
  users: [], settings: [], notifications: [], session: null,
};
const LOCAL_KEY = "sheout_session";
const CACHE_KEY = "sheout_cache_v6";

function saveSession() {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(DB.session)); } catch(e) {}
}
function loadSession() {
  try { DB.session = JSON.parse(localStorage.getItem(LOCAL_KEY)); } catch(e) { DB.session = null; }
}
function saveCache() {
  try {
    const c = { products: DB.products, variants: DB.variants, orders: DB.orders, orderItems: DB.orderItems, users: DB.users, settings: DB.settings, notifications: DB.notifications, ts: Date.now() };
    localStorage.setItem(CACHE_KEY, JSON.stringify(c));
  } catch(e) {}
}
function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return false;
    const c = JSON.parse(raw);
    if (!c.users || !c.users.length) return false;
    DB.products = c.products || [];
    DB.variants = c.variants || [];
    DB.orders = c.orders || [];
    DB.orderItems = c.orderItems || [];
    DB.users = c.users || [];
    DB.settings = c.settings || [];
    DB.notifications = c.notifications || [];
    return true;
  } catch(e) { return false; }
}

/* ---- API helper ---- */
async function api(action, body) {
  try {
    const res = await fetch(API_URL + "?action=" + action, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(body || {}),
    });
    const data = await res.json();
    if (data && data.error && data.error.includes("Unknown action") && action === "deleteOrder") {
      /* deleteOrder not yet added to Apps Script — use updateOrder to mark as deleted */
      return await api("updateOrder", { Order_ID: body.Order_ID, Status: "deleted" });
    }
    return data;
  } catch (e) {
    console.warn("API error:", e);
    throw e;
  }
}

async function loadAllData() {
  const d = await api("loadAll");
  DB.products = d.products || [];
  DB.variants = d.variants || [];
  DB.orders = (d.orders || []).sort((a, b) => new Date(b.Date) - new Date(a.Date));
  DB.orderItems = d.orderItems || [];
  DB.users = d.users || [];
  DB.settings = d.settings || [];
  DB.notifications = (d.notifications || []).sort((a, b) => new Date(b.Created_At) - new Date(a.Created_At));
  saveCache();
}

/* Sync from sheets in background — no blocking */
function bgSync() {
  loadAllData().then(() => { render(); }).catch(() => {});
}

/* ---- data helpers ---- */
function getUser(uid) { return DB.users.find(u => String(u.User_ID) === String(uid)); }
function getSetting(key) { const s = DB.settings.find(x => x.Key === key); return s ? s.Value : null; }
function getExtraShipping() { return Number(getSetting("extraShippingPrice")) || 60; }
function getCollectionFee() { return Number(getSetting("collectionFee")) || 5; }
function productVariants(pid) { return DB.variants.filter(v => String(v.Product_ID) === String(pid)); }
function productTotal(pid) { return productVariants(pid).reduce((s,v) => s + Number(v.Quantity), 0); }
function isLow(p) { return productTotal(p.Product_ID) <= Number(p.Low_Stock_Threshold); }
function orderItems(oid) { return DB.orderItems.filter(i => String(i.Order_ID) === String(oid)); }

function toBool(v) { return String(v).toUpperCase() === "TRUE" || v === true; }

/* =====================================================
   2) HELPERS
   ===================================================== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

function esc(v) { return String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function egp(n) { return Number(n||0).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}); }
function todayStr(d=new Date()) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function fmtDate(d) { return new Date(d).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}); }
function fmtDT(d) { return new Date(d).toLocaleString("en-GB",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}); }
function timeAgo(d) { const diff=Date.now()-new Date(d).getTime(); const m=Math.floor(diff/60000); if(m<1) return "just now"; if(m<60) return m+"m ago"; const h=Math.floor(m/60); if(h<24) return h+"h ago"; const days=Math.floor(h/24); if(days<7) return days+"d ago"; return fmtDate(d); }
function icons() { if(window.lucide) lucide.createIcons(); }

function me() { return DB.users.find(u => String(u.User_ID) === String(DB.session)) || null; }
function can(perm) {
  const u=me(); if(!u) return false; if(u.Role==="admin") return true;
  if(perm==="viewOrders") return toBool(u.Perm_ViewOrders);
  const key="Perm_"+perm.charAt(0).toUpperCase()+perm.slice(1);
  return toBool(u[key]);
}

/* ---- toasts ---- */
function toast(kind,text) {
  const box=document.createElement("div"); box.className="toast t-"+kind;
  const ic=kind==="success"?"check-circle-2":kind==="error"?"alert-triangle":"info";
  box.innerHTML=`<i data-lucide="${ic}"></i><p>${esc(text)}</p>`;
  $("#toasts").appendChild(box); icons(); setTimeout(()=>box.remove(),4200);
}

/* ---- modal ---- */
function openModal(html,wide=false) {
  const ov=document.createElement("div"); ov.className="modal-ov"; ov.id="modal-ov";
  ov.innerHTML=`<div class="modal anim-pop ${wide?"wide":""}">${html}</div>`;
  ov.addEventListener("mousedown",e=>{if(e.target===ov) closeModal();});
  $("#modal-root").appendChild(ov); icons();
}
function closeModal() { const ov=$("#modal-ov"); if(ov) ov.remove(); DRAFT.img=null; DRAFT.cart=[]; }
function modalHead(title,sub) { return `<div class="modal-head"><div><h3>${esc(title)}</h3>${sub?`<p>${esc(sub)}</p>`:""}</div><button class="modal-x" onclick="closeModal()"><i data-lucide="x"></i></button></div><div class="modal-body">`; }

let CONFIRM_FN=null;
function confirmDlg(title,message,yesLabel,danger,fn) {
  CONFIRM_FN=fn;
  openModal(modalHead(title,"")+`<p style="font-size:14px;line-height:1.7;color:#c4b489">${esc(message)}</p>
  <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
  <button class="btn ${danger?"btn-danger":"btn-primary"}" onclick="runConfirm()">${esc(yesLabel||"Confirm")}</button></div></div>`);
}
function runConfirm() { const fn=CONFIRM_FN; CONFIRM_FN=null; closeModal(); if(fn) fn(); }

/* ---- loading overlay ---- */
function showLoading(msg) {
  let ov=$("#loading-ov"); if(ov) ov.remove();
  ov=document.createElement("div"); ov.id="loading-ov";
  ov.style.cssText="position:fixed;inset:0;z-index:200;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)";
  ov.innerHTML=`<div style="text-align:center"><div style="width:40px;height:40px;border:3px solid #322d21;border-top-color:#d4af37;border-radius:50%;animation:spin .7s linear infinite;margin:0 auto"></div><p style="margin-top:14px;color:#e9c766;font-size:14px;font-weight:600">${esc(msg||"Loading…")}</p></div><style>@keyframes spin{to{transform:rotate(360deg)}}</style>`;
  document.body.appendChild(ov);
}
function hideLoading() { const ov=$("#loading-ov"); if(ov) ov.remove(); }

/* ---- notifications ---- */
function myNotifs() { const u=me(); return u ? DB.notifications.filter(n=>String(n.User_ID)===String(u.User_ID)).slice(0,40) : []; }
function unreadCount() { const u=me(); return u ? DB.notifications.filter(n=>String(n.User_ID)===String(u.User_ID)&&!toBool(n.Read)).length : 0; }
async function sendNotifications(type,message) {
  const admins=DB.users.filter(u=>u.Role==="admin");
  if(!admins.length) return;
  const notifs=admins.map(a=>({User_ID:a.User_ID,Type:type,Message:message}));
  await api("saveNotifications",{notifications:notifs}).catch(()=>{});
}

function toggleOfferDetails(id){const el=document.getElementById(id);if(el){el.style.display=el.style.display==="none"?"block":"none";}}

function manualRefresh() {
  showLoading("Refreshing data...");
  loadAllData().then(() => { render(); toast("success", "Data refreshed!"); }).catch(() => { toast("error", "Refresh failed."); }).finally(() => hideLoading());
}

function toggleBell(e) {
  e.stopPropagation();
  const panel=$(".bell-panel"); if(panel){panel.remove();return;}
  const items=myNotifs(); const host=e.currentTarget.parentElement;
  const div=document.createElement("div"); div.className="bell-panel anim-pop";
  const uid=me().User_ID;
  div.innerHTML=`
    <div style="display:flex;align-items:center;justify-content:space-between;padding:13px 16px;border-bottom:1px solid var(--line)">
      <h4 style="font-family:var(--font-display);font-size:14px">Notifications</h4>
      ${items.length?`<button onclick="deleteAllNotifs()" style="background:rgba(229,72,77,.1);color:var(--red-soft);border:1px solid rgba(229,72,77,.3);font-size:11px;font-weight:700;padding:4px 10px;border-radius:8px;cursor:pointer">Delete All</button>`:""}
    </div>
    <div class="bell-list">`+
    (items.length?items.map(n=>`
      <div class="bell-item ${toBool(n.Read)?"read":"unread"}" style="position:relative">
        <span class="bell-ico ${n.Type}"><i data-lucide="${n.Type==="stock"?"alert-triangle":n.Type==="order"?"clipboard-list":"info"}"></i></span>
        <div style="flex:1;min-width:0"><p>${esc(n.Message)}</p><small>${timeAgo(n.Created_At)}</small></div>
        <button onclick="deleteNotif(${n.Notif_ID})" title="Delete" style="background:transparent;border:none;color:var(--faint);cursor:pointer;padding:4px;border-radius:6px;flex-shrink:0" onmouseover="this.style.color='var(--red-soft)'" onmouseout="this.style.color='var(--faint)'">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </button>
      </div>`).join("")
    :`<div class="bell-empty">No notifications yet.</div>`)+
    `</div>`;
  host.appendChild(div); icons();
  if(unreadCount()>0) { api("markNotificationsRead",{User_ID:uid}).then(()=>loadAllData().then(()=>renderBellBadges())).catch(()=>{}); }
}

function deleteNotif(id){
  DB.notifications=DB.notifications.filter(n=>Number(n.Notif_ID)!==Number(id));
  saveCache();
  const panel=$(".bell-panel"); if(panel) panel.remove();
  renderBellBadges();
  api("deleteNotif",{Notif_ID:id}).catch(()=>{});
}
function deleteAllNotifs(){
  const uid=me().User_ID;
  DB.notifications=DB.notifications.filter(n=>String(n.User_ID)!==String(uid));
  saveCache();
  const panel=$(".bell-panel"); if(panel) panel.remove();
  renderBellBadges();
  api("deleteAllNotifs",{User_ID:uid}).catch(()=>{});
}
document.addEventListener("mousedown",e=>{const p=$(".bell-panel");if(p&&!p.contains(e.target)&&!e.target.closest(".bell-btn"))p.remove();});
function renderBellBadges() { $$(".bell-count").forEach(b=>b.remove()); const c=unreadCount(); if(c>0) $$(".bell-btn").forEach(btn=>{const s=document.createElement("span");s.className="bell-count";s.textContent=c>9?"9+":c;btn.appendChild(s);}); }

/* ---- AI Agent ---- */
function agentSnapshot(){
  return {
    currentUser: me()?{ username: me().Username, role: me().Role }:null,
    products: DB.products.map(p=>({ Product_ID:p.Product_ID, Name:p.Name, Category:p.Category, Price:p.Price, Offer_Items:p.Offer_Items||"" })),
    variants: DB.variants.map(v=>({ Variant_ID:v.Variant_ID, Product_ID:v.Product_ID, Variant_Name:v.Variant_Name, Quantity:v.Quantity })),
    orders: DB.orders.slice(0,120).map(o=>({ Order_ID:o.Order_ID, Customer_Name:o.Customer_Name, Phone_1:o.Phone_1, Status:o.Status, Grand_Total:o.Grand_Total, Date:o.Date })),
    settings: DB.settings,
  };
}
function agentHtml(){
  if(!me()) return "";
  return `<div id="agent-root" style="position:fixed;left:18px;bottom:18px;z-index:120">
    ${AGENT.open?`<div class="card" style="width:min(92vw,380px);height:min(72vh,560px);display:flex;flex-direction:column;overflow:hidden;border-color:rgba(212,175,55,.35)">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--line);background:#100e09">
        <div><b style="font-family:var(--font-display);font-size:16px;color:var(--gold-soft)">SHE OUT AI</b><div style="font-size:10px;color:var(--faint);margin-top:2px">Ask anything or send a free-text order</div></div>
        <button class="bell-btn" onclick="toggleAgentPanel()" style="padding:8px"><i data-lucide="x"></i></button>
      </div>
      <div id="agent-messages" style="flex:1;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:10px;background:#0f0d09">${AGENT.messages.map(m=>`<div style="max-width:88%;align-self:${m.role==='user'?'flex-end':'flex-start'};background:${m.role==='user'?'rgba(212,175,55,.12)':'#171410'};border:1px solid ${m.role==='user'?'rgba(212,175,55,.25)':'var(--line)'};padding:10px 12px;border-radius:14px;color:${m.role==='user'?'var(--champ)':'#efe6cc'};font-size:13px;line-height:1.7;white-space:pre-wrap">${esc(m.text)}</div>`).join('')}</div>
      <div style="padding:12px;border-top:1px solid var(--line);background:#12100b">
        <div style="display:flex;gap:8px">
          <textarea id="agent-input" class="inp" placeholder="اكتب سؤالك أو ابعت أوردر نصّي…" style="min-height:52px;resize:none"></textarea>
          <button class="btn btn-primary" onclick="sendAgentMessage()" ${AGENT.busy?'disabled':''} style="min-width:84px">${AGENT.busy?'...':'Send'}</button>
        </div>
      </div>
    </div>`:`<button onclick="toggleAgentPanel()" style="width:60px;height:60px;border:none;border-radius:999px;background:linear-gradient(135deg,var(--gold-pale),var(--gold-deep));color:#171205;box-shadow:0 14px 40px -14px rgba(212,175,55,.7);cursor:pointer;font-weight:800">AI</button>`}
  </div>`;
}
function toggleAgentPanel(){ AGENT.open=!AGENT.open; render(); setTimeout(()=>{ const box=$("#agent-messages"); if(box) box.scrollTop=box.scrollHeight; }, 0); }
async function submitAgentOrder(order){
  if(_savingOrder) return { ok:false, message:'يوجد أوردر جارٍ حفظه الآن.' };
  _savingOrder = true;
  showLoading('AI is registering the order...');
  try{
    const payload = {
      Customer_Name: order.customerName,
      Phone_1: "'" + (order.phone1||""),
      Phone_2: order.phone2 ? ("'" + order.phone2) : "",
      Street: order.street,
      City: order.city,
      Notes: order.notes || "",
      Shipping_Type: order.shippingType,
      Shipping_Price: order.shippingPrice,
      Collection_Fee: order.collectionFee || getCollectionFee(),
      Items_Total: order.itemsTotal,
      Discount: order.discount || 0,
      Grand_Total: order.grandTotal,
      Status: 'pending',
      Created_By: me().Username,
      items: order.items,
    };
    const res = await fetch('/api/agent', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ message:'', snapshot: agentSnapshot() }) }).catch(()=>null);
    void res;
    const saveRes = await api('saveOrder', payload);
    await sendNotifications('order', `New order #${saveRes.Order_ID} for ${order.customerName} by AI / ${me().Username}.`);
    await loadAllData();
    render();
    return { ok:true, orderId: saveRes.Order_ID };
  }catch(e){
    return { ok:false, message:'فشل تسجيل الأوردر من المساعد الذكي.' };
  }finally{
    hideLoading();
    _savingOrder = false;
  }
}
async function sendAgentMessage(){
  const input = $('#agent-input');
  const text = (input?.value || '').trim();
  if(!text || AGENT.busy) return;
  AGENT.messages.push({ role:'user', text });
  AGENT.busy = true;
  render();
  setTimeout(()=>{ const box=$('#agent-messages'); if(box) box.scrollTop=box.scrollHeight; }, 0);
  try{
    const res = await fetch('/api/agent', {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ message: text, snapshot: agentSnapshot() })
    });
    const data = await res.json();
    AGENT.messages.push({ role:'assistant', text: data.reply || 'تم.' });
    if(data.type === 'create_order' && data.order){
      const result = await submitAgentOrder(data.order);
      AGENT.messages.push({ role:'assistant', text: result.ok ? `✅ تم تسجيل الأوردر تلقائياً برقم #${result.orderId}` : `❌ ${result.message}` });
    }
  }catch(e){
    AGENT.messages.push({ role:'assistant', text:'حصلت مشكلة في المساعد الذكي. حاول مرة تانية.' });
  }finally{
    AGENT.busy = false;
    if(input) input.value = '';
    render();
    setTimeout(()=>{ const box=$('#agent-messages'); if(box) box.scrollTop=box.scrollHeight; }, 0);
  }
}

/* =====================================================
   3) UI STATE
   ===================================================== */
const UI = { section:"overview", invSearch:"", ordSearch:"", ordStatus:"", selected:new Set(), repRange:"day", repDate:todayStr() };
const DRAFT = { img:null, cart:[], isOffer:false };
const AGENT = {
  open: false,
  busy: false,
  messages: [
    { role: "assistant", text: "أهلاً 👋 أنا مساعد SHE OUT. اسألني عن المخزن أو الأوردرات، أو ابعتلي بيانات أوردر وأنا أجهزه لك." },
  ],
};

const SECTIONS = [
  {id:"overview",label:"Overview",icon:"layout-grid",need:"admin",title:"Overview",sub:"A quick look at your studio today"},
  {id:"inventory",label:"Inventory",icon:"package",need:"inventory",title:"Inventory",sub:"Products, variants and stock levels"},
  {id:"orders",label:"Orders",icon:"shopping-bag",need:"orders",title:"Orders",sub:"Register, track and export customer orders"},
  {id:"reports",label:"Reports",icon:"bar-chart-3",need:"reports",title:"Reports",sub:"Daily, weekly and monthly order reports"},
  {id:"accounts",label:"Accounts",icon:"users",need:"accounts",title:"Accounts",sub:"Team accounts, roles and permissions"},
  {id:"settings",label:"Settings",icon:"settings",need:"admin",title:"Settings",sub:"Shipping pricing & workspace preferences"},
];
function visibleSections(){return SECTIONS.filter(s=>(s.need==="admin"?me().Role==="admin":!s.need||can(s.need)));}
function go(section){UI.section=section;UI.selected=new Set();render();}

/* =====================================================
   4) AUTH
   ===================================================== */
async function doLogin(e) {
  e.preventDefault();
  const username=$("#lg-user").value.trim();
  const password=$("#lg-pass").value;
  const u=DB.users.find(x=>x.Username.toLowerCase()===username.toLowerCase()&&x.Password===password);
  if(!u){$("#lg-err").textContent="Invalid username or password.";$("#lg-err").style.display="block";const f=$("#lg-form");f.classList.add("shake");setTimeout(()=>f.classList.remove("shake"),500);return;}
  DB.session=u.User_ID; saveSession(); render();
}
function logout(){DB.session=null;saveSession();render();}

/* =====================================================
   5) ROOT RENDER
   ===================================================== */
function render() {
  const app=$("#app");
  if(!me()){app.innerHTML=loginHTML();}else{app.innerHTML=shellHTML();}
  icons(); renderBellBadges();
}

function loginHTML() {
  return `<div class="login-wrap">
    <div class="login-brand"><div class="blob blob-1"></div><div class="blob blob-2"></div>
      <div class="login-brand-inner"><div><p class="brandmark">SHE <em>OUT</em></p><p class="brand-sub">Cosmatics Store</p></div>
        <div class="anim-up" style="display:flex;flex-direction:column;align-items:center;justify-content:center;flex:1">
          <img src="${LOGO_SRC}" alt="SHE OUT Logo" style="width:min(340px,72%);height:auto;object-fit:contain"/>
          <div class="brand-features" style="margin-top:32px"><span><i data-lucide="package"></i> Inventory</span><span><i data-lucide="shopping-bag"></i> Orders</span><span><i data-lucide="bar-chart-3"></i> Reports</span></div>
        </div></div></div>
    <div class="login-form-side"><div class="login-box anim-up">
      <div class="mobile-brand"><p class="brandmark">SHE <em>OUT</em></p><p class="brand-sub">Cosmatics Store</p></div>
      <div class="login-head"><div class="sq-logo" style="width:52px;height:52px;overflow:hidden;flex-shrink:0"><img src="${LOGO_SRC}" alt="Logo" style="width:100%;height:100%;object-fit:contain"/></div><div><h1>Welcome back</h1><p>Sign in to your SHE OUT workspace</p></div></div>
      <form id="lg-form" onsubmit="doLogin(event)">
        <div class="field"><label class="lbl" for="lg-user">Username</label><div class="iw"><i data-lucide="user"></i><input class="inp" id="lg-user" placeholder="e.g. admin" autocomplete="username" autofocus/></div></div>
        <div class="field"><label class="lbl" for="lg-pass">Password</label><div class="iw"><i data-lucide="lock"></i><input class="inp" id="lg-pass" type="password" placeholder="••••••••" autocomplete="current-password"/></div></div>
        <div class="err" id="lg-err" style="display:none"></div>
        <button class="btn btn-primary btn-block mt-16" type="submit">Sign In <i data-lucide="arrow-right"></i></button>
      </form>
      <p class="login-note">Accounts are created by the administrator only.</p>
    </div></div></div>`;
}

function bellHTML(){const c=unreadCount();return `<div class="bell"><button class="bell-btn" onclick="toggleBell(event)" aria-label="Notifications"><i data-lucide="bell"></i>${c?`<span class="bell-count">${c>9?"9+":c}</span>`:""}</button></div>`;}

function shellHTML() {
  const u=me(); const secs=visibleSections();
  if(!secs.some(s=>s.id===UI.section)) UI.section=secs[0]?secs[0].id:"overview";
  const meta=SECTIONS.find(s=>s.id===UI.section)||SECTIONS[0];
  const nav=secs.map(s=>`<button class="nav-btn ${UI.section===s.id?"active":""}" onclick="go('${s.id}')"><i data-lucide="${s.icon}"></i>${s.label}</button>`).join("");
  const bnav=secs.map(s=>`<button class="bn-btn ${UI.section===s.id?"active":""}" onclick="go('${s.id}')"><i data-lucide="${s.icon}"></i>${s.label}</button>`).join("");
  return `<div class="shell">
    <aside class="sidebar"><div class="side-brand"><p class="brandmark">SHE <em>OUT</em></p><p class="brand-sub">Cosmatics Store</p></div>
      <nav class="side-nav">${nav}</nav>
      <div class="side-user"><div class="avatar">${esc(u.Username.slice(0,2).toUpperCase())}</div><div class="who"><b>${esc(u.Username)}</b><span>${u.Role==="admin"?"Administrator":"Team member"}</span></div><button class="icon-btn" onclick="logout()" title="Sign out"><i data-lucide="log-out"></i></button></div></aside>
    <div class="topbar"><p class="brandmark">SHE <em>OUT</em></p><div class="tools"><button class="bell-btn" onclick="manualRefresh()" title="Refresh Data"><i data-lucide="refresh-cw"></i></button>${bellHTML()}<button class="bell-btn" onclick="logout()" title="Sign out"><i data-lucide="log-out"></i></button></div></div>
    <main class="page"><header class="page-head"><div class="anim-up"><h1 class="page-title">${meta.title}</h1><p class="page-sub">${meta.sub}</p></div><div class="bell-desk" style="display:none;align-items:center;gap:8px"><button class="bell-btn" onclick="manualRefresh()" title="Refresh Data"><i data-lucide="refresh-cw"></i></button>${bellHTML()}</div></header>
      <section class="anim-up">${sectionHTML()}</section></main>
    <nav class="bottomnav">${bnav}</nav>
    ${agentHtml()}
  </div>
  <style>@media(min-width:1024px){.bell-desk{display:block!important}}</style>`;
}

function sectionHTML() {
  switch(UI.section){
    case "inventory": return can("inventory")?inventoryHTML():noAccessHTML();
    case "orders": return can("orders")?ordersHTML():noAccessHTML();
    case "reports": return can("reports")?reportsHTML():noAccessHTML();
    case "accounts": return can("accounts")?accountsHTML():noAccessHTML();
    case "settings": return me().Role==="admin"?settingsHTML():noAccessHTML();
    default: return overviewHTML();
  }
}
function noAccessHTML(){return `<div class="card empty"><i data-lucide="lock"></i><p>You don't have access to this section — ask your admin.</p></div>`;}

/* =====================================================
   6) OVERVIEW
   ===================================================== */
function overviewHTML() {
  const today=todayStr();
  const todayOrders=DB.orders.filter(o=>todayStr(new Date(o.Date))===today);
  const deliveredToday=todayOrders.filter(o=>o.Status==="delivered");
  const revenue=deliveredToday.reduce((s,o)=>s+Number(o.Grand_Total),0);
  const low=DB.products.filter(isLow);
  const inTransit=DB.orders.filter(o=>o.Status==="ready"||o.Status==="shipped").length;
  const stats=[];
  if(can("orders")){
    stats.push({label:"Orders today",value:String(todayOrders.length),icon:"shopping-bag",tint:"tint-gold"},{label:"Delivered today",value:String(deliveredToday.length),icon:"truck",tint:"tint-green"},{label:"Revenue today",value:egp(revenue)+" EGP",icon:"sparkles",tint:"tint-amber"},{label:"Ready / Shipped",value:String(inTransit),icon:"package",tint:"tint-indigo"});
  }
  if(can("inventory")){
    stats.push({label:"Products in stock",value:String(DB.products.length),icon:"boxes",tint:"tint-gold"},{label:"Low stock alerts",value:String(low.length),icon:"alert-triangle",tint:"tint-red"});
  }
  let html=`<div class="space"><div class="stat-grid">`+stats.map(s=>`<div class="card stat-card"><div class="stat-ico ${s.tint}"><i data-lucide="${s.icon}"></i></div><b>${s.value}</b><span>${s.label}</span></div>`).join("")+`</div>`;
  if(low.length&&can("inventory")){
    html+=`<div class="card alert-strip"><div class="row"><h3><i data-lucide="alert-triangle"></i> Low stock — restock soon</h3><button class="btn btn-ghost btn-sm" onclick="go('inventory')">Open inventory <i data-lucide="arrow-right"></i></button></div><div class="chips-wrap">${low.map(p=>`<span class="chip chip-red"><span class="dot-pulse dot-red"></span>${esc(p.Name)} — ${productTotal(p.Product_ID)} left</span>`).join("")}</div></div>`;
  }
  if(can("orders")&&DB.orders.length){
    html+=`<div class="card list-mini"><div class="head"><h3>Latest orders</h3><button class="btn btn-ghost btn-sm" onclick="go('orders')">All orders <i data-lucide="arrow-right"></i></button></div>${DB.orders.slice(0,5).map(o=>`<div class="mini-row"><div class="who"><b>#${o.Order_ID} — ${esc(o.Customer_Name)}</b><span>${esc(o.Phone_1)}</span></div><div class="right"><b>${egp(o.Grand_Total)} <small>EGP</small></b><span class="chip status-${o.Status}" style="text-transform:uppercase">${o.Status}</span></div></div>`).join("")}</div>`;
  }
  if(!can("orders")&&!can("inventory")) html+=`<div class="card empty"><i data-lucide="lock"></i><p>Your account has no sections enabled yet — ask your administrator.</p></div>`;
  return html+`</div>`;
}

/* =====================================================
   7) INVENTORY
   ===================================================== */
function inventoryHTML() {
  const prods=DB.products.filter(p=>p.Category!=="OFFER");
  const offers=DB.products.filter(p=>p.Category==="OFFER");
  const totalPieces=DB.variants.reduce((s,v)=>s+Number(v.Quantity),0);
  const lowCount=prods.filter(isLow).length;
  return `<div class="toolbar"><div class="search-wrap"><i data-lucide="search"></i><input class="inp" id="inv-q" placeholder="Search products or offers…" value="${esc(UI.invSearch)}" oninput="invSearch(this.value)"/></div>
    <span class="chip chip-line"><i data-lucide="boxes"></i> ${prods.length} products · ${offers.length} offers · ${totalPieces} pieces</span>
    ${lowCount?`<span class="chip chip-red"><i data-lucide="alert-triangle"></i> ${lowCount} low</span>`:""}
    <button class="btn btn-primary" onclick="openProductModal()"><i data-lucide="plus"></i> Add Product</button>
    <button class="btn btn-dark" onclick="openProductModal(null,true)"><i data-lucide="gift"></i> Add Offer</button>
    <button class="btn btn-ghost" onclick="openRestockModal()" style="border-color:rgba(16,185,129,.4);color:#6ee7b7"><i data-lucide="truck"></i> Restock</button></div>
  <div id="inv-grid">${inventoryGridHTML()}</div>`;
}
function invSearch(v){UI.invSearch=v;$("#inv-grid").innerHTML=inventoryGridHTML();icons();}
function inventoryGridHTML() {
  const q=UI.invSearch.toLowerCase();
  const list=DB.products.filter(p=>p.Name.toLowerCase().includes(q)||(p.Category||"").toLowerCase().includes(q));
  if(!DB.products.length) return `<div class="card empty"><i data-lucide="package"></i><p>Your inventory is empty — add your first product.</p></div>`;
  if(!list.length) return `<div class="card empty"><i data-lucide="search-x"></i><p>No products match your search.</p></div>`;
  const prods=list.filter(p=>p.Category!=="OFFER");
  const offers=list.filter(p=>p.Category==="OFFER");
  let html="";
  if(offers.length) html+=`<h3 style="font-family:var(--font-display);margin-bottom:12px;display:flex;align-items:center;gap:8px"><i data-lucide="gift" style="color:var(--gold);width:20px;height:20px"></i> Offers (${offers.length})</h3><div class="prod-grid" style="margin-bottom:28px">`+offers.map(p=>renderProductCard(p)).join("")+`</div>`;
  if(prods.length) html+=`<h3 style="font-family:var(--font-display);margin-bottom:12px;display:flex;align-items:center;gap:8px"><i data-lucide="package" style="color:var(--gold);width:20px;height:20px"></i> Products (${prods.length})</h3><div class="prod-grid">`+prods.map(p=>renderProductCard(p)).join("")+`</div>`;
  return html;
  return html;
}
function renderProductCard(p){
    const vars=productVariants(p.Product_ID); const total=productTotal(p.Product_ID); const low=isLow(p);
    const isOffer=p.Category==="OFFER";
    let imgUrl = p.Image_Data || "";
    if (imgUrl.includes("drive.google.com") && imgUrl.includes("id=")) {
      const fileId = imgUrl.split("id=")[1].split("&")[0];
      imgUrl = `https://drive.google.com/thumbnail?id=${fileId}&sz=w800`;
    }
    const hasImg = imgUrl.length > 10;
    return `<div class="card prod-card" style="${isOffer?"border-color:rgba(212,175,55,0.4)":""}"><div class="prod-img">${hasImg?`<img src="${imgUrl}" alt="${esc(p.Name)}" loading="lazy" />`:`<div class="ph"><i data-lucide="${isOffer?"gift":"gem"}"></i></div>`}${low?`<span class="low-badge"><span class="dot-pulse"></span>Low stock</span>`:""}<span class="price-pill">${egp(p.Price)} EGP</span>${isOffer?`<span style="position:absolute;top:12px;left:12px;background:var(--gold);color:#171205;font-size:10px;font-weight:700;padding:3px 10px;border-radius:999px">OFFER</span>`:""}</div>
    <div class="prod-body"><div class="prod-top"><div style="min-width:0"><h3>${esc(p.Name)}</h3><p class="cat">${isOffer?"Special Offer":esc(p.Category||"Uncategorized")}</p></div><div class="prod-tools"><button class="mini-btn" onclick="openProductModal(${p.Product_ID},${isOffer})" title="Edit"><i data-lucide="pencil"></i></button><button class="mini-btn danger" onclick="delProduct(${p.Product_ID})" title="Delete"><i data-lucide="trash-2"></i></button></div></div>
    <div class="prod-total"><span>Total in stock</span><b class="${low?"low":""}">${total}</b></div>
    ${isOffer&&p.Offer_Items?`<div class="prod-variants">${(()=>{try{return JSON.parse(p.Offer_Items).map(i=>`<span class="chip variant-chip">${esc(i.productName)} (${esc(i.variantName)}) ×${i.qty}</span>`).join("")}catch(e){return""}})()}</div>`
    :`<div class="prod-variants">${vars.map(v=>`<span class="chip variant-chip ${Number(v.Quantity)===0?"out":""}">${esc(v.Variant_Name)} · <b>${v.Quantity}</b></span>`).join("")}</div>`}
    <p class="prod-thr">Alert at ≤ ${p.Low_Stock_Threshold} pieces</p></div></div>`;
}

/* ---- product modal ---- */
function openProductModal(id,isOffer) {
  const p=id?DB.products.find(x=>Number(x.Product_ID)===id):null;
  if(p && p.Category==="OFFER") isOffer=true;
  DRAFT.img=p?p.Image_Data:null;
  DRAFT.isOffer=!!isOffer;
  DRAFT.offerItems=[];
  const vars=p?productVariants(p.Product_ID):[{Variant_Name:"",Quantity:""}];
  const titleText=isOffer?(p?"Edit offer":"Add new offer"):(p?"Edit product":"Add new product");
  const subText=isOffer?"Bundle products from inventory into a special offer":"Add a product with types, quantity and photo";

  /* Load existing offer items if editing */
  if(isOffer && p && p.Offer_Items) {
    try { DRAFT.offerItems=JSON.parse(p.Offer_Items); } catch(e) { DRAFT.offerItems=[]; }
  }

  const realProducts=DB.products.filter(x=>x.Category!=="OFFER");

  openModal(modalHead(titleText,subText)+`
    <div class="form-grid" style="grid-template-columns:1fr"><div style="display:grid;grid-template-columns:1fr;gap:16px" class="pm-cols">
      <div><span class="lbl">${isOffer?"Offer":"Product"} photo</span><button type="button" class="img-drop" onclick="document.getElementById('pm-file').click()">${DRAFT.img?`<img src="${DRAFT.img}"/><span class="swap"><span class="chip" style="background:#e9c766;color:#171205">Change</span></span>`:`<span class="hint"><i data-lucide="image-plus"></i><span>Upload from device</span></span>`}</button>${DRAFT.img?`<button class="btn btn-ghost btn-sm mt-16" style="width:100%" onclick="clearDraftImg()"><i data-lucide="x"></i> Remove</button>`:""}<input type="file" id="pm-file" accept="image/*" hidden onchange="pickImg(this)"/></div>
      <div class="form-grid c2"><div><label class="lbl">${isOffer?"Offer":"Product"} name *</label><input class="inp" id="pm-name" placeholder="${isOffer?"e.g. Summer Bundle 3+1":"e.g. Velvet Matte Lipstick"}" value="${esc(p?p.Name:"")}"/></div>${isOffer?"":`<div><label class="lbl">Category</label><input class="inp" id="pm-cat" placeholder="e.g. Lips" value="${esc(p?p.Category:"")}"/></div>`}<div><label class="lbl">Offer price (EGP) *</label><input class="inp" id="pm-price" type="number" min="0" step="0.5" value="${p?p.Price:""}"/></div><div><label class="lbl">Low-stock alert at</label><input class="inp" id="pm-thr" type="number" min="0" value="${p?p.Low_Stock_Threshold:5}"/></div></div>
    </div><style>@media(min-width:640px){.pm-cols{grid-template-columns:170px 1fr!important}}</style></div>
    ${isOffer?`
    <div class="mt-20">
      <label class="lbl">Products included in this offer *</label>
      <p style="font-size:11px;color:var(--faint);margin-bottom:10px">Select products from your inventory to bundle into this offer. When this offer is ordered, these products will be deducted from stock.</p>
      <div class="picker-grid">
        <select class="inp" id="of-prod" onchange="ofProdChange()"><option value="">Select product…</option>${realProducts.map(rp=>`<option value="${rp.Product_ID}">${esc(rp.Name)} (${productTotal(rp.Product_ID)} in stock)</option>`).join("")}</select>
        <select class="inp" id="of-var" disabled><option value="">Select variant…</option></select>
        <input class="inp" id="of-qty" type="number" min="1" value="1" placeholder="Qty"/>
        <button class="btn btn-dark" onclick="addOfferItem()"><i data-lucide="plus"></i> Add</button>
      </div>
      <div id="of-items">${renderOfferItems()}</div>
    </div>
    `:
    `<div class="mt-20"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px"><label class="lbl" style="margin:0">Variants *</label><span class="chip chip-gold" id="pm-total">Total: 0</span></div>
    <div id="pm-variants">${vars.map(v=>variantRowHTML(v)).join("")}</div>
    <button class="btn btn-ghost btn-sm" onclick="addVariantRow()"><i data-lucide="plus"></i> Add variant</button></div>`}
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveProduct(${p?p.Product_ID:"null"})">${p?"Save changes":isOffer?"Add offer":"Add to inventory"}</button></div></div>`,true);
  if(!isOffer) updateVariantTotal();
}

/* ---- offer item picker ---- */
function ofProdChange(){
  const pid=$("#of-prod").value; const sel=$("#of-var");
  if(!pid){sel.innerHTML=`<option value="">Select variant…</option>`;sel.disabled=true;return;}
  const vars=productVariants(pid);
  sel.disabled=false;
  sel.innerHTML=`<option value="">Select variant…</option><option value="random">Random (Any available)</option>`+vars.map(v=>`<option value="${v.Variant_ID}" ${Number(v.Quantity)===0?"disabled":""}>${esc(v.Variant_Name)} — ${v.Quantity} avail</option>`).join("");
}
function addOfferItem(){
  const pid=$("#of-prod").value; const vid=$("#of-var").value;
  const p=DB.products.find(x=>String(x.Product_ID)===pid);
  let vName = "";
  if (vid === "random") {
    vName = "Random";
  } else {
    const v=p&&productVariants(p.Product_ID).find(vv=>String(vv.Variant_ID)===vid);
    if(!p||!v) return toast("error","Choose a product and variant.");
    vName = v.Variant_Name;
  }
  const addQty=Math.max(1,parseInt($("#of-qty").value)||1);
  const existing=DRAFT.offerItems.find(i=>String(i.variantId)===String(vid) && String(i.productId)===String(pid));
  if(existing){existing.qty+=addQty;}
  else{DRAFT.offerItems.push({id: Date.now()+Math.random(), productId:p.Product_ID,variantId:vid,productName:p.Name,variantName:vName,qty:addQty});}
  $("#of-qty").value=1;
  $("#of-items").innerHTML=renderOfferItems();icons();
}
function rmOfferItem(id){DRAFT.offerItems=DRAFT.offerItems.filter(i=>String(i.id)!==String(id));$("#of-items").innerHTML=renderOfferItems();icons();}
function renderOfferItems(){
  if(!DRAFT.offerItems.length) return "";
  return `<div class="cart-box" style="margin-top:10px">`+DRAFT.offerItems.map(i=>`
    <div class="cart-line"><div class="cl-who"><b>${esc(i.productName)} <span>— ${esc(i.variantName)}</span></b></div>
    <div class="cl-ctl"><span class="cl-qty" style="width:auto;margin:0 8px">×${i.qty}</span>
    <button class="mini-btn danger" onclick="rmOfferItem('${i.id}')"><i data-lucide="x-circle"></i></button></div></div>`).join("")+`</div>`;
}
function variantRowHTML(v){return `<div class="variant-row"><input class="inp vname" placeholder="Variant name" value="${esc(v.Variant_Name||"")}"/><input class="inp vqty" type="number" min="0" placeholder="Qty" value="${v.Quantity===""||v.Quantity===undefined?"":v.Quantity}" oninput="updateVariantTotal()"/><button class="mini-btn danger" onclick="this.parentElement.remove();updateVariantTotal()"><i data-lucide="trash-2"></i></button></div>`;}
function addVariantRow(){$("#pm-variants").insertAdjacentHTML("beforeend",variantRowHTML({}));icons();}
function updateVariantTotal(){const t=$$("#pm-variants .vqty").reduce((s,i)=>s+Math.max(0,parseInt(i.value)||0),0);const el=$("#pm-total");if(el) el.textContent=`Total: ${t} pieces`;}
function pickImg(input){
  const file=input.files&&input.files[0];
  input.value="";
  if(!file)return;
  const reader=new FileReader();
  reader.onload=()=>{
    const img=new Image();
    img.onload=()=>{
      /* Max 600px — بيخلي الملف صغير وبيترفع بسرعة على Drive */
      const targetSize=600;
      const scale=Math.min(1,targetSize/Math.max(img.width,img.height));
      const c=document.createElement("canvas");
      c.width=Math.round(img.width*scale);
      c.height=Math.round(img.height*scale);
      const ctx=c.getContext("2d");
      ctx.fillStyle="#FFFFFF";
      ctx.fillRect(0,0,c.width,c.height);
      ctx.drawImage(img,0,0,c.width,c.height);
      /* جودة 0.7 = توازن ممتاز بين الحجم والوضوح */
      DRAFT.img=c.toDataURL("image/jpeg",0.7);
      const drop=$(".img-drop");
      if(drop)drop.innerHTML=`<img src="${DRAFT.img}"/><span class="swap"><span class="chip" style="background:#e9c766;color:#171205">Change</span></span>`;
    };
    img.src=reader.result;
  };
  reader.readAsDataURL(file);
}
function clearDraftImg(){DRAFT.img=null;const drop=$(".img-drop");if(drop)drop.innerHTML=`<span class="hint"><i data-lucide="image-plus"></i><span>Upload from device</span></span>`;icons();}

/* ---- RESTOCK (Supply) Modal ---- */
let RESTOCK_ITEMS = [];

function openRestockModal() {
  RESTOCK_ITEMS = [];
  const realProducts = DB.products.filter(x => x.Category !== "OFFER");
  openModal(modalHead("Restock — Add Supply", "Select products and add quantities to increase stock") + `
    <div class="picker-grid">
      <div style="position:relative">
        <input class="inp" id="rs-search" placeholder="Type or select product…" autocomplete="off" oninput="filterRestockProducts()" onfocus="filterRestockProducts()"/>
        <div id="rs-prod-list" style="display:none;position:absolute;top:100%;left:0;right:0;z-index:50;max-height:220px;overflow-y:auto;background:#12100b;border:1px solid var(--line);border-radius:0 0 12px 12px;box-shadow:0 12px 30px -8px rgba(0,0,0,.6)"></div>
      </div>
      <select class="inp" id="rs-var" disabled><option value="">Select variant…</option></select>
      <input class="inp" id="rs-qty" type="number" min="1" value="1" placeholder="Qty to add"/>
      <button class="btn btn-dark" onclick="addRestockItem()"><i data-lucide="plus"></i> Add</button>
    </div>
    <div id="rs-items"></div>
    <div class="modal-foot">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="confirmRestock()" style="background:linear-gradient(135deg,#6ee7b7,#059669);color:#fff"><i data-lucide="check-circle-2"></i> Confirm Restock</button>
    </div>
  </div>`, true);
}

function filterRestockProducts() {
  const q = ($("#rs-search").value || "").toLowerCase();
  const list = DB.products.filter(p => p.Category !== "OFFER" && (p.Name.toLowerCase().includes(q) || (p.Category || "").toLowerCase().includes(q)));
  const div = $("#rs-prod-list");
  if (!list.length) { div.innerHTML = '<div style="padding:12px;color:var(--faint);font-size:12px">No products found</div>'; div.style.display = "block"; return; }
  div.innerHTML = list.map(p => `<div onclick="selectRestockProduct(${p.Product_ID})" style="padding:10px 14px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--line);transition:background .15s" onmouseover="this.style.background='rgba(16,185,129,.1)'" onmouseout="this.style.background='transparent'"><b style="color:var(--champ)">${esc(p.Name)}</b> <span style="color:var(--faint)">(${productTotal(p.Product_ID)} in stock)</span></div>`).join("");
  div.style.display = "block";
}

function selectRestockProduct(pid) {
  const p = DB.products.find(x => Number(x.Product_ID) === pid);
  if (!p) return;
  $("#rs-search").value = p.Name;
  $("#rs-search").dataset.pid = pid;
  $("#rs-prod-list").style.display = "none";
  const vars = productVariants(pid);
  const sel = $("#rs-var");
  sel.disabled = false;
  sel.innerHTML = '<option value="">Select variant…</option>' + vars.map(v => `<option value="${v.Variant_ID}">${esc(v.Variant_Name)} — current: ${v.Quantity}</option>`).join("");
}

document.addEventListener("click", e => { const list = $("#rs-prod-list"); if (list && !e.target.closest("#rs-search") && !e.target.closest("#rs-prod-list")) list.style.display = "none"; });

function addRestockItem() {
  const pid = $("#rs-search").dataset.pid;
  const vid = $("#rs-var").value;
  const qty = Math.max(1, parseInt($("#rs-qty").value) || 1);
  const p = DB.products.find(x => String(x.Product_ID) === String(pid));
  const v = p && productVariants(p.Product_ID).find(vv => String(vv.Variant_ID) === String(vid));
  if (!p || !v) return toast("error", "Choose a product and variant first.");

  const existing = RESTOCK_ITEMS.find(i => String(i.variantId) === String(vid));
  if (existing) { existing.qty += qty; }
  else { RESTOCK_ITEMS.push({ productId: p.Product_ID, variantId: v.Variant_ID, productName: p.Name, variantName: v.Variant_Name, currentQty: Number(v.Quantity), qty: qty }); }

  $("#rs-qty").value = 1;
  renderRestockItems();
}

function rmRestockItem(vid) {
  RESTOCK_ITEMS = RESTOCK_ITEMS.filter(i => String(i.variantId) !== String(vid));
  renderRestockItems();
}

function renderRestockItems() {
  const box = $("#rs-items");
  if (!box) return;
  if (!RESTOCK_ITEMS.length) { box.innerHTML = ""; return; }
  box.innerHTML = `<div style="margin-top:16px;border:1px solid rgba(16,185,129,.3);border-radius:16px;overflow:hidden">
    <div style="padding:10px 16px;background:rgba(16,185,129,.08);font-size:11px;font-weight:700;color:#6ee7b7;text-transform:uppercase;letter-spacing:.08em">
      ${RESTOCK_ITEMS.length} item(s) to restock
    </div>
    ${RESTOCK_ITEMS.map(i => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 16px;border-top:1px solid var(--line)">
        <div>
          <b style="font-size:13px">${esc(i.productName)}</b>
          <span style="color:var(--faint);font-size:12px"> — ${esc(i.variantName)}</span>
          <div style="font-size:11px;color:var(--faint);margin-top:2px">Current: ${i.currentQty} → New: <b style="color:#6ee7b7">${i.currentQty + i.qty}</b> (+${i.qty})</div>
        </div>
        <button style="background:none;border:none;color:var(--red-soft);cursor:pointer" onclick="rmRestockItem('${i.variantId}')">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </button>
      </div>
    `).join("")}
  </div>`;
  icons();
}

async function confirmRestock() {
  if (!RESTOCK_ITEMS.length) return toast("error", "Add at least one item to restock.");
  closeModal();
  showLoading("Restocking inventory...");
  try {
    for (const item of RESTOCK_ITEMS) {
      const p = DB.products.find(x => String(x.Product_ID) === String(item.productId));
      if (!p) continue;
      const vars = productVariants(p.Product_ID);
      const updatedVariants = vars.map(v => {
        const addQty = String(v.Variant_ID) === String(item.variantId) ? item.qty : 0;
        return { name: v.Variant_Name, quantity: Number(v.Quantity) + addQty };
      });
      await api("saveProduct", {
        Product_ID: p.Product_ID,
        Name: p.Name,
        Category: p.Category,
        Price: p.Price,
        Low_Stock_Threshold: p.Low_Stock_Threshold,
        Offer_Items: p.Offer_Items || "",
        variants: updatedVariants
      });
    }
    toast("success", `${RESTOCK_ITEMS.length} item(s) restocked successfully!`);
    RESTOCK_ITEMS = [];
    await loadAllData();
    render();
  } catch (e) {
    toast("error", "Restock failed. Please try again.");
    bgSync();
  } finally {
    hideLoading();
  }
}

async function saveProduct(id) {
  const name=$("#pm-name").value.trim(); const catEl=$("#pm-cat"); const category=DRAFT.isOffer?"OFFER":(catEl?catEl.value.trim():"");
  const price=parseFloat($("#pm-price").value); const thr=Math.max(0,parseInt($("#pm-thr").value)||0);
  if(!name) return toast("error","Name is required.");
  if(!Number.isFinite(price)||price<0) return toast("error","Enter a valid price.");

  let variants=[];
  if(DRAFT.isOffer){
    if(!DRAFT.offerItems.length) return toast("error","Add at least one product to the offer.");
    /* For offers: create a single variant "Offer" with qty from Low_Stock_Threshold or 1 */
    variants=[{name:"Offer",quantity:Math.max(1,thr)}];
  } else {
    const rows=$$("#pm-variants .variant-row");
    variants=rows.map(r=>({name:$(".vname",r).value.trim()||"Standard",quantity:Math.max(0,parseInt($(".vqty",r).value)||0)})).filter(v=>v.quantity>0||v.name);
    if(!variants.length) return toast("error","Add at least one variant.");
  }
  const imgToSend = DRAFT.img || "";
  const offerItemsJson=DRAFT.isOffer?JSON.stringify(DRAFT.offerItems):"";
  const localId = id || Date.now();
  const optimisticProduct = {
    Product_ID: localId,
    Name: name,
    Category: category,
    Price: price,
    Image_Data: imgToSend,
    Low_Stock_Threshold: thr,
    Created_At: pCurrentDate(),
    Offer_Items: offerItemsJson,
  };
  DB.products = DB.products.filter(p=>Number(p.Product_ID)!==Number(localId));
  DB.products.unshift(optimisticProduct);
  DB.variants = DB.variants.filter(v=>String(v.Product_ID)!==String(localId));
  variants.forEach((v,idx)=>DB.variants.push({Variant_ID:`tmp_${localId}_${idx}`,Product_ID:localId,Variant_Name:v.name||"Standard",Quantity:Number(v.quantity)||0}));
  saveCache();
  closeModal();
  render();
  toast("success",(imgToSend.indexOf("data:image")===0?"Uploading image and ":"") + (id?`"${name}" updated.`:`"${name}" added.`));
  api("saveProduct",{Product_ID:id,Name:name,Category:category,Price:price,Image_Data:imgToSend,Low_Stock_Threshold:thr,variants,Offer_Items:offerItemsJson})
    .then(()=>bgSync())
    .catch(()=>{toast("error","Sync failed — retrying…"); bgSync();});
}
function pCurrentDate(){return new Date().toISOString();}

async function delProduct(id) {
  const p=DB.products.find(x=>Number(x.Product_ID)===id); if(!p)return;
  confirmDlg("Delete product",`Delete "${p.Name}"?`,"Delete",true,async()=>{
    DB.products=DB.products.filter(x=>Number(x.Product_ID)!==id);
    DB.variants=DB.variants.filter(v=>String(v.Product_ID)!==String(id));
    saveCache(); toast("success",`"${p.Name}" deleted.`); render();
    api("deleteProduct",{Product_ID:id}).then(()=>bgSync()).catch(()=>bgSync());
  });
}

/* =====================================================
   8) ORDERS
   ===================================================== */
function ordersHTML() {
  const canView = can("viewOrders");
  const counts={"":DB.orders.length}; DB.orders.forEach(o=>(counts[o.Status]=(counts[o.Status]||0)+1));
  let html = `<div class="toolbar"><div class="search-wrap"><i data-lucide="search"></i><input class="inp" placeholder="Search by phone or name…" value="${esc(UI.ordSearch)}" oninput="ordSearch(this.value)"/></div><button class="btn btn-primary" onclick="openOrderModal()"><i data-lucide="plus"></i> New Order</button></div>`;
  if (!canView) {
    html += `<div class="card empty"><i data-lucide="eye-off"></i><p>You have permission to register orders only. You cannot view the orders list.</p></div>`;
    return html;
  }
  html += `<div class="filters">${["", ...STATUSES].map(s=>`<button class="chip ${UI.ordStatus===s?"on":""} chip-line" onclick="ordFilter('${s}')">${s?s.toUpperCase()+" · "+(counts[s]||0):"ALL"}</button>`).join("")}</div>
  <div id="ord-selbar">${selbarHTML()}</div><div id="ord-list">${ordersListHTML()}</div>`;
  return html;
}
function ordSearch(v){UI.ordSearch=v;$("#ord-list").innerHTML=ordersListHTML();icons();}
function ordFilter(s){UI.ordStatus=s;UI.selected=new Set();render();}
function filteredOrders(){const q=UI.ordSearch.toLowerCase().trim();return DB.orders.filter(o=>{if(UI.ordStatus&&o.Status!==UI.ordStatus)return false;if(!q)return true;return cleanPhone(o.Phone_1).includes(q)||cleanPhone(o.Phone_2).includes(q)||(o.Customer_Name||"").toLowerCase().includes(q);});}

function deleteOrder(id){
  const o=DB.orders.find(x=>Number(x.Order_ID)===Number(id));if(!o)return;
  confirmDlg("Delete Order",`Are you sure you want to delete order #${o.Order_ID} for "${o.Customer_Name}"? This cannot be undone.`,"Yes, Delete",true,async()=>{
    DB.orders=DB.orders.filter(x=>Number(x.Order_ID)!==Number(id));
    DB.orderItems=DB.orderItems.filter(x=>String(x.Order_ID)!==String(id));
    saveCache();toast("success",`Order #${id} deleted.`);render();
    api("deleteOrder",{Order_ID:id}).then(()=>bgSync()).catch(()=>bgSync());
  });
}
function deleteSelectedOrders(){
  const count=UI.selected.size;if(!count)return;
  confirmDlg("Delete Orders",`Are you sure you want to delete ${count} selected order(s)? This cannot be undone.`,"Yes, Delete All",true,async()=>{
    const ids=[...UI.selected];
    DB.orders=DB.orders.filter(o=>!ids.includes(Number(o.Order_ID)));
    DB.orderItems=DB.orderItems.filter(i=>!ids.includes(Number(i.Order_ID)));
    UI.selected=new Set();saveCache();toast("success",`${count} order(s) deleted.`);render();
    for(const id of ids){api("deleteOrder",{Order_ID:id}).catch(()=>{});}
    setTimeout(bgSync,2000);
  });
}

function cleanPhone(p){return String(p||"").replace(/^'/,"");}
function ordersListHTML() {
  const list=filteredOrders(); const isAdmin=me()&&me().Role==="admin";
  if(!list.length) return `<div class="card empty"><i data-lucide="shopping-bag"></i><p>No orders found.</p></div>`;
  return `<div class="stack">`+list.map(o=>{
    const items=orderItems(o.Order_ID); const ph1=cleanPhone(o.Phone_1); const ph2=cleanPhone(o.Phone_2);
    return `<div class="card order-card ${UI.selected.has(Number(o.Order_ID))?"selected":""}">
      <div class="order-row"><label class="order-check"><input type="checkbox" ${UI.selected.has(Number(o.Order_ID))?"checked":""} onchange="toggleSel(${o.Order_ID})"/></label>
        <div class="order-main"><div class="order-head"><span class="num">#${o.Order_ID}</span><h3>${esc(o.Customer_Name)}</h3><span class="chip status-${o.Status}" style="text-transform:uppercase">${o.Status}</span>${o.Weight?`<span class="chip chip-line"><i data-lucide="weight"></i> ${o.Weight}g</span>`:""}</div>
          <div class="order-meta"><span><i data-lucide="phone"></i>${esc(ph1)}${ph2?" · "+esc(ph2):""}</span><span><i data-lucide="map-pin"></i>${esc(o.Street)}</span><span><i data-lucide="building-2"></i>${esc(o.City||"—")}</span></div>
          ${o.Notes?`<div style="margin-top:8px;font-size:12px;color:var(--champ);font-weight:700;line-height:1.6"><i data-lucide="file-text" style="width:13px;height:13px;display:inline-block;vertical-align:middle;margin-right:5px;color:var(--gold-soft)"></i><span style="font-weight:800">${esc(o.Notes)}</span></div>`:""}
          <div class="items-row">${(()=>{
            /* Group items: main offer items + sub-items (from ...) */
            const mainItems=items.filter(i=>!i.Product_Name.includes("(from "));
            const subItems=items.filter(i=>i.Product_Name.includes("(from "));
            return mainItems.map(mi=>{
              const prod=DB.products.find(p=>String(p.Product_ID)===String(mi.Product_ID));
              const isOffer=prod&&prod.Category==="OFFER";
              const offerId="oi_"+o.Order_ID+"_"+mi.Product_ID;
              const offerSubs=isOffer?subItems.filter(s=>s.Product_Name.includes("from "+mi.Product_Name)):[];
              return `<span class="chip chip-line" style="${isOffer?"border-color:rgba(212,175,55,0.4)":""}">
                ${isOffer?`<span style="background:var(--gold);color:#171205;font-size:9px;font-weight:700;padding:1px 5px;border-radius:999px;margin-right:3px">OFFER</span>`:""}
                ${esc(mi.Product_Name)}${mi.Variant_Name&&String(mi.Variant_Name).indexOf("Offer")===-1?" <span style='color:var(--gold-soft);font-weight:600'>("+esc(mi.Variant_Name)+")</span>":""} <b>×${mi.Quantity}</b>
                ${isOffer&&offerSubs.length?`<button onclick="toggleOfferDetails('${offerId}')" style="background:transparent;border:none;color:var(--gold-soft);cursor:pointer;font-size:11px;font-weight:700;padding:0 4px" title="Show contents">▾</button><span id="${offerId}" style="display:none;width:100%;padding-top:4px;padding-left:6px;font-size:10px;color:var(--faint)">${offerSubs.map(s=>"• "+s.Product_Name.replace(/\s*\(from[^)]+\)/,"")+' ('+s.Variant_Name+') ×'+s.Quantity).join("<br/>")}</span>`:""}
              </span>`;
            }).join("");
          })()}</div>
          <div class="order-foot"><span><i data-lucide="truck"></i>${SHIP_LABEL[o.Shipping_Type]||o.Shipping_Type} · ${Number(o.Shipping_Price)===0?"0":egp(o.Shipping_Price)} EGP</span><span><i data-lucide="wallet"></i>Collection ${egp(Number(o.Collection_Fee)||Math.max(0,Number(o.Grand_Total)-Number(o.Items_Total)-Number(o.Shipping_Price)+Number(o.Discount||0)))} EGP</span><span><i data-lucide="user"></i>by <b>${esc(o.Created_By||"—")}</b></span><span>${fmtDT(o.Date)}</span>${o.Status==="returned"&&toBool(o.Stock_Restored)?'<span class="restored">· stock restored</span>':""}</div></div>
        <div class="order-total"><small>Items</small><p class="it">${egp(o.Items_Total)}</p>${Number(o.Discount)>0?`<small style="margin-top:4px;color:var(--red-soft)">Discount</small><p class="it" style="color:var(--red-soft)">- ${egp(o.Discount)}</p>`:""}<small style="margin-top:4px">Total</small><p class="gt">${egp(o.Grand_Total)} <small>EGP</small></p></div></div>
      <div class="order-actions">${(NEXT_ACTIONS[o.Status]||[]).map(a=>`<button class="btn btn-sm ${a.cls}" onclick="setStatus(${o.Order_ID},'${a.to}')"><i data-lucide="${a.icon}"></i> ${a.label}</button>`).join("")}${o.Weight?`<button class="btn btn-sm btn-primary" onclick="exportShipping([${o.Order_ID}])"><i data-lucide="file-spreadsheet"></i> Export Shipping</button>`:""}${isAdmin?`<button class="btn btn-sm btn-danger" onclick="deleteOrder(${o.Order_ID})"><i data-lucide="trash-2"></i> Delete</button>`:""}</div></div>`;
  }).join("")+`</div>`;
}

function selbarHTML(){
  if(!UI.selected.size) return "";
  const selO=DB.orders.filter(o=>UI.selected.has(Number(o.Order_ID)));
  const allW=selO.every(o=>o.Weight); const isAdmin=me()&&me().Role==="admin";
  return `<div class="selbar anim-pop"><p>${UI.selected.size} order(s) selected</p><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-ghost btn-sm" onclick="clearSel()">Clear</button><button class="btn btn-primary btn-sm" onclick="exportSel()"><i data-lucide="file-spreadsheet"></i> Export Excel</button>${allW?`<button class="btn btn-dark btn-sm" onclick="exportShipping([...UI.selected])"><i data-lucide="truck"></i> Shipping Sheet</button>`:""}${isAdmin?`<button class="btn btn-danger btn-sm" onclick="deleteSelectedOrders()"><i data-lucide="trash-2"></i> Delete Selected</button>`:""}</div></div>`;
}
function toggleSel(id){id=Number(id);if(UI.selected.has(id))UI.selected.delete(id);else UI.selected.add(id);$("#ord-selbar").innerHTML=selbarHTML();$("#ord-list").innerHTML=ordersListHTML();icons();}
function clearSel(){UI.selected=new Set();$("#ord-selbar").innerHTML="";$("#ord-list").innerHTML=ordersListHTML();icons();}

/* ---- status ---- */
async function setStatus(id,to) {
  const o=DB.orders.find(x=>Number(x.Order_ID)===Number(id)); if(!o)return;
  if(to==="returned"){confirmDlg("Return order",`Return order #${o.Order_ID}?`,"Confirm return",true,()=>doSetStatus(o,"returned"));return;}
  if(to==="ready"){openWeightModal(o);return;}
  doSetStatus(o,to);
}
function openWeightModal(o){
  openModal(modalHead("Mark Ready — Enter Weight",`Order #${o.Order_ID}`)+`
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px"><div class="stat-ico tint-gold" style="flex-shrink:0"><i data-lucide="weight"></i></div><div><p style="font-size:14px;font-weight:600">Package weight in grams</p></div></div>
    <label class="lbl">Weight (grams) *</label><input class="inp" id="wt-grams" type="number" min="1" placeholder="e.g. 500" autofocus/>
    <input type="hidden" id="wt-oid" value="${o.Order_ID}"/>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="confirmReady()"><i data-lucide="package-check"></i> Mark Ready</button></div></div>`);
}
async function confirmReady(){
  const id=Number($("#wt-oid").value); const grams=parseInt($("#wt-grams").value);
  if(!grams||grams<1) return toast("error","Enter a valid weight.");
  const o=DB.orders.find(x=>Number(x.Order_ID)===id); if(o){o.Status="ready";o.Weight=grams;saveCache();}
  closeModal(); toast("success",`Order #${id} marked as ready.`); render();
  api("updateOrder",{Order_ID:id,Status:"ready",Weight:grams}).then(()=>bgSync()).catch(()=>bgSync());
}
async function doSetStatus(o,to){
  o.Status=to; if(to==="returned") o.Stock_Restored="true";
  saveCache(); toast("success",`Order #${o.Order_ID} → ${to}${to==="returned"?" — stock restored":""}.`); render();
  api("updateOrder",{Order_ID:o.Order_ID,Status:to}).then(()=>{
    if(to!=="returned") sendNotifications("order",`Order #${o.Order_ID} → ${to} by ${me().Username}.`);
    bgSync();
  }).catch(()=>bgSync());
}

/* ---- new order ---- */
function openOrderModal(){
  if(!DB.products.length){toast("error","Add products first.");return;}
  DRAFT.cart=[];const extra=getExtraShipping();
  openModal(modalHead("New order","Stock deducted automatically")+`
    <div class="form-grid c2"><div><label class="lbl">Customer name *</label><input class="inp" id="no-name" placeholder="Full name"/></div><div><label class="lbl">Phone 1 *</label><input class="inp" id="no-p1" type="tel" placeholder="01xxxxxxxxx"/></div><div><label class="lbl">Phone 2</label><input class="inp" id="no-p2" type="tel" placeholder="Optional"/></div><div><label class="lbl">Street *</label><input class="inp" id="no-street" placeholder="Street, area…"/></div><div><label class="lbl">City *</label><select class="inp" id="no-city"><option value="">Select city…</option>${CITIES.map(c=>`<option value="${c}">${c}</option>`).join("")}</select></div></div>
    <div class="mt-20"><label class="lbl">Notes (Optional)</label><textarea class="inp" id="no-notes" placeholder="Any special instructions for this order…" style="min-height:60px;resize:vertical"></textarea></div>
    <div class="mt-20"><label class="lbl">Products *</label><div class="picker-grid">
      <div style="position:relative"><input class="inp" id="no-prod-search" placeholder="Type or select product…" autocomplete="off" oninput="filterProducts()" onfocus="filterProducts()"/><input type="hidden" id="no-prod" /><div id="no-prod-list" style="display:none;position:absolute;top:100%;left:0;right:0;z-index:50;max-height:220px;overflow-y:auto;background:#12100b;border:1px solid var(--line);border-radius:0 0 12px 12px;box-shadow:0 12px 30px -8px rgba(0,0,0,.6)"></div></div>
      <select class="inp" id="no-var" disabled><option value="">Select variant…</option></select><input class="inp" id="no-qty" type="number" min="1" value="1" placeholder="Qty"/><button class="btn btn-dark" onclick="addToCart()"><i data-lucide="plus"></i> Add</button></div><p class="picker-hint" id="no-hint"></p><div id="no-cart"></div></div>
    <div class="mt-20"><label class="lbl">Shipping *</label><div class="ship-grid"><button type="button" class="ship-opt" data-ship="free" onclick="shipPick('free')"><b>Free Shipping</b><span>0 EGP</span></button><button type="button" class="ship-opt" data-ship="extra_free" onclick="shipPick('extra_free')"><b>Extra Free</b><span>Fixed by admin</span></button><button type="button" class="ship-opt on" data-ship="normal" onclick="shipPick('normal')"><b>Standard</b><span>Enter price</span></button></div><div class="mt-16 w-xs"><label class="lbl">Shipping price (EGP)</label><input class="inp" id="no-ship-price" type="number" min="0" value="${extra}" data-normal="" oninput="updTotals()"/><p class="hint-sm" id="no-ship-note" style="display:none">Fixed by admin.</p></div></div>
    <div class="totals">
      <div class="trow"><span>Items total</span><span id="no-items-total">0.00 EGP</span></div>
      <div class="trow"><span>Shipping</span><span id="no-ship-total">${egp(extra)} EGP</span></div>
      <div class="trow"><span>Collection fee</span><span id="no-collection-total">${egp(getCollectionFee())} EGP</span></div>
      <div class="trow" style="align-items:center;gap:8px">
        <span style="white-space:nowrap">Discount</span>
        <div style="display:flex;align-items:center;gap:6px;margin-left:auto">
          <input class="inp" id="no-discount" type="number" min="0" value="0" oninput="updTotals()" style="width:90px;text-align:right;padding:4px 8px"/>
          <select class="inp" id="no-discount-type" onchange="updTotals()" style="width:70px;padding:4px 8px">
            <option value="amount">EGP</option>
            <option value="percent">%</option>
          </select>
        </div>
      </div>
      <div class="trow grand"><span>Grand total</span><b id="no-grand">${egp(extra + getCollectionFee())} EGP</b></div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveOrder()">Register order</button></div></div>`,true);
  shipPick("normal");updTotals();
}
function filterProducts(){
  const q=($("#no-prod-search").value||"").toLowerCase();
  const list=DB.products.filter(p=>p.Name.toLowerCase().includes(q)||(p.Category||"").toLowerCase().includes(q));
  const div=$("#no-prod-list");
  if(!list.length){div.innerHTML=`<div style="padding:12px;color:var(--faint);font-size:12px">No products found</div>`;div.style.display="block";return;}
  div.innerHTML=list.map(p=>`<div onclick="selectProduct(${p.Product_ID})" style="padding:10px 14px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--line);transition:background .15s" onmouseover="this.style.background='rgba(212,175,55,.1)'" onmouseout="this.style.background='transparent'"><b style="color:var(--champ)">${esc(p.Name)}</b> <span style="color:var(--faint)">— ${egp(p.Price)} EGP (${productTotal(p.Product_ID)} in stock)</span>${p.Category==="OFFER"?` <span style="background:var(--gold);color:#171205;font-size:9px;font-weight:700;padding:2px 6px;border-radius:999px;margin-left:4px">OFFER</span>`:""}</div>`).join("");
  div.style.display="block";
}
function selectProduct(pid){
  const p=DB.products.find(x=>Number(x.Product_ID)===pid);
  if(!p)return;
  $("#no-prod").value=pid;
  $("#no-prod-search").value=p.Name+" — "+egp(p.Price)+" EGP";
  $("#no-prod-list").style.display="none";
  noProdChange();
}
document.addEventListener("click",e=>{const list=$("#no-prod-list");if(list&&!e.target.closest("#no-prod-search")&&!e.target.closest("#no-prod-list"))list.style.display="none";});

function noProdChange(){const p=DB.products.find(x=>String(x.Product_ID)===$("#no-prod").value);const sel=$("#no-var");if(!p){sel.innerHTML=`<option value="">Select variant…</option>`;sel.disabled=true;return;}sel.disabled=false;const vars=productVariants(p.Product_ID);sel.innerHTML=`<option value="">Select variant…</option>`+vars.map(v=>`<option value="${v.Variant_ID}" ${Number(v.Quantity)===0?"disabled":""}>${esc(v.Variant_Name)} — ${v.Quantity} avail</option>`).join("");}
function addToCart(){
  const p=DB.products.find(x=>String(x.Product_ID)===$("#no-prod").value);const v=p&&productVariants(p.Product_ID).find(vv=>String(vv.Variant_ID)===$("#no-var").value);
  if(!p||!v)return toast("error","Choose a product and variant.");
  const qty=Math.max(1,parseInt($("#no-qty").value)||1);const line=DRAFT.cart.find(l=>String(l.variantId)===String(v.Variant_ID));const already=line?line.quantity:0;
  if(already+qty>Number(v.Quantity))return toast("error",`Only ${v.Quantity} in stock.`);
  
  if(line){
    line.quantity+=qty;
  }else{
    let subItems = [];
    if(p.Category==="OFFER" && p.Offer_Items) {
      try { subItems = JSON.parse(p.Offer_Items); } catch(e){}
    }
    DRAFT.cart.push({productId:p.Product_ID,variantId:v.Variant_ID,productName:p.Name,variantName:v.Variant_Name,unitPrice:Number(p.Price),quantity:qty,max:Number(v.Quantity),subItems:subItems});
  }
  $("#no-qty").value=1;renderCart();
}
function cartDelta(vid,d){const line=DRAFT.cart.find(l=>String(l.variantId)===String(vid));if(!line)return;line.quantity=Math.min(line.max,Math.max(1,line.quantity+d));renderCart();}
function cartRm(vid){DRAFT.cart=DRAFT.cart.filter(l=>String(l.variantId)!==String(vid));renderCart();}
function rmSubItem(cartVid, subIdx) {
  const line=DRAFT.cart.find(l=>String(l.variantId)===String(cartVid));
  if(line && line.subItems) { line.subItems.splice(subIdx, 1); renderCart(); }
}
function renderCart(){
  const box=$("#no-cart");if(!box)return;
  if(!DRAFT.cart.length){box.innerHTML="";}else{
    box.innerHTML=`<div class="cart-box">`+DRAFT.cart.map(l=>`
      <div class="cart-line" style="flex-direction:column;align-items:stretch">
        <div style="display:flex;align-items:center;justify-content:space-between;width:100%">
          <div class="cl-who"><b>${esc(l.productName)} <span>— ${esc(l.variantName)}</span></b><small>${egp(l.unitPrice)} each</small></div>
          <div class="cl-ctl"><button class="qty-btn" onclick="cartDelta('${l.variantId}',-1)">−</button><span class="cl-qty">${l.quantity}</span><button class="qty-btn" onclick="cartDelta('${l.variantId}',1)" ${l.quantity>=l.max?"disabled":""}>+</button><span class="cl-sum">${egp(l.unitPrice*l.quantity)}</span><button class="mini-btn danger" onclick="cartRm('${l.variantId}')"><i data-lucide="x-circle"></i></button></div>
        </div>
        ${l.subItems && l.subItems.length ? `<div style="margin-top:8px;padding-top:8px;border-top:1px dashed var(--line)">
          <p style="font-size:10px;color:var(--faint);margin-bottom:6px;font-weight:700;text-transform:uppercase">Offer Contents:</p>
          ${l.subItems.map((si, sidx) => `<div style="display:flex;align-items:center;justify-content:space-between;font-size:11px;color:var(--muted);padding:4px 0"><span>• ${esc(si.productName)} (${esc(si.variantName)}) ×${si.qty}</span><button style="background:none;border:none;color:var(--red-soft);cursor:pointer;font-size:10px" onclick="rmSubItem('${l.variantId}', ${sidx})"><i data-lucide="x" style="width:12px;height:12px"></i></button></div>`).join("")}
        </div>` : ""}
      </div>`).join("")+`</div>`;
  }
  icons();updTotals();
}
function shipPick(type){$$(".ship-opt").forEach(b=>b.classList.toggle("on",b.dataset.ship===type));const pi=$("#no-ship-price");const note=$("#no-ship-note");if(!pi)return;if(type==="free"){if(!pi.disabled)pi.dataset.normal=pi.value;pi.value=0;pi.disabled=true;note.style.display="none";}else if(type==="extra_free"){if(!pi.disabled)pi.dataset.normal=pi.value;pi.value=getExtraShipping();pi.disabled=true;note.style.display="block";}else{pi.disabled=false;pi.value=pi.dataset.normal||"";note.style.display="none";}updTotals();}
function currentShipType(){const on=$(".ship-opt.on");return on?on.dataset.ship:"normal";}
function getDiscount(items,ship){
  const dVal=Math.max(0,parseFloat($("#no-discount")?.value)||0);
  const dType=$("#no-discount-type")?.value||"amount";
  if(dType==="percent") return Math.min(items+ship, (items+ship)*dVal/100);
  return Math.min(items+ship, dVal);
}
function updTotals(){
  const items=DRAFT.cart.reduce((s,l)=>s+l.quantity*l.unitPrice,0);
  const ship=Math.max(0,parseFloat($("#no-ship-price")?.value)||0);
  const collection=getCollectionFee();
  const discount=getDiscount(items,ship+collection);
  const grand=Math.max(0,items+ship+collection-discount);
  const it=$("#no-items-total"),st=$("#no-ship-total"),ct=$("#no-collection-total"),gt=$("#no-grand");
  if(it)it.textContent=egp(items)+" EGP";
  if(st)st.textContent=egp(ship)+" EGP";
  if(ct)ct.textContent=egp(collection)+" EGP";
  if(gt)gt.textContent=egp(grand)+" EGP";
}

let _savingOrder = false;
async function saveOrder(){
  if(_savingOrder) return;
  const name=$("#no-name").value.trim();const street=$("#no-street").value.trim();const city=$("#no-city").value;const p1=$("#no-p1").value.trim();const p2=$("#no-p2").value.trim();
  const notes=$("#no-notes")?$("#no-notes").value.trim():"";
  if(!name)return toast("error","Customer name required.");if(!p1)return toast("error","Phone required.");if(!street)return toast("error","Street required.");if(!city)return toast("error","City required.");if(!DRAFT.cart.length)return toast("error","Add products.");
  const shipType=currentShipType();const shipPrice=shipType==="free"?0:shipType==="extra_free"?getExtraShipping():Math.max(0,parseFloat($("#no-ship-price").value)||0);
  const collectionFee=getCollectionFee();
  const itemsTotal=DRAFT.cart.reduce((s,l)=>s+l.quantity*l.unitPrice,0);
  const discount=getDiscount(itemsTotal,shipPrice+collectionFee);
  const grandTotal=Math.max(0,itemsTotal+shipPrice+collectionFee-discount);
  const cartCopy=DRAFT.cart.map(l=>({...l}));
  const expandedItems = cartCopy.flatMap(l=>{
    const mainItem={Product_ID:l.productId,Variant_ID:l.variantId,Product_Name:l.productName,Variant_Name:l.variantName,Quantity:l.quantity,Unit_Price:l.unitPrice};
    if(l.subItems && l.subItems.length>0){
      try{
        const subItems=l.subItems.map(oi=>{
          let actualVid=oi.variantId; let actualVName=oi.variantName;
          if(actualVid==="random"){
            const availVars=productVariants(oi.productId).filter(v=>Number(v.Quantity)>=(oi.qty*l.quantity));
            if(availVars.length>0){ const picked=availVars[Math.floor(Math.random()*availVars.length)]; actualVid=picked.Variant_ID; actualVName=picked.Variant_Name+" (Random)"; }
            else{ const fb=productVariants(oi.productId)[0]; actualVid=fb?fb.Variant_ID:""; actualVName=fb?fb.Variant_Name+" (Random)":""; }
          }
          return {Product_ID:oi.productId,Variant_ID:actualVid,Product_Name:oi.productName+" (from "+l.productName+")",Variant_Name:actualVName,Quantity:oi.qty*l.quantity,Unit_Price:0};
        });
        return [mainItem,...subItems];
      }catch(e){return [mainItem];}
    }
    return [mainItem];
  });
  _savingOrder = true;
  closeModal();
  showLoading("Registering order...");
  try{
    const res = await api("saveOrder",{
      Customer_Name:name,Phone_1:"'"+p1,Phone_2:p2?("'"+p2):"",
      Street:street,City:city,Notes:notes,
      Shipping_Type:shipType,Shipping_Price:shipPrice,
      Collection_Fee:collectionFee,Items_Total:itemsTotal,
      Discount:discount,Grand_Total:grandTotal,
      Status:"pending",Created_By:me().Username,items:expandedItems
    });
    sendNotifications("order","New order #"+res.Order_ID+" for "+name+" by "+me().Username+".").catch(()=>{});
    toast("success","Order #"+res.Order_ID+" registered!");
    await loadAllData();
    render();
  }catch(e){
    toast("error","Failed to register. Please try again.");
  }finally{
    hideLoading();
    _savingOrder = false;
  }
}

/* ---- exports ---- */
function exportSel(){
  const rows=DB.orders.filter(o=>UI.selected.has(Number(o.Order_ID))).sort((a,b)=>new Date(a.Date)-new Date(b.Date));if(!rows.length)return;
  const head=["Order #","Date","Customer","Phone 1","Phone 2","Street","City","Notes","Items","Pieces","Items Total","Shipping","Discount","Grand Total","Status","Weight","Added By"];
  const data=rows.map(o=>{const its=orderItems(o.Order_ID);return[o.Order_ID,fmtDT(o.Date),o.Customer_Name,cleanPhone(o.Phone_1),cleanPhone(o.Phone_2)||"—",o.Street,o.City,o.Notes||"—",its.map(i=>`${i.Product_Name} x${i.Quantity}`).join(" | "),its.reduce((s,i)=>s+Number(i.Quantity),0),o.Items_Total,o.Shipping_Price,o.Discount||0,o.Grand_Total,o.Status.toUpperCase(),o.Weight||"—",o.Created_By||"—"];});
  if(window.XLSX){const wb=XLSX.utils.book_new();const ws=XLSX.utils.aoa_to_sheet([["SHE OUT"],[`${rows.length} order(s)`],[],head,...data]);ws["!merges"]=[{s:{r:0,c:0},e:{r:0,c:15}},{s:{r:1,c:0},e:{r:1,c:15}}];ws["!cols"]=head.map(()=>({wch:16}));XLSX.utils.book_append_sheet(wb,ws,"Orders");XLSX.writeFile(wb,`SHE-OUT-orders-${todayStr()}.xlsx`);}
  toast("success",`${rows.length} exported.`);UI.selected=new Set();render();
}
function exportShipping(ids){
  const idArr=Array.isArray(ids)?ids:[...ids];const rows=DB.orders.filter(o=>idArr.includes(Number(o.Order_ID))&&o.Weight).sort((a,b)=>new Date(a.Date)-new Date(b.Date));
  if(!rows.length)return toast("error","No orders with weight.");
  const H=["Package_Serial","Description","Total_Weight","Package_volume","COD_Value","Item_Special_Notes","Customer_Name","Mobile_No","Street","City","Package_Ref. Number","Merchant_Name","Warehouse_Name","HasPOD","SellerName","Post_Id"];
  const RED=new Set([0,1,2,3,4,5,6,7,8,9]);
  const data=rows.map((o,i)=>{
    /* For shipping: show only main items (not offer sub-items) */
    const its=orderItems(o.Order_ID);
    const mainIts=its.filter(it=>!it.Product_Name.includes("(from "));
    const itemsSummary=mainIts.map(it=>it.Product_Name+" ×"+it.Quantity).join(" | ");
    return [i+1,"she out اكسسوارات نسائيه - ممنوع الفتح",o.Weight,"Small",o.Grand_Total,"غير مطلوب تحقيق هويه",o.Customer_Name,cleanPhone(o.Phone_1),o.Street,o.City,"","","","","",""];
  });
  if(window.XLSX){const wb=XLSX.utils.book_new();const ws=XLSX.utils.aoa_to_sheet([H,...data]);ws["!cols"]=[{wch:15},{wch:42},{wch:13},{wch:15},{wch:12},{wch:26},{wch:22},{wch:24},{wch:38},{wch:14},{wch:20},{wch:16},{wch:16},{wch:10},{wch:14},{wch:10}];
  for(let c=0;c<H.length;c++){const ref=XLSX.utils.encode_cell({r:0,c});if(!ws[ref])ws[ref]={v:H[c],t:"s"};ws[ref].s={font:{bold:true,color:{rgb:RED.has(c)?"FF0000":"000000"},sz:11}};}
  for(let r=0;r<data.length;r++){for(let c=0;c<H.length;c++){const ref=XLSX.utils.encode_cell({r:r+1,c});if(ws[ref])ws[ref].s={font:{color:{rgb:"000000"},sz:11}};}}
  XLSX.utils.book_append_sheet(wb,ws,"Shipping");XLSX.writeFile(wb,`SHE-OUT-shipping-${todayStr()}.xlsx`,{cellStyles:true});}
  toast("success",`Shipping sheet for ${rows.length} order(s).`);
}

/* =====================================================
   9) REPORTS
   ===================================================== */
function rangeBounds(ds,range){const base=new Date(ds+"T00:00:00");if(isNaN(base))return null;const start=new Date(base),end=new Date(base);if(range==="week"){const day=(base.getDay()+6)%7;start.setDate(base.getDate()-day);end.setTime(start.getTime());end.setDate(start.getDate()+7);}else if(range==="month"){start.setDate(1);end.setMonth(start.getMonth()+1,1);}else{end.setDate(base.getDate()+1);}return{start,end};}
function setRange(r){UI.repRange=r;render();}
function pickRepDate(v){UI.repDate=v;render();}
function stepRep(dir){const d=new Date(UI.repDate+"T00:00:00");if(UI.repRange==="day")d.setDate(d.getDate()+dir);else if(UI.repRange==="week")d.setDate(d.getDate()+dir*7);else d.setMonth(d.getMonth()+dir);UI.repDate=todayStr(d);render();}
function prettyRangeLabel(){const b=rangeBounds(UI.repDate,UI.repRange);const opts={day:"numeric",month:"long",year:"numeric"};if(UI.repRange==="day")return b.start.toLocaleDateString("en-GB",{weekday:"long",...opts});if(UI.repRange==="week"){const e=new Date(b.end.getTime()-86400000);return b.start.toLocaleDateString("en-GB",opts)+" — "+e.toLocaleDateString("en-GB",opts);}return b.start.toLocaleDateString("en-GB",{month:"long",year:"numeric"});}

function reportsHTML(){
  const b=rangeBounds(UI.repDate,UI.repRange);
  const inRange=DB.orders.filter(o=>{const t=new Date(o.Date);return t>=b.start&&t<b.end;}).sort((a,b2)=>new Date(a.Date)-new Date(b2.Date));
  const sc=s=>inRange.filter(o=>o.Status===s).length;const del=inRange.filter(o=>o.Status==="delivered");const act=inRange.filter(o=>o.Status!=="returned");const ret=inRange.filter(o=>o.Status==="returned");
  const pcs=list=>list.reduce((s,o)=>s+orderItems(o.Order_ID).reduce((x,i)=>x+Number(i.Quantity),0),0);const money=(list,f)=>list.reduce((s,o)=>s+f(o),0);
  const stats=[{label:"Total orders",value:String(inRange.length),icon:"shopping-bag",tint:"tint-gold"},{label:"Delivered",value:String(del.length),icon:"truck",tint:"tint-green"},{label:"Returned",value:String(ret.length),icon:"undo-2",tint:"tint-red"},{label:"Ready",value:String(sc("ready")),icon:"package-check",tint:"tint-violet"},{label:"Shipped",value:String(sc("shipped")),icon:"send",tint:"tint-blue"},{label:"Pending",value:String(sc("pending")),icon:"clock-3",tint:"tint-amber"},{label:"Delivery rate",value:(inRange.length?Math.round(del.length/inRange.length*100):0)+"%",icon:"percent",tint:"tint-green"},{label:"Delivered revenue",value:egp(money(del,o=>Number(o.Grand_Total)))+" EGP",icon:"banknote",tint:"tint-gold"},{label:"Revenue (active)",value:egp(money(act,o=>Number(o.Grand_Total)))+" EGP",icon:"wallet",tint:"tint-amber"},{label:"Shipping",value:egp(money(del,o=>Number(o.Shipping_Price)))+" EGP",icon:"truck",tint:"tint-blue"},{label:"Pieces out",value:String(pcs(act)),icon:"boxes",tint:"tint-violet"},{label:"Pieces returned",value:String(pcs(ret)),icon:"rotate-ccw",tint:"tint-red"}];
  return `<div class="card rep-controls"><div class="seg">${["day","week","month"].map(r=>`<button class="${UI.repRange===r?"on":""}" onclick="setRange('${r}')">${r}ly</button>`).join("")}</div><div class="stepper"><button class="sq-btn" onclick="stepRep(-1)"><i data-lucide="chevron-left"></i></button><div class="input-date"><i data-lucide="calendar-days"></i><input type="date" class="inp" value="${UI.repDate}" max="${todayStr()}" onchange="pickRepDate(this.value)"/></div><button class="sq-btn" onclick="stepRep(1)"><i data-lucide="chevron-right"></i></button></div>${UI.repDate!==todayStr()?`<button class="btn btn-ghost btn-sm" onclick="pickRepDate('${todayStr()}')">Today</button>`:""}<p class="rep-title">${prettyRangeLabel()}</p></div>
  <div class="stat-grid rep">${stats.map(s=>`<div class="card stat-card row"><div class="stat-ico ${s.tint}"><i data-lucide="${s.icon}"></i></div><div style="min-width:0"><b>${s.value}</b><span>${s.label}</span></div></div>`).join("")}</div>
  <div class="card" style="margin-top:20px;overflow:hidden"><div style="padding:18px 20px;border-bottom:1px solid var(--line)"><h3 style="font-family:var(--font-display);font-size:15px">Orders (${inRange.length})</h3></div>
  ${inRange.length?`<div class="table-wrap"><table class="grid"><thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Pcs</th><th>Total</th><th>Status</th><th>By</th></tr></thead><tbody>${inRange.map(o=>{const its=orderItems(o.Order_ID);return`<tr><td><b>#${o.Order_ID}</b><span class="sub">${fmtDT(o.Date)}</span></td><td><b>${esc(o.Customer_Name)}</b></td><td><span class="items-mini">${its.map(i=>i.Product_Name+" x"+i.Quantity).join(", ")}</span></td><td>${its.reduce((s,i)=>s+Number(i.Quantity),0)}</td><td><span class="money">${egp(o.Grand_Total)}</span></td><td><span class="chip status-${o.Status}" style="text-transform:uppercase">${o.Status}</span></td><td class="dim">${esc(o.Created_By||"—")}</td></tr>`;}).join("")}</tbody></table></div>`:`<p class="dim" style="padding:40px;text-align:center">No orders for this period.</p>`}</div>`;
}

/* =====================================================
   10) ACCOUNTS
   ===================================================== */
function accountsHTML(){
  return `<div class="toolbar" style="justify-content:flex-end"><p class="dim" style="margin-right:auto;font-size:13.5px">${DB.users.length} account(s)</p><button class="btn btn-primary" onclick="openUserModal()"><i data-lucide="user-plus"></i> Create Account</button></div>
  <div class="stack">${DB.users.map(u=>{const isSelf=String(u.User_ID)===String(DB.session);const isAdmin=u.Role==="admin";
    return`<div class="card urow"><div class="avatar ${isAdmin?"":"staff"}">${esc(u.Username.slice(0,2).toUpperCase())}</div><div class="info"><div class="line1"><h3>${esc(u.Username)}</h3>${isSelf?`<span class="chip chip-dark">You</span>`:""}<span class="chip ${isAdmin?"chip-gold":"chip-line"}"><i data-lucide="${isAdmin?"shield-check":"shield"}"></i>${isAdmin?"Admin":"Staff"}</span></div>
    <div class="line2">${!isAdmin?[["Perm_Inventory","Inventory"],["Perm_Orders","Orders — Register"],["Perm_ViewOrders","Orders — View"],["Perm_Reports","Reports"],["Perm_Accounts","Accounts"]].filter(([k])=>toBool(u[k])).map(([,l])=>`<span class="chip chip-line">${l}</span>`).join("")||'<span class="none">No access</span>':""}<span class="joined">Joined ${fmtDate(u.Created_At)}</span></div></div>
    <div class="tools"><button class="btn btn-ghost btn-sm" onclick="openPwModal(${u.User_ID})"><i data-lucide="key-round"></i> Password</button>${!isSelf?`<button class="btn btn-ghost btn-sm" onclick="openEditUserModal(${u.User_ID})"><i data-lucide="pencil"></i> Role</button><button class="btn btn-danger btn-sm" onclick="delUser(${u.User_ID})"><i data-lucide="trash-2"></i> Delete</button>`:""}</div></div>`;}).join("")}</div>`;
}

function openUserModal(){
  openModal(modalHead("Create account","New member credentials")+`
    <div class="form-grid c2"><div><label class="lbl">Username *</label><input class="inp" id="um-name" placeholder="e.g. sara"/></div><div><label class="lbl">Password *</label><input class="inp" id="um-pass" type="text" placeholder="Min 6 chars"/></div></div>
    ${me().Role==="admin"?`<button type="button" class="admin-toggle mt-16" id="um-admin" onclick="toggleAdminBtn()"><span class="at-l"><i data-lucide="shield-check"></i><span><b>Make Admin</b><span>Full access</span></span></span><span class="switch big"><i></i></span></button>`:""}
    <div class="mt-20" id="um-perms"><label class="lbl">Permissions</label><div class="perm-grid">${permToggle("inventory","Inventory","package",true)}${permToggle("orders","Orders — Register","shopping-bag",true)}${permToggle("viewOrders","Orders — View List","eye",false)}${permToggle("reports","Reports","bar-chart-3",false)}${permToggle("accounts","Accounts","users",false)}</div></div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveUserBtn()">Create</button></div></div>`);
}
function permToggle(key,label,icon,on){return `<button type="button" class="perm ${on?"on":""}" data-perm="${key}" onclick="this.classList.toggle('on')"><span class="pl"><i data-lucide="${icon}"></i>${label}</span><span class="switch ${on?"on":""}"><i></i></span></button>`;}
function toggleAdminBtn(){const t=$("#um-admin");t.classList.toggle("on");$(".switch",t).classList.toggle("on",t.classList.contains("on"));const p=$("#um-perms");if(p)p.style.display=t.classList.contains("on")?"none":"block";}
function readPerms(){const out={};$$("#um-perms .perm").forEach(b=>(out[b.dataset.perm]=b.classList.contains("on")));return out;}
function permKey(perm){if(perm==="viewOrders")return"Perm_ViewOrders";return"Perm_"+perm.charAt(0).toUpperCase()+perm.slice(1);}

async function saveUserBtn(){
  const username=$("#um-name").value.trim();const password=$("#um-pass").value;
  if(!/^[a-zA-Z0-9_.-]{3,32}$/.test(username))return toast("error","Username 3-32 chars.");
  if(password.length<6)return toast("error","Password min 6 chars.");
  if(DB.users.some(u=>u.Username.toLowerCase()===username.toLowerCase()))return toast("error","Username taken.");
  const makeAdmin=$("#um-admin")?$("#um-admin").classList.contains("on"):false;const perms=readPerms();
  closeModal(); toast("success",`"${username}" created.`);
  showLoading("Saving…");
  try{await api("saveUser",{Username:username,Password:password,Role:makeAdmin?"admin":"staff",Perm_Inventory:makeAdmin||!!perms.inventory,Perm_Orders:makeAdmin||!!perms.orders,Perm_ViewOrders:makeAdmin||!!perms.viewOrders,Perm_Reports:makeAdmin||!!perms.reports,Perm_Accounts:makeAdmin?true:!!perms.accounts});await loadAllData();render();}catch(e){toast("error","Sync failed."); bgSync();}finally{hideLoading();}
}
function openEditUserModal(id){
  const u=DB.users.find(x=>Number(x.User_ID)===id);if(!u)return;
  openModal(modalHead(`Role — ${u.Username}`,"")+`
    ${me().Role==="admin"?`<button type="button" class="admin-toggle ${u.Role==="admin"?"on":""} mt-16" id="um-admin" onclick="toggleAdminBtn()"><span class="at-l"><i data-lucide="shield-check"></i><span><b>Admin</b><span>Full access</span></span></span><span class="switch big ${u.Role==="admin"?"on":""}"><i></i></span></button>`:""}
    <div class="mt-20" id="um-perms" ${u.Role==="admin"?'style="display:none"':""}><label class="lbl">Permissions</label><div class="perm-grid">${permToggle("inventory","Inventory","package",toBool(u.Perm_Inventory))}${permToggle("orders","Orders — Register","shopping-bag",toBool(u.Perm_Orders))}${permToggle("viewOrders","Orders — View List","eye",toBool(u.Perm_ViewOrders))}${permToggle("reports","Reports","bar-chart-3",toBool(u.Perm_Reports))}${permToggle("accounts","Accounts","users",toBool(u.Perm_Accounts))}</div></div>
    <input type="hidden" id="um-eid" value="${u.User_ID}"/>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveEditUserBtn()">Save</button></div></div>`);
}
async function saveEditUserBtn(){
  const id=Number($("#um-eid").value);const makeAdmin=$("#um-admin")?$("#um-admin").classList.contains("on"):false;const perms=readPerms();
  closeModal(); toast("success","Updated.");
  showLoading("Saving…");
  try{await api("updateUser",{User_ID:id,Role:makeAdmin?"admin":"staff",Perm_Inventory:makeAdmin||!!perms.inventory,Perm_Orders:makeAdmin||!!perms.orders,Perm_ViewOrders:makeAdmin||!!perms.viewOrders,Perm_Reports:makeAdmin||!!perms.reports,Perm_Accounts:makeAdmin?true:!!perms.accounts});await loadAllData();render();}catch(e){bgSync();}finally{hideLoading();}
}
function openPwModal(id){
  const u=DB.users.find(x=>Number(x.User_ID)===id);if(!u)return;
  openModal(modalHead(`Password — ${u.Username}`,"")+`<label class="lbl">New password</label><input class="inp" id="pw-new" type="text" placeholder="Min 6 chars" autofocus/><input type="hidden" id="pw-id" value="${u.User_ID}"/>
  <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="savePwBtn()">Save</button></div></div>`);
}
async function savePwBtn(){
  const id=Number($("#pw-id").value);const pw=$("#pw-new").value;if(pw.length<6)return toast("error","Min 6 chars.");
  const u=DB.users.find(x=>Number(x.User_ID)===id); if(u) u.Password=pw;
  saveCache(); closeModal(); toast("success","Password updated.");
  api("updateUser",{User_ID:id,Password:pw}).catch(()=>bgSync());
}
async function delUser(id){
  const u=DB.users.find(x=>Number(x.User_ID)===id);if(!u)return;
  if(Number(id)===Number(DB.session))return toast("error","Can't delete yourself.");
  confirmDlg("Delete account",`Delete "${u.Username}"?`,"Delete",true,async()=>{
    DB.users=DB.users.filter(x=>Number(x.User_ID)!==id); saveCache(); toast("success","Deleted."); render();
    api("deleteUser",{User_ID:id}).catch(()=>bgSync());
  });
}

/* =====================================================
   11) SETTINGS
   ===================================================== */
function settingsHTML(){
  return `<div class="card set-card"><div class="set-head"><div class="sq"><i data-lucide="truck"></i></div><div><h3>Fixed pricing settings</h3><p>Control the fixed extra shipping price and collection fee from here.</p></div></div>
  <div class="set-form" style="align-items:flex-end;flex-wrap:wrap">
    <div class="grow"><label class="lbl">Extra Free Shipping (EGP)</label><input class="inp" id="set-extra" type="number" min="0" value="${getExtraShipping()}"/></div>
    <div class="grow"><label class="lbl">Collection Fee (EGP)</label><input class="inp" id="set-collection" type="number" min="0" value="${getCollectionFee()}"/></div>
    <button class="btn btn-primary" onclick="saveExtraBtn()"><i data-lucide="save"></i> Save</button>
  </div></div>
  <div class="card tip-card"><i data-lucide="sparkles"></i><p>All data is saved to <b>Google Sheets</b> automatically — your data is always safe in the cloud!</p></div>`;
}
async function saveExtraBtn(){
  const v=parseFloat($("#set-extra").value);const c=parseFloat($("#set-collection").value);
  if(!Number.isFinite(v)||v<0||!Number.isFinite(c)||c<0)return toast("error","Invalid prices.");
  const s=DB.settings.find(x=>x.Key==="extraShippingPrice"); if(s) s.Value=v; else DB.settings.push({Key:"extraShippingPrice",Value:v});
  const cf=DB.settings.find(x=>x.Key==="collectionFee"); if(cf) cf.Value=c; else DB.settings.push({Key:"collectionFee",Value:c});
  saveCache(); toast("success",`Prices updated successfully.`);
  api("saveSetting",{Key:"extraShippingPrice",Value:String(v)}).catch(()=>bgSync());
  api("saveSetting",{Key:"collectionFee",Value:String(c)}).catch(()=>bgSync());
}

/* =====================================================
   12) BOOT — instant from cache, sync in background
   ===================================================== */
(function boot(){
  try {
    loadSession();
    const hasCache = loadCache();
    if (hasCache) {
      render();
      bgSync();
    } else {
      showLoading("Loading...");
      loadAllData().then(() => {
        render();
      }).catch((e) => {
        console.error("Boot error:", e);
        document.getElementById("app").innerHTML=`<div style="display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px"><div class="card" style="padding:40px;text-align:center;max-width:400px"><h2 style="font-family:var(--font-display);margin-bottom:12px">Connection Error</h2><p style="color:#8d8264;font-size:14px;margin-bottom:20px">Please check your internet connection.</p><button class="btn btn-primary" onclick="location.reload()">Retry</button></div></div>`;
      }).finally(() => hideLoading());
    }
  } catch(e) {
    console.error("Critical boot failure:", e);
    localStorage.clear();
    location.reload();
  }
})();
