// ════════════════════════════════════════════════════════════════
//  ADAPTED UI LAYER  — wires the original Web3 engine (kept verbatim
//  above) to the new gold-on-dark two-page design markup. All on-chain
//  logic (contract calls, approvals, pagination, fee math) is identical
//  to the original; only the DOM it reads/writes has changed.
// ════════════════════════════════════════════════════════════════

const FEE_RATE = 0.005;                 // 0.5% — display only; contract is authoritative
// Lock-duration bounds (seconds). The contract enforces 5 min … ~20 yr
// (MIN_LOCK_TIME = 5 minutes, MAX_LOCK_TIME = 20*366 days). The UI deliberately
// offers the tighter, advertised 10 min … 10 yr range — matching the presets and
// the "10 minutes to 10 years" copy, and sitting safely inside the contract limits
// so a chosen time can never revert for being out of range.
const MIN_LOCK_SECONDS = 600;           // 10 minutes (smallest preset)
const MAX_LOCK_SECONDS = 315360000;     // 10 years   (largest preset)
let durMode = 'preset';                 // 'preset' | 'date'
let selMs   = null;                     // chosen preset duration (ms)
let lockTick = null;                    // setInterval handle for live vault bars
let datePicker = null;                  // flatpickr instance for the custom date picker

// ─── CONNECT LIFECYCLE ───────────────────────────────
async function onConnected(){
  try{
    // For WalletConnect read the chain from the provider property — routing
    // getNetwork()/eth_chainId through ethers over WC throws "Please call
    // connect() before request()". Injected wallets keep the ethers path.
    if(wcProvider){
      currentChainId = Number(wcProvider.chainId);
    }else{
      const network = await prov.getNetwork();
      currentChainId = Number(network.chainId);
    }
    const net = getNetwork(currentChainId);

    if(!CONTRACTS[currentChainId]){
      const supported = Object.keys(CONTRACTS)
        .filter(id => CONTRACTS[id])
        .map(id => NETWORKS[id]?.name || id)
        .join(', ');
      showErr('Network not supported yet. Please switch to: '+supported);
      return;
    }

    CONTRACT_ADDRESS = CONTRACTS[currentChainId];
    readProv = new ethers.JsonRpcProvider(ALCHEMY_RPC);
    readCont = new ethers.Contract(CONTRACT_ADDRESS, ABI, readProv);
    // WC: sendContractTx publishes via wcProvider.request (no ethers signer
    // needed), so bind to the read provider and never call getSigner() over WC.
    cont     = new ethers.Contract(CONTRACT_ADDRESS, ABI, wcProvider ? readProv : await prov.getSigner());

    updateSymbols(net.symbol);
    setConnectedUI(true, net.name);
  }catch(e){ showErr(e.message); return; }

  await Promise.all([loadTokenBalances(), loadLocks()]);
  await checkAdmin();
  try{
    const isPaused = await readCont.paused();
    document.getElementById('pausedBanner').style.display = isPaused ? 'block' : 'none';
  }catch(e){}
}

async function connectWallet(){ openWalletModal(); }

// ─── WALLET PILL (connect state, menu, copy, disconnect) ──
function setConnectedUI(on, netName){
  const pill  = document.getElementById('walletPill');
  const dot   = document.getElementById('walletDot');
  const label = document.getElementById('walletLabel');
  const netEl = document.getElementById('walletNet');
  const lockBtn = document.getElementById('lock');
  if(on){
    document.body.classList.add('connected');
    pill.classList.remove('is-off');
    dot.style.display='inline-block';
    label.textContent = acct.slice(0,6)+'…'+acct.slice(-4);
    if(netEl) netEl.textContent = netName || '';
    if(lockBtn){ lockBtn.textContent='Lock'; lockBtn.disabled=false; }
  }else{
    document.body.classList.remove('connected');
    pill.classList.add('is-off');
    dot.style.display='none';
    label.textContent='Connect Wallet';
    if(netEl) netEl.textContent='';
    if(lockBtn){ lockBtn.textContent='Connect Wallet'; lockBtn.disabled=false; }
  }
}

function toggleWalletMenu(){
  if(!acct) { openWalletModal(); return; }
  const m=document.getElementById('walletMenu');
  m.style.display = m.style.display==='block' ? 'none' : 'block';
}

function copyAddress(){
  if(!acct) return;
  navigator.clipboard?.writeText(acct).then(()=>showOk('Address copied'),()=>{});
  document.getElementById('walletMenu').style.display='none';
}

