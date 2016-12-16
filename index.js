if (!process.versions.electron) {
  console.log('TODO: support launching electron'); // eslint-disable-line no-console
  process.exit(1);
}

const { BrowserWindow } = require('electron');
const { whenReady, digest, queue, execute, waitFor, waitForQueue } = require('./plumbing');
const { noop, run, delay } = require('./utils');


const browsers = [];
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
      digest(this);
    });
  }

  execute(fn, ...args) {
    return queue(this, () => {
      return execute(this, fn, ...args);
    });
  }

  close() {
    return queue(this, () => {
      this.browser.close();
    });
  }

  kill() {
    return queue(this, () => {
      this.browser.destroy();
    });
  }

  goto(url, options) {
    return queue(this, (done, err) => {
      let sent = false;
      this.browser.webContents.once('did-finish-load', () => {
        if (!sent) {
          sent = true;
          done();
        }
      });
      this.browser.webContents.once('did-fail-load', (event, errorCode, desc, url) => {
        if (!sent) {
          sent = true;
          err(`Failed to navigate to '${url}' (${desc})`);
        }
      });
      this.browser.loadURL(url, options);
    });
  }

  halt(reason) {
    const err = new Error('Queued function failure; draining queue');
    if (reason) err.stack += `\n----------\nCaused by:\n${reason.stack ? reason.stack : reason}`;
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

  waitFor(selector, timeout) {
    return queue(this, () => {
      if (typeof selector === 'number') return delay(selector);
      else return waitFor(this, selector, timeout);
    });
  }

  title() {
    return queue(this, () => {
      return Promise.resolve(this.browser.webContents.getTitle());
    });
  }

  click(selector, options = {}) {
    return waitForQueue(this, selector, () => {
      return execute(this, selector => {
        const el = document.querySelector(selector);
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
    return waitForQueue(this, selector, () => {
      return execute(this, (selector, str, options) => {
        const el = document.querySelector(selector);
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
    return this.execute(selector => {
      return !!document.querySelector(selector);
    }, selector);
  }

  checkForText(str) {
    return this.execute(() => {
      return document.body.innerHTML;
    }).then(text => {
      if (typeof str === 'string') return true;
      else if (typeof str.test === 'function') return str.test(text);
    });
  }
}

Browser.new = function(...args) { return new Browser(...args); };

module.exports.Browser = Browser;
module.exports.run = run;
module.exports.sleep = delay;
