import TopBar from "../components/TopBar";

type DashboardProps = {
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
};

export default function Dashboard({setIsOpen}: DashboardProps ) {
  return (
    <div className="flex flex-col">
      <TopBar setIsOpen={setIsOpen} title="Dashboard"/>
      <h1 className="text-2xl">Dashboard</h1>
    </div>
  );
}