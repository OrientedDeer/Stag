import React from 'react';

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
        bg: 'bg-amber-900/30',
        border: 'border-amber-600/50',
        text: 'text-amber-200',
        icon: 'text-amber-400',
    },
    info: {
        bg: 'bg-blue-900/30',
        border: 'border-blue-600/50',
        text: 'text-blue-200',
        icon: 'text-blue-400',
    },
    error: {
        bg: 'bg-red-900/30',
        border: 'border-red-600/50',
        text: 'text-red-200',
        icon: 'text-red-400',
    },
    success: {
        bg: 'bg-emerald-900/30',
        border: 'border-emerald-600/50',
        text: 'text-emerald-200',
        icon: 'text-emerald-400',
    },
};

const WarningIcon = ({ className }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
);

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
    warning: WarningIcon,
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

export default AlertBanner;
