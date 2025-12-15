import { Routes, Route } from "react-router-dom";
import Sidebar from "./components/Layout/Sidebar";
import TopBar from "./components/Layout/TopBar";
import Dashboard from "./pages/Dashboard";
import AccountsTab from "./pages/Current/AccountsTab";
import Future from "./pages/Future";
import Testing from "./pages/Testing/Testing";
import { useState } from "react";
import { AccountProvider } from './components/Accounts/AccountContext';

export default function App() {
  const [isOpen, setIsOpen] = useState(false); // shared variable
  return (
    <AccountProvider>
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
              <Route path="/current/income" element={<Dashboard />} />
              <Route path="/current/expense" element={<Dashboard />} />
                          
              <Route path="/future" element={<Future />} />
              <Route path="/testing" element={<Testing />} />
            </Routes>
          </main>
        </div>
      </div>
    </AccountProvider>
  );
}
