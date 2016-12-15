if (!process.versions.electron) {
  console.log('TODO: support launching electron');
  process.exit(1);
}

const { app, BrowserWindow } = require('electron');
function noop() {}

let browsers = [];
let whenReady = (function() {
  if (app.isReady()) return function(fn) { return fn(); };
  const queue = [];
  let ready = false;

  const proxy = function(fn) {
    if (!ready && fn) queue.push(fn);
    else if (ready) {
      ready = false;
      let next;
      while (next = queue.shift()) {
        try {
          next();
        } catch (e) {
          console.error('Error in queued function:', e);
        }
      }
      ready = true;
      whenReady = function(fn) { return fn(); };
    }
  }

  app.on('ready', function() {
    ready = true;
    proxy();
  });

  return proxy;
})()

class Browser {
  constructor (options = {}) {
    this._queue = [];
    this.pollInterval = options.pollInterval || 200;
    this.typingInterval = options.typingInterval || 50;
    browsers.push(this);
    this._queue.push(null);
    options.webPreferences = { nodeIntegration: false };

    whenReady(() => {
      this.browser = new BrowserWindow(options);
      this.browser.on('closed', () => {
        browsers.splice(browsers.indexOf(this), 1);
        this.halt('Browser closed');
      });
      this._queue.shift();
      this._digest();
    });
  }

  _digest() {
    whenReady(() => {
      const next = this._queue.shift();
      if (!next) return;

      this._running = true;
      const [fn, ok, fail] = next;
      if (fn.length) {
        fn(v => {
          ok(v);
          this._running = false;
          this._digest();
        }, e => {
          fail(e);
          this._running = false;
          this.halt(e);
        });
      } else {
        const res = fn();
        if (typeof res === 'object' && typeof res.then === 'function') {
          res.then(v => {
            ok(v);
            this._running = false;
            this._digest();
          }, e => {
            fail(e);
            this._running = false;
            this.halt(e);
          });
        } else {
          ok(res);
          this._running = false;
          this._digest();
        }
      }
    });
  }

  _do(fn) {
    const promise = new Promise((ok, fail) => {
      this._queue.push([fn, ok, fail]);
      if (this._queue.length === 1 && !this._running) {
        this._digest();
      }
    });
    promise.and = this;
    return promise;
  }

  _execute(fn, ...args) {
    const script = `new Promise(ok => ok((${fn.toString()})(${args.map(JSON.stringify).join(',')}))).then(null, err => { return Promise.reject({ message: err.message, stack: err.stack }); })`;
    return this.browser.webContents.executeJavaScript(script, noop);
  }

  execute(fn, ...args) {
    return this._do(() => {
      return this._execute(fn, ...args);
    });
  }

  close() {
    this._do(() => {
      this.browser.close();
    });
  }

  kill() {
    this._do(() => {
      this.browser.destroy();
    });
  }

  goto(url, options) {
    return this._do(done => {
      this.browser.webContents.once('did-finish-load', done);
      this.browser.loadURL(url, options);
    });
  }

  halt(reason) {
    const err = new Error('Queued function failure; draining queue');
    if (reason) err.stack += `\n----------\nCaused by:\n${reason.stack ? reason.stack : reason}`
    let step;
    while (step = this._queue.shift()) {
      if (step[3]) {
        step[2](err);
        break;
      } else {
        step[2](err);
      }
    }
  }

  checkpoint() {
    return new Promise((ok, fail) => {
      this._queue.push([noop, ok, fail, true]);
    });
  }

  _waitFor(selector, timeout = 5000) {
    return new Promise((done, err) => {
      const start = Date.now();
      const check = () => {
        this._execute(function(selector) { return !!document.querySelector(selector); }, selector).then(found => {
          if (!found) {
            if (Date.now() - start < timeout) setTimeout(check, this.pollInterval);
            else this.halt(`Could not find element '${selector}' in allotted time`);
          } else done(true);
        }, err);
      };
      check();
    });
  }
  _waitForDo(selector, fn, timeout = 5000) {
    return this._do(() => {
      return this._waitFor(selector, timeout).then(() => fn.call(this));
    });
  }

  waitFor(selector, timeout) {
    return this._do(() => {
      return this._waitFor(selector, timeout);
    });
  }

  wait(timeout = 1000) {
    return this._do(() => {
      return delay(timeout);
    });
  }

  getTitle() {
    return this._do(() => {
      return new Promise(ok => {
        ok(this.browser.webContents.getTitle());
      });
    });
  }

  click(selector, options = {}) {
    return this._waitForDo(selector, () => {
      return this._execute(function(selector) {
        let el = document.querySelector(selector);
        if (!el) throw new Error(`click: No element matches '${selector}'`);
        function fire(name) {
          const ev = new MouseEvent(name, { cancellable: true, bubbles: true });
          el.dispatchEvent(ev);
        }
        fire('mouseover');
        fire('mousedown');
        fire('click');
        fire('mouseup');
      }, selector);
    }, options.timeout);
  }

  type(selector, str, options = {}) {
    return this._waitForDo(selector, () => {
      return this._execute(function(selector, str, options) {
        let el = document.querySelector(selector);
        if (!el) throw new Error(`type: No element matches '${selector}'`);
        el.focus();
        if (!options.append) el.value = '';
        function letter(a) {
          const keyCode = a.charCodeAt(0);
          el.dispatchEvent(new KeyboardEvent('keydown', { keyCode }));
          el.dispatchEvent(new KeyboardEvent('keypress', { keyCode }));
          el.value += a;
          el.dispatchEvent(new Event('input'));
          el.dispatchEvent(new KeyboardEvent('keyup', { keyCode }));
        }
        return new Promise(ok => {
          const array = str.split('');
          function step() {
            const a = array.shift();
            if (a) {
              letter(a);
              setTimeout(step, options.typingInterval);
            } else {
              el.dispatchEvent(new Event('change'));
              ok();
            }
          }
          step();
        });
      }, selector, str, options);
    }, options.timeout);
  }

  checkFor(selector) {
    return this.execute(function(selector) {
      return !!document.querySelector(selector);
    }, selector);
  }

  checkForText(str) {
    return this.execute(function() {
      return document.body.innerHTML;
    }).then(text => {
      if (typeof str === 'string') return true;
      else if (typeof str.test === 'function') return str.test(text);
    });
  }
}

Browser.new = function(...args) { return new Browser(...args); };

function delay(time) {
  return new Promise(ok => { setTimeout(ok, time); });
}

// shamelessly partially copied from co
function run(generator, ...args) {
  let gen = generator;
  return new Promise((ok, fail) => {
    if (typeof gen === 'function') gen = gen.apply(this, args);
    if (!gen || typeof gen.next !== 'function') return ok(gen);

    fulfilled();

    function fulfilled(res) {
      let ret;
      try {
        ret = gen.next(res);
      } catch (e) {
        return fail(e);
      }
      next(ret);
      return null;
    }

    function rejected(err) {
      let ret;
      try {
        ret = gen.throw(err);
      } catch (e) {
        return fail(e);
      }
      next(ret);
    }

    function next(ret) {
      const value = ret.value;
      if (ret.done) return ok(value);
      if (value && typeof value.then === 'function') return value.then(fulfilled, rejected);
      fail(new TypeError('You may only yield promises'));
    }
  });
}

module.exports.Browser = Browser;
module.exports.run = run;
module.exports.sleep = delay;
