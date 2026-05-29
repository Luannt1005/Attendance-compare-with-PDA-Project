import Sidebar from '@/components/layout/Sidebar'
import Header from '@/components/layout/Header'
import ToastContainer from '@/components/Toast'
import { AuthProvider } from '@/lib/AuthContext'

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return (
        <AuthProvider>
            <div className="flex h-screen overflow-hidden bg-slate-50">
                <Sidebar />
                <div className="flex-1 flex flex-col h-full overflow-hidden relative">
                    <div className="absolute top-[-20%] right-[-10%] w-[50%] h-[50%] bg-primary/5 rounded-full blur-[120px] pointer-events-none" />

                    <Header />
                    <main className="flex-1 overflow-hidden flex flex-col z-10">
                        {children}
                    </main>
                </div>
            </div>
            <ToastContainer />
        </AuthProvider>
    )
}
