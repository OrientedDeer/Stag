import { Routes, Route, Navigate } from "react-router-dom";
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
import { ImportKeyProvider } from './components/Objects/Accounts/ImportKeyContext';
import TaxesTab from "./tabs/Current/TaxesTab";
import { TaxProvider } from "./components/Objects/Taxes/TaxContext";
import FutureTab from "./tabs/Future/FutureTab";
import AssumptionTab from "./tabs/Future/AssumptionTab";
import { AssumptionsProvider } from "./components/Objects/Assumptions/AssumptionsContext";
import { SimulationProvider } from "./components/Objects/Assumptions/SimulationContext";
import { ProjectionHistoryCapture } from "./components/Objects/Assumptions/ProjectionHistoryCapture";
import { OrphanLoanReconciler } from "./components/OrphanLoanReconciler";
import { MonteCarloProvider } from "./components/Objects/Assumptions/MonteCarloContext";
import { ScenarioProvider } from "./components/Objects/Scenarios/ScenarioContext";
import PriorityTab from "./tabs/Future/PriorityTab";
import WithdrawalTab from "./tabs/Future/WithdrawalTab";
import BudgetTab from "./tabs/Budget/BudgetTab";
import { BudgetProvider } from "./components/Objects/Budget/BudgetContext";
import { CloudBackupProvider } from "./components/Objects/CloudBackup/CloudBackupProvider";
import { ThemeProvider } from "./components/Objects/Theme/ThemeContext";
import CloudBackupSync from "./components/Objects/CloudBackup/CloudBackupSync";
import GlobalKeyboardShortcuts from "./components/Layout/Overlays/GlobalKeyboardShortcuts";
import { ReceiptToastProvider } from "./components/Layout/Overlays/ReceiptToast";
import { PerformanceProfiler } from "./components/Layout/PerformanceProfiler";

export default function App() {
  const [isOpen, setIsOpen] = useState(false); // shared variable
  return (
    <ThemeProvider>
    <ImportKeyProvider>
    <SimulationProvider>
      <AccountProvider>
        <IncomeProvider>
          <ExpenseProvider>
            <TaxProvider>
              <AssumptionsProvider>
              <MonteCarloProvider>
              <ScenarioProvider>
              <BudgetProvider>
              <CloudBackupProvider>
              <ReceiptToastProvider>
              <GlobalKeyboardShortcuts />
              <ProjectionHistoryCapture />
              <OrphanLoanReconciler />
              <div className="flex h-screen">
                <Sidebar isOpen={isOpen} onClose={() => setIsOpen(true)}/>
                <div className="flex flex-col flex-1 overflow-hidden">
                  <TopBar setIsOpen={setIsOpen} title="Menu"/>
                  <CloudBackupSync />

                  <main id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto custom-scrollbar focus:outline-none">
                    <Routes>
                      <Route index element={<PerformanceProfiler id="Dashboard"><Dashboard /></PerformanceProfiler>} />
                      <Route path="/dashboard" element={<PerformanceProfiler id="Dashboard"><Dashboard /></PerformanceProfiler>} />

                      <Route path="/current" element={<PerformanceProfiler id="Current/Accounts"><AccountTab /></PerformanceProfiler>} />
                      <Route path="/current/accounts" element={<PerformanceProfiler id="Current/Accounts"><AccountTab /></PerformanceProfiler>} />
                      <Route path="/current/income" element={<PerformanceProfiler id="Current/Income"><IncomeTab /></PerformanceProfiler>} />
                      <Route path="/current/expense" element={<PerformanceProfiler id="Current/Expense"><ExpenseTab /></PerformanceProfiler>} />
                      <Route path="/current/taxes" element={<PerformanceProfiler id="Current/Taxes"><TaxesTab /></PerformanceProfiler>} />

                      <Route path="/budget" element={<PerformanceProfiler id="Budget"><BudgetTab /></PerformanceProfiler>} />
                      <Route path="/budget/*" element={<PerformanceProfiler id="Budget"><BudgetTab /></PerformanceProfiler>} />

                      <Route path="/plan" element={<Navigate to="/plan/assumptions" replace />} />
                      <Route path="/plan/assumptions" element={<PerformanceProfiler id="Plan/Assumptions"><AssumptionTab /></PerformanceProfiler>} />
                      <Route path="/plan/allocation" element={<PerformanceProfiler id="Plan/Allocation"><PriorityTab /></PerformanceProfiler>} />
                      <Route path="/plan/withdrawal" element={<PerformanceProfiler id="Plan/Withdrawal"><WithdrawalTab /></PerformanceProfiler>} />
                      <Route path="/projection" element={<PerformanceProfiler id="Projection"><FutureTab /></PerformanceProfiler>} />

                      {/* Legacy /future paths — redirect so bookmarks and muscle memory keep working */}
                      <Route path="/future" element={<Navigate to="/projection" replace />} />
                      <Route path="/future/assumptions" element={<Navigate to="/plan/assumptions" replace />} />
                      <Route path="/future/allocation" element={<Navigate to="/plan/allocation" replace />} />
                      <Route path="/future/withdrawal" element={<Navigate to="/plan/withdrawal" replace />} />
                      <Route path="/future/charts" element={<Navigate to="/projection" replace />} />
                      <Route path="/testing" element={<PerformanceProfiler id="Testing"><Testing /></PerformanceProfiler>} />
                    </Routes>
                  </main>
                </div>
              </div>
              </ReceiptToastProvider>
              </CloudBackupProvider>
              </BudgetProvider>
              </ScenarioProvider>
              </MonteCarloProvider>
              </AssumptionsProvider>
            </TaxProvider>
          </ExpenseProvider>
        </IncomeProvider>
      </AccountProvider>
    </SimulationProvider>
    </ImportKeyProvider>
    </ThemeProvider>
  );
}
