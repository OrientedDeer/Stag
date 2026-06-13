import { useCallback, useRef } from 'react';
import { parseSSAXml, validateEarningsImport } from '../../../services/SSAImportService';
import type { EarningsRecord } from '../../../services/SocialSecurityCalculator';
import { getBirthYear } from '../Assumptions/AssumptionsContext';
import type { CustomMilestone } from '../../../services/simulation/types';
import { useReceiptToast } from '../../Layout/Overlays/ReceiptToast';

// The AssumptionsContext Action type isn't exported; we use a narrow structural
// shape covering the two cases this hook dispatches.
type SSAImportDispatch = (
    action:
        | { type: 'SET_PRIOR_EARNINGS'; payload: EarningsRecord[] }
        | { type: 'CLEAR_PRIOR_EARNINGS' }
) => void;

interface UseSSAEarningsImportArgs {
    milestones: CustomMilestone[];
    dispatch: SSAImportDispatch;
}

export interface SSAEarningsImport {
    fileInputRef: React.RefObject<HTMLInputElement | null>;
    onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

/**
 * Wires an SSA earnings XML file picker to the assumptions store. The user
 * downloads their statement from ssa.gov/myaccount, drops the XML in, and we
 * parse + validate + persist earnings for the future-SS PIA calculation.
 */
export function useSSAEarningsImport({
    milestones,
    dispatch,
}: UseSSAEarningsImportArgs): SSAEarningsImport {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const receiptToast = useReceiptToast();

    const onFileChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const file = e.target.files?.[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                const xmlString = event.target?.result as string;
                try {
                    const { earnings } = parseSSAXml(xmlString);

                    if (earnings.length === 0) {
                        alert(
                            'No valid earnings found in file. Make sure the file contains FicaEarnings data.'
                        );
                        return;
                    }

                    const birthYearVal = getBirthYear(milestones);
                    const validation = validateEarningsImport(earnings, birthYearVal);

                    if (validation.warnings.length > 0) {
                        const proceed = confirm(
                            `Warnings:\n${validation.warnings.join('\n')}\n\nImport anyway?`
                        );
                        if (!proceed) return;
                    }

                    dispatch({ type: 'SET_PRIOR_EARNINGS', payload: earnings });
                    // Cross-context write (earnings live in Assumptions and feed
                    // the SS benefit calculation) — announce it as a receipt
                    // instead of a blocking alert.
                    receiptToast.show({
                        message: `Imported ${earnings.length} years of SSA earnings — Social Security benefits will be calculated from them at claiming age`,
                    });
                } catch {
                    alert(
                        "Error parsing SSA file. Please ensure it's a valid SSA XML export from ssa.gov."
                    );
                }
            };
            reader.readAsText(file);
            e.target.value = '';
        },
        [milestones, dispatch, receiptToast]
    );

    return { fileInputRef, onFileChange };
}
