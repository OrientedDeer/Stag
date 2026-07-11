import { createContext } from 'react';

interface ImportKeyContextProps {
    importKey: number;
    incrementImportKey: () => void;
}

export const ImportKeyContext = createContext<ImportKeyContextProps>({
    importKey: 0,
    incrementImportKey: () => {},
});
