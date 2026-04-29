import './styles.css';
import {
  addLiquiditySYPT,
  addLiquiditySYYT,
  adminAddAmmLiquidity,
  isUninitializedHandle,
  readKindBalanceHandle,
  adminHarvestAaveYield,
  approveUSDC,
  combinePTAndYT,
  connectWallet as connectWalletOnchain,
  decryptPortfolio,
  EXPECTED_CHAIN_ID,
  readChainId,
  switchToArbitrumSepolia,
  fissionSY,
  listPendingRedeemsForAccount,
  mintSY,
  readMarketOwner,
  readMaturity,
  readMaturityYieldStatus,
  readPrincipalDeposited,
  readUSDCAllowance,
  redeemPT,
  redeemYTToSY,
  removeLiquiditySYPT,
  removeLiquiditySYYT,
  requestSYRedeem,
  settleSYRedeem,
  signRelayedCombine,
  signRelayedFission,
  signRelayedRedeemPT,
  signRelayedRedeemYTToSY,
  signRelayedSwap,
  snapshotMaturity,
  submitRelayedCombine,
  submitRelayedFission,
  submitRelayedRedeemPT,
  submitRelayedRedeemYTToSY,
  submitRelayedSwap,
  swapWithAmm
} from './lib/fissionApi.js';
import { FISSION_ADDRESSES } from './lib/addresses.js';

const strategies = {
  pt: {
    name: 'PT Strategy',
    route: 'SY -> PT',
    title: 'Lock fixed yield privately',
    short: 'Buy PT below par and redeem at maturity for SY. Your entry size, balance, and exit are encrypted.',
    thesis: 'Best when you want predictable yield and do not want the market to see how large your principal position is. Fission stores PT exposure as confidential Nox handles.',
    risk: 'Lower upside, maturity dependent',
    execution: 'On-chain AMM',
    price: 'Encrypted quote',
    token: 'PT-USDC-30D',
    color: 'yellow'
  },
  yt: {
    name: 'YT Strategy',
    route: 'SY -> YT',
    title: 'Long future yield privately',
    short: 'Buy YT to isolate Aave USDC yield exposure. If realized yield rises, your YT position benefits.',
    thesis: 'Best when you are bullish on future yield and want leveraged yield exposure without exposing your bet. Your YT balance and AMM fill remain confidential.',
    risk: 'Higher volatility, can decay',
    execution: 'On-chain AMM',
    price: 'Encrypted quote',
    token: 'YT-USDC-30D',
    color: 'white'
  },
  pair: {
    name: 'PT + YT Strategy',
    route: 'SY -> PT + YT',
    title: 'Mint the full yield strip',
    short: 'Split SY into both PT and YT. Hold, rebalance, or sell either side through the private AMM.',
    thesis: 'Best when you want to enter the market privately, then choose whether to keep principal, sell yield, or trade both legs using encrypted balances.',
    risk: 'Flexible but more active',
    execution: 'Fission route',
    price: '1 SY -> PT + YT',
    token: 'PT + YT',
    color: 'split'
  }
};

const state = {
  screen: 'home',
  modal: null,
  toast: null,
  wallet: false,
  strategy: 'pt',
  action: 'buy',
  amount: '10',
  mintAmount: '100',
  redeemUsdcAmount: '100',
  redeemPtAmount: '10',
  minOut: '0',
  useRelay: false,
  account: '',
  txStatus: '',
  portfolio: null,
  maturity: null,
  pendingRedeem: null,
  pendingRedeems: [],
  yieldStatus: null,
  redeemYtAmount: '10',
  hasUsdcApproval: false,
  initialised: { sy: false, pt: false, yt: false, lpSyPt: false, lpSyYt: false },
  isAdmin: false,
  adminAmmReserve: 'sy',
  adminAmmAmount: '250000',
  adminHarvestAmount: '0',
  principalDeposited: 0n,
  lpSyAmount: '1000',
  lpPtAmount: '1026',
  lpYtAmount: '12000',
  lpRemoveAmount: '0',
  chainId: null,
  busy: false,
  autoSwitchAttempted: false
};

const markets = [
  {
    id: 'aave-usdc-30d',
    name: 'Aave USDC 30D',
    asset: 'USDC',
    source: 'Aave V3 Arbitrum Sepolia',
    market: FISSION_ADDRESSES.market,
    adapter: FISSION_ADDRESSES.adapter,
    status: 'Live'
  }
];

