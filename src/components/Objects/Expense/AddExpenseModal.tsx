import React, { useState, useContext } from "react";
import { ExpenseDispatchContext } from "./ExpenseContext";
import {
	RentExpense,
	MortgageExpense,
	LoanExpense,
	DependentExpense,
	HealthcareExpense,
	VacationExpense,
	SubscriptionExpense,
	TransportExpense,
	EmergencyExpense,
	FoodExpense,
	CharityExpense,
	OtherExpense,
	getGoalMonthlySetAside,
} from "./models";
import { AccountDispatchContext } from "../Accounts/AccountContext";
import { DebtAccount, PropertyAccount, SavedAccount } from "../../Objects/Accounts/models";
import { CurrencyInput } from "../../Layout/InputFields/CurrencyInput";
import { PercentageInput } from "../../Layout/InputFields/PercentageInput";
import { DropdownInput } from "../../Layout/InputFields/DropdownInput";
import { NumberInput } from "../../Layout/InputFields/NumberInput";
import { NameInput } from "../../Layout/InputFields/NameInput";
import { ToggleInput } from "../../Layout/InputFields/ToggleInput";
import { TriggerSelector } from "../../Layout/InputFields/TriggerSelector";
import { useModalAccessibility } from "../../../hooks/useModalAccessibility";
import { AssumptionsContext, BUILTIN_MILESTONE_IDS, getBirthYear } from "../Assumptions/AssumptionsContext";
import { CustomMilestone } from "../../../services/simulation/types";

import { Button } from "../../Layout/Primitives";
// Resolve a milestone to a concrete calendar date so a goal's target can be
// expressed as "by retirement" etc. but stored as a real date.
function resolveMilestoneToDate(milestoneId: string | undefined, milestones: CustomMilestone[]): Date | undefined {
	const m = milestoneId ? milestones.find(x => x.id === milestoneId) : undefined;
	if (!m) return undefined;
	const yearCond = m.conditions.find(c => c.type === 'YEAR');
	if (yearCond) return new Date(yearCond.value, 0, 1);
	const ageCond = m.conditions.find(c => c.type === 'AGE');
	if (ageCond) return new Date(getBirthYear(milestones) + ageCond.value, 0, 1);
	return undefined;
}

