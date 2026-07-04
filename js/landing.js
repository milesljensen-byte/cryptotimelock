/* ===== single-page view switching ===== */
function showApp(openWallet){
  document.getElementById('landingView').style.display='none';
  document.getElementById('appView').style.display='';
  window.scrollTo(0,0);
  if(openWallet && !acct){ try{ openWalletModal(); }catch(e){} }
}
function showHome(){
  document.getElementById('appView').style.display='none';
  document.getElementById('landingView').style.display='';
  window.scrollTo(0,0);
}
function wireViewNav(){
  document.querySelectorAll('[data-launch]').forEach(function(el){
    el.addEventListener('click',function(e){ e.preventDefault(); showApp(true); });
  });
  document.querySelectorAll('[data-home]').forEach(function(el){
    el.addEventListener('click',function(e){ e.preventDefault(); showHome(); });
  });
}
if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded',wireViewNav); }
else { wireViewNav(); }


/* ===== landing-page decorative behaviour ===== */
(function(){
// scroll reveal
  const io=new IntersectionObserver((es)=>{
    es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target);}});
  },{threshold:.16});
  document.querySelectorAll('.reveal').forEach((el,i)=>{
    el.style.transitionDelay=(i%3)*0.07+'s';
    io.observe(el);
  });

  // 3D tilt + glare
  document.querySelectorAll('.tilt').forEach(card=>{
    const max=9;
    card.addEventListener('pointermove',e=>{
      const r=card.getBoundingClientRect();
      const px=(e.clientX-r.left)/r.width, py=(e.clientY-r.top)/r.height;
      card.style.transform=`rotateY(${(px-.5)*max*2}deg) rotateX(${-(py-.5)*max*2}deg) translateZ(6px)`;
      card.style.setProperty('--mx',px*100+'%');
      card.style.setProperty('--my',py*100+'%');
    });
    card.addEventListener('pointerleave',()=>{card.style.transform='';});
  });

  // ── live example lock: countdown ticks, timeline advances on scroll ──
  (function(){
    const card=document.getElementById('lockCard');
    if(!card) return;
    const fill=document.getElementById('lcFill');
    const node=document.getElementById('lcNode');
    const countEl=document.getElementById('lcCount');
    const labelEl=card.querySelector('.lc-count-label');
    const statusEl=card.querySelector('.lc-status');

    // ---- example locks: a small deck you flip through on hover / tap ----
    // Each example has its own token, amount and lock length. The live
    // countdown and the scroll-driven timeline keep working against whichever
    // one is currently showing.
    const valEl=card.querySelector('.lc-eth-val');
    const unitEl=card.querySelector('.lc-eth-unit');
    const iconEl=document.getElementById('lcIcon');
    const sEl=document.getElementById('lcStart'), eEl=document.getElementById('lcEnd');
    const fmt=d=>d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
    const DAY=24*3600;

    const ethSvg='<svg class="eth" viewBox="0 0 24 32" aria-hidden="true"><path d="M12 0 L23 16 L12 22 L1 16 Z" fill="#E9D08A" opacity="0.95"/><path d="M12 0 L23 16 L12 22 Z" fill="#C9A84C"/><path d="M12 24 L23 18 L12 32 L1 18 Z" fill="#C9A84C" opacity="0.9"/><path d="M12 24 L23 18 L12 32 Z" fill="#8A6D2E"/></svg>';
    const usdtSvg='<svg class="coin" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="16" fill="#26A17B"/><path fill="#fff" d="M17.922 17.383v-.002c-.11.008-.677.042-1.942.042-1.01 0-1.721-.03-1.971-.042v.003c-3.888-.171-6.79-.848-6.79-1.658 0-.809 2.902-1.486 6.79-1.66v2.644c.254.018.982.061 1.988.061 1.207 0 1.812-.05 1.925-.06v-2.643c3.88.173 6.775.85 6.775 1.658 0 .81-2.895 1.485-6.775 1.657m0-3.59v-2.366h5.414V7.819H8.595v3.608h5.414v2.365c-4.4.202-7.709 1.074-7.709 2.118s3.309 1.915 7.709 2.118v7.582h3.913v-7.584c4.393-.202 7.694-1.073 7.694-2.116 0-1.043-3.301-1.914-7.694-2.117"/></svg>';
    const wbtcSvg='<svg class="coin" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="16" fill="#F7931A"/><path fill="#fff" d="M23.189 14.02c.314-2.096-1.283-3.223-3.465-3.975l.708-2.84-1.728-.43-.69 2.765c-.454-.114-.92-.22-1.385-.326l.695-2.783L15.596 6l-.708 2.839c-.376-.086-.746-.17-1.105-.26l.002-.009-2.384-.595-.46 1.846s1.283.294 1.256.312c.7.175.826.638.805 1.006l-.806 3.235c.048.012.11.03.18.057l-.183-.046-1.13 4.532c-.086.212-.303.531-.793.41.018.025-1.256-.313-1.256-.313l-.858 1.978 2.25.561c.418.105.828.215 1.231.318l-.715 2.872 1.727.43.708-2.84c.472.127.93.245 1.378.357l-.706 2.828 1.728.43.715-2.866c2.948.558 5.164.333 6.097-2.333.752-2.146-.037-3.385-1.588-4.192 1.13-.26 1.98-1.003 2.207-2.538m-3.95 5.538c-.533 2.147-4.148.986-5.32.695l.95-3.805c1.172.293 4.929.872 4.37 3.11m.535-5.569c-.487 1.953-3.495.96-4.47.717l.86-3.45c.975.243 4.118.696 3.61 2.733"/></svg>';
    const EXAMPLES=[
      {icon:ethSvg,   amount:'1.5',   unit:'ETH',  days:365},
      {icon:usdtSvg,  amount:'1,000', unit:'USDT', days:90},
      {icon:wbtcSvg,  amount:'0.25',  unit:'WBTC', days:180}
    ];

    let idx=0;
    let TOTAL=EXAMPLES[0].days*DAY;       // seconds in the current lock
    let t0=Date.now();
    let scrollFrac=0;                     // 0..1 from scroll position
    let wasDone=false;

    function applyExample(){
      const ex=EXAMPLES[idx];
      TOTAL=ex.days*DAY;
      t0=Date.now();
      wasDone=false;
      card.classList.remove('lc-done');
      if(labelEl) labelEl.textContent='Unlocks in';
      if(statusEl) statusEl.innerHTML='<i class="lc-dot"></i> Active';
      if(iconEl) iconEl.innerHTML=ex.icon;
      if(valEl) valEl.textContent=ex.amount;
      if(unitEl) unitEl.textContent=ex.unit;
      const start=new Date();
      const end=new Date(start.getTime()+TOTAL*1000);
      if(sEl) sEl.textContent=fmt(start);
      if(eEl) eEl.textContent=fmt(end);
      tick();
    }

    function pad(n){return String(n).padStart(2,'0');}
    function tick(){
      const baseElapsed=(Date.now()-t0)/1000;        // real time passing — always ticks at a normal, constant pace
      // Scroll adds an independent boost on top of the live real-time count, rather than
      // scaling/replacing it — so the moment scrolling stops, the countdown keeps ticking
      // immediately at its normal speed instead of slowing down or pausing.
      const elapsed=Math.min(baseElapsed + scrollFrac*TOTAL, TOTAL);
      const remaining=Math.max(TOTAL-elapsed,0);
      const done=scrollFrac>=1||remaining<=0;
      if(done!==wasDone){
        card.classList.toggle('lc-done',done);
        if(labelEl) labelEl.textContent=done?'Status':'Unlocks in';
        if(statusEl) statusEl.innerHTML='<i class="lc-dot"></i> '+(done?'Unlocked':'Active');
        wasDone=done;
      }
      if(done){
        if(countEl) countEl.textContent='Ready to withdraw';
      }else{
        const days=Math.floor(remaining/(24*3600));
        const h=Math.floor((remaining%(24*3600))/3600);
        const m=Math.floor((remaining%3600)/60);
        const s=Math.floor(remaining%60);
        if(countEl) countEl.textContent=`${pad(days)}d ${pad(h)}:${pad(m)}:${pad(s)}`;
      }
      const pct=done?100:Math.max(elapsed/TOTAL*100,2);
      if(fill) fill.style.width=pct+'%';
      if(node) node.style.left=pct+'%';
    }
    applyExample(); setInterval(tick,250);

    // Cycle through the examples automatically with a subtle content fade.
    // Hovering or tapping the card also advances it and resets the timer.
    let autoTimer=null;
    function flip(){
      idx=(idx+1)%EXAMPLES.length;
      applyExample();
      card.classList.remove('lc-swap');
      void card.offsetWidth;              // restart the fade cleanly
      card.classList.add('lc-swap');
    }
    function scheduleAuto(){ clearInterval(autoTimer); autoTimer=setInterval(flip,4500); }
    scheduleAuto();
    function manualFlip(){ flip(); scheduleAuto(); }
    card.addEventListener('mouseenter',manualFlip);
    card.addEventListener('click',manualFlip);

    // ---- scroll advances the lock timeline ----
    // Range is measured against this card's own position, so the bar
    // finishes a little before the card scrolls out from under the
    // sticky nav — not just somewhere past the bottom of the screen.
    let scrollRange=window.innerHeight*0.9;
    function computeScrollRange(){
      const rect=card.getBoundingClientRect();
      const cardDocTop=rect.top+window.scrollY;
      const navEl=document.querySelector('nav');
      const navH=navEl?navEl.offsetHeight:0;
      const outOfSight=Math.max(cardDocTop-navH,window.innerHeight*0.25);
      scrollRange=outOfSight*0.805;         // finish comfortably before it disappears (~15% slower pace)
    }
    // rAF-batched: coalesce bursts of scroll events into one update per frame
    // so the timeline advances smoothly in step with the screen's refresh.
    let rafPending=false;
    function applyScroll(){
      rafPending=false;
      scrollFrac=Math.min(Math.max(window.scrollY/scrollRange,0),1);
      tick();
    }
    function onScroll(){
      if(rafPending) return;
      rafPending=true;
      requestAnimationFrame(applyScroll);
    }
    computeScrollRange();
    window.addEventListener('resize',computeScrollRange);
    window.addEventListener('load',computeScrollRange);
    window.addEventListener('scroll',onScroll,{passive:true}); applyScroll();
  })();

  // FAQ accordion
  document.querySelectorAll('.faq button').forEach(b=>{
    b.addEventListener('click',()=>{
      const f=b.parentElement, ans=f.querySelector('.ans');
      const open=f.classList.contains('open');
      document.querySelectorAll('.faq.open').forEach(o=>{o.classList.remove('open');o.querySelector('.ans').style.maxHeight=null;});
      if(!open){f.classList.add('open');ans.style.maxHeight=ans.scrollHeight+'px';}
    });
  });

  // Welcome modal — first-visit trust primer, shown ONCE per device.
  // Any dismissal (✕, backdrop, ESC, "Look around first", or the Connect CTA)
  // sets the localStorage flag so it never appears again. If the visitor has
  // already jumped into the app view before the delay fires, we skip showing it
  // WITHOUT setting the flag — they never saw it, so they get it next visit.
  (function(){
    const m=document.getElementById('welcome-modal');
    if(!m) return;
    const KEY='tl_welcome_seen';
    let seen=null;
    try{ seen=localStorage.getItem(KEY); }catch(e){}
    if(seen) return;
    const markSeen=()=>{ try{ localStorage.setItem(KEY,'1'); }catch(e){} };
    const close=()=>{ m.classList.remove('open'); m.setAttribute('aria-hidden','true'); document.body.style.overflow=''; markSeen(); };
    m.querySelectorAll('[data-close]').forEach(el=>el.addEventListener('click',close));
    // The Connect CTA is also wired by wireViewNav (data-launch → app view +
    // wallet modal); here we only mark it seen and release the scroll lock.
    m.querySelectorAll('[data-launch]').forEach(el=>el.addEventListener('click',()=>{
      markSeen(); m.classList.remove('open'); m.setAttribute('aria-hidden','true'); document.body.style.overflow='';
    }));
    document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&m.classList.contains('open')) close(); });
    setTimeout(()=>{
      const landing=document.getElementById('landingView');
      if(!landing || landing.style.display==='none') return; // already in the app — don't interrupt
      m.classList.add('open');
      m.setAttribute('aria-hidden','false');
      document.body.style.overflow='hidden';
      trackEvent('welcome_modal_shown');
    },1600);
  })();

  // Depth slider — "How the lock actually works" at three levels of detail.
  // Drag the knob (pointer events + capture), click a label or the track, or
  // use arrow keys on the knob. Content switches live while dragging past the
  // midpoints; on release the knob snaps to the nearest stop. The pane swap
  // animates direction-aware (--dir) and the container height is tweened so
  // panes of different heights don't jump.
  (function(){
    const slider=document.getElementById('depthSlider');
    if(!slider) return;
    const track=slider.querySelector('.ds-track');
    const knob=document.getElementById('dsKnob');
    const fill=document.getElementById('dsFill');
    const labs=Array.prototype.slice.call(slider.querySelectorAll('.ds-lab'));
    const body=document.getElementById('depthBody');
    const panes=Array.prototype.slice.call(body.querySelectorAll('.depth-pane'));
    let level=0, dragging=false, heightTimer=null;

    function paint(pct){ knob.style.left=pct+'%'; fill.style.width=pct+'%'; }

    function switchPane(l,dir){
      const startH=body.offsetHeight;
      panes.forEach((p,i)=>p.classList.toggle('on',i===l));
      body.style.setProperty('--dir',dir);
      const endH=panes[l].offsetHeight;
      body.style.height=startH+'px';
      void body.offsetHeight; // reflow so the height transition has a start value
      body.style.height=endH+'px';
      clearTimeout(heightTimer);
      heightTimer=setTimeout(()=>{ body.style.height=''; },480);
    }

    function applyLevel(l){
      labs.forEach((b,i)=>b.classList.toggle('on',i===l));
      knob.setAttribute('aria-valuenow',String(l));
      knob.setAttribute('aria-valuetext',labs[l].textContent.trim());
    }

    function setLevel(l){
      l=Math.max(0,Math.min(2,l));
      if(l===level){ paint(l*50); return; }
      const dir=l>level?1:-1;
      level=l;
      paint(l*50);
      applyLevel(l);
      switchPane(l,dir);
    }

    function pctFromEvent(e){
      const r=track.getBoundingClientRect();
      return Math.max(0,Math.min(100,(e.clientX-r.left)/r.width*100));
    }

    knob.addEventListener('pointerdown',e=>{
      dragging=true;
      slider.classList.add('dragging');
      try{ knob.setPointerCapture(e.pointerId); }catch(err){}
      e.preventDefault();
    });
    knob.addEventListener('pointermove',e=>{
      if(!dragging) return;
      const pct=pctFromEvent(e);
      paint(pct);
      const near=Math.round(pct/50);
      if(near!==level){
        const dir=near>level?1:-1;
        level=near;
        applyLevel(near);
        switchPane(near,dir);
      }
    });
    function endDrag(){
      if(!dragging) return;
      dragging=false;
      slider.classList.remove('dragging');
      paint(level*50); // snap to the nearest stop
    }
    knob.addEventListener('pointerup',endDrag);
    knob.addEventListener('pointercancel',endDrag);

    track.addEventListener('pointerdown',e=>{
      if(e.target===knob) return;
      setLevel(Math.round(pctFromEvent(e)/50));
    });
    labs.forEach((b,i)=>b.addEventListener('click',()=>setLevel(i)));
    knob.addEventListener('keydown',e=>{
      if(e.key==='ArrowRight'||e.key==='ArrowUp'){ setLevel(level+1); e.preventDefault(); }
      else if(e.key==='ArrowLeft'||e.key==='ArrowDown'){ setLevel(level-1); e.preventDefault(); }
      else if(e.key==='Home'){ setLevel(0); e.preventDefault(); }
      else if(e.key==='End'){ setLevel(2); e.preventDefault(); }
    });
  })();

  // Terms modal
  (function(){
    const m=document.getElementById('terms-modal');
    const open=()=>{m.classList.add('open');m.setAttribute('aria-hidden','false');document.body.style.overflow='hidden';};
    const close=()=>{m.classList.remove('open');m.setAttribute('aria-hidden','true');document.body.style.overflow='';};
    document.querySelectorAll('.js-open-terms').forEach(el=>el.addEventListener('click',open));
    m.querySelectorAll('[data-close]').forEach(el=>el.addEventListener('click',close));
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&m.classList.contains('open'))close();});
  })();

  // Solidify the nav (stronger bg + subtle shadow) once the page is scrolled.
  // rAF-batched and only writes the class when the state actually changes,
  // so it adds no per-scroll work that could stutter the timeline animation.
  (function(){
    let scrolled=false, rafPending=false;
    function update(){
      rafPending=false;
      const s=window.scrollY>12;
      if(s!==scrolled){ scrolled=s; document.body.classList.toggle('nav-scrolled', s); }
    }
    window.addEventListener('scroll',()=>{
      if(rafPending) return;
      rafPending=true;
      requestAnimationFrame(update);
    },{passive:true});
    update();
  })();
})();
