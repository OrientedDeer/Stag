import { Routes, Route } from "react-router-dom";
import "./index.css";
import Sidebar from "./components/Layout/Overlays/Sidebar";
import TopBar from "./components/Layout/Overlays/TopBar";
import Dashboard from "./tabs/Dashboard";
import AccountTab from "./tabs/Current/AccountTab";
import IncomeTab from "./tabs/Current/IncomeTab";
import ExpenseTab from "./tabs/Current/ExpenseTab";
import Testing from "./tabs/Testing/Testing";
import { useState } from "react";
import { AccountProvider } from './components/Objects/Accounts/AccountContext';
import { IncomeProvider } from './components/Objects/Income/IncomeContext';
import { ExpenseProvider } from './components/Objects/Expense/ExpenseContext';
import TaxesTab from "./tabs/Current/TaxesTab";
import { TaxProvider } from "./components/Objects/Taxes/TaxContext";
import FutureTab from "./tabs/Future/FutureTab";
import AssumptionTab from "./tabs/Future/AssumptionTab";
import { AssumptionsProvider } from "./components/Objects/Assumptions/AssumptionsContext";
import { SimulationProvider } from "./components/Objects/Assumptions/SimulationContext";
import { MonteCarloProvider } from "./components/Objects/Assumptions/MonteCarloContext";
import PriorityTab from "./tabs/Future/PriorityTab";
import WithdrawalTab from "./tabs/Future/WithdrawalTab";

export default function App() {
  const [isOpen, setIsOpen] = useState(false); // shared variable
  return (
    <SimulationProvider>
      <AccountProvider>
        <IncomeProvider>
          <ExpenseProvider>
            <TaxProvider>
              <AssumptionsProvider>
              <MonteCarloProvider>
              <div className="flex h-screen">
                <Sidebar isOpen={isOpen}/>
                <div className="flex flex-col flex-1 overflow-hidden">
                  <TopBar setIsOpen={setIsOpen} title="Menu"/>

                  <main className="flex-1 overflow-y-auto">
                    <Routes>
                      <Route index element={<Dashboard />} />
                      <Route path="/dashboard" element={<Dashboard />} />

                      <Route path="/current" element={<AccountTab />} />
                      <Route path="/current/accounts" element={<AccountTab />} />
                      <Route path="/current/income" element={<IncomeTab />} />
                      <Route path="/current/expense" element={<ExpenseTab />} />
                      <Route path="/current/taxes" element={<TaxesTab />} />
                                  
                      <Route path="/future" element={<FutureTab />} />
                      <Route path="/future/future" element={<FutureTab />} />
                      <Route path="/future/assumptions" element={<AssumptionTab />} />
                      <Route path="/future/allocation" element={<PriorityTab />} />
                      <Route path="/future/withdrawal" element={<WithdrawalTab />} />
                      <Route path="/testing" element={<Testing />} />
                    </Routes>
                  </main>
                </div>
              </div>
              </MonteCarloProvider>
              </AssumptionsProvider>
            </TaxProvider>
          </ExpenseProvider>
        </IncomeProvider>
      </AccountProvider>
    </SimulationProvider>
  );
}
