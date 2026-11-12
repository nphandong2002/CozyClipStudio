import { useCallback, useRef, useState } from 'react';

/**
 * Project state with undo/redo.
 * - update(fn)            : mutate a clone of the current state → one undo step.
 * - update(fn, 'tag')     : coalesce rapid edits sharing a tag (a drag, arrow nudges)
 *                           into a single undo step.
 * - setProject(next)      : replace state and clear history (open / preset / new).
 */
export function useHistory(initial) {
  const [project, setState] = useState(initial);
  const past = useRef([]);
  const future = useRef([]);
  const burst = useRef({ tag: null, t: 0 });

  const update = useCallback((fn, coalesce) => {
    setState((cur) => {
      const next = structuredClone(cur);
      fn(next);
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const sameBurst = coalesce && coalesce === burst.current.tag && now - burst.current.t < 900;
      if (!sameBurst) {
        past.current.push(cur);
        if (past.current.length > 120) past.current.shift();
        future.current = [];
      }
      burst.current = { tag: coalesce || null, t: now };
      return next;
    });
  }, []);

  const undo = useCallback(() => {
    setState((cur) => {
      if (!past.current.length) return cur;
      future.current.push(cur);
      burst.current = { tag: null, t: 0 };
      return past.current.pop();
    });
  }, []);

  const redo = useCallback(() => {
    setState((cur) => {
      if (!future.current.length) return cur;
      past.current.push(cur);
      burst.current = { tag: null, t: 0 };
      return future.current.pop();
    });
  }, []);

  const setProject = useCallback((next) => {
    past.current = [];
    future.current = [];
    burst.current = { tag: null, t: 0 };
    setState(next);
  }, []);

  return { project, update, setProject, undo, redo };
}
