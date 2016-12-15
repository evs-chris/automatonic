function noop() {}

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

module.exports.noop = noop;
module.exports.delay = delay;
module.exports.run = run;