function disconnectWallet(){
  try{ if(wcProvider && wcProvider.disconnect) wcProvider.disconnect(); }catch(e){}
  // Fully wipe WalletConnect state so the next connect is truly fresh (a fresh
  // QR / new session) instead of reusing a now-orphaned session from storage.
  try{
    Object.keys(localStorage)
      .filter(k => k.indexOf('wc@2') === 0 || k.toLowerCase().indexOf('walletconnect') !== -1)
      .forEach(k => localStorage.removeItem(k));
  }catch(e){}
  acct=null; prov=null; cont=null; readCont=null; locks=[]; selectedToken=null;
  tokenBalances={}; availableTokens=[]; currentActiveCount=0; wcProvider=null;
  if(lockTick){ clearInterval(lockTick); lockTick=null; }
  document.getElementById('walletMenu').style.display='none';
  document.getElementById('adminPanel') && (document.getElementById('adminPanel').style.display='none');
  // Reset the admin reveal toggle back to hidden + collapsed
  const adminToggle=document.getElementById('adminToggle');
  if(adminToggle){
    adminToggle.style.display='none';
    adminToggle.classList.remove('open');
    const al=adminToggle.querySelector('.at-label'); if(al) al.textContent='Show admin panel';
  }
  document.getElementById('pausedBanner').style.display='none';
  setConnectedUI(false);
  // Reset token select + lists to the disconnected placeholder state
  const sel=document.getElementById('token');
  if(sel) sel.innerHTML='<option value="ETH">Connect wallet…</option>';
  document.getElementById('avail').textContent='—';
  document.getElementById('vlist').innerHTML='';
  document.getElementById('empty').style.display='block';
  document.getElementById('vcount').textContent='0 locks';
  document.getElementById('stat-active').textContent='0';
  document.getElementById('stat-total').textContent='—';
  setNextUnlock('—');
  updateSummary();
  showOk('Wallet disconnected');
}

// ─── TOKEN SELECT + BALANCES ─────────────────────────
async function loadTokenBalances(){
  if(!prov||!acct) return;
  const allTokens = ALL_TOKENS[currentChainId] || [];
  tokenBalances={}; availableTokens=[];

  await Promise.all(allTokens.map(async t => {
    try{
      let bal;
      if(!t.address){
        const raw = await readProv.getBalance(acct);
        bal = parseFloat(ethers.formatUnits(raw, t.decimals));
      } else {
        const erc20 = new ethers.Contract(t.address, ERC20_ABI, readProv);
        const raw = await erc20.balanceOf(acct);
        bal = parseFloat(ethers.formatUnits(raw, t.decimals));
      }
      tokenBalances[t.symbol] = bal;
      if(bal > 0) availableTokens.push(t);
    }catch(e){ tokenBalances[t.symbol] = 0; }
  }));

  // Always offer native, even at zero balance
  const native = allTokens.find(t => !t.address);
  if(native && !availableTokens.find(t => !t.address)) availableTokens.unshift(native);

  // Keep current selection if still valid, else default to native
  if(selectedToken && !availableTokens.find(t=>t.symbol===selectedToken.symbol)){
    selectedToken=null;
  }
  renderTokenSelector();
  syncTokenLabels();
}

function renderTokenSelector(){
  const sel=document.getElementById('token');
  if(!sel) return;
  if(!availableTokens.length){
    sel.innerHTML='<option>No tokens found</option>';
    return;
  }
  const curSym = selectedToken ? selectedToken.symbol : (getNetwork(currentChainId).symbol||'ETH');
  sel.innerHTML = availableTokens.map(t=>{
    const isSel=(!selectedToken&&!t.address)||(selectedToken&&selectedToken.symbol===t.symbol);
    const bal=(tokenBalances[t.symbol]||0);
    return '<option value="'+t.symbol+'" data-addr="'+(t.address||'')+'" data-dec="'+t.decimals+'" '
      +(isSel?'selected':'')+'>'+t.symbol+' — '+trimBal(bal)+'</option>';
  }).join('');
  // make sure selectedToken matches the shown selection
  selectTokenFromDropdown(sel.value || curSym);
}

function trimBal(n){
  if(n===0) return '0';
  if(n<0.0001) return n.toFixed(12).replace(/0+$/,'').replace(/\.$/,'');
  return parseFloat(n.toFixed(6)).toString();
}

function selectTokenFromDropdown(symbol){
  const token=availableTokens.find(t=>t.symbol===symbol);
  selectedToken = token && token.address ? token : null;
  const sym = token ? token.symbol : (getNetwork(currentChainId).symbol||'ETH');
  updateSymbols(sym);
  syncTokenLabels();
  updateSummary();
  checkBalance();
}

function syncTokenLabels(){
  const sym = selectedToken ? selectedToken.symbol : (getNetwork(currentChainId).symbol||currentSymbol||'ETH');
  const at=document.getElementById('amt-token');   if(at) at.textContent=sym;
  const avt=document.getElementById('avail-token'); if(avt) avt.textContent=sym;
  const av=document.getElementById('avail');
  if(av) av.textContent = acct ? trimBal(tokenBalances[sym]||0) : '—';
}

function setMaxAmount(){
  if(!acct) return;
  const sym = selectedToken ? selectedToken.symbol : (getNetwork(currentChainId).symbol||'ETH');
  const bal = tokenBalances[sym]||0;
  document.getElementById('amount').value = bal>0 ? trimBal(bal) : '';
  updateSummary(); checkBalance();
}

function checkBalance(){
  const amt=parseFloat(document.getElementById('amount').value);
  const warn=document.getElementById('balanceWarning');
  const btn=document.getElementById('lock');
  if(!warn) return;
  if(!acct){ warn.style.display='none'; return; }
  if(!amt||isNaN(amt)){ warn.style.display='none'; if(btn&&!btn.dataset.limit) btn.disabled=false; return; }
  const sym=selectedToken?selectedToken.symbol:(getNetwork(currentChainId).symbol||'ETH');
  const bal=tokenBalances[sym]||0;
  if(amt>bal){
    warn.style.display='block';
    if(btn){ btn.disabled=true; }
  } else {
    warn.style.display='none';
    if(btn&&!btn.dataset.limit){ btn.disabled=false; }
  }
}

