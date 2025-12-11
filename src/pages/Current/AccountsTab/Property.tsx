import { useAccounts } from "../../../context/AccountsContext";
import AccountList from "../../../components/Accounts/AccountList";
import AddAccount from "../../../components/Accounts/AddAccount";
import {ACCOUNT_CATEGORIES} from '../../../types';

export default function Property() {
  const { accounts } = useAccounts();

  return (
    <div className="flex flex-col rounded-b-lg">
      <AccountList
        filteredAccounts={accounts.filter((account) => {
          return account.category === "Property";
        })}
        category = "Property"
      />
      <AddAccount category={ACCOUNT_CATEGORIES[2]} />
    </div>
  );
}
