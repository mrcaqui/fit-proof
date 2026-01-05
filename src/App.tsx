import { BrowserRouter, Route, Routes } from "react-router-dom"
import AppLayout from "./components/layout/AppLayout"
import LoginPage from "./pages/auth/LoginPage"
import { AuthProvider } from "./context/AuthContext"
import { RequireAuth } from "./components/auth/RequireAuth"
import CalendarPage from "./pages/calendar/CalendarPage"
import SubmissionSettingsPage from "./pages/admin/SubmissionSettingsPage"
import SubmissionsPage from "./pages/admin/SubmissionsPage"
import UsersPage from "./pages/admin/UsersPage"
import { Toaster } from "./components/ui/toaster"

function App() {
    return (
        <AuthProvider>
            <BrowserRouter>
                <Routes>
                    <Route path="/login" element={<LoginPage />} />
                    <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
                        <Route path="/" element={<CalendarPage />} />
                        <Route path="/admin/submission-settings" element={<SubmissionSettingsPage />} />
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
