// ─── WALLET ─────────────────────────────────────────
// ── WALLET DETECTION (EIP-6963) ──────────────────────
const detectedProviders = {};

window.addEventListener('eip6963:announceProvider', (e) => {
  const { info, provider } = e.detail;
  detectedProviders[info.uuid] = { info, provider };
  renderWalletModal();
});

const POPULAR_WALLETS = [
  { name:'MetaMask',       icon:'https://upload.wikimedia.org/wikipedia/commons/3/36/MetaMask_Fox.svg',      mobile:`https://metamask.app.link/dapp/${location.host}${location.pathname}` },
  { name:'Trust Wallet',   icon:'https://trustwallet.com/assets/images/media/assets/TWT.png',               mobile:`https://link.trustwallet.com/open_url?coin_id=966&url=${encodeURIComponent(location.href)}` },
  { name:'Coinbase Wallet',icon:'https://avatars.githubusercontent.com/u/1885080',                           mobile:`https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(location.href)}` },
  { name:'Rainbow',        icon:'https://rainbowkit.com/rainbow.svg',                                        mobile:`https://rnbwapp.com/dapp?url=${encodeURIComponent(location.href)}` },
  { name:'Rabby',          icon:'https://rabby.io/assets/images/logo-128.png',                               mobile:null },
  { name:'Exodus',         icon:'https://avatars.githubusercontent.com/u/15916492',                          mobile:null },
];

function renderWalletModal(){
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const detectedEl = document.getElementById('detectedWallets');
  const popularEl  = document.getElementById('popularWallets');
  if(!detectedEl || !popularEl) return;

  const detected = Object.values(detectedProviders);
  if(detected.length > 0){
    detectedEl.innerHTML = `
      <p style="font-size:11px;color:#4a4860;letter-spacing:.08em;text-transform:uppercase;margin:.75rem 0;font-family:Syne,sans-serif;font-weight:700">Installed</p>
      ${detected.map(({info}) => `
        <button data-uuid="${esc(info.uuid)}" data-name="${esc(info.name).toLowerCase()}" style="width:100%;display:flex;align-items:center;gap:12px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:.85rem 1rem;cursor:pointer;margin-bottom:.5rem;box-sizing:border-box" onmouseover="this.style.background='rgba(212,168,67,.1)';this.style.borderColor='rgba(212,168,67,.25)'" onmouseout="this.style.background='rgba(255,255,255,.05)';this.style.borderColor='rgba(255,255,255,.08)'">
          <img src="${esc(info.icon)}" style="width:36px;height:36px;border-radius:8px;flex-shrink:0">
          <div style="text-align:left">
            <div style="font-size:14px;font-weight:500;color:#ede9e0">${esc(info.name)}</div>
            <div style="font-size:11px;color:#2EBD85">Installed ✓</div>
          </div>
        </button>
      `).join('')}
    `;
    detectedEl.querySelectorAll('button[data-uuid]').forEach(btn=>{
      btn.addEventListener('click',()=>connectEIP6963(btn.dataset.uuid));
    });
  } else {
    detectedEl.innerHTML = '';
  }

  popularEl.innerHTML = POPULAR_WALLETS.map((w,i) => `
    <button data-wallet-index="${i}" data-name="${esc(w.name).toLowerCase()}"
      style="width:100%;display:flex;align-items:center;gap:12px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:.75rem 1rem;cursor:pointer;box-sizing:border-box"
      onmouseover="this.style.background='rgba(255,255,255,.07)'"
      onmouseout="this.style.background='rgba(255,255,255,.03)'">
      <img src="${esc(w.icon)}" style="width:32px;height:32px;border-radius:8px;flex-shrink:0" onerror="this.style.display='none'">
      <span style="font-size:14px;color:#8a8590">${esc(w.name)}</span>
      <span style="margin-left:auto;font-size:11px;color:#4a4860">${isMobile ? 'Open →' : 'Connect'}</span>
    </button>
  `).join('');
  popularEl.querySelectorAll('button[data-wallet-index]').forEach(btn=>{
    const w=POPULAR_WALLETS[parseInt(btn.dataset.walletIndex)];
    btn.addEventListener('click',()=>{
      if(isMobile && w.mobile){ window.location.href=w.mobile; }
      else if(isMobile && !w.mobile && w.name === 'Exodus'){
        alert('To connect Exodus on mobile, tap "WalletConnect" on this page, then open Exodus and scan the QR code — or paste the connection link.');
      }
      else { connectByName(w.name); }
    });
  });
}

