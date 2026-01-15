import { useEffect, useRef, useCallback } from 'react';

/**
 * Hook to manage modal accessibility features:
 * - Focus trap (keeps focus within modal)
 * - Escape key to close
 * - Focus first focusable element on open
 * - Restore focus to trigger element on close
 */
export function useModalAccessibility(
    isOpen: boolean,
    onClose: () => void
) {
    const modalRef = useRef<HTMLDivElement>(null);
    const previousActiveElement = useRef<HTMLElement | null>(null);

    // Store the previously focused element when modal opens
    useEffect(() => {
        if (isOpen) {
            previousActiveElement.current = document.activeElement as HTMLElement;
        }
    }, [isOpen]);

    // Focus first focusable element when modal opens
    useEffect(() => {
        if (!isOpen || !modalRef.current) return;

        const focusableElements = getFocusableElements(modalRef.current);
        if (focusableElements.length > 0) {
            // Small delay to ensure modal is rendered
            requestAnimationFrame(() => {
                focusableElements[0].focus();
            });
        }
    }, [isOpen]);

    // Restore focus when modal closes
    useEffect(() => {
        if (!isOpen && previousActiveElement.current) {
            previousActiveElement.current.focus();
            previousActiveElement.current = null;
        }
    }, [isOpen]);

    // Handle escape key
    useEffect(() => {
        if (!isOpen) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    // Focus trap - keep focus within modal
    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key !== 'Tab' || !modalRef.current) return;

        const focusableElements = getFocusableElements(modalRef.current);
        if (focusableElements.length === 0) return;

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        // Shift+Tab on first element -> go to last
        if (e.shiftKey && document.activeElement === firstElement) {
            e.preventDefault();
            lastElement.focus();
        }
        // Tab on last element -> go to first
        else if (!e.shiftKey && document.activeElement === lastElement) {
            e.preventDefault();
            firstElement.focus();
        }
    }, []);

    return {
        modalRef,
        handleKeyDown,
    };
}

/**
 * Get all focusable elements within a container
 */
function getFocusableElements(container: HTMLElement): HTMLElement[] {
    const focusableSelectors = [
        'button:not([disabled])',
        'input:not([disabled])',
        'select:not([disabled])',
        'textarea:not([disabled])',
        'a[href]',
        '[tabindex]:not([tabindex="-1"])',
    ].join(', ');

    return Array.from(container.querySelectorAll<HTMLElement>(focusableSelectors));
}
