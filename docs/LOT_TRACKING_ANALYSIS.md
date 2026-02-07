# Lot Tracking for Brokerage Accounts

## Overview

The system tracks tax lots for brokerage accounts to accurately split capital gains into short-term (STCG) vs long-term (LTCG) for tax calculations. Withdrawals use FIFO (First In, First Out) lot selection.

---

## BrokerageLot Interface

```typescript
export interface BrokerageLot {
  purchaseYear: number;    // Year contribution was made
  costBasis: number;       // Original amount (never grows)
  currentValue: number;    // Market value (grows with returns)
}
```

**Location:** `models.tsx`

---

## How It Works

### Lot Creation

When `InvestedAccount.increment()` is called:

1. **Seeding:** If no lots exist, creates a seed lot with `purchaseYear = currentYear - 2` (assumes existing balance is long-term)
2. **Contributions:** Each positive contribution creates a new lot with `purchaseYear = currentYear`
3. **Growth:** Each lot's `currentValue` grows proportionally with returns; `costBasis` stays fixed

### Withdrawal (FIFO)

`calculateLotAwareWithdrawal(withdrawAmount, currentYear)` returns:
- `shortTermGains` - gains from lots held < 2 years
- `longTermGains` - gains from lots held >= 2 years
- `basisReturn` - cost basis portion (not taxed)

**FIFO behavior:** Oldest lots (lowest `purchaseYear`) are sold first, which naturally favors long-term gains.

**Holding period:** Uses `>= 2` year threshold (conservative). With year-only precision, this avoids misclassifying short-term gains as long-term (e.g., Dec 2023 → Jan 2024 = 1 year diff but only 1 month held).

### WithdrawalService Integration

`WithdrawalService.ts` calls `calculateLotAwareWithdrawal()` for brokerage accounts and:
- Taxes STCG as ordinary income
- Taxes LTCG at capital gains rates

---

## Limitations

| Limitation | Description |
|------------|-------------|
| Year-only precision | Only tracks `purchaseYear`, not full date. Some actual 12+ month holdings may be taxed as short-term (conservative). |
| No persistence | Lots are recreated each simulation run. Seed lot assumes existing balance is 2+ years old. |
| No user-defined lots | Users can't import actual lot history from brokerage statements. |
| FIFO only | No LIFO, specific ID, or tax-optimized (highest-basis first) selection. |

---

## ESPP Lot Tracking

ESPP accounts have separate, more detailed lot tracking:

```typescript
export interface ESPPLot {
  id: string;
  grantDate: Date;
  purchaseDate: Date;
  shares: number;
  purchasePrice: number;
  fmvAtGrant: number;
  fmvAtPurchase: number;
  discountAmount: number;
}
```

---

## Code References

| Feature | Location |
|---------|----------|
| BrokerageLot interface | `models.tsx` |
| Lot creation | `InvestedAccount.increment()` |
| FIFO withdrawal | `InvestedAccount.calculateLotAwareWithdrawal()` |
| WithdrawalService usage | `WithdrawalService.ts` |
| ESPPLot interface | `models.tsx` |
