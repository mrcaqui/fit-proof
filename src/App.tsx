import { BrowserRouter, Route, Routes } from "react-router-dom"
import AppLayout from "./components/layout/AppLayout"

function Dashboard() {
    return (
        <div>
            <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
            <p className="text-muted-foreground">Overview of your activity.</p>
        </div>
    )
}

function CalendarPage() {
    return (
        <div>
            <h2 className="text-3xl font-bold tracking-tight">Calendar</h2>
            <p className="text-muted-foreground">Manage your deadlines.</p>
        </div>
    )
}

function UploadPage() {
    return (
        <div>
            <h2 className="text-3xl font-bold tracking-tight">Upload</h2>
            <p className="text-muted-foreground">Submit your workout videos.</p>
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
        <BrowserRouter>
            <Routes>
                <Route element={<AppLayout />}>
                    <Route path="/" element={<Dashboard />} />
                    <Route path="/calendar" element={<CalendarPage />} />
                    <Route path="/upload" element={<UploadPage />} />
                    <Route path="/profile" element={<ProfilePage />} />
                </Route>
            </Routes>
        </BrowserRouter>
    )
}

export default App
