import {
    escapeHtml,
    formatDateTime,
    formatEstimatedOutcome,
    formatMarketMakingMode,
    formatNumber,
    formatOrderStatus,
    getEstimatedMarketMakingOutcome,
    getExchangeTitle,
    getMarketMakingLoopDescription,
    getVisibleExchanges,
    infoMetricCard,
    loadExchangeStatuses,
    metricCard
} from './shared.js';

export async function initDashboardPage() {
    await loadExchangeStatuses().catch(() => {});

    const modeLabel = document.getElementById('mode-label');
    const feedback = document.getElementById('feedback');
    const runAllButton = document.getElementById('run-all');
    const runMarketMakingButton = document.getElementById('run-market-making');
    const listenMarketMakingButton = document.getElementById('listen-market-making');
    const cancelMarketMakingOrdersButton = document.getElementById('cancel-market-making-orders');
    const listenAllButton = document.getElementById('listen-all');
    const listenAllMarketMakingButton = document.getElementById('listen-market-making-all');
    const refreshAllButton = document.getElementById('refresh-all');
    const exchangeGrid = document.getElementById('exchange-grid');
    const marketMakingGrid = document.getElementById('market-making-grid');
    const socketStatusPill = document.getElementById('socket-status-pill');
    const socketStatusLabel = document.getElementById('socket-status-label');
    const lastUpdateLabel = document.getElementById('last-update-label');
    const marketMakingPanelTitle = document.getElementById('market-making-panel-title');
    const marketMakingSummary = document.getElementById('market-making-summary');
    const marketMakingTarget = document.getElementById('market-making-target');
    const marketMakingLastRun = document.getElementById('market-making-last-run');
    const marketMakingMode = document.getElementById('market-making-mode');
    const marketMakingLoop = document.getElementById('market-making-loop');
    const marketMakingMetrics = document.getElementById('market-making-metrics');
    const marketMakingActiveExecution = document.getElementById('market-making-active-execution');
    const marketMakingFavorableOpportunities = document.getElementById('market-making-favorable-opportunities');
    const marketMakingHistory = document.getElementById('market-making-history');

    const exchangeViews = new Map();
    const marketMakingExchangeViews = new Map();
    const activeSubscriptions = new Set();
    const activeMarketMakingSubscriptions = new Set();
    const marketMakingStatuses = new Map();
    const pendingSocketRequests = new Map();

    let socket;
    let socketReadyPromise;
    let socketRequestId = 0;
    let selectedMarketMakingExchangeId = null;

    function ensureRequiredElements() {
        const currentExchangeGrid = document.getElementById('exchange-grid');
        const currentMarketMakingGrid = document.getElementById('market-making-grid');
        const currentRunAllButton = document.getElementById('run-all');
        const currentRunMarketMakingButton = document.getElementById('run-market-making');
        const currentListenMarketMakingButton = document.getElementById('listen-market-making');
        const currentCancelMarketMakingOrdersButton = document.getElementById('cancel-market-making-orders');
        const currentListenAllButton = document.getElementById('listen-all');
        const currentListenAllMarketMakingButton = document.getElementById('listen-market-making-all');
        const currentRefreshAllButton = document.getElementById('refresh-all');

        return Boolean(
            currentExchangeGrid &&
            currentMarketMakingGrid &&
            currentRunAllButton &&
            currentRunMarketMakingButton &&
            currentListenMarketMakingButton &&
            currentCancelMarketMakingOrdersButton &&
            currentListenAllButton &&
            currentListenAllMarketMakingButton &&
            currentRefreshAllButton
        );
    }

    function getSubscribedVisibleExchangeCount() {
        return getVisibleExchanges().filter((exchangeId) => activeSubscriptions.has(exchangeId)).length;
    }

    function getSubscribedVisibleMarketMakingCount() {
        return getVisibleExchanges().filter((exchangeId) => activeMarketMakingSubscriptions.has(exchangeId)).length;
    }

    function updateListenAllButton() {
        if (!listenAllButton) {
            return;
        }

        const visibleExchanges = getVisibleExchanges();
        const subscribedCount = getSubscribedVisibleExchangeCount();
        const allSubscribed = visibleExchanges.length > 0 && subscribedCount === visibleExchanges.length;

        listenAllButton.textContent = allSubscribed ? 'Parar escuta de todas' : 'Escutar todas';
        listenAllButton.className = allSubscribed ? 'primary' : 'secondary';
    }

    function updateListenAllMarketMakingButton() {
        if (!listenAllMarketMakingButton) {
            return;
        }

        const visibleExchanges = getVisibleExchanges();
        const subscribedCount = getSubscribedVisibleMarketMakingCount();
        const allSubscribed = visibleExchanges.length > 0 && subscribedCount === visibleExchanges.length;

        listenAllMarketMakingButton.textContent = allSubscribed ? 'Parar MM todas' : 'Escutar MM todas';
        listenAllMarketMakingButton.className = allSubscribed ? 'primary' : 'secondary';
    }

    function getMarketMakingExchangeId() {
        const visibleExchanges = getVisibleExchanges();
        if (visibleExchanges.length === 1) {
            return visibleExchanges[0];
        }

        if (selectedMarketMakingExchangeId && visibleExchanges.includes(selectedMarketMakingExchangeId)) {
            return selectedMarketMakingExchangeId;
        }

        return visibleExchanges[0] || 'binance';
    }

    function updateListenMarketMakingButton() {
        if (!listenMarketMakingButton) {
            return;
        }

        const marketMakingExchangeId = getMarketMakingExchangeId();
        const isActive = activeMarketMakingSubscriptions.has(marketMakingExchangeId);

        listenMarketMakingButton.textContent = isActive
            ? 'Parar escuta Market Making'
            : 'Escutar Market Making';
        listenMarketMakingButton.className = isActive ? 'primary' : 'secondary';
    }

    function updateExchangeMarketMakingButton(exchangeId) {
        const view = marketMakingExchangeViews.get(exchangeId);

        if (!view?.listenButton) {
            return;
        }

        const isActive = activeMarketMakingSubscriptions.has(exchangeId);
        view.listenButton.textContent = isActive
            ? `Parar MM ${getExchangeTitle(exchangeId)}`
            : `Escutar MM ${getExchangeTitle(exchangeId)}`;
        view.listenButton.className = isActive ? 'primary' : 'secondary';
    }

    function updateVisibleMarketMakingButtons() {
        for (const exchangeId of getVisibleExchanges()) {
            updateExchangeMarketMakingButton(exchangeId);
        }

        updateListenMarketMakingButton();
        updateListenAllMarketMakingButton();
    }

    function updateCancelMarketMakingOrdersButton(activeExecution) {
        if (!cancelMarketMakingOrdersButton) {
            return;
        }

        cancelMarketMakingOrdersButton.disabled = !activeExecution;
        cancelMarketMakingOrdersButton.className = activeExecution ? 'primary' : 'secondary';
    }

    function createExchangePanelMarkup(exchangeId) {
        const autoScanButton = `<button class="secondary" data-role="auto-run-scan">Escutar ${getExchangeTitle(exchangeId)}</button>`;

        return `
            <article class="exchange-panel" data-exchange="${exchangeId}">
                <div class="exchange-panel-top">
                    <div>
                        <p class="route">${getExchangeTitle(exchangeId)}</p>
                        <div class="exchange-mode mono" data-role="mode-label">Carregando...</div>
                    </div>
                    <div class="actions actions-compact">
                        <button class="primary" data-role="run-scan">Executar ${getExchangeTitle(exchangeId)}</button>
                        ${autoScanButton}
                        <button class="secondary" data-role="refresh-logs">Atualizar ${getExchangeTitle(exchangeId)}</button>
                    </div>
                </div>
                <div class="exchange-feedback mono" data-role="feedback"></div>
                <div class="exchange-status-meta">
                    <article class="status-card">
                        <span class="status-card-label">Última atualização</span>
                        <span class="status-card-value" data-role="last-update">Aguardando atualização...</span>
                    </article>
                    <article class="status-card">
                        <span class="status-card-label">Logs exibidos</span>
                        <span class="status-card-value" data-role="logs-status">Nenhum log carregado ainda.</span>
                    </article>
                </div>
                <section class="panel exchange-section">
                    <h2>Resumo do ciclo</h2>
                    <div class="metrics" data-role="metrics"></div>
                </section>
                <div class="grid exchange-panel-grid">
                    <div class="stack">
                        <section class="panel exchange-section">
                            <h2>Melhores rotas</h2>
                            <div class="cards" data-role="results"></div>
                        </section>
                        <section class="panel exchange-section">
                            <h2>Histórico recente de scans</h2>
                            <div class="cards" data-role="scan-history"></div>
                        </section>
                    </div>
                    <section class="panel exchange-section">
                        <h2>Logs de oportunidades</h2>
                        <div class="cards" data-role="logs"></div>
                    </section>
                </div>
            </article>
        `;
    }

    function createMarketMakingPanelMarkup(exchangeId) {
        return `
            <article class="panel market-making-gadget" data-exchange="${exchangeId}">
                <div class="exchange-panel-top">
                    <div>
                        <p class="route">${getExchangeTitle(exchangeId)}</p>
                        <div class="exchange-feedback mono" data-role="mm-summary">Aguardando status de market making...</div>
                    </div>
                    <div class="actions actions-compact">
                        <button class="secondary" data-role="mm-select">Ver detalhes</button>
                        <button class="secondary" data-role="mm-listen">Escutar MM ${getExchangeTitle(exchangeId)}</button>
                    </div>
                </div>
                <div class="exchange-status-meta">
                    <article class="status-card">
                        <span class="status-card-label">Par</span>
                        <span class="status-card-value" data-role="mm-target">Aguardando...</span>
                    </article>
                    <article class="status-card">
                        <span class="status-card-label">Última execução</span>
                        <span class="status-card-value" data-role="mm-last-run">Aguardando...</span>
                    </article>
                    <article class="status-card">
                        <span class="status-card-label">Modo / Loop</span>
                        <span class="status-card-value" data-role="mm-mode-loop">Aguardando...</span>
                    </article>
                    <article class="status-card">
                        <span class="status-card-label">Execução ativa</span>
                        <span class="status-card-value" data-role="mm-active-status">Nenhuma</span>
                    </article>
                </div>
                <div class="metrics" data-role="mm-metrics">
                    <div class="empty">Sem dados de market making ainda.</div>
                </div>
            </article>
        `;
    }

    function updateSelectedMarketMakingExchange() {
        const selectedExchangeId = getMarketMakingExchangeId();

        for (const [exchangeId] of exchangeViews.entries()) {
            const marketMakingView = marketMakingExchangeViews.get(exchangeId);

            if (!marketMakingView?.root) {
                continue;
            }

            marketMakingView.root.classList.toggle('market-making-gadget-selected', exchangeId === selectedExchangeId);
        }

        if (marketMakingPanelTitle) {
            marketMakingPanelTitle.textContent = `Market Making · ${getExchangeTitle(selectedExchangeId)}`;
        }
    }

    function initializeExchangePanels() {
        const visibleExchanges = getVisibleExchanges();
        exchangeGrid.innerHTML = visibleExchanges.map(createExchangePanelMarkup).join('');
        marketMakingGrid.innerHTML = visibleExchanges.map(createMarketMakingPanelMarkup).join('');

        for (const exchangeId of visibleExchanges) {
            const root = exchangeGrid.querySelector(`[data-exchange="${exchangeId}"]`);
            const marketMakingRoot = marketMakingGrid.querySelector(`[data-exchange="${exchangeId}"]`);
            const view = {
                exchangeId,
                root,
                modeLabel: root.querySelector('[data-role="mode-label"]'),
                feedback: root.querySelector('[data-role="feedback"]'),
                lastUpdate: root.querySelector('[data-role="last-update"]'),
                logsStatus: root.querySelector('[data-role="logs-status"]'),
                metrics: root.querySelector('[data-role="metrics"]'),
                results: root.querySelector('[data-role="results"]'),
                logs: root.querySelector('[data-role="logs"]'),
                scanHistory: root.querySelector('[data-role="scan-history"]'),
                runButton: root.querySelector('[data-role="run-scan"]'),
                autoRunButton: root.querySelector('[data-role="auto-run-scan"]'),
                refreshButton: root.querySelector('[data-role="refresh-logs"]')
            };
            const marketMakingView = {
                exchangeId,
                root: marketMakingRoot,
                summary: marketMakingRoot.querySelector('[data-role="mm-summary"]'),
                target: marketMakingRoot.querySelector('[data-role="mm-target"]'),
                lastRun: marketMakingRoot.querySelector('[data-role="mm-last-run"]'),
                modeLoop: marketMakingRoot.querySelector('[data-role="mm-mode-loop"]'),
                activeStatus: marketMakingRoot.querySelector('[data-role="mm-active-status"]'),
                metrics: marketMakingRoot.querySelector('[data-role="mm-metrics"]'),
                selectButton: marketMakingRoot.querySelector('[data-role="mm-select"]'),
                listenButton: marketMakingRoot.querySelector('[data-role="mm-listen"]')
            };

            view.runButton.addEventListener('click', () => {
                runScan(exchangeId);
            });

            view.refreshButton.addEventListener('click', () => {
                loadDashboard(exchangeId);
            });

            if (view.autoRunButton) {
                view.autoRunButton.addEventListener('click', () => {
                    toggleAutoScan(exchangeId);
                });
            }

            if (marketMakingView.listenButton) {
                marketMakingView.listenButton.addEventListener('click', () => {
                    toggleExchangeMarketMaking(exchangeId);
                });
            }

            if (marketMakingView.root) {
                marketMakingView.root.addEventListener('click', (event) => {
                    if (event.target.closest('button')) {
                        return;
                    }

                    selectMarketMakingExchange(exchangeId).catch((error) => {
                        marketMakingSummary.textContent = error.message;
                    });
                });
            }

            if (marketMakingView.selectButton) {
                marketMakingView.selectButton.addEventListener('click', () => {
                    selectMarketMakingExchange(exchangeId).catch((error) => {
                        marketMakingSummary.textContent = error.message;
                    });
                });
            }

            exchangeViews.set(exchangeId, view);
            marketMakingExchangeViews.set(exchangeId, marketMakingView);
        }

        if (!selectedMarketMakingExchangeId && visibleExchanges.length > 0) {
            selectedMarketMakingExchangeId = visibleExchanges[0];
        }

        updateSelectedMarketMakingExchange();
        updateListenAllButton();
        updateVisibleMarketMakingButtons();
    }

    function updateAutoScanButton(exchangeId) {
        const view = exchangeViews.get(exchangeId);

        if (!view?.autoRunButton) {
            return;
        }

        const isActive = activeSubscriptions.has(exchangeId);
        view.autoRunButton.textContent = isActive
            ? `Parar escuta ${getExchangeTitle(exchangeId)}`
            : `Escutar ${getExchangeTitle(exchangeId)}`;
        view.autoRunButton.className = isActive ? 'primary' : 'secondary';
    }

    function stopAutoScan(exchangeId) {
        activeSubscriptions.delete(exchangeId);
        updateAutoScanButton(exchangeId);
        updateListenAllButton();
    }

    function startAutoScan(exchangeId) {
        activeSubscriptions.add(exchangeId);
        updateAutoScanButton(exchangeId);
        updateListenAllButton();
    }

    function stopMarketMakingSubscription(exchangeId) {
        activeMarketMakingSubscriptions.delete(exchangeId);
        updateExchangeMarketMakingButton(exchangeId);
        updateListenMarketMakingButton();
        updateListenAllMarketMakingButton();
    }

    function startMarketMakingSubscription(exchangeId) {
        activeMarketMakingSubscriptions.add(exchangeId);
        updateExchangeMarketMakingButton(exchangeId);
        updateListenMarketMakingButton();
        updateListenAllMarketMakingButton();
    }

    function getWebSocketUrl() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${protocol}//${window.location.host}/ws`;
    }

    function updateSocketStatus(state, label) {
        if (!socketStatusPill || !socketStatusLabel) {
            return;
        }

        socketStatusPill.dataset.socketState = state;
        socketStatusLabel.textContent = label;
    }

    function updateLastRefresh(exchangeId, timestamp, logs) {
        const view = exchangeViews.get(exchangeId);

        if (!view) {
            return;
        }

        const logItems = Array.isArray(logs) ? logs : [];
        const latestLogTimestamp = logItems[0]?.timestamp;

        view.lastUpdate.textContent = formatDateTime(timestamp);
        view.logsStatus.textContent = logItems.length > 0
            ? `${logItems.length} log(s) na tela. Mais recente em ${formatDateTime(latestLogTimestamp)}.`
            : 'Nenhum log persistido exibido no momento.';

        if (lastUpdateLabel) {
            lastUpdateLabel.textContent = `${getExchangeTitle(exchangeId)} · ${formatDateTime(timestamp)}`;
        }
    }

    function updatePageStatus() {
        if (!modeLabel) {
            return;
        }

        const statuses = [...exchangeViews.values()].map((view) => view.modeLabel.textContent).filter(Boolean);
        modeLabel.textContent = statuses.length > 0 ? `${statuses.length} painel(is) carregado(s)` : 'Carregando exchanges...';
    }

    function renderMetrics(view, scan) {
        if (!scan) {
            view.metrics.innerHTML = '<div class="empty">Nenhuma varredura executada ainda.</div>';
            return;
        }

        view.metrics.innerHTML = [
            metricCard('Triângulos', scan.selectedTriangles),
            metricCard('Pares consultados', scan.uniquePairs),
            metricCard('Filtrados por spread', scan.skippedBySpread),
            metricCard('Filtrados por volume', scan.skippedByVolume)
        ].join('');
    }

    function resultCard(result, index) {
        const variationClass = result.percentage >= 0 ? 'positive' : 'negative';
        const performanceClass = result.percentage >= 0 ? 'result-positive' : 'result-negative';
        const directionIcon = result.percentage >= 0 ? '▲' : '▼';
        const rankClass = index === 0 ? 'result-top' : '';

        return `
            <details class="result-card accordion-item ${performanceClass} ${rankClass}">
                <summary class="accordion-summary result-summary">
                    <span>
                        <span class="accordion-title">${result.route}</span>
                        <span class="accordion-subtitle">${formatNumber(result.finalAmount)} ${result.startAsset}</span>
                    </span>
                    <span class="accordion-meta result-meta ${variationClass}">${directionIcon} ${formatNumber(result.percentage)}%</span>
                </summary>
                <div class="accordion-body">
                    <div class="row"><span>Variação</span><strong class="${variationClass}">${formatNumber(result.percentage)}%</strong></div>
                    <div class="row"><span>Final</span><strong>${formatNumber(result.finalAmount)} ${result.startAsset}</strong></div>
                    <div class="row"><span>Spreads</span><strong>${result.spreads.map((value) => formatNumber(value, 3)).join('% / ')}%</strong></div>
                    <div class="row"><span>Slippage</span><strong>${result.slippages.map((value) => formatNumber(value, 3)).join('% / ')}%</strong></div>
                    <div class="row mono"><span>Pares</span><strong>${result.pair1} · ${result.pair2} · ${result.pair3}</strong></div>
                </div>
            </details>
        `;
    }

    function renderResults(view, scan) {
        if (!scan || !Array.isArray(scan.topResults) || scan.topResults.length === 0) {
            view.results.innerHTML = '<div class="empty">Sem resultados para exibir.</div>';
            return;
        }

        view.results.innerHTML = scan.topResults.map((result, index) => resultCard(result, index)).join('');
    }

    function logCard(item) {
        const entries = Array.isArray(item.opportunities) ? item.opportunities : [];
        const body = entries.length
            ? entries.map((entry) => `<div class="row"><span>${escapeHtml(entry.route)}</span><strong class="positive">${formatNumber(entry.percentage)}%</strong></div>`).join('')
            : '<div class="row"><span>Nenhuma oportunidade registrada</span><strong>0</strong></div>';

        return `
            <article class="log-card">
                <p class="route">${new Date(item.timestamp).toLocaleString()}</p>
                <div class="row"><span>Exchange</span><strong>${item.exchange}</strong></div>
                <div class="row"><span>Triângulos avaliados</span><strong>${item.evaluatedTriangles}</strong></div>
                ${body}
            </article>
        `;
    }

    function renderLogs(view, items) {
        if (!Array.isArray(items) || items.length === 0) {
            view.logs.innerHTML = '<div class="empty">Nenhum log persistido ainda.</div>';
            return;
        }

        view.logs.innerHTML = items.map(logCard).join('');
    }

    function renderScanHistory(view, items) {
        if (!Array.isArray(items) || items.length === 0) {
            view.scanHistory.innerHTML = '<div class="empty">Nenhum scan recente salvo em memória.</div>';
            return;
        }

        function renderEvaluationStep(step) {
            const statusClass = `history-step-${step.status || 'info'}`;
            return `
                <div class="history-step ${statusClass}">
                    <div class="row"><span>${step.title}</span><strong>${step.status || 'info'}</strong></div>
                    <div class="history-step-detail">${step.details}</div>
                </div>
            `;
        }

        function renderEvaluation(evaluation) {
            const steps = Array.isArray(evaluation.steps) ? evaluation.steps.map(renderEvaluationStep).join('') : '';
            return `
                <details class="history-evaluation accordion-item">
                    <summary class="accordion-summary">
                        <span class="accordion-title">${evaluation.route}</span>
                        <span class="accordion-meta">${evaluation.status}</span>
                    </summary>
                    <div class="accordion-body">
                        <div class="row"><span>Status</span><strong>${evaluation.status}</strong></div>
                        <div class="row"><span>Motivo</span><strong>${evaluation.reason || 'Sem observacoes'}</strong></div>
                        <div class="row mono"><span>Pares</span><strong>${evaluation.pairs.join(' · ')}</strong></div>
                        <div class="history-steps">${steps}</div>
                    </div>
                </details>
            `;
        }

        view.scanHistory.innerHTML = items.map((item) => `
            <details class="scan-card accordion-item">
                <summary class="accordion-summary">
                    <span>
                        <span class="accordion-title">${new Date(item.timestamp).toLocaleString()}</span>
                        <span class="accordion-subtitle">${item.mode} · ${item.opportunitiesCount} oportunidade(s)</span>
                    </span>
                    <span class="accordion-meta">${item.bestOpportunity ? item.bestOpportunity.route : 'Sem rota destaque'}</span>
                </summary>
                <div class="accordion-body">
                    <div class="row"><span>Modo</span><strong>${item.mode}</strong></div>
                    <div class="row"><span>Oportunidades</span><strong>${item.opportunitiesCount}</strong></div>
                    <div class="row"><span>Melhor rota</span><strong>${item.bestOpportunity ? item.bestOpportunity.route : 'Nenhuma'}</strong></div>
                    <div class="history-evaluations">${Array.isArray(item.evaluations) && item.evaluations.length > 0 ? item.evaluations.map(renderEvaluation).join('') : '<div class="empty">Sem acoes detalhadas para este scan.</div>'}</div>
                </div>
            </details>
        `).join('');
    }

    function renderExchangeMarketMakingGadget(exchangeId, status, summaryMessage) {
        const view = marketMakingExchangeViews.get(exchangeId);

        if (!view?.summary) {
            return;
        }

        if (!status) {
            view.summary.textContent = 'Aguardando status de market making...';
            view.target.textContent = 'Aguardando...';
            view.lastRun.textContent = 'Aguardando...';
            view.modeLoop.textContent = 'Aguardando...';
            view.activeStatus.textContent = 'Nenhuma';
            view.metrics.innerHTML = '<div class="empty">Sem dados de market making ainda.</div>';
            return;
        }

        const latestRun = status.latestRun;
        const activeExecution = status.activeExecution || null;
        const favorableOpportunities = Array.isArray(status.favorableOpportunities) ? status.favorableOpportunities : [];
        const latestFavorable = favorableOpportunities[0] || null;
        const executionStatus = activeExecution?.status || latestRun?.execution?.status || 'Nenhuma';
        const estimatedOutcome = getEstimatedMarketMakingOutcome(latestRun);

        view.summary.textContent = summaryMessage || latestRun?.summary || 'Status de market making carregado.';
        view.target.textContent = status.configuration?.symbol || 'Aguardando...';
        view.lastRun.textContent = latestRun ? formatDateTime(latestRun.timestamp) : 'Sem execução recente';
        view.modeLoop.textContent = status.configuration
            ? `${formatMarketMakingMode(status.configuration.mode)} · ${getMarketMakingLoopDescription(status.configuration.keepListening)}`
            : 'Aguardando...';
        view.activeStatus.textContent = executionStatus;
        view.metrics.innerHTML = latestRun
            ? [
                metricCard('Spread', `${formatNumber(latestRun.spreadPercent, 4)}%`),
                infoMetricCard('Estimativa', formatEstimatedOutcome(estimatedOutcome, latestRun.quoteCurrency || 'quote')),
                metricCard('Favoráveis', favorableOpportunities.length),
                metricCard('Budget', formatNumber(latestRun.quoteBudget, 4)),
                metricCard('Qtd estimada', formatNumber(latestRun.estimatedBaseAmount, 8)),
                infoMetricCard('Última favorável', latestFavorable ? formatDateTime(latestFavorable.timestamp) : 'Nenhuma registrada'),
                infoMetricCard('Execução', latestRun.execution?.message || latestRun.execution?.status || 'Sem execução recente')
            ].join('')
            : '<div class="empty">Sem dados de market making ainda.</div>';
    }

    function renderMarketMakingStatus(status, summaryMessage) {
        if (!status) {
            marketMakingSummary.textContent = 'Nenhuma execução de market making ainda.';
            marketMakingTarget.textContent = 'Aguardando execução...';
            marketMakingLastRun.textContent = 'Aguardando execução...';
            marketMakingMode.textContent = 'Aguardando configuração...';
            marketMakingLoop.textContent = 'Aguardando configuração...';
            marketMakingMetrics.innerHTML = '<div class="empty">Sem dados de market making ainda.</div>';
            marketMakingActiveExecution.innerHTML = '<div class="empty">Nenhuma ordem pendente de market making.</div>';
            marketMakingFavorableOpportunities.innerHTML = '<div class="empty">Nenhuma oportunidade favorável registrada ainda.</div>';
            marketMakingHistory.innerHTML = '<div class="empty">Nenhuma execução de market making ainda.</div>';
            updateCancelMarketMakingOrdersButton(null);
            return;
        }

        const latestRun = status.latestRun;
        const activeExecution = status.activeExecution || null;
        const recentRuns = Array.isArray(status.recentRuns) ? status.recentRuns : [];
        const favorableOpportunities = Array.isArray(status.favorableOpportunities)
            ? status.favorableOpportunities
            : recentRuns.filter((run) => run.status === 'favorable');
        const estimatedOutcome = getEstimatedMarketMakingOutcome(latestRun);
        const conversionText = latestRun
            ? `${formatNumber(latestRun.quoteBudget, 4)} ${latestRun.quoteCurrency || 'quote'} -> ${formatNumber(latestRun.estimatedBaseAmount, 8)} ${latestRun.baseCurrency || 'base'} estimados`
            : 'Aguardando conversao estimada...';
        marketMakingTarget.textContent = `${getExchangeTitle(status.exchange)} · ${status.configuration.symbol}`;
        marketMakingLastRun.textContent = latestRun ? formatDateTime(latestRun.timestamp) : 'Sem execução recente';
        marketMakingMode.textContent = formatMarketMakingMode(status.configuration.mode);
        marketMakingLoop.textContent = getMarketMakingLoopDescription(status.configuration.keepListening);
        marketMakingSummary.textContent = summaryMessage || latestRun?.summary || 'Status de market making carregado.';
        marketMakingActiveExecution.innerHTML = activeExecution
            ? `
                <article class="log-card">
                    <p class="route">Execução ativa monitorada</p>
                    <div class="row"><span>Status geral</span><strong>${activeExecution.status || 'n/a'}</strong></div>
                    <div class="row"><span>Última checagem</span><strong>${formatDateTime(activeExecution.lastCheckedAt)}</strong></div>
                    <div class="row"><span>Buy</span><strong>${formatOrderStatus(activeExecution.buyOrder)}</strong></div>
                    <div class="row"><span>Buy ID</span><strong>${activeExecution.buyOrder?.id || 'n/a'}</strong></div>
                    <div class="row"><span>Buy filled</span><strong>${formatNumber(activeExecution.buyOrder?.filled, 8)}</strong></div>
                    <div class="row"><span>Buy remaining</span><strong>${formatNumber(activeExecution.buyOrder?.remaining, 8)}</strong></div>
                    <div class="row"><span>Sell</span><strong>${formatOrderStatus(activeExecution.sellOrder)}</strong></div>
                    <div class="row"><span>Sell ID</span><strong>${activeExecution.sellOrder?.id || 'n/a'}</strong></div>
                    <div class="row"><span>Sell filled</span><strong>${formatNumber(activeExecution.sellOrder?.filled, 8)}</strong></div>
                    <div class="row"><span>Sell remaining</span><strong>${formatNumber(activeExecution.sellOrder?.remaining, 8)}</strong></div>
                    <div class="row"><span>Mensagem</span><strong>${activeExecution.message || 'Monitorando ordens pendentes.'}</strong></div>
                </article>
            `
            : '<div class="empty">Nenhuma ordem pendente de market making.</div>';
        updateCancelMarketMakingOrdersButton(activeExecution);
        marketMakingFavorableOpportunities.innerHTML = favorableOpportunities.length > 0
            ? favorableOpportunities.map((opportunity) => `
                <article class="log-card">
                    <p class="route">${formatDateTime(opportunity.timestamp)}</p>
                    <div class="row"><span>Exchange</span><strong>${getExchangeTitle(opportunity.exchange)}</strong></div>
                    <div class="row"><span>Par</span><strong>${opportunity.symbol}</strong></div>
                    <div class="row"><span>Modo</span><strong>${opportunity.mode}</strong></div>
                    <div class="row"><span>Execução</span><strong>${opportunity.execution?.status || 'n/a'}</strong></div>
                    <div class="row"><span>Conversão</span><strong>${formatNumber(opportunity.quoteBudget, 4)} ${opportunity.quoteCurrency || 'quote'} -> ${formatNumber(opportunity.estimatedBaseAmount, 8)} ${opportunity.baseCurrency || 'base'}</strong></div>
                    <div class="row"><span>Ganho/Perda estimado</span><strong>${formatEstimatedOutcome(getEstimatedMarketMakingOutcome(opportunity), opportunity.quoteCurrency || 'quote')}</strong></div>
                    <div class="row"><span>Spread</span><strong class="positive">${formatNumber(opportunity.spreadPercent, 4)}%</strong></div>
                    <div class="row"><span>Bid sugerido</span><strong>${formatNumber(opportunity.targetBid, 4)}</strong></div>
                    <div class="row"><span>Ask sugerido</span><strong>${formatNumber(opportunity.targetAsk, 4)}</strong></div>
                </article>
            `).join('')
            : '<div class="empty">Nenhuma oportunidade favorável registrada ainda.</div>';
        marketMakingHistory.innerHTML = recentRuns.length > 0
            ? recentRuns.map((run) => `
                <article class="log-card">
                    <p class="route">${formatDateTime(run.timestamp)}</p>
                    <div class="row"><span>Par</span><strong>${run.symbol}</strong></div>
                    <div class="row"><span>Status</span><strong>${run.status}</strong></div>
                    <div class="row"><span>Execução</span><strong>${run.execution?.status || 'n/a'}</strong></div>
                    <div class="row"><span>Conversão</span><strong>${formatNumber(run.quoteBudget, 4)} ${run.quoteCurrency || 'quote'} -> ${formatNumber(run.estimatedBaseAmount, 8)} ${run.baseCurrency || 'base'}</strong></div>
                    <div class="row"><span>Ganho/Perda estimado</span><strong>${formatEstimatedOutcome(getEstimatedMarketMakingOutcome(run), run.quoteCurrency || 'quote')}</strong></div>
                    <div class="row"><span>Spread</span><strong>${formatNumber(run.spreadPercent, 4)}%</strong></div>
                    <div class="row"><span>Bid sugerido</span><strong>${formatNumber(run.targetBid, 4)}</strong></div>
                    <div class="row"><span>Ask sugerido</span><strong>${formatNumber(run.targetAsk, 4)}</strong></div>
                </article>
            `).join('')
            : '<div class="empty">Nenhuma execução de market making ainda.</div>';

        if (!latestRun) {
            marketMakingMetrics.innerHTML = '<div class="empty">Sem dados de market making ainda.</div>';
            return;
        }

        marketMakingMetrics.innerHTML = [
            metricCard('Spread', `${formatNumber(latestRun.spreadPercent, 4)}%`),
            metricCard('Mid', formatNumber(latestRun.midPrice, 4)),
            metricCard(`Orcamento (${latestRun.quoteCurrency || 'quote'})`, formatNumber(latestRun.quoteBudget, 4)),
            metricCard(`Qtd estimada (${latestRun.baseCurrency || 'base'})`, formatNumber(latestRun.estimatedBaseAmount, 8)),
            infoMetricCard('Ganho/Perda estimado', formatEstimatedOutcome(estimatedOutcome, latestRun.quoteCurrency || 'quote')),
            metricCard('Bid sugerido', formatNumber(latestRun.targetBid, 4)),
            metricCard('Ask sugerido', formatNumber(latestRun.targetAsk, 4)),
            infoMetricCard('Conversao direta', conversionText)
        ].join('');
    }

    function renderMarketMakingViews(status, summaryMessage) {
        if (!status?.exchange) {
            return;
        }

        marketMakingStatuses.set(status.exchange, status);
        renderExchangeMarketMakingGadget(status.exchange, status, summaryMessage);

        if (getMarketMakingExchangeId() === status.exchange) {
            renderMarketMakingStatus(status, summaryMessage);
        }
    }

    function applyExchangeStatus(exchangeId, status, message) {
        const view = exchangeViews.get(exchangeId);

        if (!view || !status) {
            return;
        }

        view.modeLabel.textContent = `Modo ${status.mode} · ${status.exchange}`;
        renderMetrics(view, status.latestScan);
        renderResults(view, status.latestScan);
        renderLogs(view, status.logs);
        renderScanHistory(view, status.recentScans);
        updateLastRefresh(exchangeId, status.latestScan?.timestamp || status.logs?.[0]?.timestamp || new Date().toISOString(), status.logs);

        if (message) {
            view.feedback.textContent = message;
        }

        updatePageStatus();
    }

    function rejectPendingSocketRequests(message) {
        for (const { reject } of pendingSocketRequests.values()) {
            reject(new Error(message));
        }

        pendingSocketRequests.clear();
    }

    function ensureSocketConnection() {
        if (socket && socket.readyState === WebSocket.OPEN) {
            updateSocketStatus('connected', 'WebSocket conectado');
            return Promise.resolve(socket);
        }

        if (socketReadyPromise) {
            return socketReadyPromise;
        }

        socketReadyPromise = new Promise((resolve, reject) => {
            updateSocketStatus('connecting', 'WebSocket conectando...');
            socket = new WebSocket(getWebSocketUrl());

            socket.addEventListener('open', () => {
                socketReadyPromise = null;
                updateSocketStatus('connected', 'WebSocket conectado');
                console.log(`[ws] conectado ao servidor em ${getWebSocketUrl()}`);
                resolve(socket);
            }, { once: true });

            socket.addEventListener('message', (event) => {
                let message;

                try {
                    message = JSON.parse(event.data);
                } catch {
                    return;
                }

                console.log('[ws] mensagem recebida do servidor:', message);

                if (message.type === 'exchange-update') {
                    applyExchangeStatus(
                        message.exchangeId,
                        message.payload,
                        `${getExchangeTitle(message.exchangeId)} atualizada automaticamente em ${new Date().toLocaleTimeString()}.`
                    );
                    return;
                }

                if (message.type === 'market-making-update') {
                    renderMarketMakingViews(
                        message.payload,
                        `Market making atualizado automaticamente em ${new Date().toLocaleTimeString()}.`
                    );
                    return;
                }

                if (message.type === 'market-making-stopped') {
                    stopMarketMakingSubscription(message.exchangeId);

                    const stopReason = message.reason === 'live-orders-created'
                        ? 'Loop encerrado automaticamente após enviar ordens live.'
                        : message.reason === 'favorable-opportunity-found'
                            ? 'Loop encerrado automaticamente após encontrar oportunidade favorável.'
                            : 'Loop de market making encerrado pelo servidor.';

                    const view = exchangeViews.get(message.exchangeId);
                    if (view) {
                        view.feedback.textContent = stopReason;
                    }

                    if (getMarketMakingExchangeId() === message.exchangeId) {
                        marketMakingSummary.textContent = stopReason;
                    }

                    feedback.textContent = `${getExchangeTitle(message.exchangeId)}: ${stopReason}`;
                    return;
                }

                if (message.type === 'exchange-error') {
                    const view = exchangeViews.get(message.exchangeId);

                    if (view) {
                        view.feedback.textContent = message.error;
                    }

                    return;
                }

                if (message.type === 'market-making-error') {
                    marketMakingSummary.textContent = message.error;
                    return;
                }

                if (!message.requestId) {
                    return;
                }

                const pendingRequest = pendingSocketRequests.get(message.requestId);

                if (!pendingRequest) {
                    return;
                }

                pendingSocketRequests.delete(message.requestId);

                if (!message.ok) {
                    pendingRequest.reject(new Error(message.error || 'Falha na requisição WebSocket.'));
                    return;
                }

                pendingRequest.resolve(message.payload);
            });

            socket.addEventListener('close', () => {
                socket = null;
                socketReadyPromise = null;
                updateSocketStatus('disconnected', 'WebSocket desconectado');
                console.log('[ws] conexão encerrada');
                rejectPendingSocketRequests('Conexão WebSocket encerrada.');
            });

            socket.addEventListener('error', () => {
                if (socket && socket.readyState !== WebSocket.OPEN) {
                    socketReadyPromise = null;
                    updateSocketStatus('error', 'Falha no WebSocket');
                    reject(new Error('Falha ao conectar ao WebSocket do servidor.'));
                }
            }, { once: true });
        });

        return socketReadyPromise;
    }

    async function sendSocketRequest(action, exchangeId) {
        const activeSocket = await ensureSocketConnection();
        const requestId = `${Date.now()}-${socketRequestId += 1}`;

        return await new Promise((resolve, reject) => {
            pendingSocketRequests.set(requestId, { resolve, reject });

            try {
                const request = { requestId, action, exchangeId };
                console.log('[ws] enviando mensagem para o servidor:', request);
                activeSocket.send(JSON.stringify(request));
            } catch {
                pendingSocketRequests.delete(requestId);
                reject(new Error('Falha ao enviar mensagem WebSocket.'));
            }
        });
    }

    async function loadDashboard(exchangeId) {
        const view = exchangeViews.get(exchangeId);
        view.refreshButton.disabled = true;
        view.feedback.textContent = `Atualizando ${getExchangeTitle(exchangeId)}...`;

        try {
            const [status, marketMakingStatus] = await Promise.all([
                sendSocketRequest('status', exchangeId),
                sendSocketRequest('market-making-status', exchangeId).catch(() => null)
            ]);
            applyExchangeStatus(exchangeId, status, `Painel ${getExchangeTitle(exchangeId)} atualizado.`);

            if (marketMakingStatus) {
                renderMarketMakingViews(marketMakingStatus);
            }
        } catch (error) {
            view.feedback.textContent = error.message;
        } finally {
            view.refreshButton.disabled = false;
        }
    }

    async function runScan(exchangeId) {
        const view = exchangeViews.get(exchangeId);
        view.runButton.disabled = true;
        view.feedback.textContent = `Executando ${getExchangeTitle(exchangeId)}...`;

        try {
            const payload = await sendSocketRequest('scan', exchangeId);
            const status = await sendSocketRequest('status', exchangeId);
            applyExchangeStatus(exchangeId, status, `Scan ${getExchangeTitle(exchangeId)} concluído às ${new Date(payload.scan.timestamp).toLocaleTimeString()}.`);
        } catch (error) {
            view.feedback.textContent = error.message;
        } finally {
            view.runButton.disabled = false;
        }
    }

    async function refreshAllDashboards() {
        refreshAllButton.disabled = true;
        feedback.textContent = 'Atualizando todos os painéis...';

        try {
            await Promise.all(getVisibleExchanges().map((exchangeId) => loadDashboard(exchangeId)));
            feedback.textContent = 'Todos os painéis foram atualizados.';
        } catch (error) {
            feedback.textContent = error.message;
        } finally {
            refreshAllButton.disabled = false;
        }
    }

    async function runAllScans() {
        runAllButton.disabled = true;
        feedback.textContent = 'Executando todas as exchanges...';

        try {
            const exchangeIds = getVisibleExchanges();
            const results = await Promise.allSettled(exchangeIds.map((exchangeId) => runScan(exchangeId)));
            const failedCount = results.filter((result) => result.status === 'rejected').length;

            if (failedCount > 0) {
                feedback.textContent = `${exchangeIds.length - failedCount} exchange(s) concluídas, ${failedCount} com falha.`;
                return;
            }

            feedback.textContent = 'Execução concluída em todas as exchanges visíveis.';
        } catch (error) {
            feedback.textContent = error.message;
        } finally {
            runAllButton.disabled = false;
        }
    }

    async function loadMarketMakingStatus() {
        try {
            const status = await sendSocketRequest('market-making-status', getMarketMakingExchangeId());
            renderMarketMakingViews(status);
        } catch (error) {
            marketMakingSummary.textContent = error.message;
        }
    }

    async function runMarketMaking() {
        runMarketMakingButton.disabled = true;
        marketMakingSummary.textContent = 'Executando estratégia de market making...';

        try {
            selectedMarketMakingExchangeId = getMarketMakingExchangeId();
            updateSelectedMarketMakingExchange();
            const payload = await sendSocketRequest('market-making-run', getMarketMakingExchangeId());
            renderMarketMakingViews(payload.status, `Market making executado em ${formatDateTime(payload.run.timestamp)}.`);
            feedback.textContent = `Market making executado para ${getExchangeTitle(payload.run.exchange)} em ${payload.run.symbol}.`;
        } catch (error) {
            marketMakingSummary.textContent = error.message;
        } finally {
            runMarketMakingButton.disabled = false;
        }
    }

    async function cancelMarketMakingOrders() {
        const exchangeId = getMarketMakingExchangeId();
        selectedMarketMakingExchangeId = exchangeId;
        updateSelectedMarketMakingExchange();
        cancelMarketMakingOrdersButton.disabled = true;

        try {
            const payload = await sendSocketRequest('market-making-cancel', exchangeId);
            renderMarketMakingViews(payload.status, payload.cancellation.message);
            feedback.textContent = `${getExchangeTitle(exchangeId)}: ${payload.cancellation.message}`;
        } catch (error) {
            marketMakingSummary.textContent = error.message;
        } finally {
            const status = await sendSocketRequest('market-making-status', exchangeId).catch(() => null);
            updateCancelMarketMakingOrdersButton(status?.activeExecution || null);
        }
    }

    async function toggleListenMarketMaking() {
        const exchangeId = getMarketMakingExchangeId();
        selectedMarketMakingExchangeId = exchangeId;
        updateSelectedMarketMakingExchange();
        listenMarketMakingButton.disabled = true;

        try {
            if (activeMarketMakingSubscriptions.has(exchangeId)) {
                await sendSocketRequest('market-making-unsubscribe', exchangeId);
                stopMarketMakingSubscription(exchangeId);
                marketMakingSummary.textContent = 'Escuta contínua de market making interrompida.';
                return;
            }

            const payload = await sendSocketRequest('market-making-subscribe', exchangeId);
            startMarketMakingSubscription(exchangeId);
            marketMakingSummary.textContent = `Escuta de market making ativada para ${getExchangeTitle(payload.exchangeId)}. Atualização a cada ${Math.round(payload.intervalMs / 1000)} segundo(s), com ${getMarketMakingLoopDescription(payload.keepListening)}.`;
        } catch (error) {
            marketMakingSummary.textContent = error.message;
        } finally {
            updateListenMarketMakingButton();
            listenMarketMakingButton.disabled = false;
        }
    }

    async function toggleAutoScan(exchangeId) {
        const view = exchangeViews.get(exchangeId);

        if (!view?.autoRunButton) {
            return;
        }

        view.autoRunButton.disabled = true;

        try {
            if (activeSubscriptions.has(exchangeId)) {
                await sendSocketRequest('unsubscribe', exchangeId);
                stopAutoScan(exchangeId);
                view.feedback.textContent = `Escuta contínua da ${getExchangeTitle(exchangeId)} interrompida.`;
                return;
            }

            const payload = await sendSocketRequest('subscribe', exchangeId);
            startAutoScan(exchangeId);
            view.feedback.textContent = `Escuta contínua da ${getExchangeTitle(exchangeId)} ativada. O servidor enviará atualizações a cada ${Math.round(payload.intervalMs / 1000)} segundo(s).`;
        } catch (error) {
            view.feedback.textContent = error.message;
        } finally {
            view.autoRunButton.disabled = false;
        }
    }

    async function toggleExchangeMarketMaking(exchangeId) {
        const view = exchangeViews.get(exchangeId);
        const marketMakingView = marketMakingExchangeViews.get(exchangeId);

        if (!marketMakingView?.listenButton) {
            return;
        }

        selectedMarketMakingExchangeId = exchangeId;
        updateSelectedMarketMakingExchange();
        marketMakingView.listenButton.disabled = true;

        try {
            if (activeMarketMakingSubscriptions.has(exchangeId)) {
                await sendSocketRequest('market-making-unsubscribe', exchangeId);
                stopMarketMakingSubscription(exchangeId);
                view.feedback.textContent = `Escuta de market making da ${getExchangeTitle(exchangeId)} interrompida.`;
                if (getMarketMakingExchangeId() === exchangeId) {
                    marketMakingSummary.textContent = `Escuta contínua de market making interrompida para ${getExchangeTitle(exchangeId)}.`;
                }
                return;
            }

            const payload = await sendSocketRequest('market-making-subscribe', exchangeId);
            startMarketMakingSubscription(exchangeId);
            view.feedback.textContent = `Escuta de market making da ${getExchangeTitle(exchangeId)} ativada. Atualização a cada ${Math.round(payload.intervalMs / 1000)} segundo(s), com ${getMarketMakingLoopDescription(payload.keepListening)}.`;
            if (getMarketMakingExchangeId() === exchangeId) {
                marketMakingSummary.textContent = `Escuta de market making ativada para ${getExchangeTitle(exchangeId)}. Atualização a cada ${Math.round(payload.intervalMs / 1000)} segundo(s), com ${getMarketMakingLoopDescription(payload.keepListening)}.`;
            }
        } catch (error) {
            view.feedback.textContent = error.message;
            if (getMarketMakingExchangeId() === exchangeId) {
                marketMakingSummary.textContent = error.message;
            }
        } finally {
            marketMakingView.listenButton.disabled = false;
        }
    }

    async function toggleListenAll() {
        const visibleExchanges = getVisibleExchanges();
        const allSubscribed = visibleExchanges.length > 0 && visibleExchanges.every((exchangeId) => activeSubscriptions.has(exchangeId));

        listenAllButton.disabled = true;
        listenAllButton.textContent = allSubscribed ? 'Interrompendo escuta...' : 'Ativando escuta...';

        try {
            if (allSubscribed) {
                await Promise.all(visibleExchanges.map((exchangeId) => sendSocketRequest('unsubscribe', exchangeId)));
                visibleExchanges.forEach(stopAutoScan);
                feedback.textContent = 'Escuta contínua interrompida em todas as exchanges visíveis.';
                return;
            }

            const exchangeIdsToSubscribe = visibleExchanges.filter((exchangeId) => !activeSubscriptions.has(exchangeId));
            const results = await Promise.all(exchangeIdsToSubscribe.map((exchangeId) => sendSocketRequest('subscribe', exchangeId)));
            exchangeIdsToSubscribe.forEach(startAutoScan);

            const intervals = [...new Set(results.map((item) => Math.round(item.intervalMs / 1000)))];
            feedback.textContent = `Escuta contínua ativada nas exchanges visíveis. Intervalo(s) do servidor: ${intervals.join(', ')} segundo(s).`;
        } catch (error) {
            feedback.textContent = error.message;
        } finally {
            updateListenAllButton();
            listenAllButton.disabled = false;
        }
    }

    async function toggleListenAllMarketMaking() {
        const visibleExchanges = getVisibleExchanges();
        const allSubscribed = visibleExchanges.length > 0 && visibleExchanges.every((exchangeId) => activeMarketMakingSubscriptions.has(exchangeId));

        listenAllMarketMakingButton.disabled = true;
        listenAllMarketMakingButton.textContent = allSubscribed ? 'Interrompendo MM...' : 'Ativando MM...';

        try {
            if (allSubscribed) {
                await Promise.all(visibleExchanges.map((exchangeId) => sendSocketRequest('market-making-unsubscribe', exchangeId)));
                visibleExchanges.forEach(stopMarketMakingSubscription);
                marketMakingSummary.textContent = 'Escuta contínua de market making interrompida em todas as exchanges visíveis.';
                feedback.textContent = 'Escuta de market making interrompida em todas as exchanges visíveis.';
                return;
            }

            const exchangeIdsToSubscribe = visibleExchanges.filter((exchangeId) => !activeMarketMakingSubscriptions.has(exchangeId));
            const results = await Promise.all(exchangeIdsToSubscribe.map((exchangeId) => sendSocketRequest('market-making-subscribe', exchangeId)));
            exchangeIdsToSubscribe.forEach(startMarketMakingSubscription);

            const intervals = [...new Set(results.map((item) => Math.round(item.intervalMs / 1000)))];
            const loopDescriptions = [...new Set(results.map((item) => getMarketMakingLoopDescription(item.keepListening)))];
            marketMakingSummary.textContent = `Escuta de market making ativada nas exchanges visíveis. Intervalo(s): ${intervals.join(', ')} segundo(s). Regra(s): ${loopDescriptions.join(' | ')}.`;
            feedback.textContent = `Escuta de market making ativada nas exchanges visíveis. Intervalo(s) do servidor: ${intervals.join(', ')} segundo(s). Regra(s): ${loopDescriptions.join(' | ')}.`;
        } catch (error) {
            marketMakingSummary.textContent = error.message;
            feedback.textContent = error.message;
        } finally {
            updateListenAllMarketMakingButton();
            listenAllMarketMakingButton.disabled = false;
        }
    }

    async function selectMarketMakingExchange(exchangeId) {
        selectedMarketMakingExchangeId = exchangeId;
        updateSelectedMarketMakingExchange();

        const cachedStatus = marketMakingStatuses.get(exchangeId);

        if (cachedStatus) {
            renderMarketMakingStatus(cachedStatus, `Detalhamento de market making focado em ${getExchangeTitle(exchangeId)}.`);
        }

        const latestStatus = await sendSocketRequest('market-making-status', exchangeId);
        renderMarketMakingViews(latestStatus);
    }

    updateListenMarketMakingButton();
    updateListenAllMarketMakingButton();
    updateCancelMarketMakingOrdersButton(null);

    if (ensureRequiredElements()) {
        initializeExchangePanels();
        runAllButton.addEventListener('click', runAllScans);
    }

    if (runMarketMakingButton) {
        runMarketMakingButton.addEventListener('click', runMarketMaking);
    }

    if (listenMarketMakingButton) {
        listenMarketMakingButton.addEventListener('click', toggleListenMarketMaking);
    }

    if (cancelMarketMakingOrdersButton) {
        cancelMarketMakingOrdersButton.addEventListener('click', cancelMarketMakingOrders);
    }

    if (listenAllButton) {
        listenAllButton.addEventListener('click', toggleListenAll);
    }

    if (listenAllMarketMakingButton) {
        listenAllMarketMakingButton.addEventListener('click', toggleListenAllMarketMaking);
    }

    if (refreshAllButton) {
        refreshAllButton.addEventListener('click', refreshAllDashboards);
    }

    window.addEventListener('beforeunload', () => {
        for (const exchangeId of activeSubscriptions.keys()) {
            sendSocketRequest('unsubscribe', exchangeId).catch(() => {
                // Ignore unload-time unsubscribe failures.
            });
        }

        for (const exchangeId of activeMarketMakingSubscriptions.keys()) {
            sendSocketRequest('market-making-unsubscribe', exchangeId).catch(() => {
                // Ignore unload-time unsubscribe failures.
            });
        }

        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.close();
        }
    });

    const visibleExchanges = getVisibleExchanges();

    if (visibleExchanges.length === 1) {
        toggleAutoScan(visibleExchanges[0]).catch((error) => {
            feedback.textContent = error.message;
        });
        loadMarketMakingStatus().catch((error) => {
            marketMakingSummary.textContent = error.message;
        });
    } else {
        Promise.all(visibleExchanges.map((exchangeId) => loadDashboard(exchangeId))).catch((error) => {
            feedback.textContent = error.message;
        });
    }

    window.addEventListener('load-dashboard', (event) => {
        const exchangeId = event.detail?.exchangeId;
        if (exchangeId && exchangeViews.has(exchangeId)) {
            loadDashboard(exchangeId).then(() => {
                const loadEvent = new CustomEvent('dashboard-loaded', { detail: { exchangeId } });
                window.dispatchEvent(loadEvent);
            }).catch(() => {
                const loadEvent = new CustomEvent('dashboard-loaded', { detail: { exchangeId } });
                window.dispatchEvent(loadEvent);
            });
        }
    });

    window.addEventListener('init-panels', () => {
        if (ensureRequiredElements() && exchangeViews.size === 0) {
            initializeExchangePanels();

            const visibleExchanges = getVisibleExchanges();
            Promise.all(visibleExchanges.map((exchangeId) => loadDashboard(exchangeId))).catch((error) => {
                feedback.textContent = error.message;
            });
        }
    });

    return true;
}