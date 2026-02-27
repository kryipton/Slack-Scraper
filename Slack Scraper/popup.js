document.addEventListener('DOMContentLoaded', function () {
    const activateBtn = document.getElementById('activate-btn');
    const reloadBtn = document.getElementById('reload-btn');
    const statusText = document.getElementById('status-text');
    const statusDot = document.getElementById('status-dot');

    function setStatus(type, message) {
        statusText.textContent = message;
        statusDot.className = 'status-dot ' + type;
    }

    // Check if active tab is Slack
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        const tab = tabs[0];
        if (!tab) { setStatus('error', 'No active tab found'); return; }

        if (tab.url && tab.url.includes('slack.com')) {
            setStatus('ready', 'Ready — Slack workspace detected');
            activateBtn.disabled = false;
        } else {
            setStatus('warn', 'Navigate to a Slack workspace first');
            activateBtn.disabled = true;
        }
    });

    // Open / show the scraper panel
    activateBtn.addEventListener('click', function () {
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            const tabId = tabs[0].id;
            chrome.scripting.executeScript(
                { target: { tabId }, function: activateScraper },
                function () {
                    if (chrome.runtime.lastError) {
                        setStatus('error', 'Failed to activate');
                        console.error(chrome.runtime.lastError);
                    } else {
                        setStatus('ready', 'Panel opened!');
                        setTimeout(() => window.close(), 800);
                    }
                }
            );
        });
    });

    // Reload the page (useful after extension update)
    reloadBtn.addEventListener('click', function () {
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            chrome.tabs.reload(tabs[0].id, function () {
                setStatus('ready', 'Page reloaded');
                setTimeout(() => window.close(), 800);
            });
        });
    });
});

// Injected into the Slack page
function activateScraper() {
    const ui = document.getElementById('slack-scraper-ui');
    if (ui) {
        ui.style.display = '';
        const content = ui.querySelector('.scraper-content');
        if (content) content.classList.remove('collapsed');
    } else {
        console.log('[SlackScraper] Panel not found — ensure the extension is loaded and content script ran.');
    }
}
