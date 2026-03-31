// Background script for the Slack Message Scraper extension
chrome.runtime.onInstalled.addListener(() => {
  // Extension installed/updated — no action needed
});

// Handle messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'downloadFile') {
    const { filename, data, mimeType } = request;

    // MV3 service workers do not have Blob/URL.createObjectURL.
    // Encode the text as a data: URL instead — chrome.downloads accepts it directly.
    const base64 = btoa(unescape(encodeURIComponent(data)));
    const dataUrl = `data:${mimeType};base64,${base64}`;

    chrome.downloads.download({
      url: dataUrl,
      filename: filename,
      saveAs: false
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ success: true, downloadId });
      }
    });

    return true; // Will respond asynchronously
  }
});

// Handle extension icon click
chrome.action.onClicked.addListener((tab) => {
  // Inject the scraper if not already present
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    function: initializeScraper
  });
});

function initializeScraper() {
  // Placeholder — content script handles initialization
}