// ── WALLET EXPLORER SEARCH (WalletConnect registry — 500+ wallets) ────────────
// POPULAR_WALLETS and renderWalletModal are now defined — safe to ask wallets to announce.
window.dispatchEvent(new Event('eip6963:requestProvider'));

function openWalletModal(){
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  renderWalletModal();
  document.getElementById('walletModal').style.display='flex';
}

function closeWalletModal(){
  document.getElementById('walletModal').style.display='none';
}

// Flag to prevent reload during initial connection
let isConnecting = false;

async function switchToEthereum(provider){
  const chainId = await provider.request({method:'eth_chainId'});
  if(chainId === '0x1') return;
  try{
    await provider.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x1'}]});
  }catch(e){
    // Auto-switch failed (chain not added, user declined, or wallet can't switch
    // over WalletConnect). Don't message here — onConnected() runs next and shows
    // the single, clear wrongNetworkMsg() once it sees the unsupported chain.
  }
  await new Promise(r=>setTimeout(r,500));
}


async function connectEIP6963(uuid){
  closeWalletModal();
  clearAlerts();
  isConnecting = true;
  const {provider} = detectedProviders[uuid];
  try{
    await provider.request({method:'eth_requestAccounts'});
    await switchToEthereum(provider);
    prov = new ethers.BrowserProvider(provider);
    const signer = await prov.getSigner();
    acct = await signer.getAddress();
    await onConnected();
    // Only attach listeners AFTER connection is complete
    provider.on('accountsChanged', ()=>location.reload());
    provider.on('chainChanged', ()=>{ if(!isConnecting) location.reload(); });
  }catch(e){ showErr(e.message) }
  finally{ isConnecting = false; }
}

async function connectByName(name){
  closeWalletModal();
  clearAlerts();
  isConnecting = true;
  if(!window.ethereum){ showErr('Please install '+name+' or open this site inside your wallet app browser'); return; }
  try{
    await window.ethereum.request({method:'eth_requestAccounts'});
    await switchToEthereum(window.ethereum);
    prov = new ethers.BrowserProvider(window.ethereum);
    const signer = await prov.getSigner();
    acct = await signer.getAddress();
    await onConnected();
    // Only attach listeners AFTER connection is complete
    window.ethereum.on('accountsChanged', ()=>location.reload());
    window.ethereum.on('chainChanged', ()=>{ if(!isConnecting) location.reload(); });
  }catch(e){ showErr(e.message) }
  finally{ isConnecting = false; }
}

// Pre-load WalletConnect SDK in background so the button feels instant.
let wcSdkPromise = null;
function preloadWcSdk(){
  if(wcSdkPromise) return;
  wcSdkPromise = import('https://esm.sh/@walletconnect/ethereum-provider@2.17.0?bundle-deps').catch(()=>null);
}
// Start loading as soon as page is ready
window.addEventListener('load', preloadWcSdk);

let wcProvider = null;
let wcReloadTimer = null;

// Ensure the WalletConnect relay socket is actually live before we publish a
// transaction request. An idle browser tab can leave the socket closed; if we
// publish onto a dead socket the request is "interrupted" and never reaches the
// wallet — the user opens their phone, sees no approval, and gets an error.
// Waiting for the relay to reconnect first lets the request land so the wallet
// can show the prompt. No-op for injected (browser-extension) wallets.
async function ensureWcReady(timeoutMs = 12000){
  if(!wcProvider || wcProvider.connected) return true;
  try{ wcProvider.client?.core?.relayer?.restartTransport?.(); }catch(e){}
  const start = Date.now();
  while(Date.now() - start < timeoutMs){
    if(wcProvider.connected) return true;
    await new Promise(r => setTimeout(r, 400));
  }
  return !!wcProvider.connected;
}

