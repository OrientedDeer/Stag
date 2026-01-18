import React, { useEffect, useRef } from 'react';

interface ConfirmDialogProps {
    isOpen: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    onConfirm: () => void;
    onCancel: () => void;
    variant?: 'danger' | 'warning' | 'info';
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
    isOpen,
    title,
    message,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    onConfirm,
    onCancel,
    variant = 'danger'
}) => {
    const cancelButtonRef = useRef<HTMLButtonElement>(null);

    // Focus cancel button when dialog opens (safer default)
    useEffect(() => {
        if (isOpen && cancelButtonRef.current) {
            cancelButtonRef.current.focus();
        }
    }, [isOpen]);

    // Handle escape key
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isOpen) {
                onCancel();
            }
        };
        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, [isOpen, onCancel]);

    if (!isOpen) return null;

    const variantStyles = {
        danger: {
            icon: (
                <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
            ),
            confirmButton: 'bg-red-600 hover:bg-red-700 focus:ring-red-500',
            iconBg: 'bg-red-900/30'
        },
        warning: {
            icon: (
                <svg className="w-6 h-6 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
            ),
            confirmButton: 'bg-yellow-600 hover:bg-yellow-700 focus:ring-yellow-500',
            iconBg: 'bg-yellow-900/30'
        },
        info: {
            icon: (
                <svg className="w-6 h-6 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
            ),
            confirmButton: 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500',
            iconBg: 'bg-blue-900/30'
        }
    };

    const styles = variantStyles[variant];

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={onCancel}
        >
            <div
                className="bg-gray-900 border border-gray-700 rounded-xl p-6 shadow-2xl max-w-sm w-full"
                onClick={(e) => e.stopPropagation()}
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="confirm-dialog-title"
                aria-describedby="confirm-dialog-message"
            >
                <div className="flex items-start gap-4">
                    <div className={`shrink-0 w-10 h-10 rounded-full ${styles.iconBg} flex items-center justify-center`}>
                        {styles.icon}
                    </div>
                    <div className="flex-1">
                        <h3 id="confirm-dialog-title" className="text-lg font-semibold text-white">
                            {title}
                        </h3>
                        <p id="confirm-dialog-message" className="mt-2 text-sm text-gray-400">
                            {message}
                        </p>
                    </div>
                </div>

                <div className="flex justify-end gap-3 mt-6">
                    <button
                        ref={cancelButtonRef}
                        onClick={onCancel}
                        className="px-4 py-2 rounded-lg font-medium text-gray-400 hover:text-white hover:bg-gray-800 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500"
                    >
                        {cancelLabel}
                    </button>
                    <button
                        onClick={onConfirm}
                        className={`px-4 py-2 rounded-lg font-medium text-white transition-colors focus:outline-none focus:ring-2 ${styles.confirmButton}`}
                    >
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
};
