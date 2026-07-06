import React, { useState, useEffect, useMemo } from "react";
import { Routes, Route, useParams, useNavigate, Link } from "react-router-dom";
import {
  Plus, Copy, Check, X, RotateCcw, ExternalLink, Shield, Loader2,
  Lock, KeyRound, ImagePlus, Trash2, ChevronRight,
} from "lucide-react";
import { supabase } from "./supabaseClient";

/* ---------------------------------------------------------
   Formatting + calculation helpers
--------------------------------------------------------- */
function fmtUSD(n) {
  if (n === "" || n === null || n === undefined || isNaN(n)) return "—";
  return `$${Number(n).toFixed(2)}`;
}
function fmtSGD(n) {
  if (n === "" || n === null || n === undefined || isNaN(n)) return "—";
  return `S$${Number(n).toFixed(2)}`;
}
function hasValue(v) {
  return v !== "" && v !== null && v !== undefined && !isNaN(v);
}
function computeTotalEarningsSGD(card, rate) {
  if (!hasValue(card.order_earnings) || !hasValue(card.shipping)) return null;
  return (Number(card.order_earnings) - Number(card.shipping)) * rate;
}
function fmtDate(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-SG", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return d;
  }
}
function fmtDateTime(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString("en-SG", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return d;
  }
}
function timeAgo(iso) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
function extractItemId(link) {
  if (!link) return null;
  const m = link.match(/(\d{6,})/);
  return m ? m[1] : null;
}
function estimatedEnd(startDateStr, days) {
  if (!startDateStr) return null;
  const start = new Date(startDateStr);
  if (isNaN(start.getTime())) return null;
  return new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
}
function formatCountdownLong(targetDate, now) {
  const diff = targetDate.getTime() - now.getTime();
  if (diff <= 0) return { text: "Ended", ended: true };
  const totalMins = Math.floor(diff / 60000);
  const days = Math.floor(totalMins / (60 * 24));
  const hours = Math.floor((totalMins % (60 * 24)) / 60);
  const mins = totalMins % 60;
  let text;
  if (days > 0) text = `${days} Day${days !== 1 ? "s" : ""} ${hours} Hr${hours !== 1 ? "s" : ""} left`;
  else if (hours > 0) text = `${hours} Hr${hours !== 1 ? "s" : ""} ${mins} Min${mins !== 1 ? "s" : ""} left`;
  else text = `${mins} Min${mins !== 1 ? "s" : ""} left`;
  return { text, ended: false };
}

// Compress an image client-side before uploading, so a full-res phone photo
// doesn't turn into a multi-MB upload.
function compressImageFile(file, maxDim = 1400, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) { height = Math.round((height * maxDim) / width); width = maxDim; }
          else { width = Math.round((width * maxDim) / height); height = maxDim; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => resolve(blob), "image/jpeg", quality);
      };
      img.onerror = () => reject(new Error("Could not load that image."));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.readAsDataURL(file);
  });
}

async function uploadImage(file, pathPrefix) {
  const compressed = await compressImageFile(file);
  const path = `${pathPrefix}/${Date.now()}.jpg`;
  const { error } = await supabase.storage.from("card-photos").upload(path, compressed, {
    contentType: "image/jpeg",
    upsert: true,
  });
  if (error) throw error;
  const { data } = supabase.storage.from("card-photos").getPublicUrl(path);
  return data.publicUrl;
}

async function fetchLiveFxRate() {
  const res = await fetch("https://api.frankfurter.app/latest?from=USD&to=SGD");
  if (!res.ok) throw new Error("FX fetch failed");
  const data = await res.json();
  return data.rates.SGD;
}

const STATUS_META = {
  listed: { label: "IN AUCTION", color: "#CC0001", stamp: false },
  offer: { label: "BEST OFFER", color: "#CC0001", stamp: false },
  sold: { label: "BUYER PAID", color: "#2F8F4E", stamp: true },
  paid: { label: "PAYOUT DONE", color: "#2F5FA8", stamp: true },
};
const FILTER_TABS = [
  { key: "listed", label: "In Auction" },
  { key: "offer", label: "Best Offer" },
  { key: "sold", label: "Buyer Paid" },
  { key: "paid", label: "Payout Done" },
];