function maturityLabel() {
  if (!state.maturity) return 'Loading…';
  const d = new Date(Number(state.maturity) * 1000);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function isMatured() {
  if (!state.maturity) return false;
  return Math.floor(Date.now() / 1000) >= Number(state.maturity);
}

const navItems = [
  { id: 'home', label: 'Home', icon: '⌂' },
  { id: 'markets', label: 'Markets', icon: '⌁' },
  { id: 'strategy', label: 'Strategy', icon: '◇' },
  { id: 'portfolio', label: 'Portfolio', icon: '◐' }
];

const adminNavItem = { id: 'admin', label: 'Admin', icon: '◆' };

const app = document.querySelector('#app');

function setScreen(screen) {
  if (!state.wallet && screen !== 'home') {
    state.modal = 'connect';
  } else {
    state.screen = screen;
  }
  render();
  resetScroll();
}

function openModal(modal) {
  state.modal = modal;
  state.txStatus = '';
  render();
}

function closeModal() {
  state.modal = null;
  state.txStatus = '';
  render();
}

async function connectWallet() {
  try {
    state.txStatus = 'Requesting wallet connection...';
    render();
    const account = await connectWalletOnchain();
    state.wallet = true;
    state.account = account;
    state.screen = 'markets';
    state.modal = null;
    state.txStatus = '';
    toast('Wallet connected. Private markets unlocked.');
    resetScroll();
    refreshPostConnectState();
    attachWalletListeners();
    persistSession();
  } catch (error) {
    state.txStatus = '';
    toast(error.message || 'Wallet connection failed');
  }
}

function refreshPostConnectState() {
  if (!state.account) return;
  readChainId().then(async (id) => {
    state.chainId = id;
    render();
    if (id !== EXPECTED_CHAIN_ID && !state.autoSwitchAttempted) {
      state.autoSwitchAttempted = true;
      // Auto-trigger MetaMask switch dialog once per session. If the user rejects, the
      // wrong-network banner stays visible as a manual fallback. chainChanged listener
      // reloads on success.
      try {
        await switchToArbitrumSepolia();
      } catch {
        // User rejected or wallet refused — leave the banner for manual click.
      }
    }
  }).catch(() => {});
  readMaturity().then((m) => { state.maturity = m; render(); }).catch(() => {});
  readUSDCAllowance(state.account).then((a) => {
    state.hasUsdcApproval = a > 0n;
    persistSession();
    render();
  }).catch(() => {});
  listPendingRedeemsForAccount(state.account).then((redeems) => {
    state.pendingRedeems = redeems;
    if (!state.pendingRedeem && redeems.length) {
      state.pendingRedeem = redeems[redeems.length - 1];
    }
    render();
  }).catch(() => {});
  // YT-redeem-to-SY is single-step now — no pending list to refresh.
  readMaturityYieldStatus().then((status) => {
    state.yieldStatus = status;
    render();
  }).catch(() => {});
  readMarketOwner().then((ownerAddr) => {
    state.isAdmin = ownerAddr.toLowerCase() === state.account.toLowerCase();
    render();
  }).catch(() => {});
  readPrincipalDeposited().then((p) => {
    state.principalDeposited = p;
    render();
  }).catch(() => {});
  refreshBalanceHandles();
}

async function refreshBalanceHandles() {
  if (!state.account) return;
  try {
    const [sy, pt, yt, lpSyPt, lpSyYt] = await Promise.all([
      readKindBalanceHandle(0, state.account),
      readKindBalanceHandle(1, state.account),
      readKindBalanceHandle(2, state.account),
      readKindBalanceHandle(3, state.account),
      readKindBalanceHandle(4, state.account)
    ]);
    state.initialised = {
      sy: !isUninitializedHandle(sy),
      pt: !isUninitializedHandle(pt),
      yt: !isUninitializedHandle(yt),
      lpSyPt: !isUninitializedHandle(lpSyPt),
      lpSyYt: !isUninitializedHandle(lpSyYt)
    };
    render();
  } catch {}
}

let walletListenersAttached = false;
function attachWalletListeners() {
  if (walletListenersAttached || !window.ethereum?.on) return;
  walletListenersAttached = true;
  window.ethereum.on('accountsChanged', (accounts) => {
    if (!accounts.length) {
      state.wallet = false;
      state.account = '';
      state.portfolio = null;
      state.pendingRedeem = null;
      state.pendingRedeems = [];
      state.screen = 'home';
      clearSession();
      toast('Wallet disconnected');
      render();
      return;
    }
    state.account = accounts[0];
    state.portfolio = null;
    state.pendingRedeem = null;
    state.pendingRedeems = [];
    refreshPostConnectState();
    toast('Account changed');
    render();
  });
  window.ethereum.on('chainChanged', () => {
    toast('Network changed — reload required');
    setTimeout(() => window.location.reload(), 800);
  });
}

// ---- Session persistence ----
//
// Per-account cache lives in localStorage under SESSION_KEY. It survives reloads so the user
// doesn't have to reconnect, re-decrypt, or re-discover their approval state on every refresh.
// Persisted: account, decrypted portfolio (stale-but-displayable), USDC allowance heuristic,
// last-seen chainId, the relay-mode toggle, and the user's preferred screen. Pending redeems
// have their own per-account localStorage scheme inside fissionApi.js.

const SESSION_KEY = 'fission:session';

function persistSession() {
  if (!state.account) return;
  try {
    const payload = {
      account: state.account,
      portfolio: state.portfolio
        ? Object.fromEntries(Object.entries(state.portfolio).map(([k, v]) => [k, String(v)]))
        : null,
      portfolioAt: state.portfolio ? Date.now() : null,
      hasUsdcApproval: state.hasUsdcApproval,
      chainId: state.chainId,
      useRelay: state.useRelay,
      screen: state.screen
    };
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(payload));
  } catch {
    /* localStorage full or blocked — degrade gracefully */
  }
}

function clearSession() {
  try { window.localStorage.removeItem(SESSION_KEY); } catch {}
}

