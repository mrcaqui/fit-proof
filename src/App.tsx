import { BrowserRouter, Route, Routes } from "react-router-dom"
import AppLayout from "./components/layout/AppLayout"
import LoginPage from "./pages/auth/LoginPage"
import { AuthProvider } from "./context/AuthContext"
import { RequireAuth } from "./components/auth/RequireAuth"
import CalendarPage from "./pages/calendar/CalendarPage"
import DeadlineManagement from "./pages/admin/DeadlineManagement"
import SubmissionsPage from "./pages/admin/SubmissionsPage"
import UsersPage from "./pages/admin/UsersPage"
import { Toaster } from "./components/ui/toaster"

function Dashboard() {
    return (
        <div>
            <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
            <p className="text-muted-foreground">Overview of your activity.</p>
        </div>
    )
}

import { VideoUploader } from "./components/upload/VideoUploader"

function UploadPage() {
    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-3xl font-bold tracking-tight">Upload</h2>
                <p className="text-muted-foreground">ワークアウト動画を提出します。</p>
            </div>
            <VideoUploader />
        </div>
    )
}

function ProfilePage() {
    return (
        <div>
            <h2 className="text-3xl font-bold tracking-tight">Profile</h2>
            <p className="text-muted-foreground">Manage your settings.</p>
        </div>
    )
}

function App() {
    return (
        <AuthProvider>
            <BrowserRouter>
                <Routes>
                    <Route path="/login" element={<LoginPage />} />
                    <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
                        <Route path="/" element={<Dashboard />} />
                        <Route path="/calendar" element={<CalendarPage />} />
                        <Route path="/upload" element={<UploadPage />} />
                        <Route path="/profile" element={<ProfilePage />} />
                        <Route path="/admin/deadlines" element={<DeadlineManagement />} />
                        <Route path="/admin/users" element={<UsersPage />} />
                        <Route path="/admin/submissions" element={<SubmissionsPage />} />
                    </Route>
                </Routes>
                <Toaster />
            </BrowserRouter>
        </AuthProvider>
    )
}

export default App
