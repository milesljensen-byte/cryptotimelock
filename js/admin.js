async function checkAdmin(){
  try{
    // HIGH FIX: also check pendingFeeRecipient so the incoming address can confirm
    const [feeAddr, ownerAddr, guardianAddr, pendingFeeAddr] = await Promise.all([
      readCont.feeRecipient(), readCont.owner(), readCont.guardian(), readCont.pendingFeeRecipient()
    ]);
    const isFee         = acct.toLowerCase()===feeAddr.toLowerCase();
    const isOwner       = acct.toLowerCase()===ownerAddr.toLowerCase();
    const isGuardian    = acct.toLowerCase()===guardianAddr.toLowerCase();
    const isPendingFee  = pendingFeeAddr && pendingFeeAddr !== '0x0000000000000000000000000000000000000000'
                          && acct.toLowerCase()===pendingFeeAddr.toLowerCase();

    if(!isFee && !isOwner && !isGuardian && !isPendingFee){
      document.getElementById('adminPanel').style.display='none'; return;
    }

    document.getElementById('adminPanel').style.display='block';

    // Owner-only controls: emergency pause + token allowlist
    document.getElementById('pauseSection').style.display      = isOwner ? '' : 'none';
    document.getElementById('allowlistSection').style.display  = isOwner ? '' : 'none';
    // Fee-recipient-only controls: claim fees + fee-recipient change (request/cancel)
    document.getElementById('claimControls').style.display       = isFee ? '' : 'none';
    document.getElementById('feeRecipientSection').style.display = isFee ? '' : 'none';
    document.getElementById('rescueSection').style.display       = isFee ? '' : 'none';
    // HIGH FIX: pending (incoming) fee recipient gets a separate confirm-only panel
    const confirmSection = document.getElementById('pendingRecipientConfirmSection');
    if(confirmSection) confirmSection.style.display = isPendingFee ? '' : 'none';
    // Owner-only: ownership transfer + guardian rotation
    document.getElementById('ownershipSection').style.display   = isOwner ? '' : 'none';
    document.getElementById('guardianSection').style.display    = isOwner ? '' : 'none';
    // Owner + guardian: fee-recipient recovery (2-of-2)
    document.getElementById('recoverySection').style.display    = (isOwner || isGuardian) ? '' : 'none';

    await loadAdminStats(); // read-only stats, fine for any admin role
    if(isOwner){ await loadAllowlist(); await loadPauseState(); await loadOwnershipStatus(); await loadGuardianStatus(); }
    if(isFee){ await loadFeeRecipientStatus(); await loadRescuableTokens(); }
    if(isPendingFee){ await loadPendingFeeRecipientStatus(); }
    if(isOwner || isGuardian){ await loadRecoveryStatus(); }
  }catch(e){console.error(e)}
}

// ─── PAUSE ───────────────────────────────────────────
async function loadPauseState(){
  try{
    const isPaused=await readCont.paused();
    renderPauseState(isPaused);
    document.getElementById('pausedBanner').style.display=isPaused?'block':'none';
  }catch(e){console.error(e)}
}

function renderPauseState(isPaused){
  const badge=document.getElementById('pauseStatusBadge');
  const btn=document.getElementById('pauseBtn');
  const section=document.getElementById('pauseSection');
  if(!badge||!btn)return;
  if(isPaused){
    badge.textContent='● PAUSED';
    badge.style.cssText='font-size:11px;padding:3px 10px;border-radius:100px;font-weight:500;background:var(--red-a12);color:var(--red);border:1px solid rgba(224,85,85,.25)';
    btn.textContent='Unpause';
    btn.className='btn btn-green';
    section.style.borderColor='rgba(224,85,85,.25)';
  }else{
    badge.textContent='● LIVE';
    badge.style.cssText='font-size:11px;padding:3px 10px;border-radius:100px;font-weight:500;background:var(--green-a12);color:var(--green);border:1px solid rgba(46,189,133,.25)';
    btn.textContent='Pause';
    btn.className='btn btn-out';
    btn.style.cssText='font-size:12px;padding:.4rem .9rem;min-width:80px;color:var(--red);border-color:rgba(224,85,85,.2)';
    section.style.borderColor='var(--b1)';
  }
}

