/**
 * Camera: follows a world point (art px) with a smooth lerp, clamps to the
 * zone, and hands systems a `cam` object each frame:
 *   cam.x, cam.y        device px of world origin (same as FX's cam)
 *   cam.zoom            device px per art px
 *   cam.tw, cam.th      device px per tile (32*zoom, 18*zoom)
 *   cam.toScreen(tx, ty) -> {x, y} device px of a tile-unit point (= RPG.camera.toScreen)
 *   cam.push(footY, fn) joins the 'sorted' layer (footY in tiles); fn(ctx, cam)
 * biasY (art px) shifts the view, e.g. so a dialog never covers the hero.
 */
(function (root) {
  'use strict';

  const TW = 32;
  const TH = 18;

  function Camera() {
    this.x = 0; // art px at the screen centre
    this.y = 0;
    this.ready = false;
    this.s = 4;
    this.cw = 1;
    this.ch = 1;
    this.originX = 0;
    this.originY = 0;
    this.biasY = 0;
    this.biasNow = 0;
    const self = this;
    this.view = {
      x: 0, y: 0, zoom: 4, tw: TW * 4, th: TH * 4, w: 1, h: 1,
      toScreen: function (tx, ty) { return { x: self.originX + tx * TW * self.s, y: self.originY + ty * TH * self.s }; },
      push: null, // set by the renderer for the 'sorted' layer
    };
  }

  Camera.prototype.setViewport = function (cw, ch, s) {
    this.cw = cw;
    this.ch = ch;
    this.s = s;
  };

  /** Follow art-px point (ax, ay) within a zone of zw x zh art px. */
  Camera.prototype.follow = function (ax, ay, zw, zh, dt, snap) {
    const vw = this.cw / this.s;
    const vh = this.ch / this.s;
    const kb = snap ? 1 : 1 - Math.exp(-dt * 6);
    this.biasNow += (this.biasY - this.biasNow) * kb;
    let x = ax;
    let y = ay + this.biasNow;
    x = zw <= vw ? zw / 2 : Math.max(vw / 2, Math.min(zw - vw / 2, x));
    const minY = vh / 2 + Math.min(0, this.biasNow);
    const maxY = zh - vh / 2 + Math.max(0, this.biasNow);
    y = zh <= vh ? zh / 2 + this.biasNow : Math.max(minY, Math.min(maxY, y));
    if (snap || !this.ready) {
      this.x = x;
      this.y = y;
      this.ready = true;
    } else {
      const k = 1 - Math.exp(-dt * 8);
      this.x += (x - this.x) * k;
      this.y += (y - this.y) * k;
    }
    this.originX = Math.round(this.cw / 2 - this.x * this.s);
    this.originY = Math.round(this.ch / 2 - this.y * this.s);
    const v = this.view;
    v.x = this.originX;
    v.y = this.originY;
    v.zoom = this.s;
    v.tw = TW * this.s;
    v.th = TH * this.s;
    v.w = this.cw;
    v.h = this.ch;
  };

  /** Device px -> art px. */
  Camera.prototype.toWorld = function (dx, dy) {
    return { x: (dx - this.originX) / this.s, y: (dy - this.originY) / this.s };
  };

  /**
   * Tile coords -> {x, y} in canvas device px: the same space the 'ui'
   * layer's ctx draws in (identity transform). Also cam.toScreen for systems.
   */
  Camera.prototype.toScreen = function (tx, ty) {
    return { x: this.originX + tx * TW * this.s, y: this.originY + ty * TH * this.s };
  };

  /** Art px -> device px (core rendering). */
  Camera.prototype.artToScreen = function (ax, ay) {
    return { x: this.originX + ax * this.s, y: this.originY + ay * this.s };
  };

  /** Device px -> tile coords. */
  Camera.prototype.toTile = function (dx, dy) {
    return { x: (dx - this.originX) / (TW * this.s), y: (dy - this.originY) / (TH * this.s) };
  };

  root.RpgCamera = { Camera: Camera };
})(typeof window !== 'undefined' ? window : globalThis);
