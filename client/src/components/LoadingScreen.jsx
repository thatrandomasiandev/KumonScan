export default function LoadingScreen({ message = 'Loading...' }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
      <div className="w-8 h-8 border-2 border-kumon-blue/20 border-t-kumon-blue rounded-full animate-spin" />
      <p className="text-slate-400 text-sm font-medium">{message}</p>
    </div>
  );
}