async function togglePause(){
  clearAlerts();
  const btn=document.getElementById('pauseBtn');
  const isPaused=await readCont.paused();
  btn.disabled=true;
  btn.innerHTML='<div class="spin"></div>';
  try{
    const tx=isPaused?await cont.unpause():await cont.pause();
    await waitForTx(tx);
    const newState=!isPaused;
    renderPauseState(newState);
    document.getElementById('pausedBanner').style.display=newState?'block':'none';
    showOk(newState?'⚠ Contract paused — new deposits blocked':'✓ Contract unpaused — deposits re-enabled');
  }catch(e){showErr(e.reason||e.message);}
  finally{btn.disabled=false;}
}

async function loadAdminStats(){
  try{
    const total=await readCont.lockCounter();
    document.getElementById('adminTotal').textContent=Number(total);
    const feeRows=document.getElementById('adminFeeRows');
    let rows='';
    try{
      const np=await readCont.pendingNativeFees();
      const na=parseFloat(ethers.formatEther(np));
      rows+='<div style="display:flex;align-items:center;justify-content:space-between;background:var(--s2);border:1px solid var(--b1);border-radius:var(--rsm);padding:.75rem 1rem">'+
        '<div><div style="font-size:13px;font-weight:500">'+currentSymbol+' Fees</div>'+
        '<div style="font-family:Space Mono,monospace;font-size:14px;color:var(--gold)">'+na.toFixed(6)+' '+currentSymbol+'</div></div>'+
        '<button class="btn btn-out" onclick="claimSingleToken(&quot;native&quot;)" style="font-size:12px;padding:.4rem .9rem" '+(na<=0?'disabled':'')+'>Claim</button></div>';
    }catch(e){}
    const tokens=(ALL_TOKENS[currentChainId]||[]).filter(t=>t.address);
    for(const t of tokens){
      try{
        const p=await readCont.pendingTokenFees(t.address);
        const a=parseFloat(ethers.formatUnits(p,t.decimals));
        if(a>0.000001){
          rows+='<div style="display:flex;align-items:center;justify-content:space-between;background:var(--s2);border:1px solid var(--b1);border-radius:var(--rsm);padding:.75rem 1rem">'+
            '<div><div style="font-size:13px;font-weight:500">'+t.symbol+' Fees</div>'+
            '<div style="font-family:Space Mono,monospace;font-size:14px;color:var(--gold)">'+a.toFixed(6)+' '+t.symbol+'</div></div>'+
            '<button class="btn btn-out" onclick="claimSingleToken(&quot;'+t.address+'&quot;)" style="font-size:12px;padding:.4rem .9rem">Claim</button></div>';
        }
      }catch(e){}
    }
    feeRows.innerHTML=rows||'<div style="font-size:13px;color:var(--t3)">No fees accumulated yet</div>';
  }catch(e){console.error(e)}
}

async function claimSingleToken(tokenAddress){
  clearAlerts();
  try{
    let tx;
    if(tokenAddress==='native'){
      tx=await cont.claimNativeFees();
    } else {
      tx=await cont.claimTokenFees(tokenAddress);
    }
    await waitForTx(tx);
    showOk('✓ Fees claimed!');
    await loadAdminStats();
  }catch(e){showErr(e.reason||e.message)}
}

async function doClaimFees(){
  clearAlerts();
  const btn=document.getElementById('claimBtn');
  btn.disabled=true;btn.innerHTML='<div class="spin"></div> Claiming...';
  try{
    const np=await readCont.pendingNativeFees();
    if(np>0){
      const tx=await cont.claimNativeFees();
      await waitForTx(tx);
    }
    const tokens=(ALL_TOKENS[currentChainId]||[]).filter(t=>t.address);
    for(const t of tokens){
      try{const p=await readCont.pendingTokenFees(t.address);if(p>0){const tx=await cont.claimTokenFees(t.address);await waitForTx(tx);}}catch(e){}
    }
    showOk('✓ All fees claimed!');
    await loadAdminStats();
  }catch(e){showErr(e.reason||e.message)}
  finally{btn.disabled=false;btn.innerHTML='Claim All Fees';}
}

// ─── ALLOWLIST MANAGEMENT ─────────────────────────────