// ─── DURATION (preset chips + datetime) ──────────────
function setDurMode(mode){
  durMode=mode;
  document.getElementById('tab-preset').classList.toggle('on',mode==='preset');
  document.getElementById('tab-date').classList.toggle('on',mode==='date');
  document.getElementById('presets').classList.toggle('hide',mode!=='preset');
  document.getElementById('datebox').classList.toggle('show',mode==='date');
  updateSummary();
}

function pickPreset(btn){
  document.querySelectorAll('#presets .preset').forEach(p=>p.classList.remove('on'));
  btn.classList.add('on');
  selMs=parseFloat(btn.dataset.ms);
  updateSummary();
}

// Returns an absolute UNIX timestamp (seconds) for the unlock moment, or null.
function getUnlockSeconds(){
  if(durMode==='preset'){
    if(!selMs) return null;
    return Math.floor((Date.now()+selMs)/1000);
  } else {
    // Prefer the flatpickr instance's parsed Date; fall back to the raw input
    // value (native datetime-local) if the picker didn't load.
    let d=null;
    if(datePicker && datePicker.selectedDates && datePicker.selectedDates[0]){
      d=datePicker.selectedDates[0];
    } else {
      const v=document.getElementById('date').value;
      if(v) d=new Date(v);
    }
    if(!d) return null;
    const ts=Math.floor(d.getTime()/1000);
    if(!ts || ts*1000<=Date.now()) return null;
    return ts;
  }
}

function chosenUnlockMs(){
  const s=getUnlockSeconds();
  return s ? s*1000 : null;
}

// Returns an error string if the chosen unlock time is out of the allowed
// range, or null if it's fine / nothing chosen yet. Presets are always in range,
// so this only ever fires for a custom date/time pick.
function lockTimeError(ts){
  if(!ts) return null;
  const dur=ts-Math.floor(Date.now()/1000);
  if(dur<MIN_LOCK_SECONDS) return 'Minimum lock time is 10 minutes.';
  if(dur>MAX_LOCK_SECONDS) return 'Maximum lock time is 10 years.';
  return null;
}

// ─── LOCK SUMMARY (replaces calcFee) ─────────────────
function updateSummary(){
  const el=document.getElementById('summary');
  if(!el) return;
  const sym=selectedToken?selectedToken.symbol:(getNetwork(currentChainId).symbol||'ETH');
  const amt=parseFloat(document.getElementById('amount').value);
  const unlock=chosenUnlockMs();
  if(!acct){ el.innerHTML='Connect your wallet to begin.'; return; }
  if(!amt||amt<=0){ el.innerHTML='Enter an amount and choose a duration to lock.'; return; }
  const bal=tokenBalances[sym]||0;
  if(amt>bal){ el.innerHTML='<span class="err">Amount exceeds your available balance.</span>'; return; }
  if(!unlock){ el.innerHTML='Choose when this lock unlocks.'; return; }
  const terr=lockTimeError(Math.floor(unlock/1000));
  if(terr){ el.innerHTML='<span class="err">'+terr+'</span>'; return; }
  const fee=amt*FEE_RATE, net=amt-fee;
  el.innerHTML='Locking <b>'+trimBal(net)+' '+sym+'</b> until <b>'+fmtFull(unlock/1000)
    +'</b> &middot; fee '+trimBal(fee)+' '+sym;
}

// ─── STATS ───────────────────────────────────────────
function renderStats(){
  const active=locks.filter(l=>l.withdrawn!==true&&l.withdrawn!=='true'&&parseFloat(l.amount)>0);
  document.getElementById('stat-active').textContent=active.length;
  currentActiveCount=active.length;
  updateLockLimitUI();

  const totals={};
  active.forEach(l=>{
    const sym=l.tokenSymbol||currentSymbol;
    totals[sym]=(totals[sym]||0)+parseFloat(l.amount);
  });
  const entries=Object.entries(totals).sort((a,b)=>b[1]-a[1]);
  const tEl=document.getElementById('stat-total');
  if(entries.length===0){
    tEl.textContent='—';
  } else {
    const parts=entries.map(([sym,amt])=>trimBal(amt)+' '+sym);
    tEl.innerHTML = parts.length<=2
      ? parts.join('  ·  ')
      : parts.slice(0,2).join('  ·  ')+'  +'+(parts.length-2);
  }

  const next=active.filter(l=>!l.canWithdraw).sort((a,b)=>a.unlockTime-b.unlockTime)[0];
  setNextUnlock(next ? relTime(next.unlockTime*1000-Date.now()) : (active.length?'Ready':'—'));
}

// Writes the "next unlock" stat and greens it out when something is ready now.
function setNextUnlock(text){
  const el=document.getElementById('stat-next');
  if(!el) return;
  el.textContent=text;
  el.classList.toggle('ready', text==='Ready');
}

