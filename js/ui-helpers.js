function esc(str){
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function calcPct(l){
  const total=l.unlockTime-l.createdAt;
  if(total<=0)return 100;
  const elapsed=total-l.timeRemaining;
  return Math.min(100,Math.max(0,Math.round(elapsed/total*100)));
}

function setApprovalStep(step){
  const ind  = document.getElementById('laStepIndicator');
  const d1   = document.getElementById('laStep1Dot');
  const t1   = document.getElementById('laStep1Text');
  const d2   = document.getElementById('laStep2Dot');
  const t2   = document.getElementById('laStep2Text');
  if(!ind) return;
  if(!step){
    ind.style.display='none';
    // Reset dots for next use
    if(d1){ d1.style.background='var(--gold)'; d1.style.color='#1A1008'; d1.style.border='none'; d1.textContent='1'; }
    if(d2){ d2.style.background='var(--b1)'; d2.style.color='var(--t3)'; d2.style.border='1px solid var(--b2)'; }
    if(t1) t1.style.color='var(--t1)';
    if(t2) t2.style.color='var(--t3)';
    return;
  }
  ind.style.display='flex';
  if(step===1){
    // Approve active
    if(d1){ d1.style.background='var(--gold)'; d1.style.color='#1A1008'; d1.style.border='none'; d1.textContent='1'; d1.style.animation='stepPulse 1.2s ease-in-out infinite'; }
    if(t1) t1.style.color='var(--t1)';
    if(d2){ d2.style.background='var(--b1)'; d2.style.color='var(--t3)'; d2.style.border='1px solid var(--b2)'; d2.textContent='2'; d2.style.animation='none'; }
    if(t2) t2.style.color='var(--t3)';
  } else if(step===2){
    // Approve done, Lock active
    if(d1){ d1.style.background='var(--green-a12)'; d1.style.color='var(--green)'; d1.style.border='1px solid var(--green)'; d1.textContent='✓'; d1.style.animation='none'; }
    if(t1) t1.style.color='var(--t2)';
    if(d2){ d2.style.background='var(--gold)'; d2.style.color='#1A1008'; d2.style.border='none'; d2.textContent='2'; d2.style.animation='stepPulse 1.2s ease-in-out infinite'; }
    if(t2) t2.style.color='var(--t1)';
  }
}

function getTokenMinimum(decimals) {
  if (decimals <= 6) return 10n ** BigInt(Math.max(decimals - 2, 0));
  if (decimals <= 8) {
    // MEDIUM FIX: contract enforces a fee-floor of 200 for 8-dec tokens
    // (fee = amount*50/10000, so fee >= 1 requires amount >= 200)
    const raw = 10n ** BigInt(Math.max(decimals - 6, 0));
    return raw < 200n ? 200n : raw;
  }
  return 10n ** BigInt(decimals - 3);
}

function formatMinimum(minWei, decimals) {
  const divisor = 10n ** BigInt(decimals);
  const whole = minWei / divisor;
  const remainder = minWei % divisor;
  if (remainder === 0n) return whole.toString();
  const frac = remainder.toString().padStart(decimals, '0').replace(/0+$/, '');
  return whole.toString() + '.' + frac;
}

// Guidance shown while we wait for the user to approve in their wallet.
// With WalletConnect the wallet app may be closed or backgrounded, so make clear
// they can open it and still confirm — the request stays open for a few minutes.
function confirmSub(action){
  const base = 'Confirm the ' + action + ' in your wallet';
  return wcProvider ? base + ' — open your wallet app if it didn’t pop up' : base;
}

// Decide whether a thrown error is just the user declining the request, vs. a real
// failure. Used so a cancel / "wallet not open yet" never shows a scary crash.
function isUserRejection(e){
  const code = e && (e.code || (e.info && e.info.error && e.info.error.code));
  if(code === 4001 || code === 'ACTION_REJECTED') return true;
  const m = ((e && (e.reason || e.message)) || '').toLowerCase();
  return m.includes('user rejected') || m.includes('user denied') ||
         m.includes('rejected the request') || m.includes('denied transaction') ||
         m.includes('request rejected');
}

// Turn a transaction error into a friendly, recoverable message. Returns null when
// it was a plain user cancel (caller should just close the overlay silently).
function friendlyTxError(e){
  if(isUserRejection(e)) return null;
  const m = ((e && (e.reason || e.message)) || '').toLowerCase();
  // WalletConnect: wallet was closed / request timed out / session went stale.
  // Reassure the user and point them to retry — nothing was lost.
  if(wcProvider && (m === '' || m.includes('expired') || m.includes('timeout') ||
     m.includes('timed out') || m.includes('no matching key') || m.includes('session') ||
     m.includes('disconnected') || m.includes('relayer') || m.includes('proposal') ||
     m.includes('request reset') || m.includes('jsonrpc') ||
     // relay/transport failures: request never reached the wallet
     m.includes('interrupted') || m.includes('publish') || m.includes('subscribe') ||
     m.includes('connection') || m.includes('transport') || m.includes('websocket') ||
     m.includes('network') || m.includes('offline'))){
    return 'Couldn’t reach your wallet. Open your wallet app and tap the button again to retry — your funds are safe.';
  }
  return (e && (e.reason || e.message)) || 'Transaction failed';
}

function showLockAnim(state){
  const overlay = document.getElementById('lockAnimOverlay');
  const shackle = document.getElementById('laShackle');
  const ring = document.getElementById('laRing');
  const tick = document.getElementById('laTick');
  const label = document.getElementById('laLabel');
  const sub = document.getElementById('laSubLabel');
  const stepInd = document.getElementById('laStepIndicator');
  const step1Dot = document.getElementById('laStep1Dot');
  const step2Dot = document.getElementById('laStep2Dot');
  const step1Text = document.getElementById('laStep1Text');
  const step2Text = document.getElementById('laStep2Text');

  function setStep(active){
    if(!stepInd) return;
    if(!active){ stepInd.style.display='none'; return; }
    stepInd.style.display='flex';
    const onStep1 = active===1;
    step1Dot.style.background = onStep1 ? 'var(--gold)' : 'var(--green)';
    step1Dot.style.color       = onStep1 ? '#1A1008' : '#fff';
    step1Dot.textContent       = onStep1 ? '1' : '✓';
    step1Text.style.color      = onStep1 ? 'var(--t1)' : 'var(--t2)';
    step2Dot.style.background  = onStep1 ? 'var(--b1)' : 'var(--gold)';
    step2Dot.style.color       = onStep1 ? 'var(--t3)' : '#1A1008';
    step2Dot.style.border      = onStep1 ? '1px solid var(--b2)' : 'none';
    step2Text.style.color      = onStep1 ? 'var(--t3)' : 'var(--t1)';
  }

  if(state === 'start'){
    // Reset
    shackle.classList.remove('closed');
    ring.classList.remove('pulse');
    tick.classList.remove('show');
    label.classList.remove('show');
    sub.classList.remove('show');
    if(stepInd) stepInd.style.display='none';
    overlay.classList.add('show');
    // Animate shackle closing after short delay
    setTimeout(()=>{
      shackle.classList.add('closed');
      label.classList.add('show');
      sub.classList.add('show');
    }, 300);
  }

  if(state === 'approving'){
    label.textContent = 'Step 1 of 2 — Approve';
    sub.textContent = confirmSub('approval');
    setStep(1);
  }

  if(state === 'locking'){
    label.textContent = selectedToken ? 'Step 2 of 2 — Lock' : 'Locking your funds';
    sub.textContent = confirmSub('transaction');
    if(selectedToken) setStep(2); else setStep(null);
  }

  if(state === 'confirming'){
    label.textContent = 'Confirming on chain';
    sub.textContent = 'Almost there…';
  }

  if(state === 'done'){
    label.textContent = 'Funds locked!';
    sub.textContent = 'Your vault is now sealed';
    setStep(null);
    // Pulse ring and show tick
    setTimeout(()=>{
      ring.classList.add('pulse');
      tick.classList.add('show');
    }, 100);
    // Hide after 2.5s
    setTimeout(()=>{
      overlay.classList.remove('show');
    }, 2500);
  }

  if(state === 'withdrawing'){
    // Reset from any prior lock state
    shackle.classList.remove('closed');
    ring.classList.remove('pulse');
    tick.classList.remove('show');
    if(stepInd) stepInd.style.display='none';
    overlay.classList.add('show');
    // Shackle starts closed (vault is locked), opens slightly to hint at withdrawal
    setTimeout(()=>{
      label.textContent = 'Confirm in your wallet';
      sub.textContent   = confirmSub('withdrawal');
      label.classList.add('show');
      sub.classList.add('show');
    }, 200);
  }

  if(state === 'withdraw-confirming'){
    label.textContent = 'Confirming on chain';
    sub.textContent   = 'Almost there…';
  }

  if(state === 'withdraw-done'){
    label.textContent = 'Withdrawal complete!';
    sub.textContent   = 'Funds returned to your wallet';
    setTimeout(()=>{
      ring.classList.add('pulse');
      tick.classList.add('show');
    }, 100);
    setTimeout(()=>{
      overlay.classList.remove('show');
    }, 2500);
  }

  if(state === 'hide'){
    overlay.classList.remove('show');
  }
}
