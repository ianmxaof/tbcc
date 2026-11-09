/* Example TBCC Utility plugin — extension-only contract. */
(function () {
  "use strict";
  if (globalThis.__tbccExampleHello) return;
  globalThis.__tbccExampleHello = true;
  console.info("[TBCC plugin] example-hello loaded on", location.host);
})();
