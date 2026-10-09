import React, { useEffect, useState } from "react";
import "leaflet/dist/leaflet.css";
import "./styles.css";
import { api } from "./api";
import Auth from "./components/Auth";
import AdminDashboard from "./components/AdminDashboard";
import UserDashboard from "./components/UserDashboard";
import RescueDispatchConsole from "./components/RescueDispatchConsole";
import EmergencyDashboard from "./components/EmergencyDashboard";

export default function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [currentPath, setCurrentPath] = useState(window.location.pathname.replace(/\/+$/,"") || "/");

  useEffect(() => {
    api("/api/auth/me")
      .then((x) => { if (x.authenticated) setUser(x.user); })
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    const onLocationChange = () => {
      setCurrentPath(window.location.pathname.replace(/\/+$/,"") || "/");
    };
    window.addEventListener("popstate", onLocationChange);
    return () => window.removeEventListener("popstate", onLocationChange);
  }, []);

  const logout = async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    setUser(null);
  };

  if (checking) return <div className="loading-screen"><div className="spin-ring"></div>Loading ResponseAI...</div>;
  if (!user) return <Auth onLoggedIn={setUser} />;

  if (user.role === "admin") {
    if (currentPath === "/rescue") return <RescueDispatchConsole user={user} onLogout={logout} />;
    if (currentPath === "/stages") return <EmergencyDashboard user={user} onLogout={logout} />;
    return <AdminDashboard user={user} onLogout={logout} />;
  }

  return <UserDashboard user={user} onLogout={logout} />;
}