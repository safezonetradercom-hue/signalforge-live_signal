const $ = (id) => document.getElementById(id);
let currentUser = null;
let authMode = "login";
const views = ["dashboard","history","admin"];
function toast(message, error=false) {
  const el=$("toast"); el.textContent=message; el.classList.remove("hidden","error");
  if(error) el.classList.add("error");
  clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.classList.add("hidden"),4500);
}
async function api(url, options={}) {
  const res=await fetch(url,{credentials:"same-origin",headers:{"Content-Type":"application/json",...(options.headers||{})},...options});
  let data={}; try{data=await res.json()}catch{}
  if(!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
function showView(name) {
  $("authView").classList.add("hidden");
  views.forEach(v=>$(v+"View").classList.toggle("hidden",v!==name));
  document.querySelectorAll(".nav").forEach(b=>b.classList.toggle("active",b.dataset.view===name));
  $("pageTitle").textContent=({dashboard:"Dashboard",history:"Signal History",admin:"Admin Panel"})[name]||"Dashboard";
  if(name==="history") loadHistory();
  if(name==="admin") loadAdmin();
}
function setAuthMode(mode){
  authMode=mode;
  $("loginTab").classList.toggle("active",mode==="login");
  $("registerTab").classList.toggle("active",mode==="register");
  $("authSubmit").textContent=mode==="login"?"Login":"Create account";
  $("password").autocomplete=mode==="login"?"current-password":"new-password";
  $("password").minLength=mode==="login"?1:12;
}
async function updateStatus(){
  try{
    const s=await api("/api/status");
    $("providerStatus").textContent=s.liveProviderConfigured?"Configured":"Not configured";
    $("providerDetail").textContent=s.liveProviderConfigured?"Provider key detected":"Add API key on server";
    $("sideStatus").textContent=s.liveProviderConfigured?"Provider configured":"No live data feed";
  }catch{$("providerStatus").textContent="Unavailable";$("sideStatus").textContent="Status unavailable"}
}
async function enterApp(user){
  currentUser=user;
  $("authView").classList.add("hidden"); $("logoutBtn").classList.remove("hidden");
  $("userEmail").textContent=user.email;
  $("adminNav").classList.toggle("hidden",user.role!=="admin");
  showView("dashboard"); await updateStatus();
}
$("loginTab").addEventListener("click",()=>setAuthMode("login"));
$("registerTab").addEventListener("click",()=>setAuthMode("register"));
$("authForm").addEventListener("submit",async e=>{
  e.preventDefault(); $("authSubmit").disabled=true;
  try{
    const endpoint=authMode==="login"?"/api/auth/login":"/api/auth/register";
    const data=await api(endpoint,{method:"POST",body:JSON.stringify({email:$("email").value,password:$("password").value})});
    await enterApp(data.user); toast(authMode==="login"?"Logged in successfully":"Account created");
  }catch(err){toast(err.message,true)}finally{$("authSubmit").disabled=false}
});
$("logoutBtn").addEventListener("click",async()=>{try{await api("/api/auth/logout",{method:"POST"})}catch{} location.reload()});
document.querySelectorAll(".nav").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.view)));
$("marketMode").addEventListener("change",()=>{$("modeStatus").textContent=$("marketMode").value==="OTC"?"OTC (disabled)":"Live Market"});
function formatPrice(n){return Number(n).toLocaleString(undefined,{maximumFractionDigits:6})}
$("signalForm").addEventListener("submit",async e=>{
  e.preventDefault(); const btn=$("generateBtn"); btn.disabled=true; btn.textContent="Analyzing…";
  $("signalResult").className="result"; $("signalResult").innerHTML='<h3>Checking market data…</h3><p>ডেটার সময়, পরিমাণ ও বিশ্লেষণ যাচাই হচ্ছে।</p>';
  try{
    const d=await api("/api/signals/generate",{method:"POST",body:JSON.stringify({symbol:$("symbol").value,interval:$("interval").value,marketMode:$("marketMode").value})});
    const cls=d.signal==="CALL"?"signal-call":d.signal==="PUT"?"signal-put":"signal-wait";
    const reasons=(d.reasons||[]).map(r=>`<li>${escapeHtml(r)}</li>`).join("");
    $("signalResult").innerHTML=`<div class="signal-head"><div><div class="eyebrow">${escapeHtml(d.symbol)} · ${escapeHtml(d.interval)} · ${escapeHtml(d.marketMode)}</div><h3 class="${cls}">${escapeHtml(d.signal)}</h3></div><div class="confidence">${d.confidence?`${d.confidence}% rule score`:"No directional score"}</div></div>
    <div class="metric-grid"><div class="metric"><span>LAST PRICE</span><b>${formatPrice(d.price)}</b></div><div class="metric"><span>TREND</span><b>${escapeHtml(d.trend)}</b></div><div class="metric"><span>SUPPORT (recent range)</span><b>${formatPrice(d.support)}</b></div><div class="metric"><span>RESISTANCE (recent range)</span><b>${formatPrice(d.resistance)}</b></div><div class="metric"><span>DATA CANDLE TIME</span><b>${escapeHtml(d.dataTime)}</b></div><div class="metric"><span>DATA STATUS</span><b>${escapeHtml(d.dataStatus)}</b></div></div>
    <div class="eyebrow">ANALYSIS REASONS</div><ul class="reasons">${reasons}</ul><p class="fine">${escapeHtml(d.provider)} data. ${escapeHtml(d.disclaimer)}</p>`;
  }catch(err){$("signalResult").innerHTML=`<div class="signal-head"><div><div class="eyebrow">SIGNAL NOT GENERATED</div><h3 class="signal-wait">DATA UNAVAILABLE</h3></div><span class="tag">No fabricated signal</span></div><p>${escapeHtml(err.message)}</p><p class="fine">API key, provider access, symbol support, and candle freshness যাচাই করুন। OTC-র জন্য আলাদা যাচাইকৃত ফিড প্রয়োজন।</p>`;toast(err.message,true)}
  finally{btn.disabled=false;btn.textContent="Generate signal"}
});
function escapeHtml(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
async function loadHistory(){
  try{const d=await api("/api/signals/history"); const rows=d.history;
    $("historyTable").innerHTML=rows.length?`<table><thead><tr><th>Pair</th><th>Mode</th><th>Timeframe</th><th>Signal</th><th>Data candle</th><th>Created</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${escapeHtml(r.symbol)}</td><td>${escapeHtml(r.market_mode)}</td><td>${escapeHtml(r.interval)}</td><td>${escapeHtml(r.signal)}</td><td>${escapeHtml(r.data_time)}</td><td>${escapeHtml(r.created_at)}</td></tr>`).join("")}</tbody></table>`:"No signal history yet.";
  }catch(e){toast(e.message,true)}
}
$("refreshHistory").addEventListener("click",loadHistory);
async function loadAdmin(){
  try{
    const [s,u]=await Promise.all([api("/api/admin/summary"),api("/api/admin/users")]);
    $("adminUsers").textContent=s.users;$("adminActive").textContent=s.activeUsers;$("adminSignals").textContent=s.signals;
    $("usersTable").innerHTML=`<table><thead><tr><th>ID</th><th>Email</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead><tbody>${u.users.map(x=>`<tr><td>${x.id}</td><td>${escapeHtml(x.email)}</td><td>${escapeHtml(x.role)}</td><td>${x.active?"Active":"Disabled"}</td><td><button class="btn secondary table-action" data-action="toggle" data-id="${x.id}" data-active="${x.active}">${x.active?"Disable":"Enable"}</button><button class="btn secondary table-action" data-action="role" data-id="${x.id}" data-role="${x.role}">${x.role==="admin"?"Make user":"Make admin"}</button></td></tr>`).join("")}</tbody></table>`;
    $("usersTable").querySelectorAll("button").forEach(b=>b.addEventListener("click",async()=>{
      const id=Number(b.dataset.id);
      if(b.dataset.action==="toggle" && !confirm(`${b.dataset.active==="1"?"Disable":"Enable"} user #${id}?`))return;
      if(b.dataset.action==="role" && !confirm(`Change role for user #${id}?`))return;
      const body=b.dataset.action==="toggle"?{active:b.dataset.active!=="1"}:{role:b.dataset.role==="admin"?"user":"admin"};
      try{await api(`/api/admin/users/${id}`,{method:"PATCH",body:JSON.stringify(body)});toast("User updated");loadAdmin()}catch(e){toast(e.message,true)}
    }));
  }catch(e){$("usersTable").textContent=e.message;toast(e.message,true)}
}
$("refreshUsers").addEventListener("click",loadAdmin);
$("refreshAudit").addEventListener("click",async()=>{
  try{const d=await api("/api/admin/audit");$("auditTable").innerHTML=`<table><thead><tr><th>Time</th><th>Actor ID</th><th>Action</th><th>Detail</th></tr></thead><tbody>${d.logs.map(x=>`<tr><td>${escapeHtml(x.created_at)}</td><td>${escapeHtml(x.actor_id??"—")}</td><td>${escapeHtml(x.action)}</td><td>${escapeHtml(x.detail??"")}</td></tr>`).join("")}</tbody></table>`}
  catch(e){toast(e.message,true)}
});
(async()=>{try{const d=await api("/api/auth/me");await enterApp(d.user)}catch{$("authView").classList.remove("hidden");await updateStatus()}})();
