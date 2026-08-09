(function (root) {
  "use strict";

  if (root.setImmediate) {
    return;
  }

  var nextHandle = 1;
  var tasksByHandle = {};
  var currentlyRunningATask = false;

  function setImmediate(callback) {
    if (typeof callback !== "function") {
      throw new TypeError("setImmediate callback must be a function");
    }
    var args = new Array(arguments.length - 1);
    for (var i = 0; i < args.length; i++) {
      args[i] = arguments[i + 1];
    }
    var task = { callback: callback, args: args };
    tasksByHandle[nextHandle] = task;
    registerImmediate(nextHandle);
    return nextHandle++;
  }

  function clearImmediate(handle) {
    delete tasksByHandle[handle];
  }

  function run(task) {
    var callback = task.callback;
    var args = task.args;
    switch (args.length) {
      case 0:
        callback();
        break;
      case 1:
        callback(args[0]);
        break;
      case 2:
        callback(args[0], args[1]);
        break;
      case 3:
        callback(args[0], args[1], args[2]);
        break;
      default:
        callback.apply(undefined, args);
        break;
    }
  }

  function runIfPresent(handle) {
    if (currentlyRunningATask) {
      root.setTimeout(runIfPresent, 0, handle);
      return;
    }
    var task = tasksByHandle[handle];
    if (task) {
      currentlyRunningATask = true;
      try {
        run(task);
      } finally {
        clearImmediate(handle);
        currentlyRunningATask = false;
      }
    }
  }

  var registerImmediate;

  if (typeof root.MessageChannel === "function") {
    var channel = new root.MessageChannel();
    channel.port1.onmessage = function (event) {
      runIfPresent(event.data);
    };
    registerImmediate = function (handle) {
      channel.port2.postMessage(handle);
    };
  } else {
    registerImmediate = function (handle) {
      root.setTimeout(runIfPresent, 0, handle);
    };
  }

  root.setImmediate = setImmediate;
  root.clearImmediate = clearImmediate;
})(window);
