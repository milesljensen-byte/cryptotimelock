// ─── CONFIG ─────────────────────────────────────────
// ═══════════════════════════════════════════════════
//  MULTI-CHAIN CONFIG
//  To add a new chain:
//  1. Deploy the contract on that chain
//  2. Add the address to CONTRACTS below
//  3. That's it!
// ═══════════════════════════════════════════════════

// ⚠️ UPDATE after deploying CryptoTimeLock v2.5.6 — replace the address below
//    with YOUR deployed contract address. Do NOT reuse a previous version's
//    address; the ABI must match the deployed bytecode exactly.
const CONTRACTS = {
  1: '0x571B99eF530879239c9274180Acb2792f03A794c',   // Ethereum mainnet — v2june01
};

// WalletConnect v2 Project ID — get yours free at https://cloud.walletconnect.com
const WC_PROJECT_ID = 'c7213548274263413e697c9e3029a853';

const NETWORKS = {
  1: { name: 'Ethereum', symbol: 'ETH', explorer: 'https://etherscan.io' },
};

// All known tokens to check per chain — only shown if user has balance > 0
const ALL_TOKENS = {
  // Ordered by popularity/likelihood of user holding — most popular checked first
  // so the token selector populates with the most common tokens in the first batch.
  // Tier 1 (batch 1): ETH + top stablecoins + BTC wrappers — almost every user has these
  // Tier 2 (batch 2): liquid staking + DeFi blue chips — very common DeFi holdings
  // Tier 3 (batch 3): mid-cap DeFi + infra — less common but still mainstream
  // Tier 4 (batch 4+): gaming, memes, exchange tokens, niche — checked last
  1: [
    // ── Tier 1: highest probability of non-zero balance ──
    { symbol: 'ETH',    address: null,                                         decimals: 18, icon: '🔷' },
    { symbol: 'USDT',   address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6,  icon: '💵' },
    { symbol: 'USDC',   address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6,  icon: '💵' },
    { symbol: 'WBTC',   address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', decimals: 8,  icon: '🟠' },
    { symbol: 'WETH',   address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', decimals: 18, icon: '🔷' },
    { symbol: 'DAI',    address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', decimals: 18, icon: '🟡' },
    { symbol: 'LINK',   address: '0x514910771AF9Ca656af840dff83E8264EcF986CA', decimals: 18, icon: '🔵' },
    { symbol: 'UNI',    address: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', decimals: 18, icon: '🦄' },
    { symbol: 'SHIB',   address: '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE', decimals: 18, icon: '🐕' },
    { symbol: 'AAVE',   address: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9', decimals: 18, icon: '👻' },
    // ── Tier 2: common DeFi / staking holdings ───────────
    { symbol: 'wstETH', address: '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0', decimals: 18, icon: '🔷' },
    { symbol: 'rETH',   address: '0xae78736Cd615f374D3085123A210448E74Fc6393', decimals: 18, icon: '🔷' },
    { symbol: 'cbBTC',  address: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', decimals: 8,  icon: '🟠' },
    { symbol: 'cbETH',  address: '0xBe9895146f7AF43049ca1c1AE358B0541Ea49704', decimals: 18, icon: '🔷' },
    { symbol: 'ARB',    address: '0xB50721BCf8d664c30412Cfbc6cf7a15145234ad1', decimals: 18, icon: '🔵' },
    { symbol: 'PEPE',   address: '0x6982508145454Ce325dDbE47a25d4ec3d2311933', decimals: 18, icon: '🐸' },
    { symbol: 'LDO',    address: '0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32', decimals: 18, icon: '🔵' },
    { symbol: 'CRV',    address: '0xD533a949740bb3306d119CC777fa900bA034cd52', decimals: 18, icon: '🔵' },
    { symbol: 'ONDO',   address: '0xfAbA6f8e4a5E8Ab82F62fe7C39859FA577269BE3', decimals: 18, icon: '🏦' },
    // ── Tier 3: mid-cap / mainstream ─────────────────────
    { symbol: 'PYUSD',  address: '0x6c3ea9036406852006290770BEdFcAbA0e23A0e8', decimals: 6,  icon: '💵' },
    { symbol: 'SNX',    address: '0xC011a73ee8576Fb46F5E1c5751cA3B9Fe0af2a6F', decimals: 18, icon: '🔵' },
    { symbol: 'COMP',   address: '0xc00e94Cb662C3520282E6f5717214004A7f26888', decimals: 18, icon: '🔵' },
    { symbol: '1INCH',  address: '0x111111111117dC0aa78b770fA6A738034120C302', decimals: 18, icon: '🔵' },
    { symbol: 'GRT',    address: '0xc944E90C64B2c07662A292be6244BDf05Cda44a7', decimals: 18, icon: '🔵' },
    { symbol: 'ENS',    address: '0xC18360217D8F7Ab5e7c516566761Ea12Ce7F9D72', decimals: 18, icon: '🔵' },
    { symbol: 'SUSHI',  address: '0x6B3595068778DD592e39A122f4f5a5cF09C90fE2', decimals: 18, icon: '🍣' },
    { symbol: 'FRAX',   address: '0x853d955aCEf822Db058eb8505911ED77F175b99e', decimals: 18, icon: '💵' },
    { symbol: 'LUSD',   address: '0x5f98805A4E8be255a32880FDeC7F6728C6568bA0', decimals: 18, icon: '💵' },
    { symbol: 'crvUSD', address: '0xf939E0A03FB07F59A73314E73794Be0E57ac1b4E', decimals: 18, icon: '🔵' },
    // ── Tier 4: niche / lower volume — checked last ───────
    { symbol: 'IMX',    address: '0xF57e7e7C23978C3cAEC3C3548E3D615c346e79fF', decimals: 18, icon: '🔵' },
    { symbol: 'CRO',    address: '0xA0b73E1Ff0B80914AB6fe0444E65848C4C34450b', decimals: 8,  icon: '🔵' },
    { symbol: 'OKB',    address: '0x75231F58b43240C9718Dd58B4967c5114342a86c', decimals: 18, icon: '🔵' },
    { symbol: 'AXS',    address: '0xBB0E17EF65F82Ab018d8EDd776e8DD940327B28b', decimals: 18, icon: '🎮' },
    { symbol: 'SAND',   address: '0x3845badAde8e6dFF049820680d1F14bD3903a5d0', decimals: 18, icon: '🏖️' },
    { symbol: 'MANA',   address: '0x0F5D2fB29fb7d3CFeE444a200298f468908cC942', decimals: 18, icon: '🌐' },
  ],
};

// Only tokens user actually has (populated after connect)
let availableTokens = [];

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
];

let selectedToken = null; // null = native, or token object
let tokenBalances = {};

let CONTRACT_ADDRESS = '';
let currentSymbol = 'ETH';
let currentChainId = null;

function getNetwork(chainId) {
  return NETWORKS[chainId] || { name: 'Unknown', symbol: 'ETH', explorer: '' };
}

function updateSymbols(symbol) {
  currentSymbol = symbol;
  document.querySelectorAll('.currency-symbol').forEach(el => el.textContent = symbol);
}

const ABI = [
  'function withdraw(uint256 _lockId) public',
  // CRITICAL FIX: field order matches the Solidity struct declaration order exactly
  // struct Lock { address owner; bool withdrawn; uint88 createdAt; address token; uint96 unlockTime; uint256 amount; }
  'function getLock(uint256 _lockId) public view returns (address owner, bool withdrawn, uint88 createdAt, address token, uint96 unlockTime, uint256 amount)',
  'function canWithdraw(uint256 _lockId) public view returns (bool)',
  'function timeRemaining(uint256 _lockId) public view returns (uint256)',
  'function getUserLocks(address _user, uint256 _offset, uint256 _limit) public view returns (uint256[])',
  'function getUserLockCount(address _user) public view returns (uint256)',
  'function lockNative(uint256 _unlockTime) public payable returns (uint256)',
  'function lockToken(address _token, uint256 _amount, uint256 _unlockTime) public returns (uint256)',
  'function claimNativeFees() public returns (uint256)',
  'function claimTokenFees(address _token) public returns (uint256)',
  'function feeRecipient() public view returns (address)',
  'function lockCounter() public view returns (uint256)',
  'function pendingNativeFees() public view returns (uint256)',
  'function pendingTokenFees(address _token) public view returns (uint256)',
  'function allowedTokens(address _token) public view returns (bool)',
  'function tokenAllowTimes(address _token) public view returns (uint256)',
  'function tokenMinimums(address _token) public view returns (uint256)',
  'function requestAllowToken(address _token) public',
  'function confirmAllowToken(address _token) public',
  'function cancelAllowToken(address _token) public',
  'function disallowToken(address _token) public',
  'function paused() public view returns (bool)',
  'function pause() public',
  'function unpause() public',
  'function pendingFeeRecipient() public view returns (address)',
  'function feeRecipientChangeTime() public view returns (uint256)',
  'function requestFeeRecipientChange(address _newRecipient) public',
  'function confirmFeeRecipientChange() public',
  'function cancelFeeRecipientChange() public',
  'function owner() public view returns (address)',
  'function pendingOwner() public view returns (address)',
  'function guardian() public view returns (address)',
  'function activeLockCount(address _user) public view returns (uint256)',
  'function transferOwnership(address _newOwner) public',
  'function acceptOwnership() public',
  'function cancelOwnershipTransfer() public',
  'function ownershipTransferTime() public view returns (uint256)',
  // CRITICAL FIX: setGuardian replaced with 3-step timelock flow
  'function requestSetGuardian(address _newGuardian) public',
  'function confirmSetGuardian() public',
  'function cancelSetGuardian() public',
  'function pendingGuardian() public view returns (address)',
  'function guardianChangeTime() public view returns (uint256)',
  'function recoveryRecipient() public view returns (address)',
  'function recoveryTime() public view returns (uint256)',
  'function recoveryInitiator() public view returns (address)',
  'function initiateFeeRecipientRecovery(address _newRecipient) public',
  'function confirmFeeRecipientRecovery() public',
  'function cancelFeeRecipientRecovery() public',
  // INFO FIX: surplus rescue functions
  'function rescuableAmount(address _token) public view returns (uint256)',
  'function rescueToken(address _token) public returns (uint256)',
  'function totalTokenLocked(address _token) public view returns (uint256)',
  'function totalTokenWithdrawn(address _token) public view returns (uint256)',
  'function totalTokenRescued(address _token) public view returns (uint256)',
];

// ─── STATE ──────────────────────────────────────────
let acct=null, prov=null, cont=null, locks=[];

// ── ALCHEMY READ RPC — all reads + tx polling go direct, only signing uses wallet ──
// MEDIUM FIX: renamed from ANKR_RPC (was mislabelled — this is an Alchemy endpoint).
// ⚠️  This key is visible in client-side source by design (static site). It MUST have
//    an HTTP referrer / domain allowlist set in the Alchemy dashboard (cryptotimelock.xyz),
//    otherwise anyone who copies it can use it from anywhere on your account's dime.
const ALCHEMY_RPC = 'https://eth-mainnet.g.alchemy.com/v2/bCL4dfF5rTmgrc-lKLMpe';
// Runtime guard — warn if the Alchemy key is still a placeholder.
if(ALCHEMY_RPC.includes('REPLACE_WITH_YOUR_KEY')){
  console.warn('[TimeLock] ALCHEMY_RPC is not configured. Replace the placeholder key in the JS config section before deploying.');
}
let readProv = null;
let readCont = null;

// waitForTx — polls via Alchemy direct instead of the wallet relay
async function waitForTx(tx){
  const rp = readProv || prov;
  let receipt = null;
  while(!receipt){
    await new Promise(r=>setTimeout(r, 2000));
    try{ receipt = await rp.getTransactionReceipt(tx.hash); }catch(e){}
  }
  return receipt;
}

// Send a contract write. For WalletConnect we do NOT route through ethers'
// signer — doing so makes ethers fire eth_chainId / eth_accounts / estimateGas
// at the WC provider, and any one of those hitting a backgrounded relay throws
// the cryptic "Please call connect() before request()". Instead we encode the
// calldata locally and publish a SINGLE eth_sendTransaction straight through the
// WC provider; the wallet does its own gas estimation, and waitForTx() polls the
// receipt via Alchemy. Injected (browser-extension) wallets keep the normal
// ethers path. Returns an object with `.hash` so waitForTx() works for both.
async function sendContractTx(contract, method, args, value){
  if(wcProvider){
    const to   = await contract.getAddress();    // local — no RPC
    const data = contract.interface.encodeFunctionData(method, args);
    const tx   = { from: acct, to, data };
    if(value && value > 0n) tx.value = '0x' + value.toString(16);
    try{
      // Send straight through the WC provider. Do NOT restart the relay first:
      // on a healthy session an idle socket still reports connected=false, and
      // restarting it here tears down the working transport and makes this very
      // send fail. The SDK auto-reconnects the relay when publishing.
      const hash = await wcProvider.request({ method: 'eth_sendTransaction', params: [tx] });
      return { hash };
    }catch(e){
      console.error('[TimeLock] WalletConnect eth_sendTransaction failed:', e);
      // Only if it genuinely looks like a dropped session, nudge the relay and
      // retry once. A truly dead session fails again and the caller surfaces the
      // friendly reconnect message; anything else is rethrown as-is.
      if(!isWcSessionError(e)) throw e;
      await ensureWcReady();
      const hash = await wcProvider.request({ method: 'eth_sendTransaction', params: [tx] });
      return { hash };
    }
  }
  const overrides = (value && value > 0n) ? { value } : {};
  return await contract[method](...args, overrides);
}
// Max *active* (un-withdrawn) locks per user — must match the contract constant (50).
const MAX_ACTIVE_LOCKS = 50;
const LOCK_WARN_AT     = 40;
let currentActiveCount = 0;
