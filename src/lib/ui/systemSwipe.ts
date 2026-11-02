/**
 * iOS moves between pages itself when you swipe from a screen edge, in Safari and in Home Screen
 * apps, and pages can't turn that off. The swipe has already shown the page sliding in by the
 * time popstate fires, so the app must not animate the same move again.
 *
 * popstate's hasUAVisualTransition says so where it's reported. WebKit hasn't always reported it,
 * so a touch that began at an edge and was then cancelled counts too: the system takes over a
 * touch that way once its swipe starts. A plain tap near the edge ends normally, so a back button
 * there is still animated.
 */

/** Width of the edge area, a little wider than the system's own. */
const EDGE_PX = 32;

export function createSwipeTracker(viewportWidth: () => number) {
  let atEdge = false;
  let swiped = false;

  return {
    touchStart(x: number) {
      atEdge = x <= EDGE_PX || x >= viewportWidth() - EDGE_PX;
      swiped = false;
    },
    touchCancel() {
      swiped = atEdge;
    },
    /** Did the system animate this history move? Answers once per swipe. */
    takeSwipe(hasUAVisualTransition: boolean | undefined): boolean {
      const result = hasUAVisualTransition === true || swiped;
      swiped = false;
      return result;
    },
  };
}