// A phone wallet that's closed/reopened can briefly drop the session. Don't hard
// reload — that kicks the user out mid-flow. Never reload during a pending
// transaction; otherwise wait a moment and only reset if the relay didn't recover.
function handleWcDisconnect(){
  if(txInFlight) return;
  if(wcReloadTimer) return;
  wcReloadTimer = setTimeout(()=>{
    wcReloadTimer = null;
    // Reset only if the SESSION is actually gone (not just a relay-socket blip that
    // recovered). A dead session can't sign, so a clean reconnect is required.
    if(!wcProvider || !wcProvider.session) location.reload();
  }, 2500);
}

async function connectWalletConnect(){
  closeWalletModal();
  clearAlerts();

  // Show a loading indicator on the button while SDK loads
  const wcBtn = document.getElementById('wcButton');
  const wcLabel = document.getElementById('wcLabel');
  if(wcLabel) wcLabel.textContent = 'Loading…';
  if(wcBtn) wcBtn.style.opacity = '0.7';

  try{
    preloadWcSdk(); // no-op if already started
    let mod = await wcSdkPromise;
    if(!mod || !mod.EthereumProvider){
      // Don't let a transient failure stick — drop the cached result and retry once.
      wcSdkPromise = null; preloadWcSdk();
      mod = await wcSdkPromise;
    }
    if(!mod || !mod.EthereumProvider){
      throw new Error('Could not load WalletConnect SDK. Check your connection (or any ad blocker), then tap Connect again.');
    }
    const { EthereumProvider } = mod;

    if(wcLabel) wcLabel.textContent = 'Scan QR · Any mobile wallet';
    if(wcBtn) wcBtn.style.opacity = '1';

    wcProvider = await EthereumProvider.init({
      projectId: WC_PROJECT_ID,
      optionalChains: [1],
      optionalMethods: ['eth_sendTransaction','eth_signTransaction','personal_sign','eth_sign','eth_signTypedData','eth_signTypedData_v4','wallet_switchEthereumChain','wallet_addEthereumChain'],
      optionalEvents: ['chainChanged','accountsChanged'],
      showQrModal: true,
      qrModalOptions: { themeMode: 'dark' },
      metadata: {
        name: 'CryptoTimeLock',
        description: 'Self-custody time-locked vault on Ethereum',
        url: location.origin,
        icons: [location.origin + '/icon.svg']
      }
    });
    await wcProvider.connect();
    prov = new ethers.BrowserProvider(wcProvider);
    const signer = await prov.getSigner();
    acct = await signer.getAddress();
    await switchToEthereum(wcProvider);
    await onConnected();
    // Don't tear the page down while a transaction is awaiting signature — a phone
    // wallet that's closed can emit a transient disconnect/chain blip, and reloading
    // here would kick the user out before they can open their wallet and confirm.
    // When a phone wallet reopens it re-emits accountsChanged/chainChanged with the
    // SAME account/chain. Reloading on those echoes is what was logging the user out
    // and bouncing them to the homepage. Only reload on a REAL switch.
    wcProvider.on('accountsChanged', (accts)=>{
      if(txInFlight) return;
      const next = ((accts && accts[0]) || '').toLowerCase();
      if(next && acct && next !== acct.toLowerCase()) location.reload();
    });
    wcProvider.on('chainChanged', (cid)=>{
      if(txInFlight) return;
      const n = Number(cid);
      if(n && currentChainId && n !== currentChainId) location.reload();
    });
    wcProvider.on('disconnect',      handleWcDisconnect);
  }catch(e){
    if(wcLabel) wcLabel.textContent = 'Scan QR · Any mobile wallet';
    if(wcBtn) wcBtn.style.opacity = '1';
    const m = (e && e.message || '').toLowerCase();
    if(m.includes('user rejected') || m.includes('modal closed')){ return; }
    // A non-EVM wallet (e.g. Solana-only) can't approve the Ethereum (eip155)
    // session, so the pairing fails on a namespace/chain mismatch. Detect that
    // and tell the user plainly that this is an Ethereum app.
    if(m.includes('namespace') || m.includes('chains') || m.includes('unsupported') || m.includes('approve()')){
      showErr(nonEvmWalletMsg()); return;
    }
    showErr(e.message || 'WalletConnect failed');
  }
}

async function connectWallet(){ openWalletModal(); }
