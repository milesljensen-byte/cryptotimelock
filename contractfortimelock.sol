// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30; // min 0.8.30: first release after the 0.8.28/0.8.29 storage-read-ordering compiler bug

/**
 * @title CryptoTimeLock v3
 * @notice Lock allowlisted ERC-20 tokens or native ETH until an absolute unlock
 *         timestamp (pass block.timestamp + duration, NOT a duration).
 *         0.5% fee on deposit. Withdrawals can never be paused or blocked by any admin.
 *
 * @dev Security model:
 *  - Reentrancy guard + checks-effects-interactions on all state-changing paths
 *  - Token allowlist: 48h request -> confirm timelock to add; removal is instant
 *    and only blocks new deposits, never existing locks
 *  - Safe-transfer helpers + balance-delta accounting: USDT-style and
 *    fee-on-transfer tokens are fully supported and solvency-safe
 *  - Every self-service rotation (fee recipient, owner) is 48h-timelocked AND
 *    two-step: the incoming key must confirm, so no single key completes a change.
 *    (The owner-only recovery path below is the sole exception; it can only move
 *    the fee destination, never user funds.)
 *  - Owner multisig can recover a lost/compromised feeRecipient key (48h timelock);
 *    pause() freezes fee claims immediately while a recovery is in flight
 *  - `owner` (allowlist/pause - MUST be a multisig) is separate from
 *    `feeRecipient` (financial key); no admin can ever reach user principal
 *  - Pause blocks deposits and fee claims only, and auto-expires after 30 days
 *    (then anyone may unpause) - no indefinite-freeze trust assumption
 *  - Direct ETH transfers revert (use lockNative). No oracles, no governance,
 *    no upgradeability. ERC-20s sent directly (not via lockToken) are unrecoverable.
 *
 * NEVER ALLOWLIST REBASING TOKENS (stETH, aTokens, AMPL, OHM, ...): a fixed
 * amount is recorded at deposit, so a negative rebase makes the withdrawal
 * revert and PERMANENTLY locks the user's funds. Wrapped non-rebasing versions
 * (wstETH) are fine. Vet upgradeable / mutable-fee tokens before allowlisting.
 * Issuer blacklists (USDC/USDT/WBTC/...) can block an individual user's
 * withdrawal - a property of those tokens, not of this contract.
 */

interface IERC20 {
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function decimals() external view returns (uint8);
}

