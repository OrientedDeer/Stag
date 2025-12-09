import { useAccounts } from "../../context/AccountsContext";
import AccountList from "../../components/AccountList";
import AddAccount from "../../components/AddAccount";
import {ACCOUNT_CATEGORIES} from '../../types';

export default function Saved() {
  const { accounts } = useAccounts();

  return (
    <div className="flex flex-col rounded-b-lg">
      <AccountList
        filteredAccounts={accounts.filter((account) => {
          return account.category === "Saved";
        })}
      />
      <AddAccount category={ACCOUNT_CATEGORIES[0]} />
    </div>
  );
}