// ─── ACTIVE-LOCK LIMIT UI ────────────────────────────
function updateLockLimitUI(){
  const warn=document.getElementById('lockLimitWarn');
  const btn=document.getElementById('lock');
  if(!warn) return;
  const n=currentActiveCount;
  const busy = btn && /wait|Approv|Lock(?:ing)?…|Sending|Confirming/.test(btn.innerHTML);
  if(!acct){ warn.style.display='none'; return; }
  if(n>=MAX_ACTIVE_LOCKS){
    warn.style.display='block';
    warn.className='limit-warn limit-stop';
    warn.innerHTML='&#128683; You\'ve reached the maximum of '+MAX_ACTIVE_LOCKS+' active locks. '
      +'Withdraw an unlocked vault to free up a slot before creating a new one.';
    if(btn){ btn.disabled=true; btn.dataset.limit='1'; if(!busy) btn.textContent='Max active locks reached ('+MAX_ACTIVE_LOCKS+')'; }
  } else if(n>=LOCK_WARN_AT){
    warn.style.display='block';
    warn.className='limit-warn limit-soft';
    warn.innerHTML='&#9888; You have '+n+' active locks. The maximum is '+MAX_ACTIVE_LOCKS+' — '
      +'you can create '+(MAX_ACTIVE_LOCKS-n)+' more before reaching the limit.';
    if(btn&&btn.dataset.limit){ btn.disabled=false; btn.dataset.limit=''; if(!busy) btn.textContent='Lock'; }
  } else {
    warn.style.display='none';
    if(btn&&btn.dataset.limit){ btn.disabled=false; btn.dataset.limit=''; if(!busy) btn.textContent='Lock'; }
  }
}

// ─── LOAD LOCKS ──────────────────────────────────────
async function loadLocks(){
  try{
    const PAGE = 100;
    let offset = 0;
    let ids = [];
    while(true){
      const page = await readCont.getUserLocks(acct, offset, PAGE);
      ids = ids.concat(Array.from(page));
      if(page.length < PAGE) break;
      offset += PAGE;
    }

    if(ids.length === 0){
      locks = [];
      renderStats(); renderLocks();
      return;
    }

    const vlist=document.getElementById('vlist');
    if(vlist) vlist.innerHTML='<div class="loading-row">Loading '+ids.length+' vault'+(ids.length!==1?'s':'')+'…</div>';
    const emptyEl=document.getElementById('empty'); if(emptyEl) emptyEl.style.display='none';

    const now = Math.floor(Date.now() / 1000);
    const allTokensList = ALL_TOKENS[currentChainId] || [];

    locks = await Promise.all(ids.map(async id => {
      const l = await readCont.getLock(id);
      const tokenAddr = l.token;
      const unlockTime = Number(l.unlockTime);
      const timeRemaining = Math.max(0, unlockTime - now);
      const canWithdraw = !l.withdrawn && timeRemaining === 0;

      let decimals = 18;
      const nativeSymbol = getNetwork(currentChainId).symbol || 'ETH';
      let tokenSymbol = nativeSymbol;
      if(tokenAddr && tokenAddr !== '0x0000000000000000000000000000000000000000'){
        const tokenInfo = allTokensList.find(t => t.address && t.address.toLowerCase() === tokenAddr.toLowerCase());
        if(tokenInfo){ decimals = tokenInfo.decimals; tokenSymbol = tokenInfo.symbol; }
        else { tokenSymbol = tokenAddr.slice(0,6)+'...'; }
      }

      return {
        id:            id.toString(),
        token:         tokenAddr,
        tokenSymbol:   tokenSymbol,
        amount:        ethers.formatUnits(l.amount, decimals),
        unlockTime:    unlockTime,
        createdAt:     Number(l.createdAt),
        withdrawn:     l.withdrawn,
        timeRemaining: timeRemaining,
        canWithdraw:   canWithdraw
      };
    }));

    locks.sort((a,b) => b.createdAt - a.createdAt);
    renderStats();
    renderLocks();
  }catch(e){ console.error(e); }
}

