import { Routes, Route } from "react-router-dom";
import Sidebar from "./components/Layout/Sidebar";
import TopBar from "./components/Layout/TopBar";
import Dashboard from "./pages/Dashboard";
import AccountsTab from "./pages/Current/AccountsTab";
import Future from "./pages/Future";
import Testing from "./pages/Testing";
import { useState } from "react";
import { AccountsProvider } from './context/AccountsContext';
import IncomeTypesTab from "./pages/Current/IncomeTypesTab";
import { IncomeTypesProvider } from "./context/IncomeTypesContext";

export default function App() {
  const [isOpen, setIsOpen] = useState(false); // shared variable
  return (
    <AccountsProvider>
      <IncomeTypesProvider>
        <div className="flex h-screen">
          <Sidebar isOpen={isOpen}/>
          <div className="flex flex-col flex-1 overflow-hidden">
            <TopBar setIsOpen={setIsOpen} title="Menu"/>

            <main className="flex-1 overflow-y-auto">
              <Routes>
                <Route index element={<Dashboard />} />
                <Route path="/dashboard" element={<Dashboard />} />

                <Route path="/current" element={<AccountsTab />} />
                <Route path="/current/accounts" element={<AccountsTab />} />
                <Route path="/current/income" element={<IncomeTypesTab />} />
                <Route path="/current/expense" element={<Dashboard />} />
                            
                <Route path="/future" element={<Future />} />
                <Route path="/testing" element={<Testing />} />
              </Routes>
            </main>
          </div>
        </div>
      </IncomeTypesProvider>
    </AccountsProvider>
  );
}