async function loadAllowlist(){
  const rows = document.getElementById('allowlistRows');
  if(!rows) return;
  const tokens = (ALL_TOKENS[currentChainId]||[]).filter(t=>t.address);
  const now = Math.floor(Date.now()/1000);

  // v2.5.3: each token has its OWN queue slot (tokenAllowTimes mapping), so
  // multiple tokens can be queued at once and none blocks another.
  let html = '';
  for(const t of tokens){
    try{
      const allowed = await readCont.allowedTokens(t.address);
      let allowTime = 0;
      try{ allowTime = Number(await readCont.tokenAllowTimes(t.address)); }catch(e){}
      const isPending = !allowed && allowTime > 0;
      const ready = isPending && now >= allowTime;

      let statusHtml, actionHtml;
      if(allowed){
        statusHtml = '<span style="font-size:11px;color:var(--green);background:var(--green-a12);border:1px solid rgba(46,189,133,.2);padding:2px 8px;border-radius:100px">Allowed</span>';
        actionHtml = '<button class="btn btn-out" onclick="doDisallowToken(\''+t.address+'\')" style="font-size:11px;padding:.3rem .7rem;color:var(--red);border-color:rgba(224,85,85,.2)">Remove</button>';
      } else if(isPending){
        const remaining = allowTime - now;
        const h = Math.max(0,Math.floor(remaining/3600)), m = Math.max(0,Math.floor((remaining%3600)/60));
        const timerText = ready ? 'Ready to confirm' : h+'h '+m+'m';
        statusHtml = '<span style="font-size:11px;color:var(--gold);background:var(--gold-a12);border:1px solid var(--gold-a25);padding:2px 8px;border-radius:100px">'+timerText+'</span>';
        actionHtml = '<button class="btn btn-green" onclick="doConfirmAllowToken(\''+t.address+'\')" style="font-size:11px;padding:.3rem .7rem"'+(ready?'':' disabled')+'>Confirm</button>'
                   + '<button class="btn btn-out" onclick="doCancelAllowToken(\''+t.address+'\')" style="font-size:11px;padding:.3rem .7rem;color:var(--red);border-color:rgba(224,85,85,.2)">Cancel</button>';
      } else {
        statusHtml = '<span style="font-size:11px;color:var(--t3);background:var(--s3);border:1px solid var(--b1);padding:2px 8px;border-radius:100px">Blocked</span>';
        actionHtml = '<button class="btn btn-green" onclick="doRequestAllowToken(\''+t.address+'\')" style="font-size:11px;padding:.3rem .7rem">Request</button>';
      }

      html +=
        '<div style="display:flex;align-items:center;justify-content:space-between;background:var(--s2);border:1px solid var(--b1);border-radius:var(--rsm);padding:.6rem .9rem">'
        + '<div style="display:flex;align-items:center;gap:8px">'
        + '<span style="font-size:14px">'+(t.icon||'&#x1FA99;')+'</span>'
        + '<span style="font-size:13px;font-weight:500">'+esc(t.symbol)+'</span>'
        + '<span style="font-size:10px;color:var(--t3);font-family:Space Mono,monospace">'+esc(t.address.slice(0,8))+'...</span>'
        + '</div>'
        + '<div style="display:flex;align-items:center;gap:.5rem">'+statusHtml+actionHtml+'</div>'
        + '</div>';
    }catch(e){}
  }
  rows.innerHTML = html || '<div style="font-size:13px;color:var(--t3)">No known tokens for this network</div>';
}

// ─── FEE RECIPIENT MANAGEMENT ────────────────────────
// HIGH FIX: split into two functions.
// loadFeeRecipientStatus() is for the CURRENT fee recipient (shows pending addr + cancel).
// loadPendingFeeRecipientStatus() is for the INCOMING address (shows confirm button).
async function loadFeeRecipientStatus(){
  try{
    const current=await readCont.feeRecipient();
    const el=document.getElementById('feeRecipientStatus');
    if(el) el.textContent=current.slice(0,10)+'…'+current.slice(-8);
    const pending=await readCont.pendingFeeRecipient();
    const box=document.getElementById('pendingRecipientBox');
    if(!box)return;
    if(pending&&pending!=='0x0000000000000000000000000000000000000000'){
      box.style.display='block';
      const addrEl=document.getElementById('pendingRecipientAddr');
      if(addrEl) addrEl.textContent=pending;
      const changeTime=Number(await readCont.feeRecipientChangeTime());
      const now=Math.floor(Date.now()/1000);
      const timerEl=document.getElementById('pendingRecipientTimer');
      if(now>=changeTime){
        if(timerEl) timerEl.textContent='Ready — waiting for new recipient to confirm';
      } else {
        const remaining=changeTime-now;
        const h=Math.floor(remaining/3600);
        const m=Math.floor((remaining%3600)/60);
        if(timerEl) timerEl.textContent='Unlocks in '+h+'h '+m+'m';
      }
    } else {
      box.style.display='none';
    }
  }catch(e){console.error(e)}
}

