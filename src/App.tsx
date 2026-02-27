import { BrowserRouter, Route, Routes } from "react-router-dom"
import AppLayout from "./components/layout/AppLayout"
import LoginPage from "./pages/auth/LoginPage"
import { AuthProvider } from "./context/AuthContext"
import { RequireAuth } from "./components/auth/RequireAuth"
import CalendarPage from "./pages/calendar/CalendarPage"
import SubmissionSettingsPage from "./pages/admin/SubmissionSettingsPage"
import UsersPage from "./pages/admin/UsersPage"
import { Toaster } from "./components/ui/toaster"
import { TooltipProvider } from "./components/ui/tooltip"

function App() {
    return (
        <AuthProvider>
            <TooltipProvider>
                <BrowserRouter>
                    <Routes>
                        <Route path="/login" element={<LoginPage />} />
                        <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
                            <Route path="/" element={<CalendarPage />} />
                            <Route path="/admin/submission-settings" element={<SubmissionSettingsPage />} />
                            <Route path="/admin/users" element={<UsersPage />} />
                        </Route>
                    </Routes>
                    <Toaster />
                </BrowserRouter>
            </TooltipProvider>
        </AuthProvider>
    )
}

export default App
