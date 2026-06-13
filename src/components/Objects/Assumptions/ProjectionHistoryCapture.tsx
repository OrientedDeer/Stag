import { useContext, useEffect, useRef } from 'react';
import { SimulationContext } from './SimulationContext';
import { captureIfNeeded } from '../../../services/projectionHistory';

/**
 * Passively records a monthly snapshot of the current projection's net-worth
 * curve (projection memory, #63) so we can later show how predictions lined up
 * with reality. Captures once per session, the first time a non-empty
 * simulation is available; captureIfNeeded dedups to one snapshot per calendar
 * month. Renders nothing. Mount once inside SimulationProvider.
 */
export function ProjectionHistoryCapture(): null {
    const { simulation } = useContext(SimulationContext);
    const capturedThisSession = useRef(false);

    useEffect(() => {
        if (capturedThisSession.current || simulation.length === 0) return;
        captureIfNeeded(simulation);
        capturedThisSession.current = true;
    }, [simulation]);

    return null;
}