// HIGH FIX: called only for the PENDING (incoming) fee recipient.
// The contract's confirmFeeRecipientChange() requires msg.sender == pendingFeeRecipient.
async function loadPendingFeeRecipientStatus(){
  try{
    const pending=await readCont.pendingFeeRecipient();
    const section=document.getElementById('pendingRecipientConfirmSection');
    if(!section)return;
    if(pending&&pending!=='0x0000000000000000000000000000000000000000'){
      section.style.display='';
      const changeTime=Number(await readCont.feeRecipientChangeTime());
      const now=Math.floor(Date.now()/1000);
      const confirmBtn=document.getElementById('confirmRecipientBtn');
      const timerEl=document.getElementById('pendingRecipientConfirmTimer');
      if(now>=changeTime){
        if(timerEl) timerEl.textContent='Timelock expired — you can confirm now';
        if(confirmBtn) confirmBtn.disabled=false;
      } else {
        const remaining=changeTime-now;
        const h=Math.floor(remaining/3600);
        const m=Math.floor((remaining%3600)/60);
        if(timerEl) timerEl.textContent='Unlocks in '+h+'h '+m+'m — come back after this time to confirm';
        if(confirmBtn) confirmBtn.disabled=true;
      }
    } else {
      section.style.display='none';
    }
  }catch(e){console.error(e)}
}

async function doRequestRecipient(){
  clearAlerts();
  const input=document.getElementById('newRecipientAddr');
  const val=input?input.value.trim():'';
  if(!/^0x[a-fA-F0-9]{40}$/.test(val)){showErr('Invalid address');return;}
  try{
    const tx=await cont.requestFeeRecipientChange(val);
    await waitForTx(tx);
    showOk('✓ Change requested — confirm in 48 hours');
    if(input) input.value='';
    await loadFeeRecipientStatus();
  }catch(e){showErr(e.reason||e.message)}
}

async function doConfirmRecipient(){
  clearAlerts();
  try{
    const tx=await cont.confirmFeeRecipientChange();
    await waitForTx(tx);
    showOk('✓ Fee recipient updated');
    await loadFeeRecipientStatus();
  }catch(e){showErr(e.reason||e.message)}
}

async function doCancelRecipient(){
  clearAlerts();
  try{
    const tx=await cont.cancelFeeRecipientChange();
    await waitForTx(tx);
    showOk('✓ Pending change cancelled');
    await loadFeeRecipientStatus();
  }catch(e){showErr(e.reason||e.message)}
}

async function doRequestAllowToken(address){
  clearAlerts();
  try{
    const tx = await cont.requestAllowToken(address);
    await waitForTx(tx);
    showOk('Request submitted — confirm in 48 hours');
    await loadAllowlist();
  }catch(e){ showErr(e.reason||e.message) }
}

async function doConfirmAllowToken(address){
  clearAlerts();
  try{
    const tx = await cont.confirmAllowToken(address);
    await waitForTx(tx);
    showOk('Token added to allowlist');
    await loadAllowlist();
  }catch(e){ showErr(e.reason||e.message) }
}

async function doCancelAllowToken(address){
  clearAlerts();
  try{
    const tx = await cont.cancelAllowToken(address);
    await waitForTx(tx);
    showOk('Pending allowlist request cancelled');
    await loadAllowlist();
  }catch(e){ showErr(e.reason||e.message) }
}

async function doDisallowToken(address){
  clearAlerts();
  try{
    const tx = await cont.disallowToken(address);
    await waitForTx(tx);
    showOk('✓ Token removed from allowlist');
    await loadAllowlist();
  }catch(e){ showErr(e.reason||e.message) }
}

// ─── OWNERSHIP MANAGEMENT ────────────────────────────