// ─── RENDER VAULT CARDS ──────────────────────────────
function renderLocks(){
  const list=document.getElementById('vlist');
  const empty=document.getElementById('empty');
  const vcount=document.getElementById('vcount');
  if(!list) return;

  // Show active + still-relevant (withdrawn shown faded), newest first already
  const shown=locks.filter(l=>parseFloat(l.amount)>0);
  const activeCount=shown.filter(l=>l.withdrawn!==true&&l.withdrawn!=='true').length;
  if(vcount) vcount.textContent=activeCount+(activeCount===1?' lock':' locks');

  if(!shown.length){
    list.innerHTML='';
    if(empty) empty.style.display='block';
    return;
  }
  if(empty) empty.style.display='none';

  const ethGlyph='<svg class="eth" viewBox="0 0 24 32" aria-hidden="true"><path d="M12 0 L23 16 L12 22 L1 16 Z" fill="#E9D08A" opacity="0.95"/><path d="M12 0 L23 16 L12 22 Z" fill="#C9A84C"/><path d="M12 24 L23 18 L12 32 L1 18 Z" fill="#C9A84C" opacity="0.9"/><path d="M12 24 L23 18 L12 32 Z" fill="#8A6D2E"/></svg>';
  const lockIcon='<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';

  const cardHtml=l=>{
    const withdrawn = l.withdrawn===true||l.withdrawn==='true';
    const ready = !withdrawn && l.canWithdraw;
    const sym=l.tokenSymbol||currentSymbol;
    const amt=trimBal(parseFloat(l.amount));
    const statusCls = withdrawn?'withdrawn':(ready?'unlocked':'locked');
    const statusTxt = withdrawn?'Withdrawn':(ready?'Unlocked':'Active');
    const pct = withdrawn||ready?100:calcPct(l);
    const isEth = sym==='ETH';
    const glyph = isEth ? ethGlyph : '<div class="tk">'+esc(sym)+'</div>';
    // ETH's glyph is a symbol, so it keeps the "ETH" unit. Token cards already
    // name the coin in the leading pill, so the trailing unit is dropped to avoid
    // showing the ticker twice.
    const unit  = isEth ? '<span class="vc-unit">'+esc(sym)+'</span>' : '';
    const cLabel = withdrawn?'Closed':(ready?'Status':'Unlocks in');
    const cText  = withdrawn?'Withdrawn':(ready?'Ready to withdraw':fmtCountdown(l.timeRemaining));
    const foot = withdrawn
      ? ''
      : '<div class="vcard-foot"><button class="btn sm withdraw" data-id="'+esc(l.id)+'" '+(ready?'':'disabled')+'>Withdraw</button></div>';
    return '<div class="vcard '+(ready?'ready':'')+(withdrawn?' spent':'')+'" data-id="'+esc(l.id)+'">'
      +  '<div class="vc-head">'
      +    '<span class="vc-badge">'+lockIcon+' Time-locked</span>'
      +    '<span class="vstatus '+statusCls+'"><i class="vc-dot"></i> '+statusTxt+'</span>'
      +  '</div>'
      +  '<div class="vc-amount">'+glyph+'<span class="vc-val">'+amt+'</span>'+unit+'</div>'
      +  '<div class="vc-countrow"><span class="vc-count-label">'+cLabel+'</span><span class="pct">'+pct+'%</span></div>'
      +  '<div class="vc-count remain">'+cText+'</div>'
      +  '<div class="vc-track"><div class="bar-fill" style="width:'+pct+'%"></div><div class="vc-node" style="left:'+pct+'%"></div></div>'
      +  '<div class="vdates">'
      +    '<span>Locked<b>'+fmtDate(l.createdAt)+'</b></span>'
      +    '<span>Unlocks<b>'+fmtDate(l.unlockTime)+'</b></span>'
      +  '</div>'
      +  foot
      +'</div>';
  };

  // Active + ready-to-withdraw stay visible; already-withdrawn locks collapse behind a toggle
  const isPast=l=>(l.withdrawn===true||l.withdrawn==='true');
  const current=shown.filter(l=>!isPast(l));
  const past=shown.filter(isPast);

  let html=current.map(cardHtml).join('');
  if(past.length){
    const plural=past.length===1?'lock':'locks';
    const chev='<svg class="pt-chev" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"></polyline></svg>';
    html += '<button type="button" class="past-toggle" id="pastToggle" aria-expanded="false">'
         +    '<span class="pt-label">Show '+past.length+' past '+plural+'</span>'+chev
         +  '</button>'
         +  '<div class="past-list" id="pastList" hidden>'+past.map(cardHtml).join('')+'</div>';
  }
  list.innerHTML=html;

  list.querySelectorAll('.withdraw').forEach(btn=>{
    btn.addEventListener('click',()=>doWithdraw(btn.dataset.id));
  });

  const pastToggle=document.getElementById('pastToggle');
  if(pastToggle){
    pastToggle.addEventListener('click',()=>{
      const pl=document.getElementById('pastList');
      const lbl=pastToggle.querySelector('.pt-label');
      const wasOpen=pastToggle.getAttribute('aria-expanded')==='true';
      pastToggle.setAttribute('aria-expanded',String(!wasOpen));
      if(pl) pl.hidden=wasOpen;
      const plural=past.length===1?'lock':'locks';
      if(lbl) lbl.textContent=(wasOpen?'Show ':'Hide ')+past.length+' past '+plural;
    });
  }

  if(lockTick) clearInterval(lockTick);
  lockTick=setInterval(tickLocks,1000);
}

