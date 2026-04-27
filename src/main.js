import './styles.css';

const strategies = {
  pt: {
    name: 'PT Strategy',
    route: 'SY -> PT',
    title: 'Lock fixed yield privately',
    short: 'Buy PT below par and redeem at maturity for SY. Your entry size, balance, and exit are encrypted.',
    thesis: 'Best when you want predictable yield and do not want the market to see how large your principal position is. Fission stores PT exposure as confidential Nox handles.',
    risk: 'Lower upside, maturity dependent',
    apy: '7.84%',
    price: '0.974 SY',
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
    apy: '14.62%',
    price: '0.082 SY',
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
    apy: 'Market neutral',
    price: '1.000 SY',
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
  amount: '1,000',
  slippage: 0.3
};

const markets = [
  {
    id: 'aave-usdc-30d',
    name: 'Aave USDC 30D',
    asset: 'USDC',
    source: 'Aave V3 Arbitrum Sepolia',
    maturity: 'May 27, 2026',
    tvl: '$284.6K',
    implied: '8.42%',
    status: 'Live'
  }
];

const navItems = [
  { id: 'home', label: 'Home', icon: '⌂' },
  { id: 'markets', label: 'Markets', icon: '⌁' },
  { id: 'strategy', label: 'Strategy', icon: '◇' },
  { id: 'portfolio', label: 'Portfolio', icon: '◐' }
];

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
  render();
}

function closeModal() {
  state.modal = null;
  render();
}

function connectWallet() {
  state.wallet = true;
  state.screen = 'markets';
  state.modal = null;
  toast('Wallet connected. Private markets unlocked.');
  resetScroll();
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
  return `
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
          ${navItems.map((item) => `
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
              <span>${state.wallet ? '0x7d4...90f2' : 'Connect'}</span>
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
  return 'Encrypted Portfolio';
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
            <p>One confidential Pendle-style market backed by Aave USDC. Mint encrypted SY, split into confidential PT/YT, then trade any strategy through the AMM.</p>
          </div>
          <div class="market-metrics">
            ${metric('Confidential TVL', market.tvl, 'encrypted shares')}
            ${metric('Implied APY', market.implied, '+0.37%')}
            ${metric('Maturity', '30D', market.maturity)}
          </div>
        </div>
      `).join('')}

      <div class="section-head">
        <p class="eyebrow">Market strategies</p>
        <h3>Select PT, YT, or full strip</h3>
      </div>
      <div class="strategy-grid">
        ${strategyCards(true)}
      </div>
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
        <span>${item.apy}</span>
        <span>${item.price}</span>
      </div>
      ${clickable ? '<button class="ghost">Open strategy</button>' : ''}
    </article>
  `).join('');
}