/* ---------------------------------------------------------
   Small UI atoms
--------------------------------------------------------- */
function Stamp({ status }) {
  const meta = STATUS_META[status] || STATUS_META.listed;
  if (!meta.stamp) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold tracking-wide"
        style={{ color: meta.color, border: `1px solid ${meta.color}`, fontFamily: "'Space Grotesk', sans-serif" }}>
        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: meta.color }} />
        {meta.label}
      </span>
    );
  }
  return (
    <span className="inline-block rounded px-2.5 py-1 text-xs font-extrabold tracking-widest"
      style={{ color: "#F3EFE3", backgroundColor: meta.color, transform: "rotate(-3deg)", fontFamily: "'Roboto Slab', serif", boxShadow: "1px 1px 0 rgba(0,0,0,0.25)" }}>
      {meta.label}
    </span>
  );
}

function FoilCorner() {
  return <div aria-hidden className="absolute top-0 right-0 w-10 h-10" style={{ background: "linear-gradient(135deg, transparent 50%, #CC0001 50%)", opacity: 0.9 }} />;
}

function Field({ label, value, onChange, type = "text", textarea, placeholder }) {
  return (
    <div>
      <label className="text-[11px] opacity-60 block mb-1" style={{ color: "#FAF7F2" }}>{label}</label>
      {textarea ? (
        <textarea value={value || ""} onChange={onChange} rows={2} className="w-full rounded px-3 py-2 text-sm" style={{ backgroundColor: "#F3EFE3", color: "#1C1B14" }} />
      ) : (
        <input type={type} value={value ?? ""} onChange={onChange} placeholder={placeholder} className="w-full rounded px-3 py-2 text-sm" style={{ backgroundColor: "#F3EFE3", color: "#1C1B14" }} />
      )}
    </div>
  );
}

