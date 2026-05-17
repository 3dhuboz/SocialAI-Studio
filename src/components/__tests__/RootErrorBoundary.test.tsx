/**
 * Tests for RootErrorBoundary — confirms it catches a thrown child and
 * surfaces the recovery UI without white-screening.
 *
 * The project's vitest setup has no jsdom, so we exercise the class API
 * directly:
 *   1. `getDerivedStateFromError` is a pure static — given an Error, it
 *      returns the next state. This is the React-error-boundary contract.
 *   2. `render()` is pure given props/state. We instantiate the boundary
 *      and inspect its output for both happy path and error path.
 *   3. `componentDidCatch` fires the beacon — we mock fetch and assert.
 *
 * This is enough to verify the "child throw → recovery UI" contract that
 * prevents white screens. Full React-tree integration is exercised in the
 * dev/preview build smoke tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isValidElement, type ReactElement } from 'react';
import { RootErrorBoundary } from '../RootErrorBoundary';

function findTextDeep(node: any, needle: string): boolean {
  if (node == null || typeof node === 'boolean') return false;
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node).includes(needle);
  }
  if (Array.isArray(node)) return node.some(n => findTextDeep(n, needle));
  if (isValidElement(node)) {
    const props: any = (node as ReactElement).props;
    return findTextDeep(props.children, needle);
  }
  return false;
}

function findPropDeep(node: any, propName: string, expected: any): boolean {
  if (node == null || typeof node === 'boolean') return false;
  if (typeof node === 'string' || typeof node === 'number') return false;
  if (Array.isArray(node)) return node.some(n => findPropDeep(n, propName, expected));
  if (isValidElement(node)) {
    const props: any = (node as ReactElement).props;
    if (props[propName] === expected) return true;
    return findPropDeep(props.children, propName, expected);
  }
  return false;
}

describe('RootErrorBoundary', () => {
  describe('getDerivedStateFromError', () => {
    it('captures the error into state so the next render shows the recovery UI', () => {
      const err = new Error('boom');
      const next = RootErrorBoundary.getDerivedStateFromError(err);
      expect(next).toEqual({ error: err });
    });
  });

  describe('render output', () => {
    it('renders children when no error has been captured', () => {
      const boundary = new RootErrorBoundary({ children: 'all good' });
      const tree = boundary.render() as any;
      // No error → render returns the raw children prop
      expect(tree).toBe('all good');
    });

    it('renders the recovery UI when state.error is set', () => {
      const boundary = new RootErrorBoundary({ children: 'all good' });
      // Simulate getDerivedStateFromError having fired
      boundary.state = { error: new Error('kaboom') };
      const tree = boundary.render();

      expect(isValidElement(tree)).toBe(true);
      // role="alert" on the outer container so AT users hear the failure
      expect(findPropDeep(tree, 'role', 'alert')).toBe(true);
      // User-facing copy + recovery affordance
      expect(findTextDeep(tree, 'Something went wrong')).toBe(true);
      expect(findTextDeep(tree, 'Reload')).toBe(true);
      // Original error surfaced inside <details>
      expect(findTextDeep(tree, 'kaboom')).toBe(true);
    });
  });

  describe('componentDidCatch beacon', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      fetchSpy = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
      // Don't fail the test on real network — stub global fetch
      (globalThis as any).fetch = fetchSpy;
      consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleErrorSpy.mockRestore();
      delete (globalThis as any).fetch;
    });

    it('posts to /api/client-error with message + stack', () => {
      const boundary = new RootErrorBoundary({ children: null });
      const err = new Error('beacon-test');
      boundary.componentDidCatch(err, { componentStack: '\n    in Foo\n    in Bar' });

      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe('/api/client-error');
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body);
      expect(body.message).toBe('beacon-test');
      expect(body.componentStack).toContain('in Foo');
    });

    it('swallows fetch failures so the boundary never throws on its own reporting', () => {
      fetchSpy.mockReturnValue(Promise.reject(new Error('network down')));
      const boundary = new RootErrorBoundary({ children: null });
      expect(() => {
        boundary.componentDidCatch(new Error('x'), { componentStack: '' });
      }).not.toThrow();
    });
  });
});