async function loadOwnershipStatus(){
  try{
    const [ownerAddr, pendingAddr, guardianAddr, transferTime] = await Promise.all([
      readCont.owner(), readCont.pendingOwner(), readCont.guardian(), readCont.ownershipTransferTime()
    ]);
    const ownerEl = document.getElementById('ownerStatus');
    if(ownerEl) ownerEl.textContent = 'Owner: '+ownerAddr.slice(0,10)+'…'+ownerAddr.slice(-8);
    const guardEl = document.getElementById('guardianStatus');
    if(guardEl) guardEl.textContent = 'Guardian: '+guardianAddr.slice(0,10)+'…'+guardianAddr.slice(-8);
    const isPending = pendingAddr && pendingAddr !== '0x0000000000000000000000000000000000000000';
    const pendingBox = document.getElementById('pendingOwnerBox');
    const transferControls = document.getElementById('transferOwnerControls');
    if(isPending){
      if(pendingBox) pendingBox.style.display='block';
      const addrEl = document.getElementById('pendingOwnerAddr');
      if(addrEl) addrEl.textContent = pendingAddr;
      const acceptBtn  = document.getElementById('acceptOwnerBtn');
      const cancelBtn  = document.getElementById('cancelOwnerBtn');
      const hintEl     = document.getElementById('acceptOwnerHint');
      const iNominee   = acct.toLowerCase()===pendingAddr.toLowerCase();
      const iCurrentOwner = acct.toLowerCase()===ownerAddr.toLowerCase();
      const now = Math.floor(Date.now()/1000);
      const tt  = Number(transferTime);
      const timelockReady = now >= tt;
      if(acceptBtn){
        acceptBtn.style.display = iNominee ? '' : 'none';
        acceptBtn.disabled = !timelockReady;
      }
      if(cancelBtn){ cancelBtn.style.display = iCurrentOwner ? '' : 'none'; }
      if(hintEl){
        if(iNominee && !timelockReady){
          const rem = tt - now;
          hintEl.textContent = 'Timelock: you can accept in '+Math.floor(rem/3600)+'h '+Math.floor((rem%3600)/60)+'m';
        } else if(iNominee) {
          hintEl.textContent = 'Timelock expired — click Accept to take ownership.';
        } else {
          hintEl.textContent = 'Waiting for nominee to accept.';
        }
      }
      if(transferControls) transferControls.style.display='none';
    } else {
      if(pendingBox) pendingBox.style.display='none';
      if(transferControls) transferControls.style.display='';
    }
  }catch(e){console.error(e)}
}

async function doTransferOwnership(){
  clearAlerts();
  const input = document.getElementById('newOwnerAddr');
  const val = input ? input.value.trim() : '';
  if(!/^0x[a-fA-F0-9]{40}$/.test(val)){showErr('Invalid address');return;}
  try{
    const tx = await cont.transferOwnership(val);
    await waitForTx(tx);
    showOk('✓ Ownership transfer initiated — nominee must call Accept');
    if(input) input.value='';
    await loadOwnershipStatus();
  }catch(e){showErr(e.reason||e.message)}
}

async function doAcceptOwnership(){
  clearAlerts();
  try{
    const tx = await cont.acceptOwnership();
    await waitForTx(tx);
    showOk('✓ Ownership accepted — you are now the owner');
    await loadOwnershipStatus();
  }catch(e){showErr(e.reason||e.message)}
}

async function doCancelOwnershipTransfer(){
  clearAlerts();
  try{
    const tx = await cont.cancelOwnershipTransfer();
    await waitForTx(tx);
    showOk('✓ Ownership transfer cancelled');
    await loadOwnershipStatus();
  }catch(e){showErr(e.reason||e.message)}
}

// ─── GUARDIAN MANAGEMENT ─────────────────────────────
// CRITICAL FIX: setGuardian() no longer exists. The contract now uses a 3-step
// timelocked flow: requestSetGuardian → 48hr → confirmSetGuardian.

