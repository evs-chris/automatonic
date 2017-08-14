const { app } = require('electron');
const { noop, delay } = require('./utils');

let whenReady = (function() {
  if (app.isReady()) return function(fn) { return fn(); };
  const queue = [];
  let ready = false;

  const proxy = function(fn) {
    if (fn) queue.push(fn);

    if (ready) {
      ready = false;
      let next;
      while (next = queue.shift()) {
        try {
          next();
        } catch (e) {
          console.error('Error in queued function:', e); // eslint-disable-line no-console
        }
      }
      ready = true;
      whenReady = function(fn) { return fn(); };
    }
  };

  app.on('ready', () => {
    ready = true;
    proxy();
  });

  return proxy;
})();

function redigest(browser) {
  browser._queue.running = false;
  delay(0).then(() => digest(browser));
}
function digest(browser) {
  whenReady(() => {
    const next = browser._queue.shift();
    if (!next) return;

    browser._queue.running = true;
    const [fn, ok, fail] = next;
    if (fn.length) {
      fn(v => {
        ok(v);
        redigest(browser);
      }, e => {
        fail(e);
        browser.halt(e);
        redigest(browser);
      });
    } else {
      const res = fn();
      if (typeof res === 'object' && typeof res.then === 'function') {
        res.then(v => {
          ok(v);
          redigest(browser);
        }, e => {
          fail(e);
          browser.halt(e);
          redigest(browser);
        });
      } else {
        ok(res);
        redigest(browser);
      }
    }
  });
}

function queue(browser, fn) {
  const promise = new Promise((ok, fail) => {
    browser._queue.push([fn, ok, fail]);
    if (browser._queue.length === 1 && !browser._queue.running) {
      digest(browser);
    }
  });
  promise.and = browser;
  return promise;
}

function execute(browser, fn, ...args) {
  const script = `new Promise(ok => ok((${fn.toString()})(${args.map(JSON.stringify).join(',')}))).then(null, err => { return Promise.reject({ message: err.message, stack: err.stack }); })`;
  return browser.browser.webContents.executeJavaScript(script, noop);
}


function waitFor(browser, selector, timeout = 5000) {
  return new Promise((done, err) => {
    const start = Date.now();
    const check = () => {
      execute(browser, selector => { return !!document.querySelector(selector); }, selector).then(found => {
        if (!found) {
          if (Date.now() - start < timeout) setTimeout(check, browser.pollInterval);
          else err(`Could not find element '${selector}' in allotted time (${timeout}ms)`);
        } else done(true);
      }, err);
    };
    check();
  });
}

function waitForQueue(browser, selector, fn, timeout = 5000) {
  return queue(browser, () => {
    return waitFor(browser, selector, timeout).then(() => fn.call(browser));
  });
}

module.exports.whenReady = whenReady;
module.exports.digest = digest;
module.exports.queue = queue;
module.exports.execute = execute;
module.exports.waitFor = waitFor;
module.exports.waitForQueue = waitForQueue;