// ─── LIVE TICK ───────────────────────────────────────
function tickLocks(){
  const now=Math.floor(Date.now()/1000);
  let changed=false;
  document.querySelectorAll('#vlist .vcard').forEach(card=>{
    const l=locks.find(x=>String(x.id)===String(card.dataset.id));
    if(!l) return;
    const withdrawn=l.withdrawn===true||l.withdrawn==='true';
    if(withdrawn) return;
    l.timeRemaining=Math.max(0,l.unlockTime-now);
    const wasReady=l.canWithdraw;
    l.canWithdraw=l.timeRemaining===0;
    const pct=l.canWithdraw?100:calcPct(l);
    const fill=card.querySelector('.bar-fill'); if(fill) fill.style.width=pct+'%';
    const node=card.querySelector('.vc-node'); if(node) node.style.left=pct+'%';
    const pctEl=card.querySelector('.pct'); if(pctEl) pctEl.textContent=pct+'%';
    const rem=card.querySelector('.remain');
    if(rem) rem.textContent=l.canWithdraw?'Ready to withdraw':fmtCountdown(l.timeRemaining);
    const lbl=card.querySelector('.vc-count-label'); if(lbl && l.canWithdraw) lbl.textContent='Status';
    if(l.canWithdraw && !wasReady){
      changed=true;
      card.classList.add('ready');
      const st=card.querySelector('.vstatus');
      if(st){ st.className='vstatus unlocked'; st.innerHTML='<i class="vc-dot"></i> Unlocked'; }
      const wb=card.querySelector('.withdraw'); if(wb) wb.removeAttribute('disabled');
    }
  });
  // refresh "next unlock" stat live
  const active=locks.filter(l=>l.withdrawn!==true&&l.withdrawn!=='true'&&parseFloat(l.amount)>0);
  const next=active.filter(l=>!l.canWithdraw).sort((a,b)=>a.unlockTime-b.unlockTime)[0];
  setNextUnlock(next ? relTime(next.unlockTime*1000-Date.now()) : (active.length?'Ready':'—'));
}

// ─── LOCK ────────────────────────────────────────────
async function doLock(){
  if(!cont){ openWalletModal(); return; }
  clearAlerts();
  const amt=parseFloat(document.getElementById('amount').value);
  if(!amt||isNaN(amt)||amt<=0){ showErr('Please enter a valid amount'); return; }
  const unlockTime=getUnlockSeconds();
  if(!unlockTime){ showErr('Please choose a valid unlock time in the future'); return; }
  const terr=lockTimeError(unlockTime);
  if(terr){ showErr(terr); return; }

  const btn=document.getElementById('lock');
  if(btn){ btn.disabled=true; btn.innerHTML='<span class="spin"></span> Please wait…'; }

  // Authoritative on-chain cap check
  try{
    const onchain=Number(await readCont.activeLockCount(acct));
    currentActiveCount=onchain;
    updateLockLimitUI();
    if(onchain>=MAX_ACTIVE_LOCKS){
      showErr('You\'ve reached the maximum of '+MAX_ACTIVE_LOCKS+' active locks. Withdraw an unlocked vault first.');
      if(btn){ btn.disabled=false; btn.textContent='Lock'; }
      return;
    }
  }catch(e){/* contract still enforces the cap */}

  if(btn){ btn.innerHTML='<span class="spin"></span> Sending…'; }
  showLockAnim('start');
  try{
    let tx;

    if(!selectedToken){
      if(amt < 0.001){ showErr('Minimum 0.001 for native coin'); showLockAnim('hide'); if(btn){btn.disabled=false;btn.textContent='Lock';} return; }
      showLockAnim('locking');
      tx=await sendContractTx(cont, 'lockNative', [unlockTime], ethers.parseEther(amt.toString()));
    } else {
      // Reads (allowance) go through the Alchemy read provider — mobile wallets
      // over WalletConnect are unreliable for eth_call and return empty data,
      // which makes ethers throw a cryptic CALL_EXCEPTION / "missing revert
      // data". For the approve WRITE, bind to a real signer only for injected
      // wallets; over WalletConnect sendContractTx() publishes the tx directly
      // and never calls prov.getSigner() (which would throw if the relay slept).
      const erc20=new ethers.Contract(selectedToken.address, ERC20_ABI, wcProvider ? (readProv||prov) : await prov.getSigner());
      const erc20Read=new ethers.Contract(selectedToken.address, ERC20_ABI, readProv||prov);
      const amtWei=ethers.parseUnits(amt.toString(), selectedToken.decimals);
      const minAmt=getTokenMinimum(selectedToken.decimals);
      if(amtWei < minAmt){ showErr('Amount too low — minimum is '+formatMinimum(minAmt, selectedToken.decimals)+' '+selectedToken.symbol); showLockAnim('hide'); if(btn){btn.disabled=false;btn.textContent='Lock';} return; }
      let allowance;
      try{
        allowance=await erc20Read.allowance(acct, CONTRACT_ADDRESS);
      }catch(err){
        showErr('Couldn’t check your '+selectedToken.symbol+' allowance — the network read failed. Please make sure your wallet is open and on Ethereum Mainnet, then try again.');
        showLockAnim('hide'); if(btn){btn.disabled=false;btn.textContent='Lock';} return;
      }

      if(allowance < amtWei){
        showLockAnim('approving');
        setApprovalStep(1);
        if(btn) btn.innerHTML='<span class="spin"></span> Approving…';
        if(allowance > 0n){
          const resetTx=await sendContractTx(erc20, 'approve', [CONTRACT_ADDRESS, 0n]);
          await waitForTx(resetTx);
        }
        const approveTx=await sendContractTx(erc20, 'approve', [CONTRACT_ADDRESS, amtWei]);
        await waitForTx(approveTx);
        setApprovalStep(2);
      } else {
        setApprovalStep(2);
      }

      showLockAnim('locking');
      if(btn) btn.innerHTML='<span class="spin"></span> Locking…';
      tx=await sendContractTx(cont, 'lockToken', [selectedToken.address, amtWei, unlockTime]);
    }

    showLockAnim('confirming');
    if(btn) btn.innerHTML='<span class="spin"></span> Confirming…';
    await waitForTx(tx);
    document.getElementById('amount').value='';
    selMs=null;
    document.querySelectorAll('#presets .preset').forEach(p=>p.classList.remove('on'));
    if(datePicker) datePicker.clear(); else { const dEl=document.getElementById('date'); if(dEl) dEl.value=''; }
    showLockAnim('done');
    setApprovalStep(0);
    showOk('✓ '+currentSymbol+' locked successfully!');
    trackEvent('deposit_completed', {symbol:currentSymbol});
    await loadTokenBalances();
    await loadLocks();
    updateSummary();
  }catch(e){
    const raw = (e&&(e.reason||e.message))||String(e);
    if(isUserRejection(e)){
      // User cancelled in their wallet — not an error, just reset quietly.
      clearAlerts();
      showLockAnim('hide'); setApprovalStep(0);
    }else if(isWcPendingError(e)){
      // The tx reached the wallet despite a relay id hiccup (wallet was closed).
      // Leave the overlay exactly as it already is ("Locking your funds — Confirm
      // the transaction in your wallet…") instead of switching to a different
      // screen — the user sees the same thing whether or not their wallet was
      // closed. Quietly poll the chain until the new vault appears — using a
      // lightweight count read (not a full loadLocks) so the list behind the
      // overlay doesn't flicker while we wait.
      const before = locks.length;
      waitForPendingSettle(async()=> Number(await readCont.getUserLockCount(acct)) > before, 'done', 'deposit_completed', {symbol:currentSymbol, viaPendingRecover:true});
    }else if(isWcSessionError(e)){
      // Dead/orphaned session — clear it so the next Connect gives a fresh QR
      // instead of silently reusing the dead one (which would just fail again).
      console.error('[TimeLock] WC session error:', raw, wcDiag());
      wipeWcSession();
      setConnectedUI(false);
      showErr(wcReconnectMsg());
      showLockAnim('hide'); setApprovalStep(0);
    }else{
      console.error('[TimeLock] tx error:', raw, wcProvider ? wcDiag() : '');
      showErr(raw);
      showLockAnim('hide'); setApprovalStep(0);
    }
  }
  finally{
    if(btn){ btn.disabled=false; btn.dataset.limit=''; btn.textContent='Lock'; }
    updateLockLimitUI();
  }
}