async function loadGuardianStatus(){
  try{
    const [guardianAddr, pendingAddr, changeTime] = await Promise.all([
      readCont.guardian(), readCont.pendingGuardian(), readCont.guardianChangeTime()
    ]);
    const guardEl = document.getElementById('guardianStatus');
    if(guardEl) guardEl.textContent = 'Guardian: '+guardianAddr.slice(0,10)+'…'+guardianAddr.slice(-8);
    const isPending = pendingAddr && pendingAddr !== '0x0000000000000000000000000000000000000000';
    const pendingBox = document.getElementById('pendingGuardianBox');
    const requestControls = document.getElementById('guardianRequestControls');
    if(isPending){
      if(pendingBox) pendingBox.style.display='block';
      if(requestControls) requestControls.style.display='none';
      const addrEl = document.getElementById('pendingGuardianAddr');
      if(addrEl) addrEl.textContent = pendingAddr;
      const now = Math.floor(Date.now()/1000);
      const ct = Number(changeTime);
      const confirmBtn = document.getElementById('confirmGuardianBtn');
      const timerEl = document.getElementById('pendingGuardianTimer');
      if(now >= ct){
        if(timerEl) timerEl.textContent = 'Timelock expired — ready to confirm';
        if(confirmBtn) confirmBtn.disabled = false;
      } else {
        const rem = ct - now;
        const h = Math.floor(rem/3600), m = Math.floor((rem%3600)/60);
        if(timerEl) timerEl.textContent = 'Unlocks in '+h+'h '+m+'m';
        if(confirmBtn) confirmBtn.disabled = true;
      }
    } else {
      if(pendingBox) pendingBox.style.display='none';
      if(requestControls) requestControls.style.display='';
    }
  }catch(e){console.error(e)}
}

async function doRequestGuardian(){
  clearAlerts();
  const input = document.getElementById('newGuardianAddr');
  const val = input ? input.value.trim() : '';
  if(!/^0x[a-fA-F0-9]{40}$/.test(val)){showErr('Invalid address');return;}
  try{
    const tx = await cont.requestSetGuardian(val);
    await waitForTx(tx);
    showOk('Guardian rotation requested — confirm after 48 hours');
    if(input) input.value='';
    await loadGuardianStatus();
  }catch(e){showErr(e.reason||e.message)}
}

async function doConfirmGuardian(){
  clearAlerts();
  try{
    const tx = await cont.confirmSetGuardian();
    await waitForTx(tx);
    showOk('✓ Guardian updated');
    await loadGuardianStatus();
  }catch(e){showErr(e.reason||e.message)}
}

async function doCancelGuardian(){
  clearAlerts();
  try{
    const tx = await cont.cancelSetGuardian();
    await waitForTx(tx);
    showOk('✓ Guardian rotation cancelled');
    await loadGuardianStatus();
  }catch(e){showErr(e.reason||e.message)}
}

// ─── FEE RECIPIENT RECOVERY (owner + guardian 2-of-2) ─

async function loadRecoveryStatus(){
  try{
    const [recovAddr, recovTime, recovInit] = await Promise.all([
      readCont.recoveryRecipient(), readCont.recoveryTime(), readCont.recoveryInitiator()
    ]);
    const isPending = recovAddr && recovAddr !== '0x0000000000000000000000000000000000000000';
    const pendingBox = document.getElementById('recoveryPendingBox');
    const initControls = document.getElementById('initRecoveryControls');
    if(isPending){
      if(pendingBox) pendingBox.style.display='block';
      if(initControls) initControls.style.display='none';
      const addrEl = document.getElementById('recoveryTargetAddr');
      if(addrEl) addrEl.textContent = 'New recipient: '+recovAddr;
      const now = Math.floor(Date.now()/1000);
      const rt = Number(recovTime);
      const confirmBtn = document.getElementById('confirmRecoveryBtn');
      const timerEl   = document.getElementById('recoveryTimer');
      const hintEl    = document.getElementById('recoveryHint');
      const isInitiator = acct.toLowerCase()===recovInit.toLowerCase();
      const canConfirm  = !isInitiator && now >= rt;
      if(timerEl){
        if(now >= rt){ timerEl.textContent='Timelock expired — ready to confirm'; }
        else{
          const rem = rt - now;
          timerEl.textContent='Unlocks in '+Math.floor(rem/3600)+'h '+Math.floor((rem%3600)/60)+'m';
        }
      }
      if(confirmBtn){ confirmBtn.disabled = !canConfirm; }
      if(hintEl){
        if(isInitiator) hintEl.textContent='You initiated this recovery. The other admin must confirm.';
        else if(!canConfirm && now < rt) hintEl.textContent='Waiting for timelock to expire.';
        else hintEl.textContent='You can confirm this recovery.';
      }
    } else {
      if(pendingBox) pendingBox.style.display='none';
      if(initControls) initControls.style.display='';
    }
  }catch(e){console.error(e)}
}

