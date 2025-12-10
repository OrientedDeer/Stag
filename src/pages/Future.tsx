import TopBar from "../components/TopBar";

type FutureProps = {
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
};

export default function Future({setIsOpen}: FutureProps ) {
  return (
    <div className="flex flex-col">
      <h1 className="text-2xl">Future</h1>
    </div>
  );
}