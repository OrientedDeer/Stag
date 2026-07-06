import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';

import AddESPPLotModal from '../../../../components/Objects/Accounts/AddESPPLotModal';
import type { ESPPLot } from '../../../../components/Objects/Accounts/models';

// #182: the modal parsed native date-input strings with new Date('YYYY-MM-DD')
// (UTC midnight) while persistence/display use local dates. For a west-of-UTC user
// that stored every lot a day early, ratcheting a further day on each edit and
// flipping qualifying/disqualifying classification near the 2yr/1yr boundaries.
// Editing an existing lot and re-saving (without touching the dates) must be an
// identity on the calendar day.
describe('AddESPPLotModal date parsing (#182)', () => {
  it('re-saving an edited lot preserves the exact calendar day (no UTC shift)', () => {
    // Local-midnight dates, as the app stores them.
    const existingLot: ESPPLot = {
      id: 'LOT-1',
      grantDate: new Date(2020, 0, 15),   // Jan 15 2020
      purchaseDate: new Date(2020, 6, 15), // Jul 15 2020
      fmvAtGrant: 100,
      fmvAtPurchase: 120,
      purchasePrice: 85,
      shares: 10,
      totalCost: 850,
      discountAmount: 15,
    };

    const onSave = vi.fn();
    render(
      <AddESPPLotModal isOpen onClose={() => {}} onSave={onSave} existingLot={existingLot} />
    );

    // Existing lot pre-fills valid share/price fields, so the form is immediately
    // submittable. Click Save Changes without touching the date inputs.
    act(() => {
      screen.getByRole('button', { name: /save changes/i }).click();
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0] as ESPPLot;

    expect(saved.grantDate.getFullYear()).toBe(2020);
    expect(saved.grantDate.getMonth()).toBe(0); // January
    expect(saved.grantDate.getDate()).toBe(15);

    expect(saved.purchaseDate.getFullYear()).toBe(2020);
    expect(saved.purchaseDate.getMonth()).toBe(6); // July
    expect(saved.purchaseDate.getDate()).toBe(15);
  });
});
