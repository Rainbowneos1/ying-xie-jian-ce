(function () {
  'use strict';
  const SL = (window.StegoLab = window.StegoLab || {});
  SL.core = SL.core || {};

  class RNG {
    constructor(seed) {
      this.state = ((Number(seed) || 0) ^ 0x9e3779b9) >>> 0;
      for (let i = 0; i < 4; i++) this.nextU32();
    }
    nextU32() {
      let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return (t ^ (t >>> 14)) >>> 0;
    }
    next() { return this.nextU32() / 4294967296; }
    int(n) { return n <= 0 ? 0 : Math.floor(this.next() * n); }
    intRange(a, b) { return a + this.int(b - a + 1); }
    choice(arr) { return arr[this.int(arr.length)]; }
    sign() { return this.nextU32() & 1 ? 1 : -1; }
    permutation(n) {
      const a = new Uint32Array(n);
      for (let i = 0; i < n; i++) a[i] = i;
      for (let i = n - 1; i > 0; i--) {
        const j = this.int(i + 1);
        const t = a[i]; a[i] = a[j]; a[j] = t;
      }
      return a;
    }
    normal() {
      let u = 0, v = 0;
      while (u === 0) u = this.next();
      while (v === 0) v = this.next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    }
  }
  SL.core.RNG = RNG;
  SL.core.seedFromKey = (key) => {
    let x = (Number(key) || 0) >>> 0;
    x ^= x >>> 16; x = Math.imul(x, 0x7feb352d);
    x ^= x >>> 15; x = Math.imul(x, 0x846ca68b);
    x ^= x >>> 16;
    return x >>> 0;
  };
})();
