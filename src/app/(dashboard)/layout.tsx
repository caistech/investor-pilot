import Sidebar from '@/components/layout/sidebar';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-dark-950">
      <Sidebar />
      <main className="flex-1 p-8 overflow-auto">{children}</main>
    </div>
  );
}
