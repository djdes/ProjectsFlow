// Inlined into HTML by Vite: recovery must work even when no module can load.
(function () {
  var ready = false;
  var failed = false;
  var started = Date.now();
  var retryKey = 'pf:boot-retried:' + location.pathname;
  var retryTimer;
  var deadline = setTimeout(function () { showFailure(false); }, 20000);

  function removePanel() {
    var panel = document.getElementById('pf-boot-recovery');
    if (panel) panel.remove();
  }

  function reloadAutomatically() {
    if (ready || !failed || navigator.onLine === false) return;
    try {
      if (sessionStorage.getItem(retryKey)) return;
      sessionStorage.setItem(retryKey, '1');
    } catch (_) {
      // Without persistent storage we cannot prevent a reload loop.
      return;
    }
    location.reload();
  }

  function showFailure(retry) {
    failed = true;
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', function () { showFailure(retry); }, { once: true });
      return;
    }
    if (!document.getElementById('pf-boot-recovery')) {
      var panel = document.createElement('div');
      panel.id = 'pf-boot-recovery';
      panel.setAttribute('role', 'alert');
      panel.innerHTML = '<div><h1>Не удалось загрузить страницу</h1><p>Проверьте соединение с интернетом и попробуйте ещё раз.</p><button type="button">Повторить загрузку</button></div>';
      panel.querySelector('button').addEventListener('click', function () { location.reload(); });
      document.body.appendChild(panel);
    }
    // Never reload a running application automatically: it may contain unsaved input.
    if (retry && !ready && !retryTimer) retryTimer = setTimeout(reloadAutomatically, 800);
  }

  window.addEventListener('pf:app-ready', function () {
    ready = true;
    failed = false;
    clearTimeout(deadline);
    clearTimeout(retryTimer);
    removePanel();
    try { sessionStorage.removeItem(retryKey); } catch (_) { /* Storage is optional. */ }
  });
  window.addEventListener('error', function (event) {
    var target = event.target;
    if (target && (target.tagName === 'SCRIPT' ||
      (target.tagName === 'LINK' && /^(modulepreload|stylesheet)$/.test(target.rel)))) {
      if (!ready) showFailure(true);
    } else if (!ready && event.error) {
      showFailure(false);
    }
  }, true);
  window.addEventListener('vite:preloadError', function () {
    if (!ready) showFailure(true);
  });
  window.addEventListener('pf:page-load-error', function () { showFailure(true); });
  window.addEventListener('unhandledrejection', function (event) {
    var message = String(event.reason && (event.reason.message || event.reason));
    if (/dynamically imported module|module script|Loading chunk|Importing a module/i.test(message)) showFailure(true);
  });
  window.addEventListener('online', reloadAutomatically);
  function checkDeadline() {
    if (!ready && Date.now() - started >= 20000) showFailure(false);
  }
  window.addEventListener('pageshow', checkDeadline);
  document.addEventListener('visibilitychange', checkDeadline);
})();
