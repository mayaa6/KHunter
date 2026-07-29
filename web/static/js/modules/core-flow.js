/**
 * “选股 → 排名 → 狩猎场”共享上下文与导航。
 */

const CORE_DATE_KEY = 'khunter:core-flow-date';
let eventsBound = false;

export function getCoreFlowDate() {
    return sessionStorage.getItem(CORE_DATE_KEY) || '';
}

export function setCoreFlowDate(date) {
    if (date) sessionStorage.setItem(CORE_DATE_KEY, date);
}

export async function goToCoreStep(page, date = '') {
    setCoreFlowDate(date);
    const navigation = await import('./navigation.js');
    await navigation.switchPage(page);
}

export function setupCoreFlow() {
    if (eventsBound) return;

    document.addEventListener('click', event => {
        const step = event.target.closest('[data-core-page]');
        if (!step) return;

        const activeDate =
            document.getElementById('stock-ranking-date')?.value ||
            document.getElementById('hunting-date')?.value ||
            getCoreFlowDate();

        goToCoreStep(step.dataset.corePage, activeDate);
    });

    eventsBound = true;
}

window.CoreFlow = {
    getDate: getCoreFlowDate,
    setDate: setCoreFlowDate,
    go: goToCoreStep
};
