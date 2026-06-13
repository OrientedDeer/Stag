import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

/**
 * ReceiptToast — a small "receipt" notification for actions whose side
 * effects land in another tab (e.g. creating a Debt account spawns a
 * LoanExpense under Expenses). Shows an info-blue toast with an optional
 * react-router link to the affected tab.
 */

export interface ReceiptToastOptions {
    message: string;
    linkTo?: string;
    linkLabel?: string;
}

interface ReceiptToastEntry extends ReceiptToastOptions {
    id: number;
}

interface ReceiptToastContextValue {
    show: (options: ReceiptToastOptions) => void;
}

const AUTO_DISMISS_MS = 8000;
const MAX_TOASTS = 3;

const ReceiptToastContext = createContext<ReceiptToastContextValue>({
    show: () => {},
});

// eslint-disable-next-line react-refresh/only-export-components -- context module exports its hook alongside the provider, matching the repo's *Context.tsx pattern
export function useReceiptToast(): ReceiptToastContextValue {
    return useContext(ReceiptToastContext);
}

export function ReceiptToastProvider({ children }: { children: React.ReactNode }): React.ReactElement {
    const [toasts, setToasts] = useState<ReceiptToastEntry[]>([]);
    const nextIdRef = useRef(0);
    const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

    const dismiss = useCallback((id: number) => {
        const timer = timersRef.current.get(id);
        if (timer !== undefined) {
            clearTimeout(timer);
            timersRef.current.delete(id);
        }
        setToasts(prev => prev.filter(toast => toast.id !== id));
    }, []);

    const show = useCallback((options: ReceiptToastOptions) => {
        const id = nextIdRef.current++;
        // Keep at most MAX_TOASTS, dropping the oldest.
        setToasts(prev => [...prev, { ...options, id }].slice(-MAX_TOASTS));
        timersRef.current.set(id, setTimeout(() => dismiss(id), AUTO_DISMISS_MS));
    }, [dismiss]);

    // Clear any pending timers on unmount.
    useEffect(() => {
        const timers = timersRef.current;
        return () => {
            timers.forEach(timer => clearTimeout(timer));
            timers.clear();
        };
    }, []);

    const contextValue = useMemo(() => ({ show }), [show]);

    return (
        <ReceiptToastContext.Provider value={contextValue}>
            {children}
            {toasts.length > 0 && (
                <div className="fixed bottom-4 right-4 z-[60] flex w-full max-w-sm flex-col gap-2 pointer-events-none">
                    {toasts.map(toast => (
                        <div
                            key={toast.id}
                            role="status"
                            className="pointer-events-auto bg-blue-900/20 border border-blue-700/50 rounded-lg shadow-lg backdrop-blur-sm p-3 flex items-start gap-3"
                        >
                            <p className="flex-1 text-sm text-blue-400">
                                {toast.message}
                                {toast.linkTo && (
                                    <>
                                        {' '}
                                        <Link
                                            to={toast.linkTo}
                                            onClick={() => dismiss(toast.id)}
                                            className="font-medium underline text-blue-300 hover:text-blue-200"
                                        >
                                            {toast.linkLabel ?? 'View'}
                                        </Link>
                                    </>
                                )}
                            </p>
                            <button
                                type="button"
                                aria-label="Dismiss notification"
                                onClick={() => dismiss(toast.id)}
                                className="shrink-0 text-blue-400 hover:text-blue-200 leading-none"
                            >
                                &times;
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </ReceiptToastContext.Provider>
    );
}
