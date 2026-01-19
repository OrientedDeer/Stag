import { createContext, useState, useCallback, useMemo, ReactNode } from 'react';

interface ImportKeyContextProps {
    importKey: number;
    incrementImportKey: () => void;
}

export const ImportKeyContext = createContext<ImportKeyContextProps>({
    importKey: 0,
    incrementImportKey: () => {},
});

export const ImportKeyProvider = ({ children }: { children: ReactNode }) => {
    const [importKey, setImportKey] = useState(0);

    const incrementImportKey = useCallback(() => {
        setImportKey(prev => {
            const next = prev + 1;
            console.log('[ImportKeyContext] incrementImportKey called:', prev, '->', next);
            return next;
        });
    }, []);

    const contextValue = useMemo(() => ({
        importKey,
        incrementImportKey,
    }), [importKey, incrementImportKey]);

    return (
        <ImportKeyContext.Provider value={contextValue}>
            {children}
        </ImportKeyContext.Provider>
    );
};