contract CryptoTimeLock {

    // ── ERRORS ─────────────────────────────────────────
    error AlreadyPaused();
    error AlreadyPending();
    error AlreadyWithdrawn();
    error BelowMinimum();
    error ContractPaused();
    error FeeTooSmall();
    error FundsStillLocked();
    error LockDoesNotExist();
    error LockTimeTooLong();
    error LockTimeTooShort();
    error MaxLocksReached();
    error NothingPending();
    error NothingToClaim();
    error NotPaused();
    error PageLimitTooLarge();
    error ReentrantCall();
    error RoleClash();
    error TokenAlreadyAllowed();
    error TokenNotAllowed();
    error TooEarly();
    error TransferFailed();
    error Unauthorized();
    error UseLockNative();
    error ZeroAddress();

    // ── CONSTANTS ──────────────────────────────────────
    uint256 public constant FEE_PERCENTAGE     = 50;            // 0.5% (50 / 10000)
    uint256 public constant MIN_LOCK_AMOUNT    = 0.001 ether;   // minimum native lock
    uint256 public constant MAX_LOCKS_PER_USER = 50;            // active (un-withdrawn) locks
    uint256 public constant MAX_PAGE_LIMIT     = 500;           // getUserLocks page size
    uint256 public constant MIN_LOCK_TIME      = 5 minutes;
    uint256 public constant MAX_LOCK_TIME      = 20 * 366 days; // ~20 years (366: leap-safe)
    uint256 public constant TIMELOCK_DELAY     = 48 hours;      // all privileged changes
    uint256 public constant MAX_PAUSE_DURATION = 30 days;       // then anyone may unpause

    // ── REENTRANCY + PAUSE (one shared slot) ───────────
    // _state is always one of {OPEN=1, LOCKED=2, PAUSED=3, PAUSED_LOCKED=4}.
    // withdraw() is nonReentrant but not whenNotPaused, so the guard must also
    // work while paused - hence the fourth state.
    uint256 private _state;
    uint256 private constant _OPEN          = 1;
    uint256 private constant _LOCKED        = 2;
    uint256 private constant _PAUSED        = 3;
    uint256 private constant _PAUSED_LOCKED = 4;

    // ── ROLES + ADMIN STATE ────────────────────────────
    // Each address below except feeRecipient shares its 32-byte slot with the
    // uint96 timer declared right after it. feeRecipient occupies its own slot:
    // there are 5 role addresses but only 4 timers, so one address is necessarily
    // unpaired (this layout is storage-optimal for that field set).
    address payable public feeRecipient;        // fee destination (financial key)
    address payable public pendingFeeRecipient; // two-step rotation nominee
    uint96  public feeRecipientChangeTime;      // when the nominee may confirm
    address public owner;                       // allowlist/pause/rotation (multisig!)
    uint96  public pausedAt;                    // pause start (0 = not paused)
    address public pendingOwner;                // two-step ownership nominee
    uint96  public ownershipTransferTime;       // when pendingOwner may accept
    address payable public recoveryRecipient;   // owner-initiated feeRecipient recovery nominee
    uint96  public recoveryTime;                // when the recovery may be confirmed

    uint256 public lockCounter;

    uint256 private totalNativeFeesAccumulated;
    uint256 private totalNativeFeesClaimed;
    mapping(address => uint256) private totalTokenFeesAccumulated;
    mapping(address => uint256) private totalTokenFeesClaimed;

    // ── TOKEN ALLOWLIST ────────────────────────────────
    // Invariant: allowedTokens[t] == (tokenMinimums[t] != 0). lockToken() relies on it.
    mapping(address => bool)    public allowedTokens;
    mapping(address => uint256) public tokenMinimums;   // decimal-aware, never 0 while allowed
    mapping(address => uint256) public tokenAllowTimes; // when a queued token may be confirmed (0 = none)

    // ── LOCKS ──────────────────────────────────────────
    // 3 slots: [owner|withdrawn|createdAt] [token|unlockTime] [amount].
    // uint88/uint96 hold any realistic Unix timestamp.
    struct Lock {
        address owner;
        bool    withdrawn;
        uint88  createdAt;
        address token;      // address(0) = native ETH
        uint96  unlockTime;
        uint256 amount;
    }

    mapping(uint256 => Lock)      private locks;     // read via getLock()
    mapping(address => uint256[]) private userLocks; // append-only; read via getUserLocks()
    mapping(address => uint256)   public  activeLockCount;

    // ── EVENTS ─────────────────────────────────────────
    event LockCreated(uint256 indexed lockId, address indexed owner, address indexed token, uint256 amount, uint256 unlockTime, uint256 fee);
    event Withdrawn(uint256 indexed lockId, address indexed owner, address indexed token, uint256 amount);
    event NativeFeeClaimed(address indexed recipient, uint256 amount);
    event TokenFeeClaimed(address indexed recipient, address indexed token, uint256 amount);
    event FeeRecipientChangeRequested(address indexed newRecipient, uint256 effectiveTime);
    event FeeRecipientChangeCancelled();
    event FeeRecipientChanged(address indexed oldRecipient, address indexed newRecipient);
    event FeeRecipientRecoveryInitiated(address indexed newRecipient, uint256 effectiveTime);
    event FeeRecipientRecoveryCancelled();
    event TokenAllowRequested(address indexed token, uint256 effectiveTime);
    event TokenAllowCancelled(address indexed token);
    event TokenAllowed(address indexed token);
    event TokenMinimumSet(address indexed token, uint256 minimum);
    event TokenDisallowed(address indexed token);
    event Paused(address indexed by);
    event Unpaused(address indexed by);
    event OwnershipTransferStarted(address indexed currentOwner, address indexed pendingOwner);
    event OwnershipTransferCancelled(address indexed cancelledPendingOwner);
    event OwnerChanged(address indexed oldOwner, address indexed newOwner);

    // ── MODIFIERS ──────────────────────────────────────
    modifier onlyOwner() {
        require(msg.sender == owner, Unauthorized());
        _;
    }

    modifier onlyFeeRecipient() {
        require(msg.sender == feeRecipient, Unauthorized());
        _;
    }

    modifier nonReentrant() {
        uint256 s = _state;
        require(s != _LOCKED && s != _PAUSED_LOCKED, ReentrantCall());
        _state = (s == _PAUSED) ? _PAUSED_LOCKED : _LOCKED;
        _;
        _state = s;
    }

    modifier whenNotPaused() {
        uint256 s = _state;
        require(s != _PAUSED && s != _PAUSED_LOCKED, ContractPaused());
        _;
    }

    // ── CONSTRUCTOR ────────────────────────────────────
    // Launch allowlist is hardcoded (no external calls mid-deploy, no
    // mis-suppliable parameter). Minimums match _computeMinimum():
    // 6 dec -> 1e4 (0.01), 8 dec -> 200 (fee floor), 18 dec -> 1e15 (0.001).
    // Do not re-add without review: FLOKI (active fee-on-transfer), PAXG & EURT
    // (dormant issuer-set fee). NEVER add rebasing tokens (see header).
    constructor(address payable _feeRecipient, address _owner) {
        require(_feeRecipient != address(0) && _owner != address(0), ZeroAddress());
        require(_feeRecipient != _owner, RoleClash()); // financial key separate from operational key
        feeRecipient = _feeRecipient;
        owner        = _owner;
        _state       = _OPEN;
        lockCounter  = 1; // 0 is a null sentinel: getLock(0) unambiguously means "does not exist"

        // Stablecoins
        _allow(0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48, 1e4);  // USDC   (6 dec)
        _allow(0xdAC17F958D2ee523a2206206994597C13D831ec7, 1e4);  // USDT   (6 dec)
        _allow(0x6B175474E89094C44Da98b954EedeAC495271d0F, 1e15); // DAI
        _allow(0x853d955aCEf822Db058eb8505911ED77F175b99e, 1e15); // FRAX
        _allow(0x5f98805A4E8be255a32880FDeC7F6728C6568bA0, 1e15); // LUSD
        _allow(0xf939E0A03FB07F59A73314E73794Be0E57ac1b4E, 1e15); // crvUSD
        _allow(0x6c3ea9036406852006290770BEdFcAbA0e23A0e8, 1e4);  // PYUSD  (6 dec)
        // Wrapped assets
        _allow(0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2, 1e15); // WETH
        _allow(0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599, 200);  // WBTC   (8 dec)
        _allow(0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf, 200);  // cbBTC  (8 dec)
        // Liquid staking (non-rebasing only)
        _allow(0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0, 1e15); // wstETH
        _allow(0xae78736Cd615f374D3085123A210448E74Fc6393, 1e15); // rETH
        _allow(0xBe9895146f7AF43049ca1c1AE358B0541Ea49704, 1e15); // cbETH
        // DeFi blue chips
        _allow(0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984, 1e15); // UNI
        _allow(0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9, 1e15); // AAVE
        _allow(0xD533a949740bb3306d119CC777fa900bA034cd52, 1e15); // CRV
        _allow(0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32, 1e15); // LDO
        _allow(0xC011a73ee8576Fb46F5E1c5751cA3B9Fe0af2a6F, 1e15); // SNX
        _allow(0xc00e94Cb662C3520282E6f5717214004A7f26888, 1e15); // COMP
        _allow(0x111111111117dC0aa78b770fA6A738034120C302, 1e15); // 1INCH
        _allow(0x6B3595068778DD592e39A122f4f5a5cF09C90fE2, 1e15); // SUSHI
        // Infrastructure / oracles
        _allow(0x514910771AF9Ca656af840dff83E8264EcF986CA, 1e15); // LINK
        _allow(0xc944E90C64B2c07662A292be6244BDf05Cda44a7, 1e15); // GRT
        _allow(0xC18360217D8F7Ab5e7c516566761Ea12Ce7F9D72, 1e15); // ENS
        // Gaming / metaverse
        _allow(0x3845badAde8e6dFF049820680d1F14bD3903a5d0, 1e15); // SAND
        _allow(0x0F5D2fB29fb7d3CFeE444a200298f468908cC942, 1e15); // MANA
        _allow(0xBB0E17EF65F82Ab018d8EDd776e8DD940327B28b, 1e15); // AXS
        // Large-cap memes
        _allow(0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE, 1e15); // SHIB
        _allow(0x6982508145454Ce325dDbE47a25d4ec3d2311933, 1e15); // PEPE
        // Exchange tokens
        _allow(0xA0b73E1Ff0B80914AB6fe0444E65848C4C34450b, 200);  // CRO    (8 dec)
        _allow(0x75231F58b43240C9718Dd58B4967c5114342a86c, 1e15); // OKB
        // RWA / ecosystem
        _allow(0xfAbA6f8e4a5E8Ab82F62fe7C39859FA577269BE3, 1e15); // ONDO
        _allow(0xB50721BCf8d664c30412Cfbc6cf7a15145234ad1, 1e15); // ARB
        _allow(0xF57e7e7C23978C3cAEC3C3548E3D615c346e79fF, 1e15); // IMX
    }

    // ── LOCK ───────────────────────────────────────────

    /// @notice Lock ETH until `_unlockTime` (absolute Unix timestamp).
    function lockNative(uint256 _unlockTime) external payable nonReentrant whenNotPaused returns (uint256) {
        require(msg.value >= MIN_LOCK_AMOUNT, BelowMinimum());
        _checkUnlockTime(_unlockTime);

        uint256 fee = (msg.value * FEE_PERCENTAGE) / 10000; // > 0: MIN_LOCK_AMOUNT * 50 / 10000 = 5e12
        totalNativeFeesAccumulated += fee;
        unchecked {
            return _createLock(address(0), msg.value - fee, fee, _unlockTime);
        }
    }

    /// @notice Lock `_amount` of an allowlisted ERC-20 until `_unlockTime` (absolute Unix timestamp).
    ///         For fee-on-transfer tokens the actually-received amount is what gets locked.
    function lockToken(address _token, uint256 _amount, uint256 _unlockTime) external nonReentrant whenNotPaused returns (uint256) {
        uint256 minAmount = tokenMinimums[_token];
        require(minAmount != 0, TokenNotAllowed()); // allowlist invariant: allowed <=> minimum set
        _checkUnlockTime(_unlockTime);

        // Measure the real balance delta - supports fee-on-transfer tokens.
        uint256 balBefore = IERC20(_token).balanceOf(address(this));
        _safeTransferFrom(_token, msg.sender, address(this), _amount);
        uint256 received = IERC20(_token).balanceOf(address(this)) - balBefore;
        require(received >= minAmount, BelowMinimum());

        uint256 fee = (received * FEE_PERCENTAGE) / 10000;
        // Defensive only: received >= minAmount, and every allowlisted minimum is
        // >= 200 (the _computeMinimum fee floor), so fee >= 1 always. Kept as a
        // belt-and-suspenders invariant in case a future minimum is ever set lower.
        require(fee > 0, FeeTooSmall());
        totalTokenFeesAccumulated[_token] += fee;
        unchecked {
            return _createLock(_token, received - fee, fee, _unlockTime);
        }
    }

    function _checkUnlockTime(uint256 _unlockTime) private view {
        // The upper bound also guarantees the value fits uint96: block.timestamp +
        // MAX_LOCK_TIME is far below 2^96, so the uint96 cast in _createLock is safe.
        require(_unlockTime >= block.timestamp + MIN_LOCK_TIME, LockTimeTooShort());
        require(_unlockTime <= block.timestamp + MAX_LOCK_TIME, LockTimeTooLong());
    }

    function _createLock(address _token, uint256 _amount, uint256 _fee, uint256 _unlockTime) private returns (uint256 id) {
        require(activeLockCount[msg.sender] < MAX_LOCKS_PER_USER, MaxLocksReached());
        unchecked {
            id = lockCounter++;
            activeLockCount[msg.sender]++; // capped by the check above
        }
        locks[id] = Lock({
            owner:      msg.sender,
            withdrawn:  false,
            createdAt:  uint88(block.timestamp),
            token:      _token,
            unlockTime: uint96(_unlockTime),
            amount:     _amount
        });
        userLocks[msg.sender].push(id);
        emit LockCreated(id, msg.sender, _token, _amount, _unlockTime, _fee);
    }

    // ── WITHDRAW ───────────────────────────────────────
    // Deliberately NOT whenNotPaused: users can always withdraw.

    function withdraw(uint256 _lockId) external nonReentrant {
        Lock storage lock = locks[_lockId];
        require(lock.owner == msg.sender,           Unauthorized()); // also rejects nonexistent locks
        require(!lock.withdrawn,                    AlreadyWithdrawn());
        require(block.timestamp >= lock.unlockTime, FundsStillLocked());

        lock.withdrawn = true;
        unchecked { activeLockCount[msg.sender]--; } // paired 1:1 with the increment at creation
        uint256 amount = lock.amount;
        address token  = lock.token;

        if (token == address(0)) {
            (bool ok, ) = payable(msg.sender).call{value: amount}("");
            require(ok, TransferFailed());
        } else {
            _safeTransfer(token, msg.sender, amount);
        }
        emit Withdrawn(_lockId, msg.sender, token, amount);
    }

    // ── FEES ───────────────────────────────────────────

    function pendingNativeFees() public view returns (uint256) {
        return totalNativeFeesAccumulated - totalNativeFeesClaimed;
    }

    function pendingTokenFees(address _token) public view returns (uint256) {
        return totalTokenFeesAccumulated[_token] - totalTokenFeesClaimed[_token];
    }

    function claimNativeFees() external nonReentrant onlyFeeRecipient whenNotPaused returns (uint256) {
        uint256 claimable = pendingNativeFees();
        require(claimable > 0, NothingToClaim());
        totalNativeFeesClaimed += claimable; // CEI: settle before transfer
        (bool ok, ) = payable(msg.sender).call{value: claimable}("");
        require(ok, TransferFailed());
        emit NativeFeeClaimed(msg.sender, claimable);
        return claimable;
    }

    /// @dev For fee-on-transfer tokens the protocol absorbs the transfer tax:
    ///      the full claimable is booked as spent, keeping contract balance >= user principal.
    function claimTokenFees(address _token) external nonReentrant onlyFeeRecipient whenNotPaused returns (uint256) {
        uint256 claimable = pendingTokenFees(_token);
        require(claimable > 0, NothingToClaim());
        totalTokenFeesClaimed[_token] += claimable; // CEI: settle before transfer
        _safeTransfer(_token, msg.sender, claimable);
        emit TokenFeeClaimed(msg.sender, _token, claimable);
        return claimable;
    }

    // ── FEE RECIPIENT ROTATION (48h + pull model) ──────
    // Current recipient requests; the NEW address must confirm after the delay,
    // so the initiator can never unilaterally complete the change. Only the
    // current recipient can cancel (a nominee simply declines by not confirming).

    function requestFeeRecipientChange(address payable _newRecipient) external onlyFeeRecipient {
        require(recoveryRecipient == address(0), AlreadyPending()); // blocked while a recovery is in flight
        require(pendingFeeRecipient == address(0), AlreadyPending());
        require(_newRecipient != address(0), ZeroAddress());
        require(_newRecipient != feeRecipient && _newRecipient != owner, RoleClash());
        pendingFeeRecipient    = _newRecipient;
        feeRecipientChangeTime = uint96(block.timestamp + TIMELOCK_DELAY);
        emit FeeRecipientChangeRequested(_newRecipient, feeRecipientChangeTime);
    }

    function cancelFeeRecipientChange() external onlyFeeRecipient {
        require(pendingFeeRecipient != address(0), NothingPending());
        pendingFeeRecipient    = payable(address(0));
        feeRecipientChangeTime = 0;
        emit FeeRecipientChangeCancelled();
    }

    function confirmFeeRecipientChange() external {
        require(msg.sender == pendingFeeRecipient, Unauthorized()); // implies a change is pending
        require(block.timestamp >= feeRecipientChangeTime, TooEarly());
        emit FeeRecipientChanged(feeRecipient, msg.sender);
        feeRecipient           = payable(msg.sender);
        pendingFeeRecipient    = payable(address(0));
        feeRecipientChangeTime = 0;
    }

    // ── FEE RECIPIENT RECOVERY (owner, 48h) ────────────
    // For a LOST or COMPROMISED feeRecipient key. Runs entirely on the owner
    // multisig - the feeRecipient can never start, block, or cancel it. The
    // multisig quorum is the only thing gating it, so owner MUST be a multisig.
    // Incident response for a compromised key: pause() immediately (fee claims are
    // whenNotPaused, so the attacker can no longer drain the fee pool), initiate,
    // wait 48h, confirm, unpause. Recovery only redirects future fees; it can
    // never reach user principal.

    function initiateFeeRecipientRecovery(address payable _newRecipient) external onlyOwner {
        require(recoveryRecipient == address(0), AlreadyPending());
        require(_newRecipient != address(0), ZeroAddress());
        require(_newRecipient != feeRecipient && _newRecipient != owner, RoleClash());
        recoveryRecipient = _newRecipient;
        recoveryTime      = uint96(block.timestamp + TIMELOCK_DELAY);
        // Void any in-flight self-service rotation - it may be attacker-initiated.
        if (pendingFeeRecipient != address(0)) {
            pendingFeeRecipient    = payable(address(0));
            feeRecipientChangeTime = 0;
            emit FeeRecipientChangeCancelled();
        }
        emit FeeRecipientRecoveryInitiated(_newRecipient, recoveryTime);
    }

    function cancelFeeRecipientRecovery() external onlyOwner {
        require(recoveryRecipient != address(0), NothingPending());
        recoveryRecipient = payable(address(0));
        recoveryTime      = 0;
        emit FeeRecipientRecoveryCancelled();
    }

    function confirmFeeRecipientRecovery() external onlyOwner {
        require(recoveryRecipient != address(0), NothingPending());
        require(block.timestamp >= recoveryTime, TooEarly());
        emit FeeRecipientChanged(feeRecipient, recoveryRecipient);
        feeRecipient      = recoveryRecipient;
        recoveryRecipient = payable(address(0));
        recoveryTime      = 0;
    }

    // ── OWNERSHIP (48h + two-step) ─────────────────────
    // The delay prevents a nominee front-running a cancellation.

    function transferOwnership(address _newOwner) external onlyOwner {
        require(_newOwner != address(0), ZeroAddress());
        require(_newOwner != feeRecipient, RoleClash());
        pendingOwner          = _newOwner;
        ownershipTransferTime = uint96(block.timestamp + TIMELOCK_DELAY);
        emit OwnershipTransferStarted(msg.sender, _newOwner);
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, Unauthorized());
        require(block.timestamp >= ownershipTransferTime, TooEarly());
        emit OwnerChanged(owner, msg.sender);
        owner                 = msg.sender;
        pendingOwner          = address(0);
        ownershipTransferTime = 0;
    }

    function cancelOwnershipTransfer() external onlyOwner {
        require(pendingOwner != address(0), NothingPending());
        emit OwnershipTransferCancelled(pendingOwner);
        pendingOwner          = address(0);
        ownershipTransferTime = 0;
    }

    // ── ALLOWLIST MANAGEMENT (48h to add, instant remove) ──
    // Read the "NEVER ALLOWLIST REBASING TOKENS" header warning before adding.

    function requestAllowToken(address _token) external onlyOwner {
        require(_token != address(0), ZeroAddress());
        require(!allowedTokens[_token], TokenAlreadyAllowed());
        require(tokenAllowTimes[_token] == 0, AlreadyPending());
        uint256 effective = block.timestamp + TIMELOCK_DELAY;
        tokenAllowTimes[_token] = effective;
        emit TokenAllowRequested(_token, effective);
    }

    function cancelAllowToken(address _token) external onlyOwner {
        require(tokenAllowTimes[_token] != 0, NothingPending());
        tokenAllowTimes[_token] = 0;
        emit TokenAllowCancelled(_token);
    }

    function confirmAllowToken(address _token) external onlyOwner {
        uint256 effective = tokenAllowTimes[_token];
        require(effective != 0, NothingPending());
        require(block.timestamp >= effective, TooEarly());
        tokenAllowTimes[_token] = 0;
        _allow(_token, _computeMinimum(_token));
    }

    /// @dev Instant, and never affects existing locks - they always remain withdrawable.
    function disallowToken(address _token) external onlyOwner {
        require(allowedTokens[_token], TokenNotAllowed());
        allowedTokens[_token] = false;
        tokenMinimums[_token] = 0;
        emit TokenDisallowed(_token);
    }

    function _allow(address _token, uint256 _minimum) private {
        allowedTokens[_token] = true;
        tokenMinimums[_token] = _minimum;
        emit TokenAllowed(_token);
        emit TokenMinimumSet(_token, _minimum);
    }

    // Decimal-aware deposit minimum. Always >= 200 so every allowlisted token
    // clears the fee floor: amount * 50 / 10000 >= 1 requires amount >= 200.
    // (Also guarantees the allowlist invariant minimum != 0.)
    // Falls back to the 18-dec tier for missing or non-standard decimals().
    function _computeMinimum(address _token) internal view returns (uint256) {
        try IERC20(_token).decimals() returns (uint8 d) {
            if (d > 18) return 1e15;                   // non-standard: assume 18 dec
            uint256 m;
            if (d <= 6)      m = 10 ** (d > 2 ? d - 2 : 0); // 0.01 of the token
            else if (d <= 8) m = 200;
            else             m = 10 ** (d - 3);             // 0.001 of the token
            return m < 200 ? 200 : m;                  // enforce the fee floor (matters for d <= 4)
        } catch {
            return 1e15;
        }
    }

    // ── PAUSE ──────────────────────────────────────────
    // Blocks new deposits and fee claims; withdrawals always work. After
    // MAX_PAUSE_DURATION anyone may unpause, so a lost/compromised owner
    // multisig can never freeze the protocol indefinitely.

    function pause() external onlyOwner {
        uint256 s = _state;
        require(s != _PAUSED && s != _PAUSED_LOCKED, AlreadyPaused());
        require(s == _OPEN, ReentrantCall());
        _state   = _PAUSED;
        pausedAt = uint96(block.timestamp);
        emit Paused(msg.sender);
    }

    function unpause() external {
        require(_state == _PAUSED, NotPaused());
        require(msg.sender == owner || block.timestamp >= pausedAt + MAX_PAUSE_DURATION, Unauthorized());
        _state   = _OPEN;
        pausedAt = 0;
        emit Unpaused(msg.sender);
    }

    function paused() external view returns (bool) {
        return _state == _PAUSED || _state == _PAUSED_LOCKED;
    }

    // ── VIEWS ──────────────────────────────────────────

    /// @dev Returns a zero-valued struct for IDs that were never created (no revert);
    ///      check lock.owner != address(0) to confirm existence.
    function getLock(uint256 _lockId) external view returns (Lock memory) {
        return locks[_lockId];
    }

    function canWithdraw(uint256 _lockId) external view returns (bool) {
        Lock memory lock = locks[_lockId];
        return lock.owner != address(0) && !lock.withdrawn && block.timestamp >= lock.unlockTime;
    }

    function timeRemaining(uint256 _lockId) external view returns (uint256) {
        Lock memory lock = locks[_lockId];
        require(lock.owner != address(0), LockDoesNotExist());
        return block.timestamp >= lock.unlockTime ? 0 : lock.unlockTime - block.timestamp;
    }

    function getUserLockCount(address _user) external view returns (uint256) {
        return userLocks[_user].length;
    }

    function getUserLocks(address _user, uint256 _offset, uint256 _limit) external view returns (uint256[] memory) {
        require(_limit <= MAX_PAGE_LIMIT, PageLimitTooLarge());
        uint256[] storage all = userLocks[_user];
        if (_offset >= all.length) return new uint256[](0);
        uint256 end = _offset + _limit;
        if (end > all.length) end = all.length;
        uint256[] memory page = new uint256[](end - _offset);
        for (uint256 i = 0; i < page.length; i++) {
            page[i] = all[_offset + i];
        }
        return page;
    }

    // ── SAFE TRANSFER HELPERS ──────────────────────────
    // Handle non-standard tokens (USDT) that return nothing instead of bool.

    function _safeTransfer(address token, address to, uint256 amount) internal {
        _callToken(token, abi.encodeCall(IERC20.transfer, (to, amount)));
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        _callToken(token, abi.encodeCall(IERC20.transferFrom, (from, to, amount)));
    }

    function _callToken(address token, bytes memory data) private {
        (bool ok, bytes memory ret) = token.call(data);
        require(ok && (ret.length == 0 || abi.decode(ret, (bool))), TransferFailed());
    }

    // ── FALLBACK ───────────────────────────────────────
    // Direct ETH transfers are rejected; use lockNative(). (ETH force-injected
    // via selfdestruct is untracked and cannot corrupt fee accounting, which
    // uses internal counters, not address(this).balance.)

    receive() external payable {
        revert UseLockNative();
    }
}
