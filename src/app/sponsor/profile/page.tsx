"use client";

import Link from "next/link";
import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { SponsorAbout, SponsorTile } from "@/components/sponsor-tile";
import { squareLogo } from "@/lib/logo";
import { CATEGORIES } from "@/lib/sponsor";
import { supabase } from "@/lib/supabase";

interface Sponsor { id: number; name: string; category: string; email: string; about: string | null; website: string | null; logo_path: string | null }

/** Where a business tells players who it is: logo, a few lines and its website. */
export default function SponsorProfile() {
  const [sponsor, setSponsor] = useState<Sponsor | null | undefined>(undefined);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [email, setEmail] = useState("");
  const [about, setAbout] = useState("");
  const [website, setWebsite] = useState("");
  const [logo, setLogo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    supabase.from("sponsors").select("id, name, category, email, about, website, logo_path").order("created_at", { ascending: false }).limit(1)
      .then(async ({ data }) => {
        const s = (data?.[0] as Sponsor | undefined) ?? null;
        setSponsor(s);
        if (s) { setName(s.name); setCategory(s.category); setEmail(s.email); setAbout(s.about ?? ""); setWebsite(s.website ?? ""); setLogo(s.logo_path); return; }
        const { data: u } = await supabase.auth.getUser();
        const meta = u.user?.user_metadata ?? {};
        setEmail(u.user?.email ?? "");
        if (meta.kind === "business" && typeof meta.business_name === "string") setName(meta.business_name);
      });
  }, []);

  /** The business behind the profile, set up on first save. */
  async function ensureSponsor(): Promise<number> {
    if (sponsor) return sponsor.id;
    const { data, error } = await supabase.rpc("create_sponsor", { p_country: "ZA", p_name: name, p_category: category, p_email: email });
    if (error) throw new Error(error.message.includes("check") ? "Check the business name and email." : error.message);
    const id = data as number;
    setSponsor({ id, name, category, email, about: null, website: null, logo_path: null });
    return id;
  }

  async function pickLogo(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true); setMsg(null);
    try {
      if (!name.trim() || (!sponsor && !category)) throw new Error("Fill in the business name and type first.");
      const id = await ensureSponsor();
      const blob = await squareLogo(file);
      const path = `${id}/${crypto.randomUUID()}.png`;
      const up = await supabase.storage.from("sponsor-logos").upload(path, blob, { contentType: "image/png" });
      if (up.error) throw new Error("Couldn't upload that logo. Try a smaller picture.");
      setLogo(path);
      setMsg({ ok: true, text: "Logo ready. Save to show it." });
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    }
    setBusy(false);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const site = website.trim() && !/^https:\/\//i.test(website.trim()) ? `https://${website.trim().replace(/^http:\/\//i, "")}` : website.trim();
    try {
      const id = await ensureSponsor();
      const { error } = await supabase.rpc("save_sponsor_profile", { p_sponsor: id, p_name: name, p_about: about, p_website: site, p_logo_path: logo });
      if (error) throw new Error(error.message.includes("reword") ? error.message : error.message.includes("check") ? "Check the website address, and keep the description to 280 characters." : error.message);
      const old = sponsor?.logo_path;
      if (old && old !== logo) await supabase.storage.from("sponsor-logos").remove([old]);
      setWebsite(site);
      setSponsor((s) => (s ? { ...s, name, about: about || null, website: site || null, logo_path: logo } : s));
      setMsg({ ok: true, text: "Saved. Players see this when they tap your name." });
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    }
    setBusy(false);
  }

  if (sponsor === undefined) return <div className="skeleton" style={{ height: 240 }} />;

  return (
    <>
      <div className="card narrow">
        <p className="sp-kicker">Your business</p>
        <h2>Your profile</h2>
        <p className="sub">Players see this when they tap your name on their pool or on the Giving page. Keep it short and friendly.</p>
        <form onSubmit={save}>
          <div className="profile-logo">
            <SponsorTile name={name} logo={logo} big />
            <label className="btn ghost">
              {logo ? "Change logo" : "Add your logo"}
              <input type="file" accept="image/*" hidden onChange={pickLogo} disabled={busy} />
            </label>
            {logo && <button type="button" className="linkish small muted" onClick={() => setLogo(null)}>Remove</button>}
          </div>
          <div className="field"><label>Business name</label>
            <input required minLength={2} maxLength={40} value={name} onChange={(e) => setName(e.target.value)} /></div>
          {!sponsor && <>
            <div className="field"><label>What kind of business</label>
              <select required value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">Choose one</option>
                {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select></div>
            <div className="field"><label>Email for your results</label>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          </>}
          <div className="field"><label>About you ({280 - about.length} characters left)</label>
            <textarea rows={4} maxLength={280} placeholder="Who you are, where to find you, what you're known for." value={about} onChange={(e) => setAbout(e.target.value)} /></div>
          <div className="field"><label>Website</label>
            <input inputMode="url" placeholder="yourbusiness.co.za" value={website} onChange={(e) => setWebsite(e.target.value)} /></div>
          <button type="submit" className="paybtn" disabled={busy}>{busy ? "Saving…" : "Save profile"}</button>
        </form>
        {msg && <p className="small" style={{ color: msg.ok ? "var(--accent)" : "var(--danger)", marginBottom: 0 }}>{msg.text}</p>}
      </div>

      {(about || website) && (
        <div className="card narrow">
          <p className="small muted" style={{ marginTop: 0 }}>What players see</p>
          <div className="spline">
            <SponsorTile name={name} logo={logo} />
            <div>
              <div>Sponsored by <b>{name}</b></div>
              <SponsorAbout about={about || null} website={website ? (/^https:\/\//i.test(website) ? website : `https://${website}`) : null} />
            </div>
          </div>
        </div>
      )}
      <p className="small muted center"><Link href="/sponsor/">Back to sponsoring</Link></p>
    </>
  );
}
