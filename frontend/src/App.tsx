import { BrowserRouter, Navigate, Route, Routes, Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { AuthProvider, useAuth } from './auth'
import LoginPage from './pages/LoginPage'
import UploadPage from './pages/UploadPage'
import ChatPage from './pages/ChatPage'

function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth()
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return <>{children}</>
}

function Nav() {
  const { user, isAuthenticated, logout } = useAuth()
  if (!isAuthenticated) return null
  return (
    <nav className="nav">
      <span className="brand">AI Document Assistant</span>
      <Link to="/" className="nav-link">Documents</Link>
      <Link to="/chat" className="nav-link">Assistant</Link>
      <span className="spacer" />
      <span className="user-email" title={user?.email}>{user?.email}</span>
      <button type="button" className="btn small" onClick={logout}>Sign out</button>
    </nav>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Nav />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <UploadPage />
              </RequireAuth>
            }
          />
          <Route
            path="/chat"
            element={
              <RequireAuth>
                <ChatPage />
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