const generateUniqueId = () =>
	`EXS-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

type ExpenseFrequency = "Weekly" | "Monthly" | "Annually";

interface AddExpenseModalProps {
	isOpen: boolean;
	onClose: () => void;
	defaultFrequency?: ExpenseFrequency; // pre-select frequency (e.g. from the active cadence tab)
	goalMode?: boolean;                  // create a long-term goal (Longer-term tab)
}

type TaxDeductibleOption = "Yes" | "No" | "Itemized";
type InterestType = "Compounding" | "Simple";

type AnnualMode = "lump" | "sinkingFund";

const MONTH_OPTIONS = [
	"January", "February", "March", "April", "May", "June",
	"July", "August", "September", "October", "November", "December",
].map((label, i) => ({ value: String(i + 1), label }));

const ANNUAL_MODE_OPTIONS: { value: AnnualMode; label: string }[] = [
	{ value: "lump", label: "Pay in due month" },
	{ value: "sinkingFund", label: "Save monthly" },
];

type GoalType = "recurring" | "targetDate";

const GOAL_TYPE_OPTIONS: { value: GoalType; label: string }[] = [
	{ value: "recurring", label: "Recurring every N years" },
	{ value: "targetDate", label: "Save by date" },
];

interface ExpenseFormState {
	name: string;
	amount: number;
	frequency: ExpenseFrequency;
	// Annual-cadence fields (only used when frequency === 'Annually')
	dueMonth: number;
	annualMode: AnnualMode;
	// Long-term goal fields (only used in goalMode)
	goalType: GoalType;
	intervalYears: number;
	goalTargetDate: Date | undefined;
	goalTargetMilestoneId: string | undefined; // transient: lets the target be picked as a milestone
	// Mortgage fields
	valuation: number;
	loanBalance: number;
	startingLoanBalance: number;
	apr: number;
	termLength: number;
	propertyTaxes: number;
	valuationDeduction: number;
	maintenance: number;
	utilities: number;
	homeOwnersInsurance: number;
	pmi: number;
	hoaFee: number;
	extraPayment: number;
	// Loan fields
	interestType: InterestType;
	payment: number;
	// Tax fields
	isTaxDeductible: TaxDeductibleOption;
	taxDeductibleAmount: number;
	// Date/Milestone fields
	startDate: Date | undefined;
	endDate: Date | undefined;
	startMilestoneId: string | undefined;
	endMilestoneId: string | undefined;
	// Other
	isDiscretionary: boolean;
}

function getInitialFormState(frequency: ExpenseFrequency = 'Monthly'): ExpenseFormState {
	return {
		name: '',
		amount: 0,
		frequency,
		dueMonth: new Date().getMonth() + 1,
		annualMode: 'lump',
		goalType: 'recurring',
		intervalYears: 10,
		goalTargetDate: undefined,
		goalTargetMilestoneId: undefined,
		valuation: 0,
		loanBalance: 0,
		startingLoanBalance: 0,
		apr: 6.23,
		termLength: 30,
		propertyTaxes: 0.85,
		valuationDeduction: 89850,
		maintenance: 1,
		utilities: 180,
		homeOwnersInsurance: 0.56,
		pmi: 0.58,
		hoaFee: 0,
		extraPayment: 0,
		interestType: 'Compounding',
		payment: 0,
		isTaxDeductible: 'No',
		taxDeductibleAmount: 0,
		startDate: new Date(Date.UTC(new Date().getFullYear(), 0, 1)),
		endDate: undefined,
		startMilestoneId: undefined,
		endMilestoneId: undefined,
		isDiscretionary: false,
	};
}

const AddExpenseModal: React.FC<AddExpenseModalProps> = ({
	isOpen,
	onClose,
	defaultFrequency,
	goalMode = false,
}) => {
	const expenseDispatch = useContext(ExpenseDispatchContext);
	const { dispatch: accountDispatch } = useContext(AccountDispatchContext);
	const { state: assumptions, dispatch: assumptionsDispatch } = useContext(AssumptionsContext);
	const { modalRef, handleKeyDown } = useModalAccessibility(isOpen, onClose);
	const [step, setStep] = useState<"select" | "details">("select");
	const [selectedType, setSelectedType] = useState<any>(null);
	const [form, setForm] = useState<ExpenseFormState>(() => getInitialFormState(defaultFrequency));
	const [dateError, setDateError] = useState<string | undefined>();

	function updateForm<K extends keyof ExpenseFormState>(field: K, value: ExpenseFormState[K]): void {
		setForm(prev => ({ ...prev, [field]: value }));
	}

	// Validate end date is after start date
	function validateDates(start: Date | undefined, end: Date | undefined): void {
		if (start && end && end < start) {
			setDateError("End date must be after start date");
		} else {
			setDateError(undefined);
		}
	}

	const id = generateUniqueId();

	const handleClose = () => {
		setStep("select");
		setSelectedType(null);
		setForm(getInitialFormState(defaultFrequency));
		setDateError(undefined);
		onClose();
	};

	const handleCancelOrBack = () => {
		if (step === "details") {
			setStep("select");
			setSelectedType(null);
		} else {
			handleClose();
		}
	};

	const handleTypeSelect = (typeClass: any) => {
		setSelectedType(() => typeClass);
		// Set sensible defaults based on expense type
		if (typeClass === CharityExpense) {
			updateForm('isTaxDeductible', 'Itemized');
		}
		// Default discretionary for non-essential expense types
		const discretionaryTypes = [VacationExpense, SubscriptionExpense, CharityExpense, OtherExpense];
		updateForm('isDiscretionary', discretionaryTypes.includes(typeClass));
		// Default end milestone to End of Plan for all expenses
		updateForm('endMilestoneId', BUILTIN_MILESTONE_IDS.END_OF_PLAN);
		setStep("details");
	};

	const handleAdd = (e?: React.FormEvent) => {
		e?.preventDefault();
		if (!selectedType || !form.name.trim() || dateError) return;

		const finalStartDate = form.startDate;
		const finalEndDate = form.endDate;
		const finalStartMilestoneId = form.startMilestoneId;
		// Default end milestone to End of Plan if no end date/milestone specified
		const finalEndMilestoneId = form.endMilestoneId || (finalEndDate ? undefined : BUILTIN_MILESTONE_IDS.END_OF_PLAN);

		let newExpense;

		if (selectedType === RentExpense) {
			newExpense = new RentExpense(
				id, form.name.trim(), form.payment, form.utilities,
				form.frequency, finalStartDate, finalEndDate,
				finalStartMilestoneId, finalEndMilestoneId
			);
		} else if (selectedType === MortgageExpense) {
			const newAccount = new PropertyAccount(
				'ACC' + id.substring(3), form.name.trim(), form.valuation,
				'Financed', form.loanBalance, form.loanBalance, id
			);
			accountDispatch({ type: "ADD_ACCOUNT", payload: newAccount });
			newExpense = new MortgageExpense(
				id, form.name.trim(), form.frequency, form.valuation,
				form.loanBalance, form.startingLoanBalance, form.apr, form.termLength,
				form.propertyTaxes, form.valuationDeduction, form.maintenance, form.utilities,
				form.homeOwnersInsurance, form.pmi, form.hoaFee, form.isTaxDeductible,
				form.isTaxDeductible !== 'No' ? form.taxDeductibleAmount : 0,
				'ACC' + id.substring(3), finalStartDate, form.payment, form.extraPayment, finalEndDate,
				finalStartMilestoneId, finalEndMilestoneId
			);
		} else if (selectedType === LoanExpense) {
			const newAccount = new DebtAccount(
				'ACC' + id.substring(3), form.name.trim(), form.amount, id
			);
			accountDispatch({ type: "ADD_ACCOUNT", payload: newAccount });
			newExpense = new LoanExpense(
				id, form.name.trim(), form.amount, form.frequency, form.apr,
				form.interestType, form.payment, form.isTaxDeductible,
				form.isTaxDeductible !== 'No' ? form.taxDeductibleAmount : 0,
				'ACC' + id.substring(3), finalStartDate, finalEndDate,
				finalStartMilestoneId, finalEndMilestoneId
			);
		} else if (selectedType === DependentExpense) {
			newExpense = new DependentExpense(
				id, form.name.trim(), form.amount, form.frequency,
				form.isTaxDeductible, form.isTaxDeductible !== 'No' ? form.taxDeductibleAmount : 0,
				finalStartDate, finalEndDate,
				finalStartMilestoneId, finalEndMilestoneId
			);
		} else if (selectedType === HealthcareExpense) {
			newExpense = new HealthcareExpense(
				id, form.name.trim(), form.amount, form.frequency,
				form.isTaxDeductible, form.isTaxDeductible !== 'No' ? form.taxDeductibleAmount : 0,
				finalStartDate, finalEndDate,
				finalStartMilestoneId, finalEndMilestoneId
			);
		} else if (selectedType === CharityExpense) {
			newExpense = new CharityExpense(
				id, form.name.trim(), form.amount, form.frequency,
				form.isTaxDeductible, form.isTaxDeductible !== 'No' ? form.taxDeductibleAmount : 0,
				finalStartDate, finalEndDate,
				finalStartMilestoneId, finalEndMilestoneId
			);
		} else if (selectedType === TransportExpense || selectedType === OtherExpense) {
			newExpense = new selectedType(
				id, form.name.trim(), form.amount, form.frequency, finalStartDate, finalEndDate,
				finalStartMilestoneId, finalEndMilestoneId
			);
		} else {
			newExpense = new selectedType(
				id, form.name.trim(), form.amount, form.frequency, finalStartDate, finalEndDate,
				finalStartMilestoneId, finalEndMilestoneId
			);
		}

		// Set discretionary flag
		if (newExpense) {
			newExpense.isDiscretionary = form.isDiscretionary;
			if (goalMode) {
				// Long-term goal: amount is the total cost; frequency is ignored.
				newExpense.goalType = form.goalType;
				if (form.goalType === 'recurring') {
					newExpense.intervalYears = form.intervalYears;
				} else {
					newExpense.goalTargetDate = form.goalTargetDate;
					// A one-time goal completes at its target date, so it drops out
					// of the active budget/list afterward (becomes a "past" item).
					newExpense.endDate = form.goalTargetDate;
				}
				// Create a linked sinking-fund SavedAccount and a FIXED savings
				// priority that funds it with the monthly set-aside. The account is
				// reserved (not in any withdrawal order); the simulation debits it
				// for the lump in the goal's due year.
				const fundAccountId = 'ACC' + id.substring(3);
				accountDispatch({
					type: "ADD_ACCOUNT",
					payload: new SavedAccount(fundAccountId, `${form.name.trim()} (fund)`, 0),
				});
				assumptionsDispatch({
					type: "ADD_PRIORITY",
					payload: {
						id: 'PRI' + id.substring(3),
						name: `${form.name.trim()} fund`,
						type: 'SAVINGS',
						accountId: fundAccountId,
						capType: 'FIXED',
						capValue: getGoalMonthlySetAside(newExpense), // FIXED capValue is monthly
					},
				});
				newExpense.goalAccountId = fundAccountId;
			} else if (form.frequency === 'Annually') {
				// Annual cadence metadata is only meaningful for yearly expenses.
				newExpense.dueMonth = form.dueMonth;
				newExpense.annualMode = form.annualMode;
			}
		}

		expenseDispatch({ type: "ADD_EXPENSE", payload: newExpense });
		handleClose();
	};

	if (!isOpen) return null;

	const expenseCategories = [
		{ label: "Rent", class: RentExpense },
		{ label: "Mortgage", class: MortgageExpense },
		{ label: "Loan", class: LoanExpense },
		{ label: "Dependent", class: DependentExpense },
		{ label: "Healthcare", class: HealthcareExpense },
		{ label: "Vacation", class: VacationExpense },
		{ label: "Subscription", class: SubscriptionExpense },
		{ label: "Emergency", class: EmergencyExpense },
		{ label: "Transport", class: TransportExpense },
		{ label: "Food", class: FoodExpense },
		{ label: "Charity", class: CharityExpense },
		{ label: "Other", class: OtherExpense },
	];

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
		>
			<div
				ref={modalRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby="add-expense-modal-title"
				className="bg-surface-raised border border-border-subtle rounded-2xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto text-white w-full max-w-lg"
				onKeyDown={handleKeyDown}
			>
				<h2 id="add-expense-modal-title" className="text-xl font-bold mb-6 border-b border-border-subtle pb-3">
					{step === "select"
						? "Select Expense Type"
						: `New ${selectedType.name.replace("Expense", "")}`}
				</h2>

				<form onSubmit={handleAdd}>
				{step === "select" ? (
					<div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
						{expenseCategories.map((cat) => (
							<button
								key={cat.label}
								type="button"
								onClick={() => handleTypeSelect(cat.class)}
								className="flex items-center justify-center p-2 h-12 bg-surface-overlay hover:bg-surface-input text-content-emphasis rounded-xl border border-border-default transition-all font-medium text-md text-center"
							>
								{cat.label}
							</button>
						))}
					</div>
				) : (
					<div className="space-y-4">
						{/* Name */}
						<div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
							<div className="col-span-2">
								<NameInput
									label="Expense Name"
									id={id}
									value={form.name}
									onChange={(val) => updateForm('name', val)}
								/>
							</div>
							{!goalMode && (
								<div className="col-span-2 lg:col-span-1">
									<DropdownInput
										label="Frequency"
										id={`${id}-frequency`}
										value={form.frequency}
										onChange={(val) => updateForm('frequency', val as ExpenseFrequency)}
										options={["Weekly", "Monthly", "Annually"]}
									/>
								</div>
							)}
						</div>

						{/* Long-term goal: type + horizon */}
						{goalMode && (
							<div className="grid grid-cols-2 gap-4">
								<DropdownInput
									label="Goal Type"
									id={`${id}-goal-type`}
									value={form.goalType}
									onChange={(val) => updateForm('goalType', val as GoalType)}
									options={GOAL_TYPE_OPTIONS}
									tooltip="Recurring: a big-ticket item replaced every N years (e.g. roof). Save by date: a one-time goal funded by a target date."
								/>
								{form.goalType === 'recurring' ? (
									<NumberInput
										id={`${id}-interval-years`}
										label="Every (years)"
										value={form.intervalYears}
										onChange={(val) => updateForm('intervalYears', val)}
										tooltip="How often this expense recurs, in years."
									/>
								) : (
									<TriggerSelector
										id={`${id}-goal-target`}
										label="Target Date"
										date={form.goalTargetDate}
										milestoneId={form.goalTargetMilestoneId}
										milestones={assumptions.milestones || []}
										onDateChange={(date) => {
											updateForm('goalTargetDate', date);
											updateForm('goalTargetMilestoneId', undefined);
										}}
										onMilestoneChange={(milestoneId) => {
											updateForm('goalTargetMilestoneId', milestoneId);
											updateForm('goalTargetDate', resolveMilestoneToDate(milestoneId, assumptions.milestones || []));
										}}
										tooltip="When you need the money by (a date or a milestone)."
									/>
								)}
							</div>
						)}

						{/* Annual cadence: due month + how to budget it */}
						{!goalMode && form.frequency === 'Annually' && (
							<div className="grid grid-cols-2 gap-4">
								<DropdownInput
									label="Due Month"
									id={`${id}-due-month`}
									value={String(form.dueMonth)}
									onChange={(val) => updateForm('dueMonth', Number(val))}
									options={MONTH_OPTIONS}
									tooltip="The month this yearly expense is actually paid."
								/>
								<DropdownInput
									label="How to Budget"
									id={`${id}-annual-mode`}
									value={form.annualMode}
									onChange={(val) => updateForm('annualMode', val as AnnualMode)}
									options={ANNUAL_MODE_OPTIONS}
									tooltip="Pay in due month: the full amount is budgeted in its due month. Save monthly: set aside 1/12 each month toward it."
								/>
							</div>
						)}

						{/* Start and End Triggers */}
						<div className="grid grid-cols-2 gap-4">
							<TriggerSelector
								id={`${id}-start`}
								label="Start"
								date={form.startDate}
								milestoneId={form.startMilestoneId}
								milestones={assumptions.milestones || []}
								onDateChange={(date) => {
									updateForm('startDate', date);
									validateDates(date, form.endDate);
								}}
								onMilestoneChange={(milestoneId) => updateForm('startMilestoneId', milestoneId)}
								tooltip={goalMode ? "When you start saving for this goal" : "When this expense begins"}
							/>
							{/* A save-by-date goal's Target Date above already is its end, so
							    hide the generic End there. Recurring goals can still take an
							    end date (when to stop replacing it). */}
							{(!goalMode || form.goalType === 'recurring') && (
							<TriggerSelector
								id={`${id}-end`}
								label="End"
								date={form.endDate}
								milestoneId={form.endMilestoneId}
								milestones={assumptions.milestones || []}
								onDateChange={(date) => {
									updateForm('endDate', date);
									validateDates(form.startDate, date);
								}}
								onMilestoneChange={(milestoneId) => updateForm('endMilestoneId', milestoneId)}
								tooltip="When this expense ends"
							/>
							)}
							{dateError && (
								<div className="col-span-full text-negative text-xs">
									{dateError}
								</div>
							)}
						</div>

						{/* Common Fields Grid */}
						<div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
							{!(selectedType === RentExpense || selectedType === MortgageExpense || selectedType === LoanExpense) && (
								<CurrencyInput
									id={`${id}-amount`}
									label="Amount"
									value={form.amount}
									onChange={(val) => updateForm('amount', val)}
								/>
							)}
							{selectedType === LoanExpense && (
								<CurrencyInput
									id={`${id}-balance`}
									label="Balance"
									value={form.amount}
									onChange={(val) => updateForm('amount', val)}
								/>
							)}

							{selectedType === RentExpense && (
								<>
									<CurrencyInput id={`${id}-rent-payment`} label="Rent Payment" value={form.payment} onChange={(val) => updateForm('payment', val)} />
									<CurrencyInput id={`${id}-utilities`} label="Utilities" value={form.utilities} onChange={(val) => updateForm('utilities', val)} />
								</>
							)}

							{selectedType === MortgageExpense && (
								<>
									<CurrencyInput id={`${id}-valuation`} label="Valuation" value={form.valuation} onChange={(val) => updateForm('valuation', val)} tooltip="Current market value of the property." />
									<CurrencyInput id={`${id}-starting-loan-balance`} label="Starting Loan Balance" value={form.startingLoanBalance} onChange={(val) => updateForm('startingLoanBalance', val)} tooltip="Original loan amount when the mortgage was taken out." />
									<CurrencyInput id={`${id}-loan-balance`} label="Current Loan Balance" value={form.loanBalance} onChange={(val) => updateForm('loanBalance', val)} tooltip="Remaining amount owed on the mortgage today." />
									<PercentageInput id={`${id}-apr`} label="APR" value={form.apr} onChange={(val) => updateForm('apr', val)} max={50} tooltip="Annual Percentage Rate - the yearly interest rate on your loan." />
									<NumberInput id={`${id}-term-length`} label="Term Length (years)" value={form.termLength} onChange={(val) => updateForm('termLength', val)} tooltip="Total length of the mortgage (typically 15 or 30 years)." />
									<PercentageInput id={`${id}-property-tax-rate`} label="Property Tax Rate" value={form.propertyTaxes} onChange={(val) => updateForm('propertyTaxes', val)} max={20} tooltip="Annual property tax as a percentage of home value. Varies by location (0.5-2.5% typical)." />
									<CurrencyInput id={`${id}-valuation-deduction`} label="Valuation Deduction" value={form.valuationDeduction} onChange={(val) => updateForm('valuationDeduction', val)} tooltip="Homestead exemption or other deductions that reduce taxable property value." />
									<PercentageInput id={`${id}-maintenance`} label="Maintenance" value={form.maintenance} onChange={(val) => updateForm('maintenance', val)} max={20} tooltip="Annual maintenance budget as % of home value. 1% is a common rule of thumb." />
									<CurrencyInput id={`${id}-utilities`} label="Utilities" value={form.utilities} onChange={(val) => updateForm('utilities', val)} tooltip="Monthly utility costs (electric, gas, water, etc.)." />
									<PercentageInput id={`${id}-homeowners-insurance`} label="Homeowners Insurance" value={form.homeOwnersInsurance} onChange={(val) => updateForm('homeOwnersInsurance', val)} max={20} tooltip="Annual insurance as % of home value. Typically 0.3-0.6%." />
									<PercentageInput id={`${id}-pmi`} label="PMI" value={form.pmi} onChange={(val) => updateForm('pmi', val)} max={20} tooltip="Private Mortgage Insurance. Required if down payment < 20%. Usually 0.5-1% of loan annually. Set to 0 if not applicable." />
									<CurrencyInput id={`${id}-hoa-fee`} label="HOA Fee" value={form.hoaFee} onChange={(val) => updateForm('hoaFee', val)} tooltip="Monthly Homeowners Association fee, if applicable." />
									<CurrencyInput id={`${id}-extra-payment`} label="Extra Payment" value={form.extraPayment} onChange={(val) => updateForm('extraPayment', val)} tooltip="Additional monthly payment toward principal to pay off the mortgage faster." />
									<DropdownInput
										id={`${id}-tax-deductible`}
										label="Tax Deductible"
										value={form.isTaxDeductible}
										onChange={(val) => updateForm('isTaxDeductible', val as TaxDeductibleOption)}
										options={["No", "Yes", "Itemized"]}
										tooltip="Yes: always deductible. Itemized: only if you itemize deductions instead of taking standard deduction."
									/>
								</>
							)}

							{selectedType === LoanExpense && (
								<>
									<PercentageInput id={`${id}-apr`} label="APR" value={form.apr} onChange={(val) => updateForm('apr', val)} max={50} tooltip="Annual Percentage Rate - the yearly interest rate on your loan." />
									<DropdownInput
										id={`${id}-interest-type`}
										label="Interest Type"
										value={form.interestType}
										onChange={(val) => updateForm('interestType', val as InterestType)}
										options={["Simple", "Compounding"]}
										tooltip="Compounding: interest accrues on principal + unpaid interest. Simple: interest only on original principal."
									/>
									<CurrencyInput id={`${id}-payment`} label="Payment" value={form.payment} onChange={(val) => updateForm('payment', val)} tooltip="Your regular payment amount (per frequency)." />
									<DropdownInput
										id={`${id}-tax-deductible`}
										label="Tax Deductible"
										value={form.isTaxDeductible}
										onChange={(val) => updateForm('isTaxDeductible', val as TaxDeductibleOption)}
										options={["No", "Yes", "Itemized"]}
										tooltip="Yes: always deductible. Itemized: only if you itemize deductions instead of taking standard deduction."
									/>
									{(form.isTaxDeductible === "Yes" || form.isTaxDeductible === "Itemized") && (
										<CurrencyInput id={`${id}-deductible-amount`} label="Deductible Amount" value={form.taxDeductibleAmount} onChange={(val) => updateForm('taxDeductibleAmount', val)} tooltip="Amount of this expense that can be deducted from taxable income." />
									)}
								</>
							)}

							{selectedType === HealthcareExpense && (
								<>
									<DropdownInput
										id={`${id}-tax-deductible`}
										label="Tax Deductible"
										value={form.isTaxDeductible}
										onChange={(val) => updateForm('isTaxDeductible', val as TaxDeductibleOption)}
										options={["No", "Yes", "Itemized"]}
										tooltip="Yes: pre-tax (like HSA contributions). Itemized: only if you itemize deductions."
									/>
									{(form.isTaxDeductible === "Yes" || form.isTaxDeductible === "Itemized") && (
										<CurrencyInput id={`${id}-deductible-amount`} label="Deductible Amount" value={form.taxDeductibleAmount} onChange={(val) => updateForm('taxDeductibleAmount', val)} tooltip="Amount of this expense that can be deducted from taxable income." />
									)}
								</>
							)}

							{selectedType === DependentExpense && (
								<>
									<DropdownInput
										id={`${id}-tax-deductible`}
										label="Tax Deductible"
										value={form.isTaxDeductible}
										onChange={(val) => updateForm('isTaxDeductible', val as TaxDeductibleOption)}
										options={["Yes", "No", "Itemized"]}
										tooltip="Yes: qualifies for dependent care FSA or tax credit. Itemized: only if you itemize."
									/>
									{form.isTaxDeductible === "Yes" && (
										<CurrencyInput id={`${id}-deductible-amount`} label="Deductible Amount" value={form.taxDeductibleAmount} onChange={(val) => updateForm('taxDeductibleAmount', val)} tooltip="Amount eligible for dependent care tax benefits." />
									)}
								</>
							)}

							{selectedType === CharityExpense && (
								<>
									<DropdownInput
										id={`${id}-tax-deductible`}
										label="Tax Deductible"
										value={form.isTaxDeductible}
										onChange={(val) => updateForm('isTaxDeductible', val as TaxDeductibleOption)}
										options={["Itemized", "Yes", "No"]}
										tooltip="Charitable donations are typically deductible if you itemize. Select 'Itemized' for standard charitable deductions."
									/>
									{(form.isTaxDeductible === "Yes" || form.isTaxDeductible === "Itemized") && (
										<CurrencyInput id={`${id}-deductible-amount`} label="Deductible Amount" value={form.taxDeductibleAmount} onChange={(val) => updateForm('taxDeductibleAmount', val)} tooltip="Amount of charitable donation that can be deducted from taxable income." />
									)}
								</>
							)}

							{/* Discretionary Toggle */}
							<div className="col-span-full">
								<ToggleInput
									id={`${id}-discretionary`}
									label="Discretionary"
									enabled={form.isDiscretionary}
									setEnabled={(val) => updateForm('isDiscretionary', val)}
									tooltip="Discretionary expenses can be reduced during Guyton-Klinger guardrail triggers in retirement, and are affected by lifestyle creep."
								/>
							</div>
						</div>
					</div>
				)}

				<div className="flex justify-end gap-3 mt-8">
					<Button
						type="button"
						onClick={handleCancelOrBack}
					 variant="ghost" size="lg"
					>
						{step === "details" ? "Back" : "Cancel"}
					</Button>
					{step === "details" && (
						<Button
							type="submit"
							disabled={!form.name.trim() || !!dateError}
							title={!form.name.trim() ? "Enter a name" : dateError ? "Fix date error" : undefined}
						 variant="positive" size="lg"
						>
							Add Expense
						</Button>
					)}
				</div>
				</form>
			</div>
		</div>
	);
};

export default AddExpenseModal;