(function (root) {
  "use strict";

  var queue = [];
  var draining = false;

  function drain() {
    draining = true;
    var i = 0;
    while (i < queue.length) {
      var current = queue;
      queue = [];
      for (; i < current.length; i++) {
        current[i]();
      }
      i = 0;
    }
    draining = false;
  }

  var MutationObserverCtor =
    root.MutationObserver || root.WebKitMutationObserver;
  var scheduleDrain;

  if (MutationObserverCtor && typeof root.document !== "undefined") {
    var toggled = 0;
    var observer = new MutationObserverCtor(drain);
    var node = root.document.createTextNode("");
    observer.observe(node, { characterData: true });

    scheduleDrain = function () {
      toggled = (toggled + 1) % 2;
      node.data = String(toggled);
    };
  } else {
    scheduleDrain = function () {
      root.setTimeout(drain, 0);
    };
  }

  function immediate(task) {
    if (queue.push(task) === 1 && !draining) {
      scheduleDrain();
    }
  }

  module.exports = immediate;
})(window);
