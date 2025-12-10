import { Routes, Route } from "react-router-dom";
import Sidebar from "./components/Sidebar";
import TopBar from "./components/TopBar";
import Dashboard from "./pages/Dashboard";
import Current from "./pages/Current";
import Future from "./pages/Future";
import Testing from "./pages/Testing";
import { useState } from "react";
import { AccountsProvider } from './context/AccountsContext';

export default function App() {
  const [isOpen, setIsOpen] = useState(false); // shared variable
  return (
    <AccountsProvider>
      <div className="flex h-screen">
        <Sidebar isOpen={isOpen}/>
        <div className="flex flex-col flex-1 overflow-hidden">
          <TopBar setIsOpen={setIsOpen} title="Menu"/>

          <main className="flex-1 overflow-y-auto">
            <Routes>
              <Route index element={<Dashboard setIsOpen={setIsOpen}/>} />
              <Route path="/dashboard" element={<Dashboard setIsOpen={setIsOpen}/>} />
              <Route path="/current" element={<Current setIsOpen={setIsOpen}/>} />
              <Route path="/future" element={<Future setIsOpen={setIsOpen}/>} />
              <Route path="/testing" element={<Testing setIsOpen={setIsOpen}/>} />
            </Routes>
          </main>
        </div>
      </div>
    </AccountsProvider>
  );
}
