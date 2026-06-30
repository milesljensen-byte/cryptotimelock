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
    showErr('Please switch to Ethereum Mainnet in your wallet');
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

// Pre-load WalletConnect SDK in background so button feels instant
let wcSdkPromise = null;
function preloadWcSdk(){
  if(wcSdkPromise) return;
  wcSdkPromise = import('https://esm.sh/@walletconnect/ethereum-provider@2.17.0?bundle-deps').catch(()=>null);
}
// Start loading as soon as page is ready
window.addEventListener('load', preloadWcSdk);

let wcProvider = null;

// A phone wallet that's been backgrounded or closed for a while leaves the
// WalletConnect relay socket idle, and the session can briefly fall out of the
// provider. The next request (eth_accounts, eth_sendTransaction, …) then hits a
// not-ready provider and throws "Please call connect() before request()". Nudge
// the relay back to life and wait briefly for it to reconnect before we
// transact. Best-effort: never throws — callers proceed regardless, and surface
// a clean reconnect message if the request still fails. No-op for injected
// (browser-extension) wallets.
async function ensureWcReady(timeoutMs = 8000){
  if(!wcProvider) return true;
  try{ if(wcProvider.connected) return true; }catch(e){}
  try{ wcProvider.client?.core?.relayer?.restartTransport?.(); }catch(e){}
  const start = Date.now();
  while(Date.now() - start < timeoutMs){
    try{ if(wcProvider.connected) return true; }catch(e){}
    await new Promise(r => setTimeout(r, 300));
  }
  try{ return !!wcProvider.connected; }catch(e){ return false; }
}

// True for the WalletConnect "session is gone / not connected" family of errors,
// where the only real recovery is for the user to reconnect their wallet.
function isWcSessionError(e){
  const m = ((e && (e.reason || e.message)) || '').toLowerCase();
  return m.includes('call connect') || m.includes('before request') ||
         m.includes('session topic') || m.includes('no matching key') ||
         m.includes('session expired') || m.includes('no session');
}

function wcReconnectMsg(){
  return 'Your wallet session dropped (this can happen when your wallet app has been closed for a while). Open your wallet, then tap the wallet button at the top to reconnect and try again.';
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
    const mod = await wcSdkPromise;
    if(!mod || !mod.EthereumProvider){
      throw new Error('Could not load WalletConnect SDK. Check your connection.');
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
    // A phone wallet that's closed during a transaction and then reopened
    // re-emits accountsChanged/chainChanged with the SAME account/chain. The
    // old handlers reloaded on those echoes, which kicked the user out and
    // bounced them back to the homepage mid-transaction. Only reload on a REAL
    // switch to a different account or chain.
    wcProvider.on('accountsChanged', (accts)=>{
      const next = ((accts && accts[0]) || '').toLowerCase();
      if(next && acct && next !== acct.toLowerCase()) location.reload();
    });
    wcProvider.on('chainChanged', (cid)=>{
      const n = Number(cid);
      if(n && currentChainId && n !== currentChainId) location.reload();
    });
    // Don't hard-reload on a transient disconnect — a closed phone wallet emits
    // one and the session reconnects when the wallet is reopened. Reloading here
    // logs the user out mid-flow, which is exactly what we're preventing.
    wcProvider.on('disconnect', ()=>{});
  }catch(e){
    if(wcLabel) wcLabel.textContent = 'Scan QR · Any mobile wallet';
    if(wcBtn) wcBtn.style.opacity = '1';
    if(e.message && (e.message.includes('User rejected') || e.message.includes('user rejected') || e.message.includes('Modal closed'))){ return; }
    showErr(e.message || 'WalletConnect failed');
  }
}

async function connectWallet(){ openWalletModal(); }
