/**
 * 页面导航与生命周期管理
 */

const PAGE_TITLES = {
    dashboard: '市场速览',
    stocks: '基础数据',
    'data-init': '初始化数据',
    'data-update': '数据更新',
    selection: '选股结果',
    history: '历史选股',
    trading: '账户总览',
    positions: '持仓明细',
    transactions: '交易历史',
    strategies: '策略配置',
    analysis: '个股图谱',
    'stock-ranking': '选股排名',
    'ranking-track': '排名跟踪',
    'backtest-params': '回测配置',
    'backtest-config': '策略回测',
    'backtest-results': '回测结果',
    'backtest-history': '回测历史',
    khunter: '狩猎场',
    'khunter-track': '狩猎跟踪',
    'strategy-runner': '策略执行器'
};

let activePage = null;
let activeLifecycle = null;
let navigationController = null;
let transitionId = 0;
let transitionQueue = Promise.resolve();

function callWindowHook(name, ...args) {
    const hook = window[name];
    if (typeof hook !== 'function') {
        console.warn(`页面生命周期函数 ${name} 不存在`);
        return undefined;
    }
    return hook(...args);
}

const PAGE_LIFECYCLES = {
    dashboard: {
        async enter() {
            const stocks = await import('./stocks.js');
            await Promise.all([
                stocks.loadStats(),
                stocks.loadMyGoldenStocks(),
                stocks.loadHotIndustries(),
                stocks.loadHotAreas()
            ]);
        }
    },
    stocks: {
        async enter() {
            const stocks = await import('./stocks.js');
            await stocks.loadStocks();
        }
    },
    'data-init': {
        enter() {
            return callWindowHook('initDataInitPage');
        },
        leave() {
            return callWindowHook('cleanupDataInitPage');
        }
    },
    'data-update': {
        enter() {
            return callWindowHook('initDataUpdatePage');
        },
        leave() {
            return callWindowHook('cleanupDataUpdatePage');
        }
    },
    history: {
        async enter() {
            const [stocks, history] = await Promise.all([
                import('./stocks.js'),
                import('./history.js')
            ]);
            await stocks.loadHistoryStrategyOptions();
            history.showHistoryEmptyState('请点击"查询"按钮加载数据');
        }
    },
    trading: {
        enter() {
            return callWindowHook('initTrading', 'trading');
        }
    },
    positions: {
        enter() {
            return callWindowHook('initTrading', 'positions');
        }
    },
    transactions: {
        enter() {
            return callWindowHook('initTrading', 'transactions');
        }
    },
    strategies: {
        async enter() {
            const strategies = await import('./strategies.js');
            await strategies.loadStrategies();
        }
    },
    analysis: {
        async enter() {
            const analysis = await import('./analysis.js');
            analysis.setupStockAnalysis();
            analysis.resetScorePageState();
        }
    },
    'stock-ranking': {
        async enter() {
            const ranking = await import('./ranking.js');
            ranking.setupRankingEvents();
            ranking.initStockRankingPage();
        }
    },
    'ranking-track': {
        async enter() {
            const ranking = await import('./ranking.js');
            ranking.setupRankingEvents();
            ranking.initRankingTrackPage();
        }
    },
    'backtest-params': {
        async enter() {
            const backtest = await import('./backtest.js');
            backtest.initBacktestParamsPage();
        },
        async leave() {
            const backtest = await import('./backtest.js');
            backtest.cleanupBacktestPage();
        }
    },
    'backtest-config': {
        async enter() {
            const backtest = await import('./backtest.js');
            await backtest.initBacktestConfigPage();
        },
        async leave() {
            const backtest = await import('./backtest.js');
            backtest.cleanupBacktestPage();
        }
    },
    'backtest-results': {
        async enter() {
            const backtest = await import('./backtest.js');
            backtest.initBacktestResultsPage();
        },
        async leave() {
            const backtest = await import('./backtest.js');
            backtest.cleanupBacktestPage();
        }
    },
    'backtest-history': {
        async enter() {
            const backtest = await import('./backtest.js');
            backtest.initBacktestHistoryPage();
        },
        async leave() {
            const backtest = await import('./backtest.js');
            backtest.cleanupBacktestPage();
        }
    },
    khunter: {
        async enter() {
            const khunter = await import('./khunter.js');
            await khunter.initKHunterPage();
        }
    },
    'khunter-track': {
        async enter() {
            const khunter = await import('./khunter.js');
            khunter.setupKHunterTrackingEvents();
            await khunter.initKHunterTrackPage();
        }
    },
    'strategy-runner': {
        async enter() {
            const strategyRunner = await import('./strategy-runner.js');
            await strategyRunner.default.initStrategyRunnerModule();
        }
    }
};

/**
 * 设置导航事件。重复调用时会先解绑旧监听器。
 */
export function setupNavigation() {
    navigationController?.abort();
    navigationController = new AbortController();

    const navMenu = document.querySelector('.nav-menu');
    if (!navMenu) {
        console.warn('找不到导航菜单');
        return;
    }

    navMenu.addEventListener('click', (event) => {
        const item = event.target.closest('.nav-item[data-page]');
        if (!item || !navMenu.contains(item)) return;

        switchPage(item.dataset.page).catch(error => {
            console.error('页面切换失败:', error);
        });
    }, { signal: navigationController.signal });
}

function renderPage(page) {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.page === page);
    });

    const pageTitle = document.getElementById('page-title');
    if (pageTitle) {
        pageTitle.textContent = PAGE_TITLES[page] || '系统概览';
    }

    document.querySelectorAll('.page').forEach(element => {
        element.classList.toggle('active', element.id === `${page}-page`);
    });
}

/**
 * 切换页面，并依次执行旧页面 leave 和新页面 enter。
 */
export function switchPage(page, { force = false } = {}) {
    const currentTransition = ++transitionId;
    const transition = transitionQueue
        .catch(() => undefined)
        .then(() => performPageSwitch(page, force, currentTransition));

    transitionQueue = transition.catch(() => undefined);
    return transition;
}

async function performPageSwitch(page, force, currentTransition) {
    if (currentTransition !== transitionId) {
        return false;
    }

    const target = document.getElementById(`${page}-page`);
    if (!target) {
        console.warn(`页面 ${page} 不存在`);
        return false;
    }

    if (!force && activePage === page) {
        return true;
    }

    const previousPage = activePage;
    const previousLifecycle = activeLifecycle;

    if (previousLifecycle?.leave) {
        try {
            await previousLifecycle.leave({ from: previousPage, to: page });
        } catch (error) {
            console.error(`清理页面 ${previousPage} 失败:`, error);
        }
    }

    if (currentTransition !== transitionId) {
        return false;
    }

    const lifecycle = PAGE_LIFECYCLES[page] || null;
    activePage = page;
    activeLifecycle = lifecycle;
    renderPage(page);

    try {
        await lifecycle?.enter?.({ from: previousPage, to: page });
    } catch (error) {
        console.error(`初始化页面 ${page} 失败:`, error);
        throw error;
    }

    if (currentTransition !== transitionId) {
        return false;
    }

    document.dispatchEvent(new CustomEvent('khunter:pagechange', {
        detail: { from: previousPage, to: page }
    }));
    return true;
}

export function getCurrentPage() {
    return activePage;
}

export async function destroyNavigation() {
    transitionId += 1;
    navigationController?.abort();
    navigationController = null;

    await transitionQueue.catch(() => undefined);

    if (activeLifecycle?.leave) {
        await activeLifecycle.leave({ from: activePage, to: null });
    }

    activePage = null;
    activeLifecycle = null;
}