async function doInitiateRecovery(){
  clearAlerts();
  const input = document.getElementById('recoveryNewAddr');
  const val = input ? input.value.trim() : '';
  if(!/^0x[a-fA-F0-9]{40}$/.test(val)){showErr('Invalid address');return;}
  try{
    const tx = await cont.initiateFeeRecipientRecovery(val);
    await waitForTx(tx);
    showOk('✓ Recovery initiated — the other admin must confirm after 48 hours');
    if(input) input.value='';
    await loadRecoveryStatus();
  }catch(e){showErr(e.reason||e.message)}
}

async function doConfirmRecovery(){
  clearAlerts();
  try{
    const tx = await cont.confirmFeeRecipientRecovery();
    await waitForTx(tx);
    showOk('✓ Fee recipient recovery confirmed');
    await loadRecoveryStatus();
  }catch(e){showErr(e.reason||e.message)}
}

async function doCancelRecovery(){
  clearAlerts();
  try{
    const tx = await cont.cancelFeeRecipientRecovery();
    await waitForTx(tx);
    showOk('✓ Recovery cancelled');
    await loadRecoveryStatus();
  }catch(e){showErr(e.reason||e.message)}
}

// ─── RESCUE TOKEN (fee recipient only) ──────────────
async function loadRescuableTokens(){
  const rowsEl  = document.getElementById('rescueRows');
  const emptyEl = document.getElementById('rescueEmpty');
  if(!rowsEl) return;
  const tokens = (ALL_TOKENS[currentChainId]||[]).filter(t=>t.address);
  let html = '';
  for(const t of tokens){
    try{
      const surplus = await readCont.rescuableAmount(t.address);
      if(surplus > 0n){
        const fmt = parseFloat(ethers.formatUnits(surplus, t.decimals)).toFixed(6);
        html +=
          '<div style="display:flex;align-items:center;justify-content:space-between;background:var(--s2);border:1px solid var(--b1);border-radius:var(--rsm);padding:.6rem .9rem">'
          + '<div style="display:flex;align-items:center;gap:8px">'
          + '<span style="font-size:14px">'+(t.icon||'🪙')+'</span>'
          + '<span style="font-size:13px;font-weight:500">'+esc(t.symbol)+'</span>'
          + '<span style="font-size:12px;font-family:Space Mono,monospace;color:var(--gold)">'+fmt+'</span>'
          + '</div>'
          + '<button class="btn btn-green" onclick="doRescueToken(\''+t.address+'\')" style="font-size:11px;padding:.3rem .7rem">Rescue</button>'
          + '</div>';
      }
    }catch(e){}
  }
  rowsEl.innerHTML  = html;
  if(emptyEl) emptyEl.style.display = html ? 'none' : 'block';
}

async function doRescueToken(tokenAddress){
  clearAlerts();
  try{
    const tx = await cont.rescueToken(tokenAddress);
    await waitForTx(tx);
    showOk('✓ Surplus tokens rescued to fee recipient');
    await loadRescuableTokens();
  }catch(e){ showErr(e.reason||e.message) }
}

function fmtTime(s){
  if(s<=0)return'Ready ✓';
  const d=Math.floor(s/86400),h=Math.floor(s%86400/3600),m=Math.floor(s%3600/60);
  if(d>365)return Math.floor(d/365)+'y '+Math.round((d%365)/30)+'mo';
  if(d>0)return d+'d '+h+'h';
  if(h>0)return h+'h '+m+'m';
  return m+'m';
}
function fmtCountdown(s){
  if(s<=0)return'Ready to withdraw';
  const p=n=>String(n).padStart(2,'0');
  const y=Math.floor(s/31536000), d=Math.floor(s%31536000/86400),
        h=Math.floor(s%86400/3600), m=Math.floor(s%3600/60), sec=Math.floor(s%60);
  const head = y>0 ? (p(y)+'y '+p(d)+'d ') : (d>0 ? (d+'d ') : '');
  return head + p(h)+':'+p(m)+':'+p(sec);
}
function fmtDate(ts){
  return new Date(ts*1000).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
}
function showErr(m){const e=document.getElementById('errBox');e.textContent=m;e.classList.add('show');setTimeout(()=>e.classList.remove('show'),7000)}
function showOk(m){const e=document.getElementById('okBox');e.textContent=m;e.classList.add('show');setTimeout(()=>e.classList.remove('show'),4000)}
function clearAlerts(){document.getElementById('errBox').classList.remove('show');document.getElementById('okBox').classList.remove('show')}