function screenStrategy() {
  const item = strategies[state.strategy];
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
          ${metric('Strategy APY', item.apy)}
          ${metric('Market price', item.price)}
          ${metric('Risk profile', item.risk)}
        </div>
      </div>

      <div class="strategy-main">
        <div class="panel">
          <div class="panel-head">
            <div>
              <p class="eyebrow">Chart</p>
          <h3>${item.name} payoff and market price</h3>
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
            ${['buy', 'swap', 'sell'].map((action) => `
              <button class="${state.action === action ? 'active' : ''}" data-action-tab="${action}">${action}</button>
            `).join('')}
          </div>
          ${amountInput('Encrypted input', state.amount, inputTokenFor(item), 'amount')}
          <div class="swap-arrow">↓</div>
          <div class="amount-box output">
            <span>Estimated private output</span>
            <div>
              <strong>${estimateFor(state.strategy, state.action)}</strong>
              <b>${outputTokenFor(item)}</b>
            </div>
          </div>
          <div class="trade-settings">
            <label>
              <span>Slippage</span>
              <input type="range" min="0.1" max="1.5" step="0.1" value="${state.slippage}" data-range="slippage" />
              <b>${state.slippage}%</b>
            </label>
          </div>
          <button class="primary full" data-modal="trade">${state.action} with confidential AMM</button>
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

function outputTokenFor(item) {
  if (state.action === 'buy') return item.token;
  if (state.action === 'sell') return 'SY-USDC';
  return item.token === 'PT + YT' ? 'YT-USDC' : 'SY-USDC';
}

function estimateFor(strategy, action) {
  const table = {
    pt: { buy: '1,026.69', swap: '974.21', sell: '973.80' },
    yt: { buy: '12,184.20', swap: '81.74', sell: '82.06' },
    pair: { buy: '1,000.00', swap: '1,000.00', sell: '998.40' }
  };
  return table[strategy][action];
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

function screenPortfolio() {
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
          ${[
            ['SY-USDC', '12,480.00', 'Confidential Aave-backed yield base'],
            ['PT-USDC-30D', '8,100.00', 'Encrypted principal exposure'],
            ['YT-USDC-30D', '4,380.00', 'Encrypted future yield exposure']
          ].map(([token, amount, note]) => `
            <div class="position-row">
              <div><b>${token}</b><small>${note}</small></div>
              <strong>${amount}</strong>
              <span>Encrypted</span>
            </div>
          `).join('')}
        </div>
      </div>
      <div class="panel exposure-panel">
        <p class="eyebrow">Exposure</p>
        <h3>Principal vs yield</h3>
        <div class="donut"><span>65%</span></div>
        <div class="legend"><span>PT principal</span><span>YT yield</span></div>
      </div>
    </section>
  `;
}

function modal(type) {
  const copy = {
    connect: ['Connect wallet', 'Connect to Arbitrum Sepolia to see available markets, choose PT/YT strategies, and trade through the private AMM.', 'Connect wallet', 'connect'],
    account: ['Account', '0x7d4...90f2 is connected. Private portfolio decryption is available for this wallet.', 'Close', 'close'],
    privacy: ['Confidentiality controls', 'Fission encrypts strategy balances, swap input amounts, AMM outputs, and PT/YT position sizes with Nox handles. Only authorized viewers can decrypt.', 'Got it', 'close'],
    how: ['How Fission markets work', 'USDC enters a yield source and becomes confidential SY. SY can be split into encrypted PT and YT. PT targets fixed principal redemption; YT isolates variable future yield. Both trade through a confidential AMM.', 'Enter app', 'connect'],
    chart: ['Chart details', 'The chart combines payoff shape and market price movement for the selected strategy. In production this would read live pool and oracle data.', 'Close', 'close'],
    trade: ['Confidential AMM trade', 'Your trade amount is encrypted before submission. The AMM updates your confidential SY, PT, or YT balances after execution.', 'Confirm trade', 'tx'],
    decrypt: ['Decrypt balances', 'Request a gasless Nox decryption for your SY, PT, and YT handles. Only this wallet can read them.', 'Decrypt now', 'tx']
  }[type];

  return `
    <div class="modal-backdrop">
      <div class="modal">
        <button class="modal-close" data-close aria-label="Close">×</button>
        <div class="modal-icon">◈</div>
        <h2>${copy[0]}</h2>
        <p>${copy[1]}</p>
        <div class="modal-actions">
          <button class="secondary" data-close>Cancel</button>
          <button class="primary" data-modal-action="${copy[3]}">${copy[2]}</button>
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
    el.addEventListener('click', () => {
      if (el.dataset.modalAction === 'connect') connectWallet();
      if (el.dataset.modalAction === 'close') closeModal();
      if (el.dataset.modalAction === 'tx') {
        state.modal = null;
        toast('Private AMM transaction prepared');
      }
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
  document.querySelectorAll('[data-input]').forEach((input) => {
    input.addEventListener('input', () => {
      state[input.dataset.input] = input.value;
    });
  });
  document.querySelectorAll('[data-range]').forEach((input) => {
    input.addEventListener('input', () => {
      state[input.dataset.range] = input.value;
      render();
    });
  });
}

render();
