# Automatonic

automatonic is a library that, for now, is meant to be used within [Electron](http://electron.atom.io) app for browser automation. Electron provides pretty good APIs for doing automation, but they're not particularly convenient for things like automated testing. There _are_ things like [Nightmare.js](http://www.nightmarejs.org) the provide an abstraction on top of Electron, and this is largely inspired by those.

## Why not just use Nightmare.js?

Well, there are a few reasons:

1. The page I was trying to test would cause Nightmare.js to freeze, but the same test when run manually in Electron or PhantomJS worked fine.
2. You can't use Nightmare.js from within an Electron app.
3. You can't test multi-session interaction (multiple browsers, like chat) because you only get access to one BrowserWindow.

## API

All of the API methods return a Promise, and all of them use an internal queue to make sure actions run in the correct order. As this is still in a proof-of-concept phase, the API is fairly limited. At some point, there _may_ be an API to use directly from node that spins up a child process with Electron and proxies back and forth like Nightmare.js.

### Browser

* __constructor([options object])__ or `Browser.new([options object])`
  > The options object is passed straight through to Electron's `BrowserWindow`.
  > The automatonic specific options are:
  * __pollInterval__: number of milliseconds between element checks when waiting for an element to appear. Default is 200.
  * __typingInterval__: number of milliseconds between characters when typing into an input. Default is 50.

#### Properties

* __browser__
  > The `BrowserWindow` instance belonging to this `Browser`.

#### Methods

* __goto(url[, options object])__
  > Navigate to the given `url`. Any options are passed directly to `BrowserWindow.loadURL`, and the returned Promise resolves when the page load is complete.

* __execute(function[, ...args])__ 
  > Execute the given function in the browser by `toString()`ing it, `JSON.stringify`ing the arguments, shipping them to the render instance, wrapping everything up in a Promise, and returning the result.

* __click(selector[, options object])__ 
  > Find an element with the given selector and trigger `mouseover`, `mousedown`, `click`, and `mouseup` events. This will wait up to 1s (default, change with the `timeout` option) for the element to appear.

* __type(selector, string[, options object])__
  > Find an element with the given selector, focus it, and then pass each character from the string into the target element. Each character will trigger `keydown`, `keypress`, update the value, `input`, and `keyup`. Once all of the characters are added, a `change` event will be triggered. This will wait up to 1s (default, change with the `timeout` option) for the element to appear. Specifying `append: true` will not empty the target input before sending characters.

* __waitFor(selector, timeout = 5000)__
  > Wait up to `timeout` milliseconds for an element matching `selector` to appear on the page.

* __checkFor(selector)__
  > Immediately check to see if an element matching `selector` exists.

* __checkForText(string)__
  > Immediately check to see if `string` exists in the page HTML. If `string` is a RegExp, then its `test` method will be used to determine whether or not there is a match.

* __checkpoint()__
  > Sets a checkpoint in the queue. If any step before the checkpoint fails, everything between the checkpoint and the failure will be removed from the queue. The Promise returned will resolve when all of the steps before the checkpoint have resolved.

* __close()__
  > Closes and disposes of the Browser.

### Utility methods

* __run(generator)__
  > This is basically a copy of [co](https://github.com/tj/co) that only allows `yield`ing Promises. This is particularly useful for allowing easy branching within an automation. This returns a Promise that resolves when the generator has nothing left to `yield`.

* __sleep(milliseconds)__
  > Returns a Promise that resolves after `milliseconds`ms have elapsed.

## Usage
```js
const { Browser, run, sleep } = require('automatonic');
run(function*() {
  const I = new Browser();
  I.goto('https://google.com');

  // let's give 'em a second to settle
  yield sleep(1000);

  // do a search
  I.type('#lst-ib', 'automatonic\n');
  I.click('button[name=btnG]');

  // wait for a result and grab its title
  I.waitFor('h3.r a');
  const first = yield I.execute(function() {
    return document.querySelector('h3.r a').innerText;
  });

  if (~first.toLowerCase().indexOf('wikipedia')) {
    console.log("hey look, it's a Wikipedia link");
  } else {
    console.log("it's not a Wikipedia link, let's click it");
    I.click('h3.r a');
  }

  yield sleep(20000);
  I.close();
}).then(null, err => {
  console.error('OH NOES!', err);
});
```
