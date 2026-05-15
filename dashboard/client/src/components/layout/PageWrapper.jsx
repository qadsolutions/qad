export default function PageWrapper({ children }) {
  return (
    <main className="ml-60 pt-16 min-h-screen">
      <div className="p-8">
        {children}
      </div>
    </main>
  );
}
