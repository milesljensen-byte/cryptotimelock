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

    // ---- lock window: 365 days, set real dates ----
    const TOTAL=365*24*3600;              // seconds in the lock
    const start=new Date();
    const end=new Date(start.getTime()+TOTAL*1000);
    const fmt=d=>d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
    const sEl=document.getElementById('lcStart'), eEl=document.getElementById('lcEnd');
    if(sEl) sEl.textContent=fmt(start);
    if(eEl) eEl.textContent=fmt(end);

    let scrollFrac=0;                     // 0..1 from scroll position
    let wasDone=false;
    const t0=Date.now();
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
    tick(); setInterval(tick,250);

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
    function onScroll(){
      scrollFrac=Math.min(Math.max(window.scrollY/scrollRange,0),1);
      tick();
    }
    computeScrollRange();
    window.addEventListener('resize',computeScrollRange);
    window.addEventListener('load',computeScrollRange);
    window.addEventListener('scroll',onScroll,{passive:true}); onScroll();
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
  (function(){
    const onScroll=()=>document.body.classList.toggle('nav-scrolled', window.scrollY > 12);
    window.addEventListener('scroll', onScroll, {passive:true});
    onScroll();
  })();
})();
