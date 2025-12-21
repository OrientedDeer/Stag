import { Routes, Route } from "react-router-dom";
import "./index.css";
import Sidebar from "./components/Layout/Sidebar";
import TopBar from "./components/Layout/TopBar";
import Dashboard from "./pages/Dashboard";
import AccountTab from "./pages/Current/AccountTab";
import IncomeTab from "./pages/Current/IncomeTab";
import ExpenseTab from "./pages/Current/ExpenseTab";
import Future from "./pages/Future";
import Testing from "./pages/Testing/Testing";
import { useState } from "react";
import { AccountProvider } from './components/Accounts/AccountContext';
import { IncomeProvider } from './components/Income/IncomeContext';
import { ExpenseProvider } from './components/Expense/ExpenseContext';
import TaxesTab from "./pages/Current/TaxesTab";
import { TaxProvider } from "./components/Taxes/TaxContext";

export default function App() {
  const [isOpen, setIsOpen] = useState(false); // shared variable
  return (
      <AccountProvider>
        <IncomeProvider>
          <ExpenseProvider>
            <TaxProvider>
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
                                  
                      <Route path="/future" element={<Future />} />
                      <Route path="/testing" element={<Testing />} />
                    </Routes>
                  </main>
                </div>
              </div>
            </TaxProvider>
          </ExpenseProvider>
        </IncomeProvider>
      </AccountProvider>
  );
}
