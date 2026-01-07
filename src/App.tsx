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
import PriorityTab from "./tabs/Future/PriorityTab";
import { SimulationProvider } from "./components/Objects/Assumptions/SimulationContext";

export default function App() {
  const [isOpen, setIsOpen] = useState(false); // shared variable
  return (
    <SimulationProvider>
      <AccountProvider>
        <IncomeProvider>
          <ExpenseProvider>
            <TaxProvider>
              <AssumptionsProvider>
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
                      <Route path="/future/priorities" element={<PriorityTab />} />
                      <Route path="/testing" element={<Testing />} />
                    </Routes>
                  </main>
                </div>
              </div>
              </AssumptionsProvider>
            </TaxProvider>
          </ExpenseProvider>
        </IncomeProvider>
      </AccountProvider>
    </SimulationProvider>
  );
}
