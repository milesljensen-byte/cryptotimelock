function esc(str){
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ─── FUNNEL TRACKING ────────────────────────────────
// Lightweight event log for the ad → connect → deposit funnel. Always logs to
// the console so drop-off is visible while testing. Also forwards to the X
// (Twitter) pixel once TWQ_EVENT_IDS below is filled in with real event IDs
// from X Ads → Tools → Events Manager — until then this is a harmless no-op
// (never throws, e.g. if the pixel is blocked or not yet configured).
const TWQ_EVENT_IDS = {
  // wallet_modal_opened: 'tw-XXXXX-XXXXX',
  // wallet_connected:    'tw-XXXXX-XXXXX',
  // deposit_completed:   'tw-XXXXX-XXXXX',
  // withdraw_completed:  'tw-XXXXX-XXXXX',
};
function trackEvent(name, params){
  try{ console.log('[TimeLock] event:', name, params||''); }catch(e){}
  try{
    if(window.twq && TWQ_EVENT_IDS[name]){
      window.twq('event', TWQ_EVENT_IDS[name], params||{});
    }
  }catch(e){}
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
  const cancelBtn = document.getElementById('laCancelBtn');

  // "Cancel" is only useful while we're still waiting on the wallet — once a tx
  // hash exists (confirming/done states) the transaction is already on its way
  // and can't be un-sent, so hide it there.
  if(cancelBtn){
    const waitingStates = ['start','approving','locking','withdrawing'];
    cancelBtn.style.display = waitingStates.includes(state) ? 'inline-flex' : 'none';
  }

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
    sub.textContent = 'Confirm the transaction in your wallet — can take up to 30 seconds';
    setStep(1);
  }

  if(state === 'locking'){
    label.textContent = selectedToken ? 'Step 2 of 2 — Lock' : 'Locking your funds';
    sub.textContent = 'Confirm the transaction in your wallet — can take up to 30 seconds';
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
      label.textContent = 'Withdrawing your funds';
      sub.textContent   = 'Confirm the transaction in your wallet — can take up to 30 seconds';
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
