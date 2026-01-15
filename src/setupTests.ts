import '@testing-library/jest-dom';

// Mock ResizeObserver for tests (not available in jsdom)
// Simulates a reasonable container width so charts render in tests
class MockResizeObserver {
    private callback: ResizeObserverCallback;

    constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
    }

    observe(target: Element) {
        // Simulate a reasonable container width
        this.callback([{
            target,
            contentRect: { width: 800, height: 400 } as DOMRectReadOnly,
            borderBoxSize: [],
            contentBoxSize: [],
            devicePixelContentBoxSize: [],
        }], this);
    }

    unobserve() {}
    disconnect() {}
}

(globalThis as any).ResizeObserver = MockResizeObserver;