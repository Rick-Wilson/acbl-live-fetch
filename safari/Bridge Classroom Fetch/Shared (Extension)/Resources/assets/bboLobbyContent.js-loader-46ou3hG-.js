(function () {
  'use strict';

  const injectTime = performance.now();
  (async () => {
    const { onExecute } = await import(
      /* @vite-ignore */
      chrome.runtime.getURL("assets/bboLobbyContent.js-tCwx30eq.js")
    );
    onExecute?.({ perf: { injectTime, loadTime: performance.now() - injectTime } });
  })().catch(console.error);

})();
