import React, { useEffect, useState } from "react";
import { CircleUserRound, ShieldCheck, Siren } from "lucide-react";
import { api } from "../api";
import { ErrorBox, ThemeToggle } from "./Common";

function Logo() {
  return (
    <div className="brand">
      <div className="brand-mark"><Siren size={22} /></div>
      <div>
        <strong>ResponseAI</strong>
        <span>Emergency Response Assistant</span>
      </div>
    </div>
  );
}

export default function Auth({ onLoggedIn }) {
  const [mode, setMode] = useState("login");
  const [role, setRole] = useState("user");
  const [form, setForm] = useState({ full_name: "", email: "", password: "" });
  const [setup, setSetup] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api("/api/admin/setup-available").then(x => setSetup(x.available)).catch(() => {});
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (mode === "register") {
        await api("/api/auth/register", {
          method: "POST",
          headers: {"Content-Type":"application/json"},
          body: JSON.stringify(form),
        });
        setMode("login");
        setForm(x => ({...x, password:""}));
        return;
      }

      if (mode === "setup") {
        await api("/api/setup-admin", {
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify(form),
        });
        setSetup(false);
        setMode("login");
        setRole("admin");
        setForm(x => ({...x, password:""}));
        return;
      }

      const result = await api("/api/auth/login", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({email:form.email,password:form.password,role}),
      });
      onLoggedIn(result.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="auth-shell">
      <div className="theme-floating-btn">
        <ThemeToggle />
      </div>
      <section className="auth-card">
        <Logo/>
        <div className="auth-title">
          <span className="eyebrow">RESPONDER PLATFORM</span>
          <h1>{mode === "setup" ? "Create the first admin" : "Welcome back"}</h1>
          <p>Organize incoming emergency evidence into real-time incident status.</p>
        </div>

        {mode !== "setup" && (
          <div className="role-switch">
            <button className={role==="user" ? "active":""} onClick={()=>setRole("user")} type="button"><CircleUserRound size={17}/> User</button>
            <button className={role==="admin" ? "active":""} onClick={()=>setRole("admin")} type="button"><ShieldCheck size={17}/> Admin</button>
          </div>
        )}

        <form onSubmit={submit} className="form">
          {(mode === "register" || mode === "setup") && (
            <label>
              Full name
              <input required value={form.full_name} onChange={e=>setForm({...form,full_name:e.target.value})} placeholder="e.g. Jane Doe" />
            </label>
          )}
          <label>
            Email address
            <input type="email" required value={form.email} onChange={e=>setForm({...form,email:e.target.value})} placeholder="name@example.com" />
          </label>
          <label>
            Password
            <input type="password" required minLength={mode==="setup"?8:6} value={form.password} onChange={e=>setForm({...form,password:e.target.value})} placeholder="••••••••" />
          </label>
          <ErrorBox>{error}</ErrorBox>
          <button className="primary-btn" disabled={loading} style={{ marginTop: 6, width: "100%" }}>
            {loading ? "Please wait..." : mode==="register" ? "Create user account" : mode==="setup" ? "Create admin" : "Sign in"}
          </button>
        </form>

        {mode !== "setup" && role==="user" && (
          <button className="text-btn" onClick={()=>setMode(mode==="login"?"register":"login")} type="button">
            {mode==="login" ? "Create a user account" : "Already have an account? Sign in"}
          </button>
        )}

        {mode !== "setup" && role==="admin" && setup && (
          <button className="text-btn" onClick={()=>setMode("setup")} type="button">First-time admin setup</button>
        )}

        {mode === "setup" && <button className="text-btn" onClick={()=>setMode("login")} type="button">Back to admin login</button>}

        <div className="auth-note">
          <ShieldCheck size={16}/> AI assists trained responders; human decision control is preserved.
        </div>
      </section>
    </main>
  );
}
