import {
    buildApiUrl,
    exchangeUsesPassphrase,
    escapeHtml,
    fetchJson,
    formatDateTime,
    showToast
} from './shared.js';

export function initManagementPage() {
    const btnShowUserForm = document.getElementById('btn-show-user-form');
    const userFormContainer = document.getElementById('user-form-container');
    const userForm = document.getElementById('user-form');
    const btnCancelUserForm = document.getElementById('btn-cancel-user-form');
    const userFormFeedback = document.getElementById('user-form-feedback');
    const userList = document.getElementById('user-list');
    const userCountLabel = document.getElementById('user-count-label');

    const btnShowExchangeForm = document.getElementById('btn-show-exchange-form');
    const exchangeFormContainer = document.getElementById('exchange-form-container');
    const exchangeForm = document.getElementById('exchange-form');
    const btnCancelExchangeForm = document.getElementById('btn-cancel-exchange-form');
    const exchangeFormFeedback = document.getElementById('exchange-form-feedback');
    const exchangeFormTitle = document.getElementById('exchange-form-title');
    const exchangeFormHint = document.getElementById('exchange-form-hint');
    const exchangeFormSubmit = document.getElementById('exchange-form-submit');
    const exchangePasswordGroup = document.getElementById('exchange-password-group');
    const exchangePasswordLabel = document.getElementById('exchange-password-label');
    const exchangePasswordInput = document.getElementById('exchange-password');
    const exchangeList = document.getElementById('exchange-list');
    const exchangeTotalCount = document.getElementById('exchange-total-count');
    const exchangeActiveCount = document.getElementById('exchange-active-count');
    const exchangeInactiveCount = document.getElementById('exchange-inactive-count');
    const hasManagementPage = Boolean(userForm || userList || exchangeForm || exchangeList);

    if (!hasManagementPage) {
        return false;
    }

    let editingExchangeId = null;
    let cachedExchanges = [];

    function updateExchangePasswordField(exchangeReference) {
        if (!exchangePasswordGroup) {
            return;
        }

        const reference = exchangeReference ?? exchangeForm?.elements?.acronym?.value;
        const usesPassphrase = exchangeUsesPassphrase(reference);

        exchangePasswordGroup.hidden = !usesPassphrase;

        if (exchangePasswordLabel) {
            exchangePasswordLabel.textContent = usesPassphrase ? 'Passphrase' : 'Password / Passphrase';
        }

        if (exchangePasswordInput) {
            exchangePasswordInput.placeholder = usesPassphrase
                ? 'Informe a passphrase da exchange'
                : 'Opcional para exchanges que exigem esse campo';

            if (!usesPassphrase) {
                exchangePasswordInput.value = '';
            }
        }
    }

    function showUserForm() {
        if (!userFormContainer) {
            return;
        }

        userFormContainer.hidden = false;
    }

    function hideUserForm() {
        if (!userFormContainer || !userForm || !userFormFeedback) {
            return;
        }

        userFormContainer.hidden = true;
        userForm.reset();
        userFormFeedback.textContent = '';
        userFormFeedback.classList.remove('success');
    }

    function showExchangeForm(exchange = null) {
        if (!exchangeFormContainer || !exchangeForm || !exchangeFormFeedback) {
            return;
        }

        editingExchangeId = exchange?._id || null;
        exchangeFormContainer.hidden = false;
        exchangeForm.reset();

        if (exchange) {
            if (exchangeFormTitle) {
                exchangeFormTitle.textContent = `Editar ${exchange.name}`;
            }
            if (exchangeFormHint) {
                exchangeFormHint.textContent = 'Atualize os dados desejados. Deixe API Key, Secret Key e Password/Passphrase em branco para manter as credenciais atuais.';
            }
            if (exchangeFormSubmit) {
                exchangeFormSubmit.textContent = 'Salvar alterações';
            }
            exchangeForm.elements.name.value = exchange.name || '';
            exchangeForm.elements.acronym.value = exchange.acronym || '';
            exchangeForm.elements.envInfo.value = exchange.envInfo || '';
            exchangeForm.elements.notes.value = exchange.notes || '';
            if (exchangeForm.elements.assetsMode) {
                exchangeForm.elements.assetsMode.value = exchange.assetsMode || 'list';
            }
            if (exchangeForm.elements.active) {
                exchangeForm.elements.active.checked = Boolean(exchange.active);
            }
            if (exchangeForm.elements.enableLiveTrading) {
                exchangeForm.elements.enableLiveTrading.checked = Boolean(exchange.enableLiveTrading);
            }

            function populateConfig(prefix, configObject) {
                if (!configObject) {
                    return;
                }
                for (const [key, value] of Object.entries(configObject)) {
                    const fieldName = `${prefix}.${key}`;
                    const element = exchangeForm.elements[fieldName];
                    if (element) {
                        if (element.type === 'checkbox') {
                            element.checked = Boolean(value);
                        } else if (value !== null && value !== undefined) {
                            element.value = value;
                        }
                    }
                }
            }

            populateConfig('arbitrageConfig', exchange.arbitrageConfig);
            populateConfig('marketMakingConfig', exchange.marketMakingConfig);
            updateExchangePasswordField(exchange.acronym);
        } else {
            if (exchangeFormTitle) {
                exchangeFormTitle.textContent = 'Cadastrar corretora';
            }
            if (exchangeFormHint) {
                exchangeFormHint.textContent = 'Informe nome e sigla. Credenciais são opcionais no cadastro manual e Password/Passphrase é usado por exchanges como OKX.';
            }
            if (exchangeFormSubmit) {
                exchangeFormSubmit.textContent = 'Salvar corretora';
            }
            if (exchangeForm.elements.active) {
                exchangeForm.elements.active.checked = true;
            }
            if (exchangeForm.elements.enableLiveTrading) {
                exchangeForm.elements.enableLiveTrading.checked = false;
            }
            updateExchangePasswordField('');
        }

        exchangeFormFeedback.textContent = '';
        exchangeFormFeedback.classList.remove('success');
    }

    function hideExchangeForm() {
        if (!exchangeFormContainer || !exchangeForm || !exchangeFormFeedback) {
            return;
        }

        editingExchangeId = null;
        exchangeFormContainer.hidden = true;
        exchangeForm.reset();
        exchangeFormFeedback.textContent = '';
        exchangeFormFeedback.classList.remove('success');
        if (exchangeFormTitle) {
            exchangeFormTitle.textContent = 'Cadastrar corretora';
        }
        if (exchangeFormHint) {
            exchangeFormHint.textContent = 'Informe nome e sigla. Credenciais são opcionais no cadastro manual e Password/Passphrase é usado por exchanges como OKX.';
        }
        if (exchangeFormSubmit) {
            exchangeFormSubmit.textContent = 'Salvar corretora';
        }
        updateExchangePasswordField('');
    }

    function renderUserList(users) {
        if (!userList || !userCountLabel) {
            return;
        }

        if (users.length === 0) {
            userList.innerHTML = '<div class="empty">Nenhum usuário cadastrado ainda.</div>';
            userCountLabel.textContent = 'Nenhum usuário cadastrado';
            return;
        }

        userCountLabel.textContent = `${users.length} usuário(s) cadastrado(s)`;
        userList.innerHTML = users.map((user) => `
            <article class="entity-card">
                <div class="entity-card-top">
                    <div>
                        <h3 class="entity-title">@${escapeHtml(user.username)}</h3>
                        <div class="entity-subtitle">${escapeHtml(user.name)} · ${escapeHtml(user.mail)}</div>
                    </div>
                    <span class="badge ${user.stopTrader ? 'badge-inactive' : 'badge-active'}">${user.stopTrader ? 'Trader pausado' : 'Trader ativo'}</span>
                </div>
                <div class="entity-card-bottom">
                    <div class="entity-meta">Criado em ${formatDateTime(user.created_at)}</div>
                    <div class="entity-actions">
                        <button class="secondary" data-action="toggle-user" data-username="${escapeHtml(user.username)}" data-stop-trader="${String(!user.stopTrader)}">
                            ${user.stopTrader ? 'Reativar trader' : 'Parar trader'}
                        </button>
                    </div>
                </div>
            </article>
        `).join('');
    }

    async function loadUsers() {
        if (!userList) {
            return;
        }

        try {
            const result = await fetchJson(buildApiUrl('users'));
            renderUserList(Array.isArray(result.users) ? result.users : []);
        } catch (error) {
            userList.innerHTML = `<div class="empty">Erro ao carregar usuários: ${escapeHtml(error.message)}</div>`;
            if (userCountLabel) {
                userCountLabel.textContent = 'Falha ao carregar usuários';
            }
            showToast(`Erro ao carregar usuários: ${error.message}`, 'error');
        }
    }

    async function toggleStopTrader(username, stopTrader) {
        try {
            await fetchJson(buildApiUrl(`users/${encodeURIComponent(username)}`), {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ stopTrader })
            });

            showToast(`Usuário ${stopTrader ? 'pausado' : 'ativado'} com sucesso!`, 'success');
            await loadUsers();
        } catch (error) {
            showToast(`Erro ao atualizar usuário: ${error.message}`, 'error');
        }
    }

    function renderExchangeSummary(exchanges) {
        if (!exchangeTotalCount || !exchangeActiveCount || !exchangeInactiveCount) {
            return;
        }

        const activeCount = exchanges.filter((exchange) => exchange.active).length;
        exchangeTotalCount.textContent = String(exchanges.length);
        exchangeActiveCount.textContent = String(activeCount);
        exchangeInactiveCount.textContent = String(exchanges.length - activeCount);
    }

    function renderEnvInfoSections(sections) {
        if (!Array.isArray(sections) || sections.length === 0) {
            return '';
        }

        return `
            <div class="exchange-env-info">
                ${sections.map((section) => `
                    <section class="exchange-env-section">
                        <div class="exchange-env-title">${escapeHtml(section.title || 'Geral')}</div>
                        <div class="exchange-env-items">
                            ${(Array.isArray(section.items) ? section.items : []).map((item) => `<span class="exchange-env-item">${escapeHtml(item)}</span>`).join('')}
                        </div>
                    </section>
                `).join('')}
            </div>
        `;
    }

    function renderExchangeList(exchanges) {
        if (!exchangeList) {
            return;
        }

        renderExchangeSummary(exchanges);

        if (exchanges.length === 0) {
            exchangeList.innerHTML = '<div class="empty">Nenhuma corretora cadastrada ainda.</div>';
            return;
        }

        exchangeList.innerHTML = exchanges.map((exchange) => {
            const credentialSummary = [
                `API ${escapeHtml(exchange.apiKeyMasked || 'não configurada')}`,
                `Secret ${exchange.hasSecretKey ? 'configurada' : 'não configurada'}`
            ];

            const envInfoMarkup = Array.isArray(exchange.envInfoSections) && exchange.envInfoSections.length > 0
                ? `
                    <div class="entity-note entity-note-env">
                        <strong>Info do .env</strong>
                        ${renderEnvInfoSections(exchange.envInfoSections)}
                    </div>
                `
                : '';

            if (exchangeUsesPassphrase(exchange.acronym)) {
                credentialSummary.push(`Passphrase ${exchange.hasPassword ? 'configurada' : 'não configurada'}`);
            }

            return `
            <article class="entity-card" data-exchange-id="${escapeHtml(exchange._id)}">
                <div class="entity-card-top">
                    <div>
                        <h3 class="entity-title">${escapeHtml(exchange.name)}</h3>
                        <div class="entity-subtitle">${escapeHtml(exchange.acronym)}${exchange.envInfo ? ' · sincronizada do .env' : ''}</div>
                    </div>
                    <span class="badge ${exchange.active ? 'badge-active' : 'badge-inactive'}">${exchange.active ? 'Ativa' : 'Inativa'}</span>
                </div>
                <div class="entity-card-meta">
                    <div class="entity-credentials">${credentialSummary.join(' · ')}</div>
                    <div class="entity-meta">Atualizada em ${formatDateTime(exchange.updatedAt || exchange.created_at)}</div>
                </div>
                <div class="entity-note">${escapeHtml(exchange.notes || 'Sem observações cadastradas.')}</div>
                ${envInfoMarkup}
                <div class="entity-card-bottom">
                    <div class="entity-meta">ID ${escapeHtml(exchange._id)}</div>
                    <div class="entity-actions">
                        <button class="secondary" data-action="edit-exchange" data-id="${escapeHtml(exchange._id)}">Editar</button>
                        <button class="secondary" data-action="toggle-exchange" data-id="${escapeHtml(exchange._id)}">${exchange.active ? 'Desativar' : 'Ativar'}</button>
                        <button class="secondary button-danger" data-action="delete-exchange" data-id="${escapeHtml(exchange._id)}">Excluir</button>
                    </div>
                </div>
            </article>
        `;
        }).join('');
    }

    async function loadExchanges() {
        if (!exchangeList) {
            return;
        }

        try {
            const result = await fetchJson(buildApiUrl('exchanges'));
            cachedExchanges = Array.isArray(result.exchanges) ? result.exchanges : [];
            renderExchangeList(cachedExchanges);
        } catch (error) {
            exchangeList.innerHTML = `<div class="empty">Erro ao carregar corretoras: ${escapeHtml(error.message)}</div>`;
            renderExchangeSummary([]);
            showToast(`Erro ao carregar corretoras: ${error.message}`, 'error');
        }
    }

    async function submitExchangeForm(event) {
        event.preventDefault();

        const formData = new FormData(exchangeForm);
        const assetsModeValue = exchangeForm.elements.assetsMode?.value || formData.get('assetsMode') || 'list';
        const payload = {
            name: formData.get('name')?.trim(),
            acronym: formData.get('acronym')?.trim().toUpperCase(),
            apiKey: formData.get('apiKey')?.trim(),
            secretKey: formData.get('secretKey')?.trim(),
            password: formData.get('password')?.trim(),
            envInfo: formData.get('envInfo')?.trim(),
            notes: formData.get('notes')?.trim(),
            assetsMode: assetsModeValue.trim().toLowerCase(),
            active: exchangeForm.elements.active.checked,
            enableLiveTrading: exchangeForm.elements.enableLiveTrading?.checked ?? false
        };

        function processConfig(prefix, form) {
            const config = {};
            let hasValue = false;

            for (const element of form.elements) {
                if (!element.name || !element.name.startsWith(prefix)) {
                    continue;
                }

                const key = element.name.substring(prefix.length);
                let value;

                if (element.type === 'checkbox') {
                    value = element.checked;
                } else if (element.type === 'number') {
                    value = element.value.trim() === '' ? null : Number(element.value);
                } else {
                    value = element.value.trim() === '' ? null : element.value.trim();
                }

                if (value !== undefined) {
                    config[key] = value;
                    hasValue = true;
                }
            }
            return hasValue ? config : null;
        }

        const existingExchange = editingExchangeId ? cachedExchanges.find(ex => ex._id === editingExchangeId) : null;

        const newArbitrageConfig = processConfig('arbitrageConfig.', exchangeForm);
        if (newArbitrageConfig) {
            const existingArbitrageConfig = existingExchange?.arbitrageConfig || {};
            payload.arbitrageConfig = { ...existingArbitrageConfig, ...newArbitrageConfig };
        }

        const newMarketMakingConfig = processConfig('marketMakingConfig.', exchangeForm);
        if (newMarketMakingConfig) {
            const existingMarketMakingConfig = existingExchange?.marketMakingConfig || {};
            payload.marketMakingConfig = { ...existingMarketMakingConfig, ...newMarketMakingConfig };
        }

        if (!payload.name || !payload.acronym) {
            exchangeFormFeedback.textContent = 'Nome e sigla são obrigatórios.';
            exchangeFormFeedback.classList.remove('success');
            return;
        }

        if ((!editingExchangeId || payload.apiKey || payload.secretKey) && ((payload.apiKey && !payload.secretKey) || (!payload.apiKey && payload.secretKey))) {
            exchangeFormFeedback.textContent = 'API Key e Secret Key devem ser informadas juntas quando houver credenciais.';
            exchangeFormFeedback.classList.remove('success');
            return;
        }

        if (editingExchangeId) {
            if (!payload.apiKey) {
                delete payload.apiKey;
            }

            if (!payload.secretKey) {
                delete payload.secretKey;
            }

            if (!payload.password) {
                delete payload.password;
            }
        }

        exchangeFormFeedback.textContent = editingExchangeId ? 'Salvando alterações...' : 'Criando corretora...';
        exchangeFormFeedback.classList.remove('success');
        exchangeFormSubmit.disabled = true;

        try {
            const url = editingExchangeId 
                ? buildApiUrl(`exchanges/${encodeURIComponent(editingExchangeId)}`)
                : buildApiUrl('exchanges');
            await fetchJson(url, {
                method: editingExchangeId ? 'PUT' : 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            exchangeFormFeedback.textContent = editingExchangeId ? 'Corretora atualizada com sucesso.' : 'Corretora criada com sucesso.';
            exchangeFormFeedback.classList.add('success');
            showToast(editingExchangeId ? 'Corretora atualizada com sucesso!' : 'Corretora criada com sucesso!', 'success');
            await loadExchanges();

            window.setTimeout(() => {
                hideExchangeForm();
            }, 1200);
        } catch (error) {
            exchangeFormFeedback.textContent = error.message;
            exchangeFormFeedback.classList.remove('success');
            showToast(error.message, 'error');
        } finally {
            exchangeFormSubmit.disabled = false;
        }
    }

    async function toggleExchangeStatus(exchangeId) {
        try {
            await fetchJson(buildApiUrl(`exchanges/${encodeURIComponent(exchangeId)}/toggle`), {
                method: 'PATCH'
            });

            showToast('Status da corretora alterado com sucesso!', 'success');
            await loadExchanges();
        } catch (error) {
            showToast(`Erro ao alterar status: ${error.message}`, 'error');
        }
    }

    async function deleteExchangeRecord(exchangeId) {
        try {
            await fetchJson(buildApiUrl(`exchanges/${encodeURIComponent(exchangeId)}`), {
                method: 'DELETE'
            });

            if (editingExchangeId === exchangeId) {
                hideExchangeForm();
            }

            showToast('Corretora excluída com sucesso!', 'success');
            await loadExchanges();
        } catch (error) {
            showToast(`Erro ao excluir corretora: ${error.message}`, 'error');
        }
    }

    if (btnShowUserForm && userFormContainer) {
        btnShowUserForm.addEventListener('click', () => {
            if (userFormContainer.hidden) {
                showUserForm();
                return;
            }

            hideUserForm();
        });
    }

    if (btnCancelUserForm) {
        btnCancelUserForm.addEventListener('click', hideUserForm);
    }

    if (userForm) {
        userForm.addEventListener('submit', async (event) => {
            event.preventDefault();

            const formData = new FormData(userForm);
            const userData = {
                username: formData.get('username')?.trim(),
                name: formData.get('name')?.trim(),
                mail: formData.get('mail')?.trim(),
                password: formData.get('password')
            };

            if (!userData.username || !userData.name || !userData.mail || !userData.password) {
                userFormFeedback.textContent = 'Todos os campos são obrigatórios.';
                userFormFeedback.classList.remove('success');
                return;
            }

            if (userData.password.length < 6) {
                userFormFeedback.textContent = 'A senha deve ter pelo menos 6 caracteres.';
                userFormFeedback.classList.remove('success');
                return;
            }

            userFormFeedback.textContent = 'Criando usuário...';
            userFormFeedback.classList.remove('success');

            try {
                await fetchJson(buildApiUrl('users'), {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(userData)
                });

                userFormFeedback.textContent = 'Usuário criado com sucesso!';
                userFormFeedback.classList.add('success');
                showToast('Usuário criado com sucesso!', 'success');
                await loadUsers();

                window.setTimeout(() => {
                    hideUserForm();
                }, 1200);
            } catch (error) {
                userFormFeedback.textContent = error.message;
                userFormFeedback.classList.remove('success');
                showToast(error.message, 'error');
            }
        });
    }

    if (btnShowExchangeForm) {
        btnShowExchangeForm.addEventListener('click', () => {
            if (exchangeFormContainer.hidden) {
                showExchangeForm();
                return;
            }

            hideExchangeForm();
        });
    }

    if (btnCancelExchangeForm) {
        btnCancelExchangeForm.addEventListener('click', hideExchangeForm);
    }

    if (exchangeForm) {
        exchangeForm.addEventListener('submit', submitExchangeForm);

        if (exchangeForm.elements.acronym) {
            exchangeForm.elements.acronym.addEventListener('input', (event) => {
                updateExchangePasswordField(event.target.value);
            });
        }
    }

    if (exchangeList) {
        exchangeList.addEventListener('click', async (event) => {
            const button = event.target.closest('button[data-action]');

            if (!button) {
                return;
            }

            const { action, id } = button.dataset;
            const exchange = cachedExchanges.find((item) => item._id === id);

            try {
                if (action === 'edit-exchange') {
                    showExchangeForm(exchange);
                    return;
                }

                if (action === 'toggle-exchange') {
                    button.disabled = true;
                    await toggleExchangeStatus(id);
                    return;
                }

                if (action === 'delete-exchange') {
                    const confirmed = window.confirm(`Excluir a corretora ${exchange?.name || id}?`);

                    if (!confirmed) {
                        return;
                    }

                    button.disabled = true;
                    await deleteExchangeRecord(id);
                }
            } catch (error) {
                exchangeFormFeedback.textContent = error.message;
                exchangeFormFeedback.classList.remove('success');
                showToast(error.message, 'error');
            } finally {
                button.disabled = false;
            }
        });
    }

    if (userList) {
        userList.addEventListener('click', async (event) => {
            const button = event.target.closest('button[data-action="toggle-user"]');

            if (!button) {
                return;
            }

            button.disabled = true;

            try {
                await toggleStopTrader(button.dataset.username, button.dataset.stopTrader === 'true');
            } finally {
                button.disabled = false;
            }
        });
    }

    loadUsers();
    loadExchanges();
    return true;
}