(function () {
    'use strict';

    if (window.slackScraperExtension) {
        const ui = document.getElementById('slack-scraper-ui');
        if (ui) {
            ui.style.display = '';
            const content = ui.querySelector('.scraper-content');
            if (content) content.classList.remove('collapsed');
        }
        return;
    }

    /* ── Helpers ─────────────────────────────────── */
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    function waitForElement(selector, timeoutMs = 8000) {
        return new Promise((resolve, reject) => {
            const el = document.querySelector(selector);
            if (el) return resolve(el);
            const obs = new MutationObserver(() => {
                const found = document.querySelector(selector);
                if (found) { obs.disconnect(); resolve(found); }
            });
            obs.observe(document.body, { childList: true, subtree: true });
            setTimeout(() => { obs.disconnect(); reject(new Error(`Timeout: ${selector}`)); }, timeoutMs);
        });
    }

    /* ════════════════════════════════════════════════
       Main class
    ════════════════════════════════════════════════ */
    class SlackMessageScraper {
        constructor() {
            this.isScrapingActive = false;
            this.isPaused = false;
            this.isStopped = false;
            this.scrapedMessages = [];
            this.ui = null;
            this.currentPage = 1;
            this.totalPages = 0;
            this.channels = [];
            this.allChannelResults = [];
            this.exportedFiles = [];
            this.channelStatuses = {};

            // Channel picker state
            this.selectedChannels = [];   // [{ name: '#foo', type: 'channel'|'private' }]
            this.pickerMode = 'pick'; // 'pick' | 'manual'
            this.sidebarChannels = [];   // all channels read from sidebar
            this.pickerFilter = '';

            this.init();
        }

        init() {
            this.createUI();
            this.setupEventListeners();
            // Automatically wait for Slack's sidebar to load, then fetch channels
            this.autoLoadChannels();
        }

        async autoLoadChannels() {
            const list = document.getElementById('picker-list');
            if (list) list.innerHTML = '<div class="picker-empty">Waiting for Slack to load…</div>';

            // Poll for up to 15 seconds waiting for at least one channel element to appear in the DOM
            for (let i = 0; i < 30; i++) {
                if (document.querySelector('[data-qa-channel-sidebar-channel="true"]')) {
                    await this.refreshSidebarChannels();
                    return;
                }
                await sleep(500);
            }

            // Fallback if Slack never loaded or the selector changed
            if (list) list.innerHTML = '<div class="picker-empty">Could not automatically load channels. Click ↺ to retry.</div>';
        }

        /* ══════════════════════════════════════════
           UI CREATION
        ══════════════════════════════════════════ */
        createUI() {
            document.getElementById('slack-scraper-ui')?.remove();

            const container = document.createElement('div');
            container.id = 'slack-scraper-ui';
            container.innerHTML = `
                <!-- Header -->
                <div class="scraper-header">
                    <div class="scraper-header-left">
                        <div class="scraper-logo">
                            <svg viewBox="0 0 54 54" xmlns="http://www.w3.org/2000/svg">
                                <path fill="#611f69" d="M19.7 0C16 0 13 3 13 6.7A6.7 6.7 0 0 0 19.7 13.4h6.7V6.7C26.4 3 23.4 0 19.7 0zM19.7 18H6.7A6.7 6.7 0 0 0 0 24.7 6.7 6.7 0 0 0 6.7 31.4H40.2A6.7 6.7 0 0 0 46.9 24.7 6.7 6.7 0 0 0 40.2 18z"/>
                            </svg>
                        </div>
                        <div>
                            <div style="color:#fff;font-size:13.5px;font-weight:700;margin:0;">Slack Scraper</div>
                            <div class="header-subtitle">Multi-channel export</div>
                        </div>
                    </div>
                    <div class="header-controls">
                        <button id="scraper-toggle" class="toggle-btn" title="Collapse">−</button>
                    </div>
                </div>

                <!-- Body -->
                <div class="scraper-content">

                    <!-- ── CHANNELS ────────────────── -->
                    <div class="section">
                        <div class="section-label">Channels</div>

                        <!-- Tab bar -->
                        <div class="picker-tabs">
                            <button class="picker-tab active" id="tab-pick" data-tab="pick">
                                <span>⌖</span> Pick from Sidebar
                            </button>
                            <button class="picker-tab" id="tab-manual" data-tab="manual">
                                <span>✎</span> Manual
                            </button>
                        </div>

                        <!-- Pick tab -->
                        <div class="picker-pane" id="pane-pick">
                            <div class="picker-search-row">
                                <div class="picker-search-wrap">
                                    <span class="picker-search-icon">⌕</span>
                                    <input type="text" id="picker-search" class="picker-search-input" placeholder="Search channels…" autocomplete="off" spellcheck="false">
                                </div>
                                <button class="action-btn secondary picker-refresh-btn" id="picker-refresh" title="Refresh channel list">↺</button>
                            </div>
                            <div class="picker-list" id="picker-list">
                                <div class="picker-empty" id="picker-empty">Loading channels from sidebar…</div>
                            </div>
                        </div>

                        <!-- Manual tab -->
                        <div class="picker-pane" id="pane-manual" style="display:none">
                            <div class="input-group" style="margin-bottom:0">
                                <textarea id="channel-input" placeholder="#general&#10;#engineering&#10;#announcements" rows="4"></textarea>
                            </div>
                        </div>

                        <!-- Selected chips -->
                        <div class="selected-header" id="selected-header" style="display:none">
                            <span class="selected-label">Selected <span id="selected-count" class="selected-badge">0</span></span>
                            <button class="selected-clear" id="selected-clear">Clear all</button>
                        </div>
                        <div class="selected-chips" id="selected-chips"></div>
                    </div>

                    <!-- ── DATE RANGE ──────────────── -->
                    <div class="section">
                        <div class="section-label">Date Range</div>
                        <div class="date-row">
                            <div class="input-group">
                                <label for="start-date">From</label>
                                <input type="date" id="start-date" />
                            </div>
                            <div class="input-group">
                                <label for="end-date">To</label>
                                <input type="date" id="end-date" />
                            </div>
                        </div>
                    </div>

                    <!-- ── ACTIONS ─────────────────── -->
                    <div class="btn-row">
                        <button id="start-scraping" class="action-btn primary">▶ Start</button>
                        <button id="pause-scraping" class="action-btn pause" disabled>⏸ Pause</button>
                        <button id="stop-scraping"  class="action-btn stop"  disabled>■ Stop</button>
                        <button id="reset-scraping" class="action-btn secondary">↺ Reset</button>
                    </div>

                    <!-- Retry warning -->
                    <div class="retry-bar" id="retry-bar">
                        ⚠ Some channels may have loaded slowly — retry triggered automatically.
                    </div>

                    <div class="divider"></div>

                    <!-- ── STATUS ──────────────────── -->
                    <div class="status-section">
                        <div id="status-display">Ready — select channels and dates above</div>
                        <div id="progress-bar"><div id="progress-fill"></div></div>

                        <div class="stats-grid">
                            <div class="stat-card highlight">
                                <div class="stat-label">Messages</div>
                                <div class="stat-value" id="total-message-count">0</div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-label">Channels done</div>
                                <div class="stat-value" id="completed-count">0</div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-label">Pages</div>
                                <div class="stat-value" id="pages-processed">0</div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-label">Expanded</div>
                                <div class="stat-value" id="expanded-count">0</div>
                            </div>
                        </div>

                        <div class="channel-progress-row" id="channel-progress-row" style="display:none">
                            <span class="channel-tag" id="processing-channel">#—</span>
                            <span class="channel-counter" id="channel-counter">0/0</span>
                        </div>
                        <div class="page-info-row" id="page-info-row" style="display:none">
                            <span style="color:#555">page</span>
                            <span class="page-badge" id="current-page">—</span>
                            <span style="color:#555">of</span>
                            <span class="page-badge" id="total-pages">—</span>
                        </div>

                        <div class="channel-list" id="channel-list" style="display:none"></div>
                    </div>

                    <!-- ── DOWNLOAD QUEUE ──────────── -->
                    <div class="downloads-section">
                        <div class="downloads-header">
                            <div class="downloads-title">
                                📦 Downloads
                                <span class="queue-badge empty" id="queue-badge">0</span>
                            </div>
                            <div class="downloads-controls">
                                <button id="download-all-btn" class="action-btn secondary" disabled style="font-size:11px;padding:5px 10px;">↓ All</button>
                                <button id="clear-queue-btn"  class="action-btn danger"     disabled style="font-size:11px;padding:5px 10px;">✕</button>
                            </div>
                        </div>
                        <div id="export-list" class="export-list">
                            <div class="export-empty" id="export-empty">No files yet — scrape some channels first</div>
                        </div>
                    </div>

                </div><!-- /scraper-content -->
            `;

            document.body.appendChild(container);
            this.ui = container;

            this.exportList = container.querySelector('#export-list');
            this.downloadAllBtn = container.querySelector('#download-all-btn');
            this.clearQueueBtn = container.querySelector('#clear-queue-btn');
            this.queueBadge = container.querySelector('#queue-badge');

            this.makeDraggable(container.querySelector('.scraper-header'), container);
        }

        /* ══════════════════════════════════════════
           EVENT LISTENERS
        ══════════════════════════════════════════ */
        setupEventListeners() {
            // Collapse toggle
            document.getElementById('scraper-toggle').addEventListener('click', () => {
                const content = document.querySelector('.scraper-content');
                const toggle = document.getElementById('scraper-toggle');
                content.classList.toggle('collapsed');
                toggle.textContent = content.classList.contains('collapsed') ? '+' : '−';
                toggle.title = content.classList.contains('collapsed') ? 'Expand' : 'Collapse';
            });

            // Tab switching
            document.querySelectorAll('.picker-tab').forEach(btn => {
                btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
            });

            // Picker search
            document.getElementById('picker-search').addEventListener('input', (e) => {
                this.pickerFilter = e.target.value.trim().toLowerCase();
                this.renderPickerList();
            });

            // Refresh sidebar
            document.getElementById('picker-refresh').addEventListener('click', () => {
                this.refreshSidebarChannels();
            });

            // Clear all selected
            document.getElementById('selected-clear').addEventListener('click', () => {
                this.selectedChannels = [];
                this.renderPickerList();
                this.renderSelectedChips();
            });

            // Manual textarea auto-prefix #
            document.getElementById('channel-input').addEventListener('input', (e) => {
                const lines = e.target.value.split('\n');
                const fixed = lines.map(l => {
                    const t = l.trim();
                    return (t && !t.startsWith('#')) ? '#' + t : t;
                });
                const newVal = fixed.join('\n');
                if (newVal !== e.target.value) e.target.value = newVal;
            });

            // Scraping controls
            document.getElementById('start-scraping').addEventListener('click', () => this.startMultiChannelScraping());
            document.getElementById('pause-scraping').addEventListener('click', () => this.togglePause());
            document.getElementById('stop-scraping').addEventListener('click',  () => this.stopScraping());
            document.getElementById('reset-scraping').addEventListener('click', () => this.resetScraping());
            this.downloadAllBtn.addEventListener('click', () => this.downloadAllExports());
            this.clearQueueBtn.addEventListener('click', () => this.clearQueue());
        }

        /* ══════════════════════════════════════════
           CHANNEL PICKER
        ══════════════════════════════════════════ */

        /** Read all relevant channels from Slack's sidebar DOM */
        readSidebarChannels() {
            const items = document.querySelectorAll('[data-qa-channel-sidebar-channel="true"]');
            const channels = [];
            const seen = new Set();

            items.forEach(item => {
                const type = item.getAttribute('data-qa-channel-sidebar-channel-type');
                // Only include real channels and private channels (not IMs/group DMs)
                if (type !== 'channel' && type !== 'private') return;

                // Get the visible name
                const nameEl = item.querySelector('.p-channel_sidebar__name > span, .p-channel_sidebar__name span');
                if (!nameEl) return;

                const rawName = nameEl.textContent.trim();
                if (!rawName || seen.has(rawName)) return;
                seen.add(rawName);

                // Determine if private (lock icon)
                const iconEl = item.querySelector('[data-sidebar-channel-icon]');
                const iconType = iconEl ? iconEl.getAttribute('data-sidebar-channel-icon') : '';
                const isPrivate = iconType === 'lock' || type === 'private';

                channels.push({
                    name: rawName.startsWith('#') ? rawName : '#' + rawName,
                    type: isPrivate ? 'private' : 'channel'
                });
            });

            return channels;
        }

        async refreshSidebarChannels() {
            const list = document.getElementById('picker-list');

            // Show loading state
            if (list) list.innerHTML = '<div class="picker-empty">Expanding sidebar sections…</div>';

            // Step 1: expand all collapsed sections so their channels are in the DOM
            await this.expandAllSidebarSections();

            // Step 2: read all visible channel items
            this.sidebarChannels = this.readSidebarChannels();

            if (this.sidebarChannels.length === 0) {
                if (list) list.innerHTML = '<div class="picker-empty">No channels found. Make sure you are on a Slack workspace page.</div>';
            } else {
                this.renderPickerList();
            }
        }

        /**
         * Expands all collapsed section headings in the Slack sidebar so their
         * child channels are rendered into the DOM before we read them.
         * Selector: sections with data-qa-channel-section-collapsed="true".
         * Returns the number of sections that were expanded.
         */
        async expandAllSidebarSections() {
            // Find every collapsed section heading
            const collapsedHeadings = document.querySelectorAll(
                '.p-channel_sidebar__section_heading[data-qa-channel-section-collapsed="true"]'
            );

            if (!collapsedHeadings.length) return 0;

            let count = 0;
            for (const heading of collapsedHeadings) {
                // The toggle button is the child button with data-qa starting with
                // "section_heading_toggle_and_label__"
                const toggleBtn = heading.querySelector(
                    'button[data-qa^="section_heading_toggle_and_label__"]'
                );
                if (toggleBtn) {
                    toggleBtn.click();
                    count++;
                    // Small stagger to avoid overwhelming Slack's event loop
                    await sleep(80);
                }
            }

            if (count > 0) {
                // Give the virtual list time to render the newly visible items
                await sleep(700);
            }

            return count;
        }

        switchTab(tab) {
            this.pickerMode = tab;
            document.querySelectorAll('.picker-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
            document.getElementById('pane-pick').style.display = tab === 'pick' ? '' : 'none';
            document.getElementById('pane-manual').style.display = tab === 'manual' ? '' : 'none';

            // On switching to pick, refresh the list
            if (tab === 'pick' && this.sidebarChannels.length === 0) {
                this.refreshSidebarChannels(); // async — fire and forget
            }
        }

        renderPickerList() {
            const list = document.getElementById('picker-list');
            if (!list) return;

            const filter = this.pickerFilter;
            const filtered = this.sidebarChannels.filter(ch =>
                !filter || ch.name.toLowerCase().includes(filter)
            );

            if (filtered.length === 0) {
                list.innerHTML = `<div class="picker-empty">${this.sidebarChannels.length === 0
                    ? 'No channels found. Click ↺ to refresh.'
                    : `No channels match "${filter}"`
                    }</div>`;
                return;
            }

            list.innerHTML = '';
            const selectedNames = new Set(this.selectedChannels.map(c => c.name));

            filtered.forEach(ch => {
                const isSelected = selectedNames.has(ch.name);
                const item = document.createElement('div');
                item.className = `picker-item${isSelected ? ' selected' : ''}`;
                item.dataset.name = ch.name;
                item.innerHTML = `
                    <span class="picker-item-icon">${ch.type === 'private' ? '🔒' : '#'}</span>
                    <span class="picker-item-name">${ch.name.replace(/^#/, '')}</span>
                    <span class="picker-item-check">${isSelected ? '✓' : ''}</span>
                `;
                item.addEventListener('click', () => this.toggleChannelSelection(ch));
                list.appendChild(item);
            });
        }

        toggleChannelSelection(ch) {
            const idx = this.selectedChannels.findIndex(c => c.name === ch.name);
            if (idx === -1) {
                this.selectedChannels.push(ch);
            } else {
                this.selectedChannels.splice(idx, 1);
            }
            this.renderPickerList();
            this.renderSelectedChips();
        }

        renderSelectedChips() {
            const chipsEl = document.getElementById('selected-chips');
            const headerEl = document.getElementById('selected-header');
            const countEl = document.getElementById('selected-count');
            if (!chipsEl) return;

            const count = this.selectedChannels.length;
            if (headerEl) headerEl.style.display = count > 0 ? '' : 'none';
            if (countEl) countEl.textContent = count;

            chipsEl.innerHTML = '';
            this.selectedChannels.forEach(ch => {
                const chip = document.createElement('div');
                chip.className = 'selected-chip';
                chip.innerHTML = `
                    <span class="chip-icon">${ch.type === 'private' ? '🔒' : '#'}</span>
                    <span class="chip-name">${ch.name.replace(/^#/, '')}</span>
                    <button class="chip-remove" title="Remove">✕</button>
                `;
                chip.querySelector('.chip-remove').addEventListener('click', () => {
                    this.toggleChannelSelection(ch);
                });
                chipsEl.appendChild(chip);
            });
        }

        /* ══════════════════════════════════════════
           VALIDATION — reads from picker OR textarea
        ══════════════════════════════════════════ */
        validateInputs() {
            let channels = [];

            if (this.pickerMode === 'pick') {
                channels = this.selectedChannels.map(c => c.name);
                if (!channels.length) return { isValid: false, error: 'Select at least one channel from the picker' };
            } else {
                const text = document.getElementById('channel-input').value.trim();
                if (!text) return { isValid: false, error: 'Enter at least one channel name' };
                channels = text.split('\n').map(l => l.trim()).filter(Boolean)
                    .map(c => c.startsWith('#') ? c : '#' + c);
                if (!channels.length) return { isValid: false, error: 'No valid channels found' };
            }

            const startDate = document.getElementById('start-date').value;
            const endDate = document.getElementById('end-date').value;
            if (!startDate || !endDate) return { isValid: false, error: 'Both start and end dates are required' };
            if (new Date(startDate) > new Date(endDate)) return { isValid: false, error: 'Start date must be before end date' };

            return { isValid: true, channels, startDate, endDate };
        }

        generateSearchQuery(channel, startDate, endDate) {
            return `after:${startDate} before:${endDate} in:${channel}`;
        }

        /* ══════════════════════════════════════════
           CONTROLS — pause / stop / reset
        ══════════════════════════════════════════ */

        /** Update button enabled/label states based on scraping phase */
        setControlState(phase) {
            // phase: 'idle' | 'running' | 'paused'
            const startBtn = document.getElementById('start-scraping');
            const pauseBtn = document.getElementById('pause-scraping');
            const stopBtn  = document.getElementById('stop-scraping');
            const resetBtn = document.getElementById('reset-scraping');
            if (!startBtn) return;

            if (phase === 'running') {
                startBtn.disabled = true;
                pauseBtn.disabled = false;
                pauseBtn.textContent = '⏸ Pause';
                stopBtn.disabled  = false;
                resetBtn.disabled = true;
            } else if (phase === 'paused') {
                startBtn.disabled = true;
                pauseBtn.disabled = false;
                pauseBtn.textContent = '▶ Resume';
                stopBtn.disabled  = false;
                resetBtn.disabled = true;
            } else {
                // idle
                startBtn.disabled = false;
                pauseBtn.disabled = true;
                pauseBtn.textContent = '⏸ Pause';
                stopBtn.disabled  = true;
                resetBtn.disabled = false;
            }
        }

        togglePause() {
            if (!this.isScrapingActive) return;
            this.isPaused = !this.isPaused;
            if (this.isPaused) {
                this.setControlState('paused');
                this.updateStatus('Paused — click Resume to continue', 0);
            } else {
                this.setControlState('running');
            }
        }

        stopScraping() {
            if (!this.isScrapingActive) return;
            this.isStopped = true;
            this.isPaused  = false;
            this.updateStatus('Stopping…', 0);
        }

        resetScraping() {
            // Reset stats and status display to initial state
            this.updateStatus('Ready — select channels and dates above', 0);
            this.updateStat('total-message-count', 0);
            this.updateStat('completed-count', 0);
            this.updateStat('pages-processed', 0);
            this.updateStat('expanded-count', 0);
            document.getElementById('current-page').textContent = '—';
            document.getElementById('total-pages').textContent  = '—';
            const pageRow    = document.getElementById('page-info-row');
            const channelRow = document.getElementById('channel-progress-row');
            const channelList = document.getElementById('channel-list');
            if (pageRow)    pageRow.style.display    = 'none';
            if (channelRow) channelRow.style.display = 'none';
            if (channelList){ channelList.innerHTML = ''; channelList.style.display = 'none'; }
            this.showRetryBar(false);
            this.allChannelResults = [];
            this.setControlState('idle');
        }

        /** Suspend execution while paused; resolves immediately if stopped */
        async waitIfPaused() {
            while (this.isPaused && !this.isStopped) {
                await sleep(300);
            }
        }

        /* ══════════════════════════════════════════
           DRAG
        ══════════════════════════════════════════ */
        makeDraggable(handle, element) {
            let isDragging = false, startX, startY, initialX, initialY;
            handle.addEventListener('mousedown', (e) => {
                if (e.target.closest('button')) return;
                isDragging = true;
                startX = e.clientX; startY = e.clientY;
                initialX = element.offsetLeft; initialY = element.offsetTop;
                document.addEventListener('mousemove', drag);
                document.addEventListener('mouseup', stopDrag);
            });
            function drag(e) {
                if (!isDragging) return;
                element.style.left = (initialX + e.clientX - startX) + 'px';
                element.style.top = (initialY + e.clientY - startY) + 'px';
                element.style.right = 'auto';
            }
            function stopDrag() {
                isDragging = false;
                document.removeEventListener('mousemove', drag);
                document.removeEventListener('mouseup', stopDrag);
            }
        }

        /* ══════════════════════════════════════════
           SEARCH MODAL
        ══════════════════════════════════════════ */
        findSearchModal() {
            // Strategy 1: dedicated data-qa containers Slack uses for search
            const directSelectors = [
                '[data-qa="search_modal"]',
                '[data-qa="search-modal"]',
                '.c-search_modal__wrapper',
                '.c-search__modal',
                '[aria-label="Search"]',
            ];
            for (const sel of directSelectors) {
                const el = document.querySelector(sel);
                if (el && !el.hasAttribute('hidden') && el.offsetParent !== null) return el;
            }

            // Strategy 2: any visible dialog that contains a search input
            for (const dialog of document.querySelectorAll('[role="dialog"]')) {
                if (dialog.hasAttribute('hidden')) continue;
                if (dialog.getAttribute('aria-label') === 'Huddle') continue;
                if (dialog.querySelector('[data-qa="focusable_search_input"], .c-search__input_box, .c-search_modal__wrapper')) return dialog;
            }

            // Strategy 3: the search input itself may be a top-level overlay (not in a dialog)
            const floatingInput = document.querySelector('[data-qa="focusable_search_input"]');
            if (floatingInput && floatingInput.offsetParent !== null) {
                // Walk up to find the panel root (first ancestor that looks like a container)
                let node = floatingInput;
                while (node && node !== document.body) {
                    node = node.parentElement;
                    if (node && (
                        node.classList.contains('c-search_modal__wrapper') ||
                        node.classList.contains('c-search__modal') ||
                        node.getAttribute('data-qa') === 'search_modal' ||
                        node.getAttribute('role') === 'dialog'
                    )) return node;
                }
                // Return the floatingInput's closest overlay-like ancestor
                return floatingInput.closest('[class*="search"]') || floatingInput.parentElement;
            }

            return null;
        }

        findSearchInput(modal = null) {
            if (!modal) modal = this.findSearchModal();
            if (!modal) return null;
            for (const sel of [
                '[data-qa="focusable_search_input"] .ql-editor[role="combobox"]',
                '[data-qa="focusable_search_input"] .ql-editor',
                '.c-search__input_box .ql-editor',
                '.ql-editor[role="combobox"]'
            ]) {
                const el = modal.querySelector(sel);
                if (el && el.contentEditable === 'true') return el;
            }
            return null;
        }

        async closeSearchModal() {
            if (!this.findSearchModal()) return;
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
            await sleep(300);
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
            // Wait until modal is gone (up to 2 s)
            for (let i = 0; i < 10; i++) {
                await sleep(200);
                if (!this.findSearchModal()) return;
            }
        }

        async openSearchModal() {
            // Always start from a clean state — close whatever is open first
            await this.closeSearchModal();

            this.updateStatus('Opening search modal…', 12);

            // Attempt 1: Ctrl+K (most reliable keyboard shortcut)
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', keyCode: 75, ctrlKey: true, bubbles: true }));
            await sleep(2000);
            let modal = this.findSearchModal();
            if (modal) return modal;

            // Attempt 2: click the top-nav search button (various data-qa values Slack has used)
            const searchBtnSelectors = [
                '[data-qa="top_nav_search"]',
                '[data-qa="search-button"]',
                '[aria-label="Search"]',
                'button[data-sk="tooltip_parent_label_search"]',
                '.p-top_nav__search button',
            ];
            for (const sel of searchBtnSelectors) {
                const btn = document.querySelector(sel);
                if (btn) {
                    btn.click();
                    await sleep(2000);
                    modal = this.findSearchModal();
                    if (modal) return modal;
                    break;
                }
            }

            // Attempt 3: wait up to 6 s for the input to appear in the DOM
            try {
                await waitForElement('[data-qa="focusable_search_input"]', 6000);
                modal = this.findSearchModal();
                if (modal) return modal;
            } catch (_) { }

            // Attempt 4: try Ctrl+/ (alternate Slack shortcut) then wait
            document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', keyCode: 191, ctrlKey: true, bubbles: true }));
            await sleep(2000);
            modal = this.findSearchModal();
            if (modal) return modal;

            throw new Error('Could not open Slack search modal');
        }

        async typeInSearchInput(searchInput, text) {
            searchInput.innerHTML = '<p><br></p>';
            searchInput.focus();
            await sleep(200);
            const paragraph = searchInput.querySelector('p');
            if (!paragraph) { searchInput.textContent = text; return; }
            paragraph.innerHTML = '';
            for (let i = 0; i < text.length; i++) {
                paragraph.textContent += text[i];
                if (i % 3 === 0) searchInput.dispatchEvent(new Event('input', { bubbles: true }));
                await sleep(25);
            }
            searchInput.dispatchEvent(new Event('change', { bubbles: true }));
            searchInput.dispatchEvent(new Event('keyup', { bubbles: true }));
        }

        async executeSearch(searchInput) {
            this.updateStatus('Waiting for suggestions…', 55);
            let suggestions = [];
            for (let i = 0; i < 8; i++) {
                await sleep(500);
                suggestions = Array.from(document.querySelectorAll('.c-search_autocomplete__suggestion_item[role="option"]'));
                if (suggestions.length > 0) break;
            }
            let found = false;
            for (const s of suggestions) {
                if (s.getAttribute('data-replacement')) { s.click(); found = true; this.updateStatus('Selected suggestion…', 65); break; }
            }
            if (!found) {
                searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
                this.updateStatus('Submitted search…', 65);
            }
            this.updateStatus('Loading results…', 70);
            for (let i = 0; i < 12; i++) {
                await sleep(500);
                if (document.querySelectorAll('.c-search_message_result, .c-search_result__message, [data-qa="search_result"]').length > 0) break;
                if (i === 6) searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
            }
            await sleep(800);
        }

        async applySearchFilters(searchQuery) {
            this.updateStatus('Opening search…', 10);
            const modal = await this.openSearchModal();
            this.updateStatus('Locating input…', 20);
            await sleep(600);
            let searchInput = null;
            for (let i = 0; i < 6; i++) { searchInput = this.findSearchInput(modal); if (searchInput) break; await sleep(400); }
            if (!searchInput) throw new Error('Could not find the search input field');
            this.updateStatus('Typing query…', 35);
            searchInput.innerHTML = '<p><br></p>';
            await sleep(300);
            await this.typeInSearchInput(searchInput, searchQuery);
            await this.executeSearch(searchInput);
            this.updateStatus('Applying sort…', 75);
            await this.applySortByOldest();
            return true;
        }

        /* ── Sort ─────────────────────────────────── */
        findSortButton() {
            return Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Sort:'));
        }

        async applySortByOldest() {
            await sleep(1500);
            const sortButton = this.findSortButton();
            if (!sortButton) return false;
            if (sortButton.textContent.includes('Oldest')) return true;
            sortButton.click();
            await sleep(1000);
            const opt = await this.findOldestOption();
            if (!opt) return false;
            opt.click();
            this.updateStatus('Sorted by oldest…', 78);
            await sleep(2000);
            return true;
        }

        async findOldestOption() {
            for (let i = 0; i < 5; i++) {
                const dropdown = document.querySelector('.c-select_options_list, [role="listbox"]');
                if (dropdown) {
                    const option = dropdown.querySelector('[data-qa="timestamp_asc"]') ||
                        Array.from(dropdown.querySelectorAll('[role="option"]')).find(o => o.textContent.includes('Oldest'));
                    if (option) return option;
                }
                await sleep(300);
            }
            return null;
        }

        /* ── Pagination ───────────────────────────── */
        getPaginationInfo() {
            const wrapper = document.querySelector('.c-pagination_wrapper');
            if (!wrapper) return { currentPage: 1, totalPages: 1, hasNext: false, hasPrev: false };
            let currentPage = 1;
            const attr = wrapper.getAttribute('data-qa-current-page');
            if (attr) currentPage = parseInt(attr) || 1;
            else {
                const active = wrapper.querySelector('.c-pagination__page_btn--active');
                if (active) currentPage = parseInt(active.textContent.trim()) || 1;
            }
            let totalPages = 1;
            wrapper.querySelectorAll('.c-pagination__page_btn').forEach(btn => {
                const n = parseInt(btn.textContent.trim());
                if (!isNaN(n) && n > totalPages) totalPages = n;
            });
            const nextBtn = wrapper.querySelector('[data-qa="c-pagination_forward_btn"]');
            const prevBtn = wrapper.querySelector('[data-qa="c-pagination_back_btn"]');
            const hasNext = nextBtn && nextBtn.getAttribute('aria-disabled') !== 'true';
            const hasPrev = prevBtn && prevBtn.getAttribute('aria-disabled') !== 'true';
            if (hasNext && currentPage >= totalPages) totalPages = Math.max(totalPages, currentPage + 1);
            return { currentPage, totalPages, hasNext, hasPrev };
        }

        async navigateToFirstPage() {
            const info = this.getPaginationInfo();
            if (info.currentPage === 1) { this.updatePageInfo(1, info.totalPages); return true; }
            this.updateStatus('Navigating to first page…', 83);
            return this.navigateToPage(1);
        }

        async navigateToPage(targetPage) {
            try {
                const current = this.getPaginationInfo();
                if (current.currentPage === targetPage) return true;
                const btn = document.querySelector(`[data-qa="c-pagination_page_btn_${targetPage}"]`);
                if (btn) {
                    btn.click(); await sleep(1500);
                    if (this.getPaginationInfo().currentPage === targetPage) {
                        this.currentPage = targetPage;
                        this.updatePageInfo(targetPage, this.getPaginationInfo().totalPages);
                        return true;
                    }
                }
                const isForward = targetPage > current.currentPage;
                const selector = isForward ? '[data-qa="c-pagination_forward_btn"]' : '[data-qa="c-pagination_back_btn"]';
                for (let step = 0; step < Math.abs(targetPage - current.currentPage) + 3; step++) {
                    const nav = document.querySelector(selector);
                    if (!nav || nav.getAttribute('aria-disabled') === 'true') break;
                    nav.click(); await sleep(1200);
                    const newInfo = this.getPaginationInfo();
                    if (newInfo.currentPage === targetPage) {
                        this.currentPage = targetPage;
                        this.updatePageInfo(targetPage, newInfo.totalPages);
                        return true;
                    }
                    if (newInfo.currentPage === current.currentPage) break;
                }
                return false;
            } catch (e) { return false; }
        }

        async goToNextPage() {
            try {
                const info = this.getPaginationInfo();
                if (!info.hasNext) return false;
                const nextBtn = document.querySelector('[data-qa="c-pagination_forward_btn"]');
                if (!nextBtn || nextBtn.getAttribute('aria-disabled') === 'true') return false;
                nextBtn.click(); await sleep(1200);
                for (let i = 0; i < 10; i++) {
                    const newInfo = this.getPaginationInfo();
                    if (newInfo.currentPage > this.currentPage) {
                        this.currentPage = newInfo.currentPage;
                        this.totalPages = Math.max(this.totalPages, newInfo.totalPages);
                        this.updatePageInfo(this.currentPage, this.totalPages);
                        return true;
                    }
                    await sleep(300);
                }
                return false;
            } catch (e) { return false; }
        }

        /* ── Expand ───────────────────────────────── */
        findShowMoreButtons() {
            return Array.from(document.querySelectorAll('button.c-search__expand, button[data-qa="unstyled-button"]'))
                .filter(b => { const t = b.textContent; return t && (t.includes('Show more') || t.includes('...') || b.querySelector('.c-search__expand_ellipsis')); });
        }

        async expandAllMessages() {
            try {
                await sleep(800);
                let expanded = 0;
                for (let pass = 0; pass < 2; pass++) {
                    const buttons = this.findShowMoreButtons();
                    if (!buttons.length) break;
                    for (let i = 0; i < buttons.length; i++) {
                        const btn = buttons[i];
                        if (btn.offsetParent !== null && !btn.disabled) {
                            if (i % 10 === 0) { btn.scrollIntoView({ behavior: 'instant', block: 'center' }); await sleep(80); }
                            btn.click(); expanded++;
                            if (i % 5 === 0) await sleep(150);
                        }
                    }
                    await sleep(600);
                }
                return expanded;
            } catch (e) { return 0; }
        }

        /* ── Extract ──────────────────────────────── */
        extractMessages() {
            const results = [];
            document.querySelectorAll('.c-search_message_result, .c-search_result__message, [data-qa="search_result"], .c-virtual_list__item, .c-message_kit__message')
                .forEach((el, idx) => {
                    try {
                        const msg = this.parseMessageElement(el);
                        if (msg && (msg.content || msg.sender)) results.push({ id: idx, ...msg });
                    } catch (_) { }
                });
            return results;
        }

        parseMessageElement(el) {
            const msg = { sender: '', content: '', timestamp: '', channel: '' };
            const senderEl = el.querySelector('[data-qa="message_sender_name"], .c-message__sender, .c-message_kit__sender_name');
            if (senderEl) msg.sender = senderEl.textContent.trim();
            const channelEl = el.querySelector('[data-qa="search_result_channel_name"] .c-channel_entity__name, .c-inline_channel_entity__name, .c-channel_entity__name');
            if (channelEl) msg.channel = channelEl.textContent.trim();
            const contentEl = el.querySelector('[data-qa="message-text"], .c-message__message_blocks, .c-search_result__message_body, .c-message_kit__text, .c-message__body');
            if (contentEl) msg.content = contentEl.textContent.replace(/\.\.\./g, '').replace(/Show more/g, '').replace(/\s+/g, ' ').trim();
            const tsEl = el.querySelector('.c-timestamp, [data-qa="message_timestamp"], .c-message_kit__timestamp, time');
            if (tsEl) msg.timestamp = tsEl.getAttribute('datetime') || tsEl.getAttribute('title') || tsEl.textContent.trim();
            return msg;
        }

        async processAllPages() {
            let all = [], totalExpanded = 0, pagesProcessed = 0;
            this.updateStatus('Navigating to first page…', 82);
            await this.navigateToFirstPage();
            const init = this.getPaginationInfo();
            this.currentPage = init.currentPage; this.totalPages = init.totalPages;
            this.updatePageInfo(this.currentPage, this.totalPages);

            let hasMore = true, failures = 0;
            while (hasMore && failures < 3) {
                // Honour pause/stop between pages
                await this.waitIfPaused();
                if (this.isStopped) break;

                const progress = 85 + (pagesProcessed / Math.max(this.totalPages, pagesProcessed + 1)) * 10;
                this.updateStatus(`Extracting page ${this.currentPage}${this.totalPages > 1 ? '/' + this.totalPages : ''}…`, progress);
                await sleep(900);
                const expanded = await this.expandAllMessages();
                totalExpanded += expanded;
                this.updateStat('expanded-count', totalExpanded);
                const pageMessages = this.extractMessages();
                pageMessages.forEach(m => { m.pageNumber = this.currentPage; m.totalPages = this.totalPages; });
                all = all.concat(pageMessages);
                pagesProcessed++;
                this.updateStat('pages-processed', pagesProcessed);
                const info = this.getPaginationInfo();
                if (info.hasNext) {
                    this.updateStatus(`Navigating to page ${this.currentPage + 1}…`, progress + 2);
                    const navigated = await this.goToNextPage();
                    if (navigated) { failures = 0; const latest = this.getPaginationInfo(); this.totalPages = Math.max(this.totalPages, latest.totalPages, this.currentPage); this.updatePageInfo(this.currentPage, this.totalPages); }
                    else failures++;
                } else { hasMore = false; }
            }
            return all;
        }

        async processSingleChannel(channel, startDate, endDate) {
            const run = async (attempt) => {
                this.updateStat('expanded-count', 0); this.updateStat('pages-processed', 0);
                this.updatePageInfo('—', '—'); this.updateStat('message-count', 0);
                this.updateStatus(`${attempt > 1 ? '↺ Retry — ' : ''}Processing ${channel}…`, 5);
                await this.applySearchFilters(this.generateSearchQuery(channel, startDate, endDate));
                this.updateStatus(`Extracting messages from ${channel}…`, 85);
                const messages = await this.processAllPages();
                messages.forEach(m => { m.sourceChannel = channel; });
                return {
                    channel, messages,
                    messageCount: messages.length,
                    expandedCount: parseInt(document.getElementById('expanded-count')?.textContent) || 0,
                    pagesProcessed: parseInt(document.getElementById('pages-processed')?.textContent) || 0
                };
            };

            let result = await run(1);
            if (result.messageCount === 0) {
                this.showRetryBar(true);
                // Close the modal cleanly before retry so openSearchModal starts fresh
                await this.closeSearchModal();
                await sleep(4000);
                result = await run(2);
                this.showRetryBar(false);
            }
            return result;
        }

        async startMultiChannelScraping() {
            if (this.isScrapingActive) return;
            const validation = this.validateInputs();
            if (!validation.isValid) { this.updateStatus(`⚠ ${validation.error}`, 0); return; }

            this.isScrapingActive = true;
            this.isPaused  = false;
            this.isStopped = false;
            this.allChannelResults = [];
            this.setControlState('running');

            const { channels, startDate, endDate } = validation;
            this.channels = channels;
            this.initChannelList(channels);
            this.updateStat('completed-count', 0); this.updateStat('total-message-count', 0);

            let totalMessages = 0;
            try {
                for (let i = 0; i < channels.length; i++) {
                    // Check for stop between channels
                    await this.waitIfPaused();
                    if (this.isStopped) break;

                    const channel = channels[i];
                    this.updateChannelList(channel, 'active');
                    this.showActiveChannel(channel, i + 1, channels.length);
                    this.updateStatus(`Channel ${i + 1}/${channels.length}: ${channel}`, 0);
                    try {
                        const result = await this.processSingleChannel(channel, startDate, endDate);
                        if (this.isStopped) break;
                        this.allChannelResults.push(result);
                        totalMessages += result.messageCount;
                        this.updateStat('completed-count', i + 1);
                        this.updateStat('total-message-count', totalMessages);
                        this.updateChannelList(channel, 'done', result.messageCount);
                        this.exportSingleChannel(result, startDate, endDate);
                        this.updateStatus(`✓ ${channel} — ${result.messageCount} messages`, 100);
                        if (i < channels.length - 1) {
                            await this.closeSearchModal();
                            await sleep(2500);
                        }
                    } catch (e) {
                        this.updateStatus(`✗ ${channel}: ${e.message}`, 0);
                        this.updateChannelList(channel, 'error');
                        await this.closeSearchModal();
                        await sleep(1500);
                    }
                }
                if (this.isStopped) {
                    this.updateStatus(`Stopped — ${totalMessages} messages saved so far`, 0);
                } else {
                    if (this.allChannelResults.length > 1) this.exportAllChannels(startDate, endDate);
                    this.updateStatus(`✓ Done — ${totalMessages} messages across ${this.allChannelResults.length} channel(s)`, 100);
                }
                this.showActiveChannel(null);
            } catch (e) {
                this.updateStatus(`✗ Error: ${e.message}`, 0);
            } finally {
                this.isScrapingActive = false;
                this.isPaused  = false;
                this.isStopped = false;
                this.setControlState('idle');
            }
        }

        /* ── Export ───────────────────────────────── */
        exportSingleChannel(result, startDate, endDate) {
            const data = { exportedAt: new Date().toISOString(), channel: result.channel, totalMessages: result.messageCount, dateRange: { start: startDate, end: endDate }, sortedBy: 'oldest', pagesProcessed: result.pagesProcessed, expandedCount: result.expandedCount, messages: result.messages };
            this.addToDownloadQueue(`slack-${result.channel.replace('#', '')}-${startDate}-to-${endDate}.json`, data, `${result.messageCount} messages from ${result.channel}`);
        }

        exportAllChannels(startDate, endDate) {
            const data = { exportedAt: new Date().toISOString(), totalChannels: this.allChannelResults.length, totalMessages: this.allChannelResults.reduce((s, r) => s + r.messageCount, 0), dateRange: { start: startDate, end: endDate }, sortedBy: 'oldest', channels: this.allChannelResults.map(r => ({ channel: r.channel, messageCount: r.messageCount })), allMessages: this.allChannelResults.flatMap(r => r.messages) };
            this.addToDownloadQueue(`slack-all-channels-${startDate}-to-${endDate}.json`, data, `Combined: ${data.totalMessages} messages from ${this.allChannelResults.length} channels`);
        }

        /* ── Download queue ───────────────────────── */
        addToDownloadQueue(filename, exportData, description) {
            const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
            const item = { id: Date.now() + Math.random(), filename, url: URL.createObjectURL(blob), blob, description, size: this.formatFileSize(blob.size), createdAt: new Date().toLocaleTimeString() };
            this.exportedFiles.push(item);
            this.renderExportItem(item);
            this.updateQueueInfo();
        }

        renderExportItem(item) {
            document.getElementById('export-empty')?.remove();
            const div = document.createElement('div');
            div.className = 'export-item';
            div.setAttribute('data-id', item.id);
            div.innerHTML = `<div class="export-icon">📄</div><div class="export-info"><div class="export-filename">${item.filename}</div><div class="export-meta">${item.description} · ${item.size} · ${item.createdAt}</div></div><div class="export-actions"><button class="export-btn download" title="Download">↓</button><button class="export-btn remove" title="Remove">✕</button></div>`;
            div.querySelector('.download').addEventListener('click', () => this.downloadSingle(item.id));
            div.querySelector('.remove').addEventListener('click', () => this.removeSingle(item.id));
            this.exportList.appendChild(div);
        }

        downloadSingle(id) { const item = this.exportedFiles.find(i => i.id === id); if (item) this.downloadFile(item.filename, item.blob); }

        async downloadFile(filename, blob) {
            if (chrome && chrome.runtime) {
                try { const text = await blob.text(); chrome.runtime.sendMessage({ action: 'downloadFile', filename, data: text, mimeType: 'application/json' }, (res) => { if (!res?.success) this.fallbackDownload(filename, blob); }); return; } catch (_) { }
            }
            this.fallbackDownload(filename, blob);
        }

        fallbackDownload(filename, blob) {
            const url = URL.createObjectURL(blob), link = document.createElement('a');
            link.href = url; link.download = filename; document.body.appendChild(link); link.click(); document.body.removeChild(link);
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }

        removeSingle(id) {
            const idx = this.exportedFiles.findIndex(i => i.id === id);
            if (idx === -1) return;
            URL.revokeObjectURL(this.exportedFiles[idx].url);
            this.exportedFiles.splice(idx, 1);
            this.exportList.querySelector(`[data-id="${id}"]`)?.remove();
            if (!this.exportedFiles.length) { const e = document.createElement('div'); e.id = 'export-empty'; e.className = 'export-empty'; e.textContent = 'No files yet — scrape some channels first'; this.exportList.appendChild(e); }
            this.updateQueueInfo();
        }

        downloadAllExports() { this.exportedFiles.forEach((item, i) => setTimeout(() => this.downloadSingle(item.id), i * 400)); }

        clearQueue() {
            if (!this.exportedFiles.length) return;
            if (!confirm(`Clear ${this.exportedFiles.length} file(s)?`)) return;
            this.exportedFiles.forEach(i => URL.revokeObjectURL(i.url));
            this.exportedFiles = []; this.exportList.innerHTML = '';
            const e = document.createElement('div'); e.id = 'export-empty'; e.className = 'export-empty'; e.textContent = 'No files yet — scrape some channels first'; this.exportList.appendChild(e);
            this.updateQueueInfo();
        }

        updateQueueInfo() {
            const count = this.exportedFiles.length;
            this.queueBadge.textContent = count; this.queueBadge.className = `queue-badge${count ? '' : ' empty'}`;
            this.downloadAllBtn.disabled = count === 0; this.clearQueueBtn.disabled = count === 0;
        }

        formatFileSize(bytes) { if (!bytes) return '0 B'; const k = 1024, u = ['B', 'KB', 'MB', 'GB'], i = Math.floor(Math.log(bytes) / Math.log(k)); return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + u[i]; }

        /* ── UI helpers ───────────────────────────── */
        updateStatus(message, progress = 0) {
            const el = document.getElementById('status-display'), pb = document.getElementById('progress-fill');
            if (el) el.textContent = message;
            if (pb) pb.style.width = Math.min(100, progress) + '%';
        }
        updateStat(id, value) { const el = document.getElementById(id); if (el) el.textContent = value; }
        updatePageInfo(current, total) { document.getElementById('current-page').textContent = current; document.getElementById('total-pages').textContent = total; const r = document.getElementById('page-info-row'); if (r) r.style.display = ''; }
        showActiveChannel(channel, idx = 0, total = 0) {
            const row = document.getElementById('channel-progress-row');
            if (!channel) { if (row) row.style.display = 'none'; return; }
            if (row) row.style.display = '';
            const tag = document.getElementById('processing-channel'), ctr = document.getElementById('channel-counter');
            if (tag) tag.textContent = channel; if (ctr) ctr.textContent = `${idx}/${total}`;
        }
        showRetryBar(visible) { document.getElementById('retry-bar')?.classList.toggle('visible', visible); }
        initChannelList(channels) {
            const list = document.getElementById('channel-list'); if (!list) return;
            list.innerHTML = ''; list.style.display = '';
            channels.forEach(ch => {
                const item = document.createElement('div');
                item.className = 'channel-list-item pending';
                item.id = 'ch-item-' + ch.replace(/[^a-zA-Z0-9]/g, '_');
                item.innerHTML = `<span class="ch-status"></span><span class="ch-name">${ch}</span><span class="ch-count"></span>`;
                list.appendChild(item);
            });
        }
        updateChannelList(channel, status, count = null) {
            const el = document.getElementById('ch-item-' + channel.replace(/[^a-zA-Z0-9]/g, '_'));
            if (!el) return;
            el.className = `channel-list-item ${status}`;
            if (count !== null) { const c = el.querySelector('.ch-count'); if (c) c.textContent = `${count} msg`; }
        }

        /* ── Test helpers removed — use Start/Pause/Stop/Reset controls ── */
    }

    window.slackScraperExtension = new SlackMessageScraper();
})();