// After a "pending" send (wallet was closed and the relay dropped the request
// id), the original promise is gone but the tx still reaches the wallet. The
// overlay is left showing whatever it already displayed; we poll the chain with
// a LIGHTWEIGHT read (`checkDone` — a single count/flag call, NOT a full
// loadLocks) so the vault list behind the overlay doesn't flicker while we wait.
// Only when it's actually done do we run the full UI refresh, once. The user can
// bail out early with the Cancel button (cancelTxWait, which flips
// txWaitCancelled) — we can't detect a wallet-side rejection directly (a
// rejected tx leaves no on-chain trace), so a manual cancel is the only way to
// end the wait early.
let txWaitCancelled = false;
async function waitForPendingSettle(checkDone, doneState, eventName, eventParams){
  txWaitCancelled = false;
  const MAX_MS = 120000;   // 2 minutes
  const start = Date.now();
  while(Date.now() - start < MAX_MS){
    await new Promise(r => setTimeout(r, 5000));
    if(txWaitCancelled) return;
    let done = false; try{ done = await checkDone(); }catch(e){}
    if(txWaitCancelled) return;
    if(done){
      // Confirmed — now do the full (flickery) refresh once, then celebrate.
      try{ await loadLocks(); await loadTokenBalances(); updateSummary(); }catch(e){}
      showLockAnim(doneState);
      if(eventName) trackEvent(eventName, eventParams);
      return;
    }
  }
  if(txWaitCancelled) return;
  showLockAnim('hide');
  showOk('Still no confirmation from your wallet. If you approved it, your vault will update shortly — otherwise nothing happened and you can try again.');
}

// Wired to the overlay's Cancel button. We can't know whether the user actually
// rejected in their wallet (no on-chain trace for a rejection) — this just stops
// the app from waiting on it any longer.
function cancelTxWait(){
  txWaitCancelled = true;
  showLockAnim('hide');
  setApprovalStep(0);
  clearAlerts();
  showOk('Stopped waiting. If you already approved in your wallet, it will still go through — otherwise nothing happened.');
}

