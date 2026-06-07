import React, { useState, useMemo } from "react";
import { ESPPLot } from "./models";
import { CurrencyInput } from "../../Layout/InputFields/CurrencyInput";
import { NumberInput } from "../../Layout/InputFields/NumberInput";
import { StyledInput, StyledDisplay } from "../../Layout/InputFields/StyleUI";
import { useModalAccessibility } from "../../../hooks/useModalAccessibility";
import { formatDateForInput } from "../../../utils/formatters";

const generateUniqueLotId = () =>
    `LOT-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

interface AddESPPLotModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (lot: ESPPLot) => void;
    existingLot?: ESPPLot; // For editing an existing lot
}

const AddESPPLotModal: React.FC<AddESPPLotModalProps> = ({
    isOpen,
    onClose,
    onSave,
    existingLot,
}) => {
    const { modalRef, handleKeyDown } = useModalAccessibility(isOpen, onClose);
    const isEditing = !!existingLot;

    // Initialize state
    const [grantDate, setGrantDate] = useState(
        existingLot ? formatDateForInput(existingLot.grantDate) : ""
    );
    const [purchaseDate, setPurchaseDate] = useState(
        existingLot ? formatDateForInput(existingLot.purchaseDate) : ""
    );
    const [shares, setShares] = useState(existingLot?.shares ?? 0);
    const [purchasePrice, setPurchasePrice] = useState(existingLot?.purchasePrice ?? 0);
    const [fmvAtGrant, setFmvAtGrant] = useState(existingLot?.fmvAtGrant ?? 0);
    const [fmvAtPurchase, setFmvAtPurchase] = useState(existingLot?.fmvAtPurchase ?? 0);

    // Calculated values
    const totalCost = useMemo(() => shares * purchasePrice, [shares, purchasePrice]);
    const discountAmount = useMemo(() => {
        const basePrice = Math.min(fmvAtGrant, fmvAtPurchase);
        return basePrice > purchasePrice ? basePrice - purchasePrice : 0;
    }, [fmvAtGrant, fmvAtPurchase, purchasePrice]);

    // Determine disposition status
    const dispositionStatus = useMemo(() => {
        if (!grantDate || !purchaseDate) return "Unknown";

        const grant = new Date(grantDate);
        const purchase = new Date(purchaseDate);
        const today = new Date();

        // Two years from grant
        const twoYearsFromGrant = new Date(grant);
        twoYearsFromGrant.setFullYear(twoYearsFromGrant.getFullYear() + 2);

        // One year from purchase
        const oneYearFromPurchase = new Date(purchase);
        oneYearFromPurchase.setFullYear(oneYearFromPurchase.getFullYear() + 1);

        if (today >= twoYearsFromGrant && today >= oneYearFromPurchase) {
            return "Qualifying";
        }
        return "Disqualifying";
    }, [grantDate, purchaseDate]);

    const handleClose = () => {
        // Reset form
        setGrantDate("");
        setPurchaseDate("");
        setShares(0);
        setPurchasePrice(0);
        setFmvAtGrant(0);
        setFmvAtPurchase(0);
        onClose();
    };

    const handleSave = (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!grantDate || !purchaseDate || shares <= 0) return;

        const lot: ESPPLot = {
            id: existingLot?.id ?? generateUniqueLotId(),
            grantDate: new Date(grantDate),
            purchaseDate: new Date(purchaseDate),
            fmvAtGrant,
            fmvAtPurchase,
            purchasePrice,
            shares,
            totalCost,
            discountAmount,
        };

        onSave(lot);
        handleClose();
    };

    const isValid = grantDate && purchaseDate && shares > 0 && purchasePrice > 0;

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
        >
            <div
                ref={modalRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="add-espp-lot-modal-title"
                className="bg-surface-raised border border-border-subtle rounded-2xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto text-white w-full max-w-lg"
                onKeyDown={handleKeyDown}
            >
                <h2 id="add-espp-lot-modal-title" className="text-xl font-bold text-white mb-4">
                    {isEditing ? 'Edit ESPP Lot' : 'Add ESPP Lot'}
                </h2>

                <form onSubmit={handleSave}>
                <div className="space-y-4">
                    {/* Offering Period Section */}
                    <div>
                        <h3 className="text-sm font-semibold text-content-muted mb-2 uppercase tracking-wide">
                            Offering Period
                        </h3>
                        <div className="grid grid-cols-2 gap-4">
                            <StyledInput
                                label="Grant Date"
                                id="grant-date"
                                type="date"
                                value={grantDate}
                                onChange={(e) => setGrantDate(e.target.value)}
                                tooltip="Start of the offering period when the stock price was locked in"
                            />
                            <StyledInput
                                label="Purchase Date"
                                id="purchase-date"
                                type="date"
                                value={purchaseDate}
                                onChange={(e) => setPurchaseDate(e.target.value)}
                                tooltip="End of the offering period when shares were purchased"
                            />
                        </div>
                    </div>

                    {/* Share Details Section */}
                    <div>
                        <h3 className="text-sm font-semibold text-content-muted mb-2 uppercase tracking-wide">
                            Share Details
                        </h3>
                        <div className="grid grid-cols-2 gap-4">
                            <NumberInput
                                id="shares"
                                label="Number of Shares"
                                value={shares}
                                onChange={setShares}
                                min={0}
                                tooltip="Total shares purchased in this lot"
                            />
                            <CurrencyInput
                                id="purchase-price"
                                label="Purchase Price/Share"
                                value={purchasePrice}
                                onChange={setPurchasePrice}
                                tooltip="Price paid per share after ESPP discount"
                            />
                        </div>
                    </div>

                    {/* FMV Section */}
                    <div>
                        <h3 className="text-sm font-semibold text-content-muted mb-2 uppercase tracking-wide">
                            Fair Market Values (for tax calculation)
                        </h3>
                        <div className="grid grid-cols-2 gap-4">
                            <CurrencyInput
                                id="fmv-at-grant"
                                label="FMV at Grant"
                                value={fmvAtGrant}
                                onChange={setFmvAtGrant}
                                tooltip="Stock price at the start of the offering period"
                            />
                            <CurrencyInput
                                id="fmv-at-purchase"
                                label="FMV at Purchase"
                                value={fmvAtPurchase}
                                onChange={setFmvAtPurchase}
                                tooltip="Stock price at the end of the offering period"
                            />
                        </div>
                    </div>

                    {/* Calculated Values Section */}
                    <div className="bg-surface-overlay/50 border border-border-default rounded-lg p-4">
                        <h3 className="text-sm font-semibold text-content-muted mb-3 uppercase tracking-wide">
                            Calculated Values
                        </h3>
                        <div className="grid grid-cols-2 gap-4">
                            <StyledDisplay
                                label="Total Cost Basis"
                                value={totalCost.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}
                                tooltip="Purchase price × number of shares"
                            />
                            <StyledDisplay
                                label="Discount/Share"
                                value={discountAmount.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}
                                tooltip="Amount saved per share from ESPP discount"
                            />
                            <div className="col-span-2">
                                <StyledDisplay
                                    label="Disposition Status"
                                    value={dispositionStatus}
                                    tooltip="Qualifying = 2 years from grant + 1 year from purchase (better tax treatment)"
                                />
                                {dispositionStatus === "Qualifying" && (
                                    <div className="text-positive text-xs mt-1">
                                        This lot qualifies for preferential tax treatment
                                    </div>
                                )}
                                {dispositionStatus === "Disqualifying" && (
                                    <div className="text-warning text-xs mt-1">
                                        This lot is a disqualifying disposition (full discount taxed as ordinary income)
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex justify-end gap-3 mt-8">
                    <button
                        type="button"
                        onClick={handleClose}
                        className="px-5 py-2.5 rounded-lg font-medium text-content-muted hover:text-white hover:bg-surface-overlay transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        disabled={!isValid}
                        title={!isValid ? "Fill in all required fields" : undefined}
                        className="px-5 py-2.5 rounded-lg font-medium bg-positive-solid text-white hover:bg-positive-strong disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        {isEditing ? 'Save Changes' : 'Add Lot'}
                    </button>
                </div>
                </form>
            </div>
        </div>
    );
};

export default AddESPPLotModal;
