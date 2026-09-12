/**
 * Mock HTMLCanvasElement.getContext for jsdom tests.
 * jsdom doesn't implement canvas, so getContext throws. Tests that render
 * components using canvas (HeroCanvas, track3d) need it to return null
 * instead, which the components already handle gracefully.
 */
if (typeof HTMLCanvasElement !== "undefined") {
  HTMLCanvasElement.prototype.getContext = function () {
    return null;
  };
}