function loadSession() {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function applySession(session) {
  if (!session?.account) return false;
  state.account = session.account;
  state.wallet = true;
  state.chainId = session.chainId ?? null;
  state.hasUsdcApproval = !!session.hasUsdcApproval;
  state.useRelay = !!session.useRelay;
  state.screen = session.screen && session.screen !== 'home' ? session.screen : 'markets';
  if (session.portfolio) {
    state.portfolio = Object.fromEntries(
      Object.entries(session.portfolio).map(([k, v]) => [k, BigInt(v)])
    );
  }
  return true;
}

/**
 * Re-attach to a previously connected wallet without prompting MetaMask.
 *
 * Approach: read EIP-1193 `eth_accounts` (silent — only returns addresses if the wallet has
 * already authorised this site). If it matches the account we cached, restore state and kick
 * off a fresh background refresh. If the wallet has switched accounts, clear the stale cache.
 */
async function silentReconnect() {
  if (!window.ethereum) return false;
  const session = loadSession();
  if (!session) return false;
  // Optimistic render from cache so the UI is populated before any RPC roundtrip.
  applySession(session);
  render();
  try {
    const accounts = await window.ethereum.request({ method: 'eth_accounts' });
    if (!accounts?.length) {
      // Wallet locked or revoked permission — keep the cached read-only view; user can
      // re-click Connect to refresh.
      return true;
    }
    if (accounts[0].toLowerCase() !== session.account.toLowerCase()) {
      // Different account selected — discard the stale cache.
      clearSession();
      state.account = accounts[0];
      state.portfolio = null;
      state.hasUsdcApproval = false;
      render();
    }
    refreshPostConnectState();
    attachWalletListeners();
    return true;
  } catch {
    return true;
  }
}

function toast(text) {
  state.toast = text;
  render();
  window.clearTimeout(state.toastTimer);
  state.toastTimer = window.setTimeout(() => {
    state.toast = null;
    render();
  }, 2600);
}

function chooseStrategy(id) {
  state.strategy = id;
  state.screen = 'strategy';
  render();
  resetScroll();
}

function resetScroll() {
  requestAnimationFrame(() => window.scrollTo(0, 0));
}

function metric(label, value, trend = '') {
  return `
    <div class="metric">
      <small>${label}</small>
      <strong>${value}</strong>
      ${trend ? `<span>${trend}</span>` : ''}
    </div>
  `;
}

function shell(content) {
  if (!state.wallet) {
    return `
      <div class="public-shell">
        <header class="public-topbar">
          <div class="brand" data-screen="home">
            <div class="brand-mark"><span></span><span></span></div>
            <div>
              <strong>Fission</strong>
              <small>Confidential yield markets</small>
            </div>
          </div>
          <div class="top-actions">
            <button class="ghost" data-modal="how">How it works</button>
            <button class="wallet-btn" data-modal="connect">Connect</button>
          </div>
        </header>
        <main class="public-main">
          ${content}
        </main>
        ${state.modal ? modal(state.modal) : ''}
        ${state.toast ? `<div class="toast">${state.toast}</div>` : ''}
      </div>
    `;
  }

  const active = state.screen;
  const wrongChain = state.chainId !== null && state.chainId !== EXPECTED_CHAIN_ID;
  return `
    ${wrongChain ? `<button class="chain-banner" data-modal-action="switch-chain" type="button">⚠ Wrong network (chainId ${state.chainId}). Click to switch to Arbitrum Sepolia</button>` : ''}
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand" data-screen="home">
          <div class="brand-mark"><span></span><span></span></div>
          <div>
            <strong>Fission</strong>
            <small>Confidential yield markets</small>
          </div>
        </div>
        <nav class="nav">
          ${(state.isAdmin ? [...navItems, adminNavItem] : navItems).map((item) => `
            <button class="nav-item ${active === item.id ? 'active' : ''}" data-screen="${item.id}">
              <span>${item.icon}</span>
              <b>${item.label}</b>
            </button>
          `).join('')}
        </nav>
        <div class="network-card">
          <span class="dot"></span>
          <div>
            <b>Arbitrum Sepolia</b>
            <small>Aave USDC market live</small>
          </div>
        </div>
      </aside>

      <main class="main">
        <header class="topbar">
          <div>
            <p class="eyebrow">${state.wallet ? 'USDC -> SY -> PT + YT' : 'Private Pendle-style markets'}</p>
            <h1>${pageTitle()}</h1>
          </div>
          <div class="top-actions">
            <button class="icon-btn" title="Confidentiality controls" data-modal="privacy">◉</button>
            <button class="wallet-btn" data-modal="${state.wallet ? 'account' : 'connect'}">
              <span>${state.wallet ? shortAddress(state.account) : 'Connect'}</span>
            </button>
          </div>
        </header>
        ${content}
      </main>
      ${state.modal ? modal(state.modal) : ''}
      ${state.toast ? `<div class="toast">${state.toast}</div>` : ''}
    </div>
  `;
}

function pageTitle() {
  if (state.screen === 'home') return 'Fission Protocol';
  if (state.screen === 'markets') return 'Available Markets';
  if (state.screen === 'strategy') return strategies[state.strategy].name;
  if (state.screen === 'admin') return 'Admin Console';
  return 'Encrypted Portfolio';
}

function shortAddress(address) {
  if (!address) return 'Connected';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function screenHome() {
  return `
    <section class="home-stack">
      <div class="home-hero">
        <div>
          <span class="status-pill">Nox confidential tokens · encrypted SY/PT/YT balances</span>
          <h2>Pendle made yield tradable. Fission makes it private.</h2>
          <p>Fission lets users deposit into a real yield source, mint confidential SY, split it into confidential PT and YT, then trade both sides through an encrypted AMM without exposing position size, fills, or strategy.</p>
          <div class="confidential-strip">
            <span>Encrypted inputs</span>
            <span>Confidential balances</span>
            <span>Private AMM fills</span>
          </div>
          <div class="cta-row">
            <button class="primary" data-modal="connect">Enter app</button>
            <button class="secondary" data-modal="how">How markets work</button>
          </div>
        </div>
        <div class="market-machine">
          <div class="machine-node">USDC</div>
          <div class="machine-path"></div>
          <div class="machine-node yellow">SY</div>
          <div class="machine-split">
            <div>PT</div>
            <div>YT</div>
          </div>
          <div class="machine-amm">Private AMM</div>
        </div>
      </div>

      <div class="section-head">
        <p class="eyebrow">How it works</p>
        <h3>Three pieces, one private market</h3>
      </div>
      <div class="how-grid">
        <article>
          <b>1. Mint SY</b>
          <p>USDC is routed into the Aave-backed reserve and represented as confidential SY inside Fission using Nox handles.</p>
        </article>
        <article>
          <b>2. Split yield</b>
          <p>Confidential SY can be split into encrypted PT for principal exposure and encrypted YT for future yield exposure.</p>
        </article>
        <article>
          <b>3. Trade privately</b>
          <p>Users buy, swap, and sell PT/YT through an AMM while balances, amounts, and fills stay confidential.</p>
        </article>
      </div>

      <div class="section-head">
        <p class="eyebrow">Strategies</p>
        <h3>Choose how you want yield exposure</h3>
      </div>
      <div class="strategy-grid public">
        ${strategyCards(false)}
      </div>
    </section>
  `;
}

function screenMarkets() {
  return `
    <section class="markets-stack">
      ${markets.map((market) => `
        <div class="market-card-large">
          <div>
            <span class="status-pill">${market.status} · ${market.source}</span>
            <h2>${market.name}</h2>
            <p>One deployed confidential Pendle-style market backed by Aave USDC. Mint encrypted SY, then open the PT, YT, or PT + YT strategy screen to trade through the on-chain confidential AMM.</p>
            <div class="cta-row">
              <button class="primary" data-screen="strategy">Open market</button>
              <button class="secondary" data-modal="mint">Mint SY</button>
            </div>
          </div>
          <div class="market-metrics">
            ${metric('Market contract', shortAddress(market.market), 'deployed')}
            ${metric('Aave adapter', shortAddress(market.adapter), 'USDC reserve')}
            ${metric('Maturity', maturityLabel(), isMatured() ? 'matured' : 'pre-maturity')}
          </div>
        </div>
      `).join('')}
    </section>
  `;
}

function strategyCards(clickable) {
  return Object.entries(strategies).map(([id, item]) => `
    <article class="strategy-card ${state.strategy === id ? 'selected' : ''}" ${clickable ? `data-strategy="${id}"` : ''}>
      <div class="mini-chart ${item.color}">
        <span></span><span></span><span></span><span></span>
      </div>
      <p class="eyebrow">${item.route}</p>
      <h4>${item.name}</h4>
      <p>${item.short}</p>
      <div class="strategy-meta">
        <span>${item.execution}</span>
        <span>${item.price}</span>
      </div>
      ${clickable ? '<button class="ghost">Open strategy</button>' : ''}
    </article>
  `).join('');
}

function screenStrategy() {
  const item = strategies[state.strategy];
  const actions = state.strategy === 'pair' ? ['buy', 'sell'] : ['buy', 'sell'];
  if (!actions.includes(state.action)) state.action = 'buy';
  const actionDisabled = isMatured() && state.strategy !== 'pt';
  const inputKind = swapInputKind();
  const noInputBalance = state.account && inputKind && !isInputKindReady(inputKind);
  const inputKindLabel = inputKind === 'pt+yt' ? 'PT and YT' : inputTokenFor(item);
  return `
    <section class="strategy-detail">
      <div class="detail-hero">
        <div>
          <span class="status-pill">${item.route} · Aave USDC 30D</span>
          <h2>${item.title}</h2>
          <p>${item.thesis}</p>
          <div class="detail-tabs">
            ${Object.entries(strategies).map(([id, tab]) => `
              <button class="${state.strategy === id ? 'active' : ''}" data-strategy="${id}">${tab.name}</button>
            `).join('')}
          </div>
        </div>
        <div class="detail-stats">
          ${metric('Execution', item.execution)}
          ${metric('Quote', item.price)}
          ${metric('Risk profile', item.risk)}
        </div>
      </div>

      <div class="strategy-main">
        <div class="panel">
          <div class="panel-head">
            <div>
              <p class="eyebrow">Chart</p>
          <h3>${item.name} payoff schematic</h3>
        </div>
        <button class="ghost" data-modal="chart">Chart details</button>
          </div>
          ${bigChart(state.strategy)}
        </div>

        <div class="panel trade-ticket">
          <div class="panel-head">
            <div>
              <p class="eyebrow">Confidential AMM ticket</p>
              <h3>Buy / swap / sell</h3>
            </div>
          </div>
          <div class="privacy-note">
            <b>Nox encryption active</b>
            <span>Input amount, output amount, and resulting balance are stored as encrypted handles.</span>
          </div>
          <div class="segmented compact">
            ${actions.map((action) => `
              <button class="${state.action === action ? 'active' : ''}" data-action-tab="${action}">${action}</button>
            `).join('')}
          </div>
          ${amountInput('Encrypted input', state.amount, inputTokenFor(item), 'amount')}
          <div class="swap-arrow">↓</div>
          <div class="amount-box output">
            <span>Private output</span>
            <div>
              <strong>Encrypted fill</strong>
              <b>${outputTokenFor(item)}</b>
            </div>
          </div>
          ${state.strategy !== 'pair' ? amountInput('Min output (slippage guard, encrypted)', state.minOut, outputTokenFor(item), 'minOut') : ''}
          ${noInputBalance ? `
            <div class="privacy-note" style="background:#3a1818;border-color:#a02828;color:#ffb0b0">
              <b>No ${inputKindLabel} balance yet</b>
              <span>${inputKind === 'sy' ? 'Mint SY first via the Markets screen.' : inputKind === 'pt+yt' ? 'Fission SY into PT+YT first (PT strategy → buy with SY).' : `Buy ${item.token} first or fission SY for it.`}</span>
            </div>
          ` : ''}
          <button class="primary full" ${actionDisabled || noInputBalance ? 'disabled' : 'data-modal="trade"'}>
            ${actionDisabled ? 'Market matured · use redeem' : noInputBalance ? `Need ${inputKindLabel} first` : `${state.action} with confidential AMM`}
          </button>
          ${isMatured() && state.strategy === 'pt' ? '<button class="secondary full" data-modal="redeem-pt">Redeem PT 1:1 for SY</button>' : ''}
          ${isMatured() && state.strategy === 'yt' ? renderYTRedeemControls() : ''}
          <button class="ghost full" data-modal="redeem-sy">Redeem SY for USDC</button>
          ${state.strategy === 'pt' && !isMatured() ? '<button class="ghost full" data-modal="lp-add">Add SY/PT liquidity</button>' : ''}
          ${state.strategy === 'pt' && !isMatured() ? '<button class="ghost full" data-modal="lp-remove">Remove SY/PT liquidity</button>' : ''}
          ${state.strategy === 'yt' && !isMatured() ? '<button class="ghost full" data-modal="lp-add-yt">Add SY/YT liquidity</button>' : ''}
          ${state.strategy === 'yt' && !isMatured() ? '<button class="ghost full" data-modal="lp-remove-yt">Remove SY/YT liquidity</button>' : ''}
          ${state.txStatus ? `<div class="tx-status">${state.txStatus}</div>` : ''}
        </div>
      </div>

      <div class="panel wide">
        <div class="panel-head">
          <div>
            <p class="eyebrow">Strategy mechanics</p>
            <h3>What the user is betting on</h3>
          </div>
        </div>
        <div class="mechanics-grid">
          <div><b>Entry</b><span>${item.route}</span></div>
          <div><b>Position token</b><span>${item.token}</span></div>
          <div><b>Confidentiality</b><span>Nox handles for amounts, balances, fills</span></div>
          <div><b>Exit</b><span>AMM sell or maturity redeem</span></div>
        </div>
      </div>
    </section>
  `;
}

function screenAdmin() {
  if (!state.isAdmin) {
    return `
      <section class="portfolio-grid">
        <div class="panel balance-panel">
          <p class="eyebrow">Admin only</p>
          <h3>Connected wallet is not the market owner</h3>
          <p>Switch to the deployer wallet to access admin controls.</p>
        </div>
      </section>
    `;
  }

  const yield_ = state.yieldStatus;
  const usdcDecimals = 6;
  const formatUsdc = (raw) => {
    const v = BigInt(raw || 0);
    const whole = v / 10n ** BigInt(usdcDecimals);
    const frac = v % 10n ** BigInt(usdcDecimals);
    return `${whole.toLocaleString()}.${frac.toString().padStart(usdcDecimals, '0').slice(0, 2)}`;
  };

  // After the privacy refactor, snapshot folds yield into principalDeposited and YT yield is
  // claimed end-to-end encrypted via redeemYTToSY. There is no public per-claim distribution
  // counter to display.

  return `
    <section class="portfolio-grid">
      <div class="panel balance-panel">
        <div class="panel-head">
          <div>
            <p class="eyebrow">Aave-side accounting</p>
            <h3>Principal vs. yield</h3>
          </div>
        </div>
        <div class="position-list">
          <div class="position-row">
            <div><b>Principal deposited</b><small>USDC supplied via mintSY, net of redemptions</small></div>
            <strong>${formatUsdc(state.principalDeposited)}</strong>
            <span>USDC</span>
          </div>
          <div class="position-row">
            <div><b>Snapshot taken</b><small>${yield_?.taken ? 'Yes' : 'Not yet — call snapshotMaturity post-maturity'}</small></div>
            <strong>${yield_?.taken ? 'YES' : 'NO'}</strong>
            <span>—</span>
          </div>
          <div class="position-row">
            <div><b>Snapshotted yield</b><small>Total user yield at maturity</small></div>
            <strong>${yield_?.taken ? formatUsdc(yield_.total) : '—'}</strong>
            <span>USDC</span>
          </div>
          <div class="position-row">
            <div><b>Yield routing</b><small>Snapshot folds yield into principal; YT claims mint encrypted SY (no public payout)</small></div>
            <strong>${yield_?.taken ? 'Encrypted' : '—'}</strong>
            <span></span>
          </div>
        </div>
      </div>

      <div class="panel exposure-panel">
        <p class="eyebrow">Encrypted AMM liquidity top-up</p>
        <h3>addAmmLiquidity</h3>
        <p>Mint encrypted SY/PT/YT to the AMM reserve. Owner-only. Caller's input is encrypted before submission.</p>
        <div class="segmented compact">
          ${['sy', 'pt', 'yt'].map((r) => `
            <button class="${state.adminAmmReserve === r ? 'active' : ''}" data-admin-reserve="${r}">${r.toUpperCase()}</button>
          `).join('')}
        </div>
        ${amountInput('Amount (1e18-scale)', state.adminAmmAmount, state.adminAmmReserve.toUpperCase(), 'adminAmmAmount')}
        <button class="primary full" data-modal-action="admin-add-liquidity">Submit AMM top-up</button>
        ${state.txStatus ? `<div class="tx-status">${state.txStatus}</div>` : ''}
      </div>

      <div class="panel exposure-panel">
        <p class="eyebrow">Aave yield harvest</p>
        <h3>harvestAaveYield</h3>
        <p>Sweep USDC out of the Aave-side surplus. Bounded so it cannot dip into user principal or unclaimed YT yield.</p>
        ${amountInput('USDC to harvest', state.adminHarvestAmount, 'USDC', 'adminHarvestAmount')}
        <button class="primary full" data-modal-action="admin-harvest">Harvest yield</button>
      </div>

      <div class="panel">
        <p class="eyebrow">Pending SY redemptions</p>
        <h3>${state.pendingRedeems.length} open</h3>
        ${state.pendingRedeems.length === 0
          ? '<p>No open redemption tickets for this account.</p>'
          : `<div class="position-list">
              ${state.pendingRedeems.map((r) => `
                <div class="position-row">
                  <div><b>SY redemption</b><small>id ${r.id}${r.requestBlockTime ? ` · settle from ${new Date((r.requestBlockTime + 300) * 1000).toLocaleTimeString()}` : ''}</small></div>
                  <strong>${formatUsdc(BigInt(r.clearUsdc) * 1n)}</strong>
                  <span>USDC</span>
                </div>
              `).join('')}
            </div>`
        }
      </div>
    </section>
  `;
}

function renderYTRedeemControls() {
  const status = state.yieldStatus;
  if (!status) return '';
  if (!status.taken) {
    return '<button class="secondary full" data-modal-action="snapshot-maturity">Snapshot maturity yield</button>';
  }
  return '<button class="secondary full" data-modal="redeem-yt">Claim YT yield (encrypted SY)</button>';
}

function bigChart(kind) {
  const bars = kind === 'pt'
    ? [36, 42, 48, 56, 62, 70, 82]
    : kind === 'yt'
      ? [82, 74, 68, 54, 60, 72, 88]
      : [46, 56, 50, 68, 62, 76, 72];
  return `
    <div class="big-chart ${kind}">
      <div class="chart-grid"></div>
      <div class="chart-line"></div>
      <div class="chart-bars">
        ${bars.map((height) => `<span style="height:${height}%"></span>`).join('')}
      </div>
      <div class="chart-axis">
        <span>Entry</span>
        <span>Mid</span>
        <span>Maturity</span>
      </div>
    </div>
  `;
}

function inputTokenFor(item) {
  if (state.action === 'buy') return 'SY-USDC';
  if (state.action === 'sell') return item.token;
  return item.token === 'PT + YT' ? 'PT-USDC' : item.token;
}

/**
 * Map (strategy, action) to the vault-kind name(s) the user spends on the input side. The trade
 * button is gated when any required kind is uninitialised (would revert with ZeroBalance).
 */
function swapInputKind() {
  if (state.strategy === 'pair' && state.action === 'sell') return 'pt+yt';
  if (state.action === 'buy') return 'sy';
  if (state.strategy === 'pt') return 'pt';
  if (state.strategy === 'yt') return 'yt';
  if (state.strategy === 'pair') return 'sy';
  return null;
}

function isInputKindReady(kind) {
  if (kind === 'pt+yt') return state.initialised.pt && state.initialised.yt;
  return state.initialised[kind];
}

function outputTokenFor(item) {
  if (state.action === 'buy') return item.token;
  if (state.action === 'sell') return 'SY-USDC';
  return item.token === 'PT + YT' ? 'YT-USDC' : 'SY-USDC';
}

function amountInput(label, value, token, key) {
  return `
    <label class="amount-box">
      <span>${label}</span>
      <div>
        <input value="${value}" data-input="${key}" inputmode="decimal" />
        <b>${token}</b>
      </div>
    </label>
  `;
}

const ALLOWED_DENOMINATIONS = ['1', '10', '100', '1000', '10000'];

function denominationPicker(label, value, token, key) {
  return `
    <div class="amount-box">
      <span>${label}</span>
      <div class="segmented compact" style="margin-top:8px">
        ${ALLOWED_DENOMINATIONS.map((d) => `
          <button class="${value === d ? 'active' : ''}" data-denom-key="${key}" data-denom-value="${d}">${Number(d).toLocaleString()} ${token}</button>
        `).join('')}
      </div>
      <small style="display:block;margin-top:6px;opacity:0.7">Anonymity-set bucket. Split larger notional into multiple denominated mints.</small>
    </div>
  `;
}

function screenPortfolio() {
  const balances = state.portfolio
    ? [
        ['SY-USDC', formatEncryptedBalance(state.portfolio.sy), 'Confidential Aave-backed yield base'],
        ['PT-USDC-30D', formatEncryptedBalance(state.portfolio.pt), 'Encrypted principal exposure'],
        ['YT-USDC-30D', formatEncryptedBalance(state.portfolio.yt), 'Encrypted future yield exposure'],
        ['LP-SY-PT-30D', formatEncryptedBalance(state.portfolio.lpSyPt), 'SY/PT pool LP share'],
        ['LP-SY-YT-30D', formatEncryptedBalance(state.portfolio.lpSyYt), 'SY/YT pool LP share']
      ]
    : [
        ['SY-USDC', 'Encrypted handle', 'Decrypt with your wallet to view'],
        ['PT-USDC-30D', 'Encrypted handle', 'Decrypt with your wallet to view'],
        ['YT-USDC-30D', 'Encrypted handle', 'Decrypt with your wallet to view'],
        ['LP-SY-PT-30D', 'Encrypted handle', 'Decrypt with your wallet to view'],
        ['LP-SY-YT-30D', 'Encrypted handle', 'Decrypt with your wallet to view']
      ];

  return `
    <section class="portfolio-grid">
      <div class="panel balance-panel">
        <div class="panel-head">
          <div>
            <p class="eyebrow">User-decrypted confidential balances</p>
            <h3>Private balances</h3>
          </div>
          <button class="ghost" data-modal="decrypt">Decrypt</button>
        </div>
        <div class="position-list">
          ${balances.map(([token, amount, note]) => `
            <div class="position-row">
              <div><b>${token}</b><small>${note}</small></div>
              <strong>${amount}</strong>
              <span>${state.portfolio ? 'Decrypted locally' : 'Encrypted'}</span>
            </div>
          `).join('')}
        </div>
        ${state.txStatus ? `<div class="tx-status">${state.txStatus}</div>` : ''}
      </div>
      <div class="panel exposure-panel">
        <p class="eyebrow">Confidentiality</p>
        <h3>Only wallet-authorized balance reads</h3>
        <div class="privacy-stack">
          <span>SY/PT/YT balances stay as Nox handles on-chain.</span>
          <span>Decryption happens through the connected wallet.</span>
          <span>No public portfolio totals are shown.</span>
        </div>
      </div>
    </section>
  `;
}

function modal(type) {
  const copy = {
    connect: ['Connect wallet', 'Connect to Arbitrum Sepolia to see available markets, choose PT/YT strategies, and trade through the private AMM.', 'Connect wallet', 'connect'],
    account: ['Account', `${shortAddress(state.account)} is connected${state.isAdmin ? ' as MARKET OWNER' : ''}. Network: ${state.chainId === EXPECTED_CHAIN_ID ? 'Arbitrum Sepolia ✓' : `chainId ${state.chainId ?? 'unknown'} ✗`}.`, 'Disconnect', 'disconnect'],
    privacy: ['Confidentiality controls', `Fission encrypts strategy balances, swap input amounts, AMM outputs, and PT/YT position sizes with Nox handles. Relay mode is ${state.useRelay ? 'ON' : 'OFF'} — when on, the wallet signs an EIP-712 intent and the same wallet submits, so the privacy benefit only shows once a separate relayer wallet is wired.`, 'Toggle relay mode', 'toggle-relay'],
    how: ['How Fission markets work', 'USDC enters a yield source and becomes confidential SY. SY can be split into encrypted PT and YT. PT targets fixed principal redemption; YT isolates variable future yield. Both trade through a confidential AMM.', 'Enter app', 'connect'],
    chart: ['Chart details', 'The chart is a strategy payoff schematic. Live swap execution is handled by the deployed confidential AMM without exposing public quote previews.', 'Close', 'close'],
    mint: ['Mint confidential SY', 'Approve USDC to the deployed Aave adapter, then mint confidential SY into the Fission market. The USDC deposit is public; the resulting SY balance is confidential.', 'Approve + mint SY', 'tx'],
    trade: ['Confidential AMM trade', 'Your trade amount is encrypted before submission. A 30 bps fee accrues to LPs. If the encrypted fill falls below your slippage minimum the input is refunded — both branches execute as encrypted no-ops so observers cannot tell which path ran.', 'Confirm trade', 'tx'],
    decrypt: ['Decrypt balances', 'Request a gasless Nox decryption for your SY, PT, and YT handles. Only this wallet can read them.', 'Decrypt now', 'tx'],
    'redeem-pt': ['Redeem PT for SY', 'After maturity, every PT redeems 1:1 for confidential SY. Both legs stay encrypted; only the fact a redemption occurred is public.', 'Redeem PT', 'tx'],
    'redeem-sy': ['Redeem SY for USDC', 'Step 1 burns your confidential SY and stakes a Nox attestation that the burn matched the requested USDC amount. Step 2 settles the redemption once the Nox network signs the attestation. The USDC amount you redeem is public — converting back to a public asset reveals that exit size.', 'Submit redeem request', 'tx'],
    'redeem-yt': ['Claim YT yield privately', 'Burn YT and receive an equivalent amount of *encrypted* SY corresponding to your pro-rata yield share. There is no public per-claim payout — yield amount stays encrypted. Exit via the SY → USDC bucket redeem when ready.', 'Claim yield as encrypted SY', 'tx'],
    'lp-add': ['Add SY/PT liquidity', 'Deposit encrypted SY and PT into the AMM in any ratio; the contract mints LP proportional to the limiting side and refunds the over-supplied side. LP tokens accrue swap-fee value as the pool grows.', 'Add liquidity', 'tx'],
    'lp-remove': ['Remove SY/PT liquidity', 'Burn LP tokens to withdraw a proportional share of the SY and PT reserves at the current pool ratio. All amounts stay encrypted.', 'Remove liquidity', 'tx'],
    'lp-add-yt': ['Add SY/YT liquidity', 'Deposit encrypted SY and YT into the AMM. Same ratio-aware mint logic as the SY/PT pool.', 'Add liquidity', 'tx'],
    'lp-remove-yt': ['Remove SY/YT liquidity', 'Burn LP tokens to withdraw a proportional share of the SY and YT reserves.', 'Remove liquidity', 'tx']
  }[type];

  return `
    <div class="modal-backdrop">
      <div class="modal">
        <button class="modal-close" data-close aria-label="Close">×</button>
        <div class="modal-icon">◈</div>
        <h2>${copy[0]}</h2>
        <p>${copy[1]}</p>
        ${type === 'mint' ? denominationPicker('USDC denomination', state.mintAmount, 'USDC', 'mintAmount') : ''}
        ${type === 'redeem-pt' ? amountInput('PT amount', state.redeemPtAmount, 'PT-USDC-30D', 'redeemPtAmount') : ''}
        ${type === 'redeem-sy' ? denominationPicker('USDC denomination', state.redeemUsdcAmount, 'USDC', 'redeemUsdcAmount') : ''}
        ${type === 'redeem-sy' && state.pendingRedeem ? `<div class="privacy-stack compact"><span>Pending request id ${state.pendingRedeem.id}</span><span>Settle once the Nox attestation is fetched.</span></div>` : ''}
        ${type === 'redeem-yt' ? amountInput('YT amount', state.redeemYtAmount, 'YT-USDC-30D', 'redeemYtAmount') : ''}
        ${type === 'lp-add' ? amountInput('SY amount', state.lpSyAmount, 'SY-USDC', 'lpSyAmount') : ''}
        ${type === 'lp-add' ? amountInput('PT amount', state.lpPtAmount, 'PT-USDC-30D', 'lpPtAmount') : ''}
        ${type === 'lp-remove' ? amountInput('LP amount', state.lpRemoveAmount, 'LP-SY-PT', 'lpRemoveAmount') : ''}
        ${type === 'lp-add-yt' ? amountInput('SY amount', state.lpSyAmount, 'SY-USDC', 'lpSyAmount') : ''}
        ${type === 'lp-add-yt' ? amountInput('YT amount', state.lpYtAmount, 'YT-USDC-30D', 'lpYtAmount') : ''}
        ${type === 'lp-remove-yt' ? amountInput('LP amount', state.lpRemoveAmount, 'LP-SY-YT', 'lpRemoveAmount') : ''}
        ${type === 'redeem-yt' ? `<div class="privacy-stack compact"><span>YT yield → encrypted SY</span><span>No public payout. Exit later via SY redeem (1, 10, 100, 1k, 10k USDC buckets).</span></div>` : ''}
        ${type === 'trade' ? `<div class="privacy-stack compact"><span>${tradeRouteLabel()}</span><span>Amount encrypted before contract execution.</span></div>` : ''}
        ${state.txStatus ? `<div class="tx-status">${state.txStatus}</div>` : ''}
        <div class="modal-actions">
          <button class="secondary" data-close>Cancel</button>
          ${type === 'redeem-sy' && state.pendingRedeem ? '<button class="primary" data-modal-action="settle-redeem">Settle redemption</button>' : `<button class="primary" data-modal-action="${copy[3]}">${copy[2]}</button>`}
        </div>
      </div>
    </div>
  `;
}

function render() {
  const content = state.screen === 'home'
    ? screenHome()
    : state.screen === 'markets'
      ? screenMarkets()
      : state.screen === 'strategy'
        ? screenStrategy()
        : state.screen === 'admin'
          ? screenAdmin()
          : screenPortfolio();

  app.innerHTML = shell(content);

  document.querySelectorAll('[data-screen]').forEach((el) => {
    el.addEventListener('click', () => setScreen(el.dataset.screen));
  });
  document.querySelectorAll('[data-modal]').forEach((el) => {
    el.addEventListener('click', () => openModal(el.dataset.modal));
  });
  document.querySelectorAll('[data-close]').forEach((el) => {
    el.addEventListener('click', closeModal);
  });
  document.querySelectorAll('[data-modal-action]').forEach((el) => {
    el.addEventListener('click', async () => {
      if (el.dataset.modalAction === 'connect') connectWallet();
      if (el.dataset.modalAction === 'close') closeModal();
      if (el.dataset.modalAction === 'tx') {
        await executeModalTransaction();
      }
      if (el.dataset.modalAction === 'settle-redeem') {
        await settlePendingRedeem();
      }
      if (el.dataset.modalAction === 'snapshot-maturity') {
        await runSnapshotMaturity();
      }
      if (el.dataset.modalAction === 'admin-add-liquidity') {
        await runAdminAddAmmLiquidity();
      }
      if (el.dataset.modalAction === 'admin-harvest') {
        await runAdminHarvest();
      }
      if (el.dataset.modalAction === 'toggle-relay') {
        state.useRelay = !state.useRelay;
        persistSession();
        toast(`Relay mode ${state.useRelay ? 'ON' : 'OFF'}`);
        render();
      }
      if (el.dataset.modalAction === 'switch-chain') {
        try {
          await switchToArbitrumSepolia();
        } catch (e) {
          toast(e.message || 'Network switch failed');
        }
      }
      if (el.dataset.modalAction === 'disconnect') {
        state.wallet = false;
        state.account = '';
        state.portfolio = null;
        state.pendingRedeem = null;
        state.pendingRedeems = [];
        state.modal = null;
        state.screen = 'home';
        clearSession();
        toast('Disconnected');
        render();
      }
    });
  });
  document.querySelectorAll('[data-admin-reserve]').forEach((el) => {
    el.addEventListener('click', (event) => {
      event.preventDefault();
      state.adminAmmReserve = el.dataset.adminReserve;
      render();
    });
  });
  document.querySelectorAll('[data-strategy]').forEach((el) => {
    el.addEventListener('click', () => chooseStrategy(el.dataset.strategy));
  });
  document.querySelectorAll('[data-action-tab]').forEach((el) => {
    el.addEventListener('click', () => {
      state.action = el.dataset.actionTab;
      render();
    });
  });
  document.querySelectorAll('[data-denom-key]').forEach((el) => {
    el.addEventListener('click', (event) => {
      event.preventDefault();
      state[el.dataset.denomKey] = el.dataset.denomValue;
      render();
    });
  });
  document.querySelectorAll('[data-input]').forEach((input) => {
    input.addEventListener('input', () => {
      state[input.dataset.input] = input.value;
    });
  });
}

function modalActionLabel(modal) {
  return ({
    'mint': 'mint SY',
    'trade': 'trade',
    'decrypt': 'decrypt',
    'redeem-pt': 'redeem PT',
    'redeem-sy': 'redeem SY → USDC',
    'redeem-yt': 'claim YT yield',
    'lp-add': 'add SY/PT liquidity',
    'lp-remove': 'remove SY/PT liquidity',
    'lp-add-yt': 'add SY/YT liquidity',
    'lp-remove-yt': 'remove SY/YT liquidity'
  })[modal] || 'continue';
}

async function ensureChainOrAbort(actionLabel) {
  // Centralised chain guard. Every modal that fires a wallet popup goes through here so
  // signing on the wrong network is caught before MetaMask asks the user to confirm.
  if (state.chainId === EXPECTED_CHAIN_ID) return true;
  try {
    state.txStatus = `Switching to Arbitrum Sepolia before ${actionLabel}...`;
    render();
    await switchToArbitrumSepolia();
    state.chainId = await readChainId();
    if (state.chainId !== EXPECTED_CHAIN_ID) {
      state.modal = null;
      state.txStatus = '';
      toast(`Switch to Arbitrum Sepolia to ${actionLabel}`);
      render();
      return false;
    }
    return true;
  } catch (err) {
    state.modal = null;
    state.txStatus = '';
    toast(err.shortMessage || err.message || `Switch chain to ${actionLabel}`);
    render();
    return false;
  }
}

async function executeModalTransaction() {
  const modal = state.modal;
  try {
    if (!(await ensureChainOrAbort(modalActionLabel(modal)))) return;
    if (modal === 'mint') {
      if (!state.hasUsdcApproval) {
        state.txStatus = 'One-time max approval of USDC to the Aave adapter...';
        render();
        const approveHash = await approveUSDC();
        state.hasUsdcApproval = true;
        state.txStatus = `Approval submitted: ${shortHash(approveHash)}. Minting confidential SY...`;
        render();
      } else {
        state.txStatus = 'Minting confidential SY...';
        render();
      }
      const mintHash = await mintSY(state.mintAmount);
      state.modal = null;
      state.txStatus = '';
      toast(`SY mint submitted: ${shortHash(mintHash)}`);
      return;
    }

    if (modal === 'trade') {
      state.txStatus = 'Encrypting amount with Nox and submitting AMM transaction...';
      render();
      const txHash = await executeStrategyTransaction();
      state.modal = null;
      state.txStatus = '';
      toast(`Confidential trade submitted: ${shortHash(txHash)}`);
      return;
    }

    if (modal === 'decrypt') {
      state.txStatus = 'Requesting wallet-authorized Nox balance decryption...';
      render();
      state.portfolio = await decryptPortfolio(state.account);
      state.modal = null;
      state.txStatus = '';
      persistSession();
      toast('Balances decrypted locally');
      return;
    }

    if (modal === 'redeem-pt') {
      state.txStatus = 'Encrypting PT amount and submitting redeem...';
      render();
      const txHash = await runRedeemPT(state.redeemPtAmount);
      state.modal = null;
      state.txStatus = '';
      toast(`PT redeemed for SY: ${shortHash(txHash)}`);
      return;
    }

    if (modal === 'redeem-sy') {
      state.txStatus = 'Burning encrypted SY and staking attestation...';
      render();
      const ticket = await requestSYRedeem(state.redeemUsdcAmount);
      state.pendingRedeem = ticket;
      state.txStatus = `Burn submitted: ${shortHash(ticket.txHash)}. Settle once attestation is signed.`;
      render();
      return;
    }

    if (modal === 'redeem-yt') {
      state.txStatus = 'Burning encrypted YT and minting encrypted SY for the yield share...';
      render();
      const txHash = state.useRelay
        ? await submitRelayedRedeemYTToSY(await signRelayedRedeemYTToSY(state.redeemYtAmount))
        : await redeemYTToSY(state.redeemYtAmount);
      state.modal = null;
      state.txStatus = '';
      toast(`Yield routed to encrypted SY: ${shortHash(txHash)}. Exit via SY → USDC bucket redeem.`);
      // Refresh balance handles so the new SY shows up.
      refreshBalanceHandles();
      return;
    }

    if (modal === 'lp-add') {
      state.txStatus = 'Encrypting SY+PT and adding liquidity...';
      render();
      const txHash = await addLiquiditySYPT(state.lpSyAmount, state.lpPtAmount);
      state.modal = null;
      state.txStatus = '';
      toast(`LP added: ${shortHash(txHash)}`);
      return;
    }

    if (modal === 'lp-remove') {
      state.txStatus = 'Encrypting LP and removing liquidity...';
      render();
      const txHash = await removeLiquiditySYPT(state.lpRemoveAmount);
      state.modal = null;
      state.txStatus = '';
      toast(`LP removed: ${shortHash(txHash)}`);
      return;
    }

    if (modal === 'lp-add-yt') {
      state.txStatus = 'Encrypting SY+YT and adding liquidity...';
      render();
      const txHash = await addLiquiditySYYT(state.lpSyAmount, state.lpYtAmount);
      state.modal = null;
      state.txStatus = '';
      toast(`LP added: ${shortHash(txHash)}`);
      return;
    }

    if (modal === 'lp-remove-yt') {
      state.txStatus = 'Encrypting LP and removing SY/YT liquidity...';
      render();
      const txHash = await removeLiquiditySYYT(state.lpRemoveAmount);
      state.modal = null;
      state.txStatus = '';
      toast(`LP removed: ${shortHash(txHash)}`);
      return;
    }
  } catch (error) {
    state.txStatus = error.shortMessage || error.message || 'Transaction failed';
    render();
  }
}

async function settlePendingRedeem() {
  if (!state.pendingRedeem) return;
  if (!(await ensureChainOrAbort('settle redemption'))) return;
  try {
    state.txStatus = 'Fetching Nox attestation and settling redemption...';
    render();
    const txHash = await settleSYRedeem(state.pendingRedeem);
    const settled = state.pendingRedeem;
    state.pendingRedeem = null;
    state.pendingRedeems = state.pendingRedeems.filter((r) => String(r.id) !== String(settled.id));
    state.modal = null;
    state.txStatus = '';
    toast(`USDC redeemed (${settled.clearUsdc}): ${shortHash(txHash)}`);
  } catch (error) {
    state.txStatus = error.shortMessage || error.message || 'Settle failed';
    render();
  }
}

async function runAdminAddAmmLiquidity() {
  if (!state.isAdmin) return;
  if (!(await ensureChainOrAbort('top up AMM'))) return;
  try {
    state.txStatus = `Encrypting ${state.adminAmmAmount} ${state.adminAmmReserve.toUpperCase()} and topping up reserve...`;
    render();
    const txHash = await adminAddAmmLiquidity(state.adminAmmReserve, state.adminAmmAmount);
    state.txStatus = '';
    toast(`AMM liquidity added: ${shortHash(txHash)}`);
    render();
  } catch (error) {
    state.txStatus = error.shortMessage || error.message || 'AMM top-up failed';
    render();
  }
}

async function runAdminHarvest() {
  if (!state.isAdmin) return;
  if (!(await ensureChainOrAbort('harvest yield'))) return;
  try {
    state.txStatus = `Harvesting ${state.adminHarvestAmount} USDC of yield...`;
    render();
    const txHash = await adminHarvestAaveYield(state.account, state.adminHarvestAmount);
    state.txStatus = '';
    toast(`Yield harvested: ${shortHash(txHash)}`);
    readMaturityYieldStatus().then((s) => { state.yieldStatus = s; render(); }).catch(() => {});
    readPrincipalDeposited().then((p) => { state.principalDeposited = p; render(); }).catch(() => {});
  } catch (error) {
    state.txStatus = error.shortMessage || error.message || 'Harvest failed';
    render();
  }
}

async function runSnapshotMaturity() {
  if (!(await ensureChainOrAbort('snapshot maturity'))) return;
  try {
    state.txStatus = 'Snapshotting maturity yield...';
    render();
    const txHash = await snapshotMaturity();
    state.txStatus = '';
    toast(`Snapshot submitted: ${shortHash(txHash)}`);
    readMaturityYieldStatus().then((s) => { state.yieldStatus = s; render(); }).catch(() => {});
  } catch (error) {
    state.txStatus = error.shortMessage || error.message || 'Snapshot failed';
    render();
  }
}

async function executeStrategyTransaction() {
  const route = swapRouteForCurrentState();
  if (state.strategy === 'pair') {
    if (state.action === 'buy') return runFission(state.amount);
    if (state.action === 'sell') return runCombine(state.amount);
    throw new Error('Unknown action');
  }
  if (!route) throw new Error('Unknown strategy');
  return runSwap(route, state.amount, state.minOut);
}

function swapRouteForCurrentState() {
  if (state.strategy === 'pt') return state.action === 'buy' ? 'syToPt' : 'ptToSy';
  if (state.strategy === 'yt') return state.action === 'buy' ? 'syToYt' : 'ytToSy';
  return null;
}

async function runFission(amount) {
  if (!state.useRelay) return fissionSY(amount);
  const intent = await signRelayedFission(amount);
  return submitRelayedFission(intent);
}

async function runCombine(amount) {
  if (!state.useRelay) return combinePTAndYT(amount);
  const intent = await signRelayedCombine(amount);
  return submitRelayedCombine(intent);
}

async function runSwap(route, amount, minOut) {
  if (!state.useRelay) return swapWithAmm(route, amount, minOut);
  const intent = await signRelayedSwap(route, amount, minOut);
  return submitRelayedSwap(intent);
}

async function runRedeemPT(amount) {
  if (!state.useRelay) return redeemPT(amount);
  const intent = await signRelayedRedeemPT(amount);
  return submitRelayedRedeemPT(intent);
}

function tradeRouteLabel() {
  const item = strategies[state.strategy];
  return `${state.action.toUpperCase()} ${item.route} with ${state.amount} ${inputTokenFor(item)}`;
}

function shortHash(hash) {
  if (!hash) return 'submitted';
  return `${hash.slice(0, 10)}...${hash.slice(-6)}`;
}

function formatEncryptedBalance(value) {
  try {
    const raw = BigInt(value);
    const whole = raw / 10n ** 18n;
    const fraction = (raw % 10n ** 18n).toString().padStart(18, '0').slice(0, 4).replace(/0+$/, '');
    return `${whole.toLocaleString()}${fraction ? `.${fraction}` : ''}`;
  } catch {
    return String(value);
  }
}

render();
// Re-attach to a previously connected wallet without prompting MetaMask. Hydrates portfolio,
// approval state, and chain ID from localStorage so refresh feels instant.
silentReconnect().catch(() => {});
