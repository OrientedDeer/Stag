import React from 'react';

import { WarningTriangleIcon } from './Icons/WarningTriangleIcon';

export type AlertSeverity = 'warning' | 'info' | 'error' | 'success';
export type AlertSize = 'default' | 'sm';

interface AlertBannerProps {
    severity: AlertSeverity;
    title?: string;
    children: React.ReactNode;
    onDismiss?: () => void;
    className?: string;
    size?: AlertSize;
}

const severityStyles: Record<AlertSeverity, { bg: string; border: string; text: string; icon: string }> = {
    warning: {
        bg: 'bg-warning-tint/30',
        border: 'border-warning-solid/50',
        text: 'text-warning-bright',
        icon: 'text-warning',
    },
    info: {
        bg: 'bg-info-tint/30',
        border: 'border-info-strong/50',
        text: 'text-info-bright',
        icon: 'text-info',
    },
    error: {
        bg: 'bg-negative-tint/30',
        border: 'border-negative-solid/50',
        text: 'text-negative-bright',
        icon: 'text-negative',
    },
    success: {
        bg: 'bg-positive-tint/30',
        border: 'border-positive-solid/50',
        text: 'text-positive-bright',
        icon: 'text-positive',
    },
};

const InfoIcon = ({ className }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
);

const ErrorIcon = ({ className }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
);

const SuccessIcon = ({ className }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
);

const DismissIcon = ({ className }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
);

const iconComponents: Record<AlertSeverity, React.FC<{ className?: string }>> = {
    warning: WarningTriangleIcon,
    info: InfoIcon,
    error: ErrorIcon,
    success: SuccessIcon,
};

export const AlertBanner: React.FC<AlertBannerProps> = ({
    severity,
    title,
    children,
    onDismiss,
    className = '',
    size = 'default',
}) => {
    const styles = severityStyles[severity];
    const IconComponent = iconComponents[severity];

    const isSmall = size === 'sm';
    const padding = isSmall ? 'px-3 py-2' : 'p-4';
    const iconSize = isSmall ? 'h-4 w-4' : 'h-5 w-5';
    const gap = isSmall ? 'gap-2' : 'gap-3';
    const textSize = isSmall ? 'text-sm' : '';

    return (
        <div className={`${styles.bg} border ${styles.border} ${styles.text} rounded-xl ${padding} flex items-start ${gap} ${className}`}>
            <IconComponent className={`${iconSize} shrink-0 mt-0.5 ${styles.icon}`} />
            <div className={`flex-1 ${textSize}`}>
                {title && <h3 className="font-semibold">{title}</h3>}
                <div className={title ? 'mt-1' : ''}>{children}</div>
            </div>
            {onDismiss && (
                <button
                    onClick={onDismiss}
                    className={`${styles.icon} hover:opacity-70 transition-opacity shrink-0`}
                    aria-label="Dismiss"
                >
                    <DismissIcon className={iconSize} />
                </button>
            )}
        </div>
    );
};
