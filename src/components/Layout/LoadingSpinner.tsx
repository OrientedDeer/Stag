import React from 'react';

interface LoadingSpinnerProps {
    size?: 'sm' | 'md' | 'lg';
    className?: string;
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({ size = 'md', className = '' }) => {
    const sizeClasses = {
        sm: 'w-4 h-4 border-2',
        md: 'w-8 h-8 border-3',
        lg: 'w-12 h-12 border-4'
    };

    return (
        <div
            className={`${sizeClasses[size]} border-border-default border-t-positive-soft rounded-full animate-spin ${className}`}
            role="status"
            aria-label="Loading"
        />
    );
};

interface LoadingOverlayProps {
    message?: string;
}

export const LoadingOverlay: React.FC<LoadingOverlayProps> = ({ message = 'Loading...' }) => {
    return (
        <div className="absolute inset-0 bg-surface-raised/80 backdrop-blur-sm flex flex-col items-center justify-center z-10 rounded-2xl">
            <LoadingSpinner size="lg" />
            <p className="mt-4 text-content-default text-sm font-medium">{message}</p>
        </div>
    );
};
