import React from "react";
import {
  RefreshCw, ShieldCheck, Siren, LogOut, Sun, Moon, LayoutDashboard, Radio, BarChart3, Languages
} from "lucide-react";
import { useTheme } from "../ThemeContext";
import { useLanguage, LANGUAGES } from "../LanguageContext";

export function LanguageSelect() {
  const { language, setLanguage } = useLanguage();
  return (
    <div className="language-select-wrap">
      <Languages size={16} className="lang-icon" />
      <select
        className="language-select"
        value={language}
        onChange={(e) => setLanguage(e.target.value)}
        title="Select Language"
      >
        {LANGUAGES.map((lang) => (
          <option key={lang.code} value={lang.code}>
            {lang.native} ({lang.name})
          </option>
        ))}
      </select>
    </div>
  );
}

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <button
      className="theme-toggle-btn"
      onClick={toggleTheme}
      title={theme === "light" ? "Switch to Dark Mode" : "Switch to Light Mode"}
      aria-label="Toggle Theme"
    >
      {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
    </button>
  );
}

export function navigateTo(path) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new Event("popstate"));
  window.scrollTo(0, 0);
}

export function Topbar({ user, onLogout }) {
  const currentPath = window.location.pathname.replace(/\/+$/,"") || "/";
  const { t } = useLanguage();

  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="brand" onClick={() => navigateTo(user?.role === "admin" ? "/admin" : "/")}>
          <div className="brand-mark"><Siren size={22} /></div>
          <div>
            <strong>ResponseAI</strong>
            <span>Emergency Response Assistant</span>
          </div>
        </div>

        {user?.role === "admin" && (
          <nav className="topbar-nav">
            <button
              className={`topbar-nav-item ${currentPath === "/admin" || currentPath === "/" || currentPath.startsWith("/admin/incidents") || currentPath.startsWith("/admin/reports") ? "active" : ""}`}
              onClick={() => navigateTo("/admin")}
            >
              <LayoutDashboard size={16} /> {t("command_center", "Command Center")}
            </button>
            <button
              className={`topbar-nav-item ${currentPath === "/rescue" ? "active" : ""}`}
              onClick={() => navigateTo("/rescue")}
            >
              <Radio size={16} /> {t("rescue_console", "Rescue Console")}
            </button>
            <button
              className={`topbar-nav-item ${currentPath === "/stages" ? "active" : ""}`}
              onClick={() => navigateTo("/stages")}
            >
              <BarChart3 size={16} /> {t("stage_analyzer", "Stage Analyzer")}
            </button>
          </nav>
        )}
      </div>

      <div className="topbar-actions">
        <LanguageSelect />
        <ThemeToggle />
        {user && (
          <div className="topbar-user">
            <div className="topbar-user-info">
              <strong>{user.full_name}</strong>
              <span>{user.role}</span>
            </div>
            <button className="icon-btn" title="Log out" onClick={onLogout}>
              <LogOut size={18}/>
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

export function Badge({ children, kind = "" }) {
  return <span className={`badge ${kind}`}>{children}</span>;
}

export function StatCard({ label, value, icon, tone, subtitle }) {
  return (
    <div className={`stat-card ${tone || ""}`}>
      <div className="stat-icon">{icon}</div>
      <div className="stat-content">
        <span>{label}</span>
        <strong>{value ?? 0}</strong>
        {subtitle && <small className="stat-sub">{subtitle}</small>}
      </div>
    </div>
  );
}

export function ErrorBox({ children }) {
  return children ? <div className="error-box">{children}</div> : null;
}

export function SuccessBox({ children }) {
  return children ? <div className="success-box"><ShieldCheck size={16}/>{children}</div> : null;
}

export function RefreshButton({ loading, onClick }) {
  return (
    <button className="secondary-btn" onClick={onClick}>
      <RefreshCw size={16} className={loading ? "spin" : ""}/> Refresh
    </button>
  );
}