/* ---------------------------------------------------------
   Card Slab — shown to both owner and consignors
--------------------------------------------------------- */
function CardSlab({ card, fxRate, onEdit, editable }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(t);
  }, []);

  const hasRealEnd = !!card.end_date;
  const estEnd = !hasRealEnd && card.start_date
    ? card.status === "listed" ? estimatedEnd(card.start_date, 7)
    : card.status === "offer" ? estimatedEnd(card.start_date, 30)
    : null
    : null;
  const endDisplay = hasRealEnd ? fmtDateTime(card.end_date) : estEnd ? fmtDateTime(estEnd.toISOString()) : "—";
  const countdown = hasRealEnd ? { text: "Ended", ended: true } : estEnd ? formatCountdownLong(estEnd, now) : { text: "—", ended: false };
  const mechanism = card.sale_mechanism || card.status;
  const startLabel = mechanism === "listed" ? "Start Bid" : mechanism === "offer" ? "Listed Price" : "Start Value";
  const endLabel = mechanism === "listed" ? "End Bid" : mechanism === "offer" ? "Offer Accepted" : "End Value";

  return (
    <div className="relative rounded-lg overflow-hidden" style={{ backgroundColor: "#FAF7F2", border: "1px solid #E3DFD6", boxShadow: "0 8px 24px -8px rgba(0,0,0,0.5)" }}>
      <FoilCorner />
      <div className="flex gap-3 p-4 pt-6">
        {card.photo_url && (
          <img src={card.photo_url} alt={card.description} className="flex-shrink-0 rounded" style={{ width: 84, height: 118, objectFit: "cover", border: "1px solid #E3DFD6" }} />
        )}
        <div className="flex-1 min-w-0">
          <h3 className="text-[15px] leading-snug font-semibold mb-3" style={{ color: "#141110", fontFamily: "'Space Grotesk', sans-serif" }}>{card.description}</h3>
          <div className="flex items-center justify-between mb-3">
            <Stamp status={card.status} />
            {card.link && (
              <a href={card.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] font-medium hover:underline" style={{ color: "#141110" }}>
                View listing <ExternalLink size={11} />
              </a>
            )}
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12px] mb-3 pt-3" style={{ borderTop: "1px dashed #E3DFD6", fontFamily: "'Space Mono', monospace", color: "#4A4636" }}>
            <div className="flex justify-between col-span-2"><span className="opacity-60">Start</span><span>{fmtDateTime(card.start_date)}</span></div>
            <div className="flex justify-between col-span-2"><span className="opacity-60">End</span><span>{endDisplay}</span></div>
            <div className="flex justify-between col-span-2"><span className="opacity-60">Countdown</span><span style={countdown.ended && !hasRealEnd ? { color: "#CC0001" } : undefined}>{countdown.text}</span></div>
            <div className="flex justify-between col-span-2"><span className="opacity-60">{startLabel}</span><span>{fmtUSD(card.start_value)}</span></div>
            <div className="flex justify-between col-span-2"><span className="opacity-60">{endLabel}</span><span>{card.end_value != null ? fmtUSD(card.end_value) : "In Progress"}</span></div>
            <div className="flex justify-between col-span-2"><span className="opacity-60">Shipping</span><span>{hasValue(card.shipping) ? fmtUSD(card.shipping) : "—"}</span></div>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <div className="rounded p-2 text-center" style={{ backgroundColor: "#141110" }}>
              <div className="text-[8px] tracking-wide opacity-60 leading-tight" style={{ color: "#FAF7F2" }}>ORDER TOTAL</div>
              <div className="text-xs font-bold" style={{ color: "#3FA34D", fontFamily: "'Roboto Slab', serif" }}>{hasValue(card.order_total) ? fmtUSD(card.order_total) : "—"}</div>
            </div>
            <div className="rounded p-2 text-center" style={{ backgroundColor: "#141110" }}>
              <div className="text-[8px] tracking-wide opacity-60 leading-tight" style={{ color: "#FAF7F2" }}>ORDER EARNINGS</div>
              <div className="text-xs font-bold" style={{ color: "#3FA34D", fontFamily: "'Roboto Slab', serif" }}>{hasValue(card.order_earnings) ? fmtUSD(card.order_earnings) : "—"}</div>
            </div>
            <div className="rounded p-2 text-center" style={{ backgroundColor: "#141110" }}>
              <div className="text-[8px] tracking-wide opacity-60 leading-tight" style={{ color: "#FAF7F2" }}>TOTAL EARNINGS (SGD)</div>
              <div className="text-xs font-bold" style={{ color: "#3FA34D", fontFamily: "'Roboto Slab', serif" }}>{fmtSGD(computeTotalEarningsSGD(card, fxRate))}</div>
            </div>
          </div>
          <div className="mt-2 text-[10px] text-right opacity-50" style={{ color: "#4A4636", fontFamily: "'Space Grotesk', sans-serif" }}>Updated {timeAgo(card.updated_at)}</div>
          {editable && (
            <button onClick={() => onEdit(card)} className="mt-2 w-full text-[12px] font-semibold rounded py-1.5" style={{ border: "1px solid #141110", color: "#141110" }}>
              Edit card
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   Card editor (owner only)
--------------------------------------------------------- */
function CardEditor({ initial, consignorId, onSaved, onCancel, onDeleted }) {
  const [form, setForm] = useState(
    initial || {
      link: "", description: "", status: "listed", sale_mechanism: null,
      start_date: "", start_value: "", end_date: "", end_value: "",
      order_total: "", order_earnings: "", shipping: "", photo_url: null,
    }
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const handleStatusChange = (e) => {
    const newStatus = e.target.value;
    setForm((prev) => ({
      ...prev,
      status: newStatus,
      sale_mechanism: prev.status === "listed" || prev.status === "offer" ? prev.status : prev.sale_mechanism,
    }));
  };

  const handlePhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadingPhoto(true);
    setError("");
    try {
      const url = await uploadImage(file, consignorId);
      setForm((prev) => ({ ...prev, photo_url: url }));
    } catch (err) {
      setError(err.message || "Photo upload failed.");
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError("");
    const payload = {
      consignor_id: consignorId,
      link: form.link, description: form.description, status: form.status,
      sale_mechanism: form.sale_mechanism,
      start_date: form.start_date || null, start_value: form.start_value === "" ? null : form.start_value,
      end_date: form.end_date || null, end_value: form.end_value === "" ? null : form.end_value,
      order_total: form.order_total === "" ? null : form.order_total,
      order_earnings: form.order_earnings === "" ? null : form.order_earnings,
      shipping: form.shipping === "" ? null : form.shipping,
      photo_url: form.photo_url,
      updated_at: new Date().toISOString(),
    };
    const result = initial
      ? await supabase.from("cards").update(payload).eq("id", initial.id)
      : await supabase.from("cards").insert(payload);
    setSaving(false);
    if (result.error) { setError(result.error.message); return; }
    onSaved();
  };

  const handleDelete = async () => {
    if (!initial) return;
    setSaving(true);
    const { error } = await supabase.from("cards").delete().eq("id", initial.id);
    setSaving(false);
    if (error) { setError(error.message); return; }
    onDeleted();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6" style={{ backgroundColor: "rgba(20,17,16,0.85)" }}>
      <div className="w-full sm:max-w-md rounded-t-xl sm:rounded-xl p-5 overflow-y-auto" style={{ backgroundColor: "#1F1A18", maxHeight: "90vh" }}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold" style={{ color: "#FAF7F2", fontFamily: "'Roboto Slab', serif" }}>{initial ? "Edit card" : "Add card"}</h3>
          <button onClick={onCancel}><X size={20} color="#FAF7F2" /></button>
        </div>
        <div className="space-y-3">
          <Field label="eBay link" value={form.link} onChange={set("link")} placeholder="https://www.ebay.com/itm/..." />
          <Field label="Card description" value={form.description} onChange={set("description")} textarea />
          <div>
            <label className="text-[11px] opacity-60 block mb-1" style={{ color: "#FAF7F2" }}>Status</label>
            <select value={form.status} onChange={handleStatusChange} className="w-full rounded px-3 py-2 text-sm" style={{ backgroundColor: "#F3EFE3", color: "#1C1B14" }}>
              <option value="listed">In Auction</option>
              <option value="offer">Best Offer</option>
              <option value="sold">Buyer Paid</option>
              <option value="paid">Payout Done</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start date/time" value={form.start_date} onChange={set("start_date")} type="datetime-local" />
            <Field label="Start value (USD)" value={form.start_value} onChange={set("start_value")} type="number" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="End date/time" value={form.end_date} onChange={set("end_date")} type="datetime-local" />
            <Field label="End value (USD)" value={form.end_value} onChange={set("end_value")} type="number" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Order total (USD)" value={form.order_total} onChange={set("order_total")} type="number" />
            <Field label="Order earnings (USD)" value={form.order_earnings} onChange={set("order_earnings")} type="number" />
          </div>
          <Field label="Shipping (USD)" value={form.shipping} onChange={set("shipping")} type="number" />
          <div>
            <label className="text-[11px] opacity-60 block mb-1" style={{ color: "#FAF7F2" }}>Card photo (front)</label>
            {form.photo_url && (
              <img src={form.photo_url} alt="Card front" className="w-full rounded mb-2" style={{ maxHeight: 220, objectFit: "contain", backgroundColor: "#FAF7F2" }} />
            )}
            <div className="flex gap-2">
              <label className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold rounded py-2 cursor-pointer" style={{ border: "1px solid rgba(250,247,242,0.4)", color: "#FAF7F2" }}>
                {uploadingPhoto ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} />}
                {uploadingPhoto ? "Uploading…" : form.photo_url ? "Replace photo" : "Upload photo"}
                <input type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} disabled={uploadingPhoto} />
              </label>
              {form.photo_url && (
                <button onClick={() => setForm((p) => ({ ...p, photo_url: null }))} className="text-xs font-semibold rounded px-3" style={{ border: "1px solid #CC0001", color: "#CC0001" }}>
                  Remove
                </button>
              )}
            </div>
          </div>
        </div>
        {error && <p className="text-[11px] mt-3" style={{ color: "#CC0001" }}>{error}</p>}
        <div className="flex gap-2 mt-5">
          {initial && (
            <button onClick={handleDelete} disabled={saving} className="text-sm font-semibold rounded px-4 py-2" style={{ color: "#CC0001", border: "1px solid #CC0001" }}>
              Remove
            </button>
          )}
          <button onClick={handleSave} disabled={saving} className="flex-1 text-sm font-bold rounded px-4 py-2" style={{ backgroundColor: "#CC0001", color: "#FAF7F2" }}>
            {saving ? "Saving…" : "Save card"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   Owner dashboard
--------------------------------------------------------- */
function OwnerDashboard({ session }) {
  const navigate = useNavigate();
  const [consignors, setConsignors] = useState([]);
  const [selected, setSelected] = useState(null);
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingCard, setEditingCard] = useState(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newHandle, setNewHandle] = useState("");
  const [addError, setAddError] = useState("");
  const [copiedId, setCopiedId] = useState(null);
  const [fx, setFx] = useState({ rate: 1.29, updatedAt: null });
  const [fxInput, setFxInput] = useState("1.29");
  const [filter, setFilter] = useState("listed");

  const loadAll = async () => {
    setLoading(true);
    const { data: cData } = await supabase.from("consignors").select("*").order("created_at");
    setConsignors(cData || []);
    if (cData && cData.length && !selected) setSelected(cData[0].id);
    const { data: fxRow } = await supabase.from("app_settings").select("*").eq("key", "fx_rate").single();
    if (fxRow) { setFx(fxRow.value); setFxInput(fxRow.value.rate); }
    setLoading(false);
  };

  useEffect(() => { loadAll(); }, []);

  useEffect(() => {
    if (!selected) { setCards([]); return; }
    (async () => {
      const { data } = await supabase.from("cards").select("*").eq("consignor_id", selected).order("created_at", { ascending: false });
      setCards(data || []);
    })();
  }, [selected, editingCard]);

  // Auto-refresh FX rate once a day
  useEffect(() => {
    if (!fx.updatedAt) return;
    const age = Date.now() - new Date(fx.updatedAt).getTime();
    if (age < 24 * 60 * 60 * 1000) return;
    (async () => {
      try {
        const rate = await fetchLiveFxRate();
        const value = { rate, updatedAt: new Date().toISOString() };
        await supabase.from("app_settings").upsert({ key: "fx_rate", value });
        setFx(value);
        setFxInput(rate);
      } catch {}
    })();
  }, [fx.updatedAt]);

  const updateFxRate = async () => {
    const value = { rate: parseFloat(fxInput) || fx.rate, updatedAt: new Date().toISOString() };
    await supabase.from("app_settings").upsert({ key: "fx_rate", value });
    setFx(value);
  };

  const addConsignor = async () => {
    const handle = newHandle.trim().replace(/^@/, "");
    if (!newName.trim() || !handle) { setAddError("Name and Telegram username are both needed."); return; }
    const { data, error } = await supabase.from("consignors").insert({ name: newName.trim(), telegram_username: handle }).select().single();
    if (error) { setAddError(error.message.includes("duplicate") ? "That Telegram username is already in use." : error.message); return; }
    setConsignors((prev) => [...prev, data]);
    setSelected(data.id);
    setNewName(""); setNewHandle(""); setAddError(""); setAdding(false);
  };

  const deleteConsignor = async (id) => {
    if (!window.confirm("Remove this consignor and all of their cards? This can't be undone.")) return;
    await supabase.from("consignors").delete().eq("id", id);
    const next = consignors.filter((c) => c.id !== id);
    setConsignors(next);
    if (selected === id) setSelected(next[0]?.id || null);
  };

  const copyLink = (username) => {
    const url = `${window.location.origin}/${username}`;
    navigator.clipboard?.writeText(url).catch(() => {});
    setCopiedId(username);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const signOut = async () => { await supabase.auth.signOut(); navigate("/owner"); };

  const filteredCards = cards.filter((c) => c.status === filter);

  if (loading) return <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "#141110" }}><Loader2 className="animate-spin" color="#CC0001" size={28} /></div>;

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#141110" }}>
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="text-[11px] tracking-[0.25em] opacity-50" style={{ color: "#FAF7F2" }}>OWNER VIEW</div>
            <h1 className="text-2xl font-extrabold" style={{ color: "#FAF7F2", fontFamily: "'Roboto Slab', serif" }}>Sports Collectibles SG</h1>
          </div>
          <button onClick={signOut} className="text-xs underline opacity-60" style={{ color: "#FAF7F2" }}>Sign out</button>
        </div>

        <div className="flex items-center gap-3 mb-6 rounded-lg px-4 py-3 flex-wrap" style={{ backgroundColor: "#1F1A18" }}>
          <span className="text-xs opacity-60" style={{ color: "#FAF7F2" }}>USD → SGD rate</span>
          <input type="number" step="0.01" value={fxInput} onChange={(e) => setFxInput(e.target.value)} className="w-20 rounded px-2 py-1 text-sm" style={{ backgroundColor: "#F3EFE3", color: "#1C1B14" }} />
          <button onClick={updateFxRate} className="text-xs font-semibold rounded px-3 py-1.5" style={{ backgroundColor: "#CC0001", color: "#FAF7F2" }}>Update</button>
          <span className="text-[11px] opacity-40 ml-auto" style={{ color: "#FAF7F2" }}>set {timeAgo(fx.updatedAt)} · auto-refreshes daily on open</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[220px_1fr] gap-5">
          <div className="rounded-lg p-3" style={{ backgroundColor: "#1F1A18" }}>
            <div className="flex items-center justify-between mb-2 px-1">
              <span className="text-[11px] tracking-widest opacity-50" style={{ color: "#FAF7F2" }}>CONSIGNORS</span>
              <button onClick={() => setAdding(true)}><Plus size={16} color="#CC0001" /></button>
            </div>
            {adding && (
              <div className="mb-2 px-1 space-y-1.5">
                <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name" className="w-full rounded px-2 py-1 text-sm" style={{ backgroundColor: "#F3EFE3", color: "#1C1B14" }} />
                <div className="flex gap-1">
                  <span className="flex items-center px-2 rounded text-sm" style={{ backgroundColor: "#F3EFE3", color: "#726C63" }}>@</span>
                  <input value={newHandle} onChange={(e) => setNewHandle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addConsignor()} placeholder="telegram_username" className="w-full rounded px-2 py-1 text-sm" style={{ backgroundColor: "#F3EFE3", color: "#1C1B14", fontFamily: "'Space Mono', monospace" }} />
                  <button onClick={addConsignor}><Check size={16} color="#7FA087" /></button>
                </div>
                {addError && <p className="text-[10px]" style={{ color: "#CC0001" }}>{addError}</p>}
              </div>
            )}
            <div className="space-y-1">
              {consignors.map((c) => (
                <button key={c.id} onClick={() => setSelected(c.id)} className="w-full text-left rounded px-2.5 py-2 flex items-center justify-between" style={{ backgroundColor: selected === c.id ? "#141110" : "transparent" }}>
                  <div>
                    <div className="text-sm font-semibold" style={{ color: "#FAF7F2" }}>{c.name}</div>
                    <div className="text-[10px] opacity-40" style={{ color: "#FAF7F2", fontFamily: "'Space Mono', monospace" }}>@{c.telegram_username}</div>
                  </div>
                  <span className="flex items-center gap-2">
                    <span onClick={(e) => { e.stopPropagation(); copyLink(c.telegram_username); }} className="p-1">
                      {copiedId === c.telegram_username ? <Check size={13} color="#7FA087" /> : <Copy size={13} color="#726C63" />}
                    </span>
                    <span onClick={(e) => { e.stopPropagation(); deleteConsignor(c.id); }} className="p-1">
                      <Trash2 size={13} color="#CC0001" />
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div>
            {selected ? (
              <>
                <div className="flex items-center justify-between mb-1">
                  <h2 className="text-sm font-semibold" style={{ color: "#FAF7F2" }}>{cards.length} card{cards.length !== 1 ? "s" : ""}</h2>
                  <button onClick={() => setEditingCard({})} className="flex items-center gap-1 text-xs font-semibold rounded px-3 py-1.5" style={{ backgroundColor: "#CC0001", color: "#FAF7F2" }}>
                    <Plus size={13} /> Add card
                  </button>
                </div>
                <div className="flex gap-2 flex-wrap mb-4">
                  {FILTER_TABS.map((f) => (
                    <button key={f.key} onClick={() => setFilter(f.key)} className="text-xs font-semibold rounded-full px-3 py-1.5"
                      style={{ backgroundColor: filter === f.key ? "#CC0001" : "transparent", color: "#FAF7F2", border: filter === f.key ? "none" : "1px solid rgba(250,247,242,0.25)" }}>
                      {f.label}
                    </button>
                  ))}
                </div>
                {filteredCards.length === 0 ? (
                  <div className="rounded-lg p-8 text-center text-sm opacity-50" style={{ backgroundColor: "#1F1A18", color: "#FAF7F2" }}>Nothing here yet.</div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {filteredCards.map((card) => (
                      <CardSlab key={card.id} card={card} fxRate={fx.rate} editable onEdit={(c) => setEditingCard(c)} />
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="rounded-lg p-8 text-center text-sm opacity-50" style={{ backgroundColor: "#1F1A18", color: "#FAF7F2" }}>Add a consignor to get started.</div>
            )}
          </div>
        </div>
      </div>

      {editingCard !== null && (
        <CardEditor
          initial={editingCard.id ? editingCard : null}
          consignorId={selected}
          onSaved={() => setEditingCard(null)}
          onCancel={() => setEditingCard(null)}
          onDeleted={() => setEditingCard(null)}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------
   Owner login (Supabase Auth — create the actual user in
   Supabase Dashboard -> Authentication -> Users -> Add user)
--------------------------------------------------------- */
function OwnerLogin({ onSignedIn }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setLoading(true);
    setError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) { setError(error.message); return; }
    onSignedIn();
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: "#141110" }}>
      <div className="max-w-xs w-full rounded-lg p-5" style={{ backgroundColor: "#1F1A18" }}>
        <div className="flex items-center gap-2 mb-4">
          <Lock size={16} color="#CC0001" />
          <h2 className="text-sm font-bold" style={{ color: "#FAF7F2", fontFamily: "'Roboto Slab', serif" }}>Owner sign in</h2>
        </div>
        <div className="space-y-2">
          <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded px-3 py-2 text-sm" style={{ backgroundColor: "#F3EFE3", color: "#1C1B14" }} />
          <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} className="w-full rounded px-3 py-2 text-sm" style={{ backgroundColor: "#F3EFE3", color: "#1C1B14" }} />
        </div>
        {error && <p className="text-[11px] mt-2" style={{ color: "#CC0001" }}>{error}</p>}
        <button onClick={submit} disabled={loading} className="w-full mt-3 text-sm font-bold rounded py-2" style={{ backgroundColor: "#CC0001", color: "#FAF7F2" }}>
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </div>
    </div>
  );
}

function OwnerRoute() {
  const [session, setSession] = useState(undefined);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);
  if (session === undefined) return <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "#141110" }}><Loader2 className="animate-spin" color="#CC0001" size={28} /></div>;
  if (!session) return <OwnerLogin onSignedIn={() => {}} />;
  return <OwnerDashboard session={session} />;
}

/* ---------------------------------------------------------
   Consignor page — public, read-only
--------------------------------------------------------- */
function ConsignorPage() {
  const { username } = useParams();
  const [consignor, setConsignor] = useState(undefined);
  const [cards, setCards] = useState([]);
  const [fxRate, setFxRate] = useState(1.29);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    (async () => {
      const { data: c } = await supabase.from("consignors").select("*").eq("telegram_username", username).maybeSingle();
      setConsignor(c || null);
      if (c) {
        const { data: cardsData } = await supabase.from("cards").select("*").eq("consignor_id", c.id).order("created_at", { ascending: false });
        setCards(cardsData || []);
      }
      const { data: fxRow } = await supabase.from("app_settings").select("*").eq("key", "fx_rate").single();
      if (fxRow) setFxRate(fxRow.value.rate);
    })();
  }, [username]);

  if (consignor === undefined) return <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "#141110" }}><Loader2 className="animate-spin" color="#CC0001" size={28} /></div>;
  if (consignor === null) return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: "#141110" }}>
      <p style={{ color: "#FAF7F2" }}>No consignor found for "@{username}".</p>
    </div>
  );

  const filtered = filter === "all" ? cards : filter === "active" ? cards.filter((c) => c.status === "listed" || c.status === "offer") : cards.filter((c) => c.status === "sold" || c.status === "paid");

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#141110" }}>
      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="text-[11px] tracking-[0.25em] opacity-50 mb-1" style={{ color: "#FAF7F2" }}>SPORTS COLLECTIBLES SG</div>
        <h1 className="text-3xl font-extrabold mb-1" style={{ color: "#CC0001", fontFamily: "'Roboto Slab', serif" }}>{consignor.name}'s cards</h1>
        <p className="text-xs opacity-50 mb-5" style={{ color: "#FAF7F2" }}>Telegram @{consignor.telegram_username}</p>

        <div className="grid grid-cols-2 gap-3 mb-6">
          <div className="rounded-lg p-3 text-center" style={{ backgroundColor: "#1F1A18" }}>
            <div className="text-[10px] tracking-widest opacity-50 mb-1" style={{ color: "#FAF7F2" }}>TOTAL CARDS</div>
            <div className="text-lg font-bold" style={{ color: "#FAF7F2", fontFamily: "'Roboto Slab', serif" }}>{cards.length}</div>
          </div>
          <div className="rounded-lg p-3 text-center" style={{ backgroundColor: "#1F1A18" }}>
            <div className="text-[10px] tracking-widest opacity-50 mb-1" style={{ color: "#FAF7F2" }}>SOLD/UNSOLD</div>
            <div className="text-lg font-bold" style={{ color: "#FAF7F2", fontFamily: "'Roboto Slab', serif" }}>
              {cards.filter((c) => c.status === "sold" || c.status === "paid").length}/{cards.filter((c) => c.status === "listed" || c.status === "offer").length}
            </div>
          </div>
        </div>

        <div className="flex gap-2 flex-wrap mb-4">
          {FILTER_TABS.map((f) => (
            <button key={f.key} onClick={() => setFilter(f.key)} className="text-xs font-semibold rounded-full px-3 py-1.5"
              style={{ backgroundColor: filter === f.key ? "#CC0001" : "transparent", color: "#FAF7F2", border: filter === f.key ? "none" : "1px solid rgba(250,247,242,0.25)" }}>
              {f.label}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-lg p-10 text-center text-sm opacity-50" style={{ backgroundColor: "#1F1A18", color: "#FAF7F2" }}>Nothing here yet.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {filtered.map((card) => <CardSlab key={card.id} card={card} fxRate={fxRate} editable={false} />)}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   Landing
--------------------------------------------------------- */
function Landing() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: "#141110" }}>
      <div className="max-w-xs w-full text-center">
        <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 mb-5" style={{ border: "1px solid rgba(204,0,1,0.4)" }}>
          <Shield size={13} color="#CC0001" />
          <span className="text-[10px] tracking-widest" style={{ color: "#CC0001" }}>CONSIGNMENTS</span>
        </div>
        <h1 className="text-2xl font-extrabold mb-3" style={{ color: "#FAF7F2", fontFamily: "'Roboto Slab', serif" }}>Sports Collectibles SG</h1>
        <p className="text-sm opacity-60 mb-6" style={{ color: "#FAF7F2" }}>Consignors: use your personal link. Owner:</p>
        <Link to="/owner" className="inline-flex items-center gap-1 text-sm font-bold rounded px-4 py-2" style={{ backgroundColor: "#CC0001", color: "#FAF7F2" }}>
          Owner sign in <ChevronRight size={16} />
        </Link>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/owner" element={<OwnerRoute />} />
      <Route path="/:username" element={<ConsignorPage />} />
    </Routes>
  );
}
