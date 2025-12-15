export interface Account {
  id: string;
  name: string;
  balance: number;
}

// 2. Base Abstract Class
export abstract class BaseAccount implements Account {
  constructor(
    public id: string,
    public name: string,
    public balance: number
  ) {}
}

// 3. Concrete Classes

export class SavedAccount extends BaseAccount {
  // No extra properties
}

export class InvestedAccount extends BaseAccount {
  constructor(
    id: string,
    name: string,
    balance: number,
    public vestedBalance: number
  ) {
    super(id, name, balance);
  }
}

export class PropertyAccount extends BaseAccount {
  constructor(
    id: string,
    name: string,
    balance: number,
    public ownershipType: 'Financed' | 'Owned',
    public loanBalance: number,
    public apr: number,
    public interestType: 'Simple' | 'Compound',
    public monthlyPayment: number
  ) {
    super(id, name, balance);
  }
}

export class DebtAccount extends BaseAccount {
  constructor(
    id: string,
    name: string,
    balance: number,
    public apr: number,
    public interestType: 'Simple' | 'Compound',
    public monthlyPayment: number
  ) {
    super(id, name, balance);
  }
}

// Union type for use in State Management
export type AnyAccount = SavedAccount | InvestedAccount | PropertyAccount | DebtAccount;