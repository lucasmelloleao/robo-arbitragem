import { initDashboardPage } from './js/dashboard.js';
import { initManagementPage } from './js/management.js';

function hasDashboardPage() {
    return Boolean(
        document.getElementById('exchange-grid') ||
        document.getElementById('listen-all') ||
        document.getElementById('market-making-grid')
    );
}

let dashboardInitialized = false;

if (hasDashboardPage()) {
    dashboardInitialized = Boolean(initDashboardPage());
}

window.app = {
    initDashboard: () => {
        if (!hasDashboardPage()) {
            return false;
        }

        if (!dashboardInitialized) {
            dashboardInitialized = Boolean(initDashboardPage());
        }

        return dashboardInitialized;
    },
    initPanels: () => {
        const event = new CustomEvent('init-panels');
        window.dispatchEvent(event);
    },
    loadDashboard: (exchangeId) => {
        const event = new CustomEvent('load-dashboard', { detail: { exchangeId } });
        window.dispatchEvent(event);
        
        return new Promise((resolve) => {
            const handler = (e) => {
                if (e.detail && e.detail.exchangeId === exchangeId) {
                    window.removeEventListener('dashboard-loaded', handler);
                    resolve();
                }
            };
            window.addEventListener('dashboard-loaded', handler);
            
            setTimeout(() => {
                window.removeEventListener('dashboard-loaded', handler);
                resolve();
            }, 5000);
        });
    }
};

initManagementPage();
