// Background script for the Slack Message Scraper extension
chrome.runtime.onInstalled.addListener(() => {
  console.log('Slack Message Scraper extension installed');
});

// Handle messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'downloadFile') {
    // Handle file downloads
    const { filename, data, mimeType } = request;
    
    // Create a download using Chrome's downloads API
    const blob = new Blob([data], { type: mimeType });
    const url = URL.createObjectURL(blob);
    
    chrome.downloads.download({
      url: url,
      filename: filename,
      saveAs: false
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error('Download failed:', chrome.runtime.lastError);
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        console.log('Download started:', downloadId);
        sendResponse({ success: true, downloadId });
        
        // Clean up the blob URL after a delay
        setTimeout(() => {
          URL.revokeObjectURL(url);
        }, 1000);
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
  // This function will be injected into the page
  if (!window.slackScraperExtension) {
    console.log('Initializing Slack Scraper from extension');
  }
}