// ─── WITHDRAW ────────────────────────────────────────
async function doWithdraw(id){
  clearAlerts();
  if(!cont){ showErr('Connect wallet first'); return; }
  // Defence-in-depth: the contract reverts on early withdrawal (FundsStillLocked),
  // but block it here too so the UI never even sends the transaction early.
  const lk=locks.find(x=>String(x.id)===String(id));
  if(lk){
    if(lk.withdrawn===true||lk.withdrawn==='true'){ showErr('This lock has already been withdrawn.'); return; }
    const tr=Math.max(0,Number(lk.unlockTime)-Math.floor(Date.now()/1000));
    if(tr>0){ showErr('Still time-locked — withdrawal opens '+fmtFull(Number(lk.unlockTime))+'.'); return; }
  }
  const btn=document.querySelector('#vlist .withdraw[data-id="'+id+'"]');
  if(btn){ btn.disabled=true; btn.innerHTML='<span class="spin"></span> Please wait…'; }
  showLockAnim('withdrawing');
  try{
    const tx=await sendContractTx(cont, 'withdraw', [id]);
    showLockAnim('withdraw-confirming');
    if(btn) btn.innerHTML='<span class="spin"></span> Confirming…';
    await waitForTx(tx);
    showLockAnim('withdraw-done');
    showOk('✓ Withdrawal successful!');
    trackEvent('withdraw_completed');
    await loadTokenBalances();
    await loadLocks();
    syncTokenLabels();
  }catch(e){
    const raw = (e&&(e.reason||e.message))||String(e);
    if(isUserRejection(e)){
      clearAlerts();
      showLockAnim('hide');
    }else if(isWcPendingError(e)){
      // Wallet was closed during send; leave the overlay exactly as it already
      // is ("Withdrawing your funds — Confirm the transaction in your wallet…")
      // and quietly wait for the withdrawal to be reflected on-chain. Lightweight
      // getLock read (not a full loadLocks) so the list behind doesn't flicker.
      waitForPendingSettle(async()=>{
        const l = await readCont.getLock(id);
        return l.withdrawn === true;
      }, 'withdraw-done', 'withdraw_completed', {viaPendingRecover:true});
    }else if(isWcSessionError(e)){
      console.error('[TimeLock] WC session error:', raw, wcDiag());
      wipeWcSession();
      setConnectedUI(false);
      showErr(wcReconnectMsg());
      showLockAnim('hide');
    }else{
      console.error('[TimeLock] tx error:', raw, wcProvider ? wcDiag() : '');
      showErr(raw);
      showLockAnim('hide');
    }
    if(btn){ btn.disabled=false; btn.textContent='Withdraw'; }
  }
}

// ─── DATE / TIME FORMAT HELPERS (new UI) ─────────────
function relTime(ms){
  if(ms<=0) return 'Ready';
  const s=Math.floor(ms/1000);
  const d=Math.floor(s/86400),h=Math.floor(s%86400/3600),m=Math.floor(s%3600/60),sec=s%60;
  if(d>0) return d+'d '+h+'h';
  if(h>0) return h+'h '+m+'m';
  if(m>0) return m+'m '+sec+'s';
  return sec+'s';
}
function fmtFull(ts){
  return new Date(ts*1000).toLocaleString(undefined,{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
}

// ─── INIT / WIRING ───────────────────────────────────
function initApp(){
  if(typeof ethers==='undefined'){
    showErr('Could not load the ethers library — check your connection and reload.');
  }

  // Wallet pill
  const pill=document.getElementById('walletPill');
  if(pill) pill.addEventListener('click',toggleWalletMenu);
  document.addEventListener('click',e=>{
    const wrap=document.getElementById('walletPillWrap');
    if(wrap && !wrap.contains(e.target)){
      const m=document.getElementById('walletMenu'); if(m) m.style.display='none';
    }
  });

  // Token + amount
  const tokenSel=document.getElementById('token');
  if(tokenSel) tokenSel.addEventListener('change',e=>selectTokenFromDropdown(e.target.value));
  const maxBtn=document.getElementById('max');
  if(maxBtn) maxBtn.addEventListener('click',setMaxAmount);
  const amountEl=document.getElementById('amount');
  if(amountEl) amountEl.addEventListener('input',()=>{ updateSummary(); checkBalance(); });

  // Duration
  document.getElementById('tab-preset').addEventListener('click',()=>setDurMode('preset'));
  document.getElementById('tab-date').addEventListener('click',()=>setDurMode('date'));
  document.getElementById('presets').addEventListener('click',e=>{
    const b=e.target.closest('.preset'); if(b) pickPreset(b);
  });
  const dateEl=document.getElementById('date');
  if(dateEl){
    const min=new Date(Date.now()+MIN_LOCK_SECONDS*1000); min.setSeconds(0,0);
    const max=new Date(Date.now()+MAX_LOCK_SECONDS*1000); max.setSeconds(0,0);
    if(typeof flatpickr!=='undefined'){
      // Clean custom calendar (themed in style.css). On real phones flatpickr
      // falls back to the native iOS/Android wheel picker automatically.
      datePicker=flatpickr(dateEl,{
        minDate:min,
        maxDate:max,
        dateFormat:'M j, Y',          // date only — e.g. "Jun 22, 2026"
        monthSelectorType:'static',   // show "Month Year" as plain text in the header
        appendTo:document.body,       // escape the form card's overflow:hidden
        position:'auto',
        onChange:updateSummary,
        onClose:updateSummary
      });
    } else {
      // Fallback: native date input if the picker library didn't load
      dateEl.removeAttribute('readonly');
      dateEl.type='date';
      dateEl.addEventListener('input',updateSummary);
      const toDate=d=>new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);
      dateEl.min=toDate(min);
      dateEl.max=toDate(max);
    }
  }

  // Lock button
  document.getElementById('lock').addEventListener('click',doLock);

  // Initial state
  setDurMode('preset');
  setConnectedUI(false);
  updateSummary();
}

if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded',initApp);
}else{
  initApp();
}
