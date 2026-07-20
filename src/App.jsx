import React, { useState, useEffect, useMemo } from "react";
import { Routes, Route, useParams, useNavigate, Link } from "react-router-dom";
import {
  Plus, Copy, Check, X, RotateCcw, ExternalLink, Shield, Loader2,
  Lock, KeyRound, ImagePlus, Trash2, ChevronRight, AlertTriangle, Package, MapPin,
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
    return new Date(d).toLocaleDateString("en-SG", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Singapore" });
  } catch {
    return d;
  }
}
function fmtDDMMYYYY(d) {
  if (!d) return "—";
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(d));
    const get = (type) => parts.find((p) => p.type === type)?.value;
    return `${get("day")}/${get("month")}/${get("year")}`;
  } catch {
    return d;
  }
}
function fmtDateTime(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString("en-SG", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Singapore" });
  } catch {
    return d;
  }
}
// Listing times are always meant as Singapore time, regardless of which
// device someone happens to be typing on or viewing from — Singapore has a
// fixed UTC+8 offset (no daylight saving), so these convert explicitly
// instead of relying on the browser's own system timezone.
function isoToSGTInputValue(iso) {
  if (!iso) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Singapore",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(new Date(iso));
    const get = (type) => parts.find((p) => p.type === type)?.value;
    return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
  } catch {
    return "";
  }
}
function sgtInputValueToISO(value) {
  if (!value) return null;
  try {
    return new Date(`${value}:00+08:00`).toISOString();
  } catch {
    return null;
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
// If a listing's countdown has run out but the status was never moved to
// Buyer Paid, keep restarting the countdown from the last cycle's end date
// instead of just sitting on "Ended" forever. Returns the current cycle's
// { start, end } as Date objects.
function currentCountdownCycle(startDateStr, days, now) {
  if (!startDateStr) return null;
  const start = new Date(startDateStr);
  if (isNaN(start.getTime())) return null;
  const intervalMs = days * 24 * 60 * 60 * 1000;
  const nowMs = now.getTime();
  const startMs = start.getTime();

  if (startMs + intervalMs > nowMs) {
    return { start, end: new Date(startMs + intervalMs) };
  }
  const cyclesElapsed = Math.floor((nowMs - startMs) / intervalMs);
  let cycleStartMs = startMs + cyclesElapsed * intervalMs;
  if (cycleStartMs + intervalMs <= nowMs) cycleStartMs += intervalMs;
  return { start: new Date(cycleStartMs), end: new Date(cycleStartMs + intervalMs) };
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

// Combine standalone cards + grouped orders into one sorted, filterable list.
function buildListingList(cards, orders) {
  const standalone = cards.filter((c) => !c.order_id);
  const grouped = orders
    .map((o) => ({ order: o, items: cards.filter((c) => c.order_id === o.id) }))
    .filter((g) => g.items.length > 0);

  const combined = [
    ...standalone.map((c) => ({ type: "single", key: c.id, createdAt: c.created_at, status: c.status, card: c })),
    ...grouped.map((g) => ({ type: "group", key: g.order.id, createdAt: g.order.created_at, status: g.order.status, order: g.order, items: g.items })),
  ];
  combined.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return combined;
}

// Sum Total Earnings (SGD) across listings matching any of the given statuses.
// Each grouped order counts once (using its shared earnings), not once per item.
function sumTotalEarnings(listings, statuses, fxRate) {
  return listings
    .filter((x) => statuses.includes(x.status))
    .reduce((sum, x) => {
      const record = x.type === "single" ? x.card : x.order;
      const val = computeTotalEarningsSGD(record, fxRate);
      return sum + (val || 0);
    }, 0);
}



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
const RECEIPT_FIELD = { order_total: "receipt_order_total_url", order_earnings: "receipt_order_earnings_url" };
const RECEIPT_LABEL = { order_total: "Order Total", order_earnings: "Order Earnings" };

// Live parcel tracking, shown inline on any card/order that has a tracking
// number entered. Works the same for owners and consignors since it's
// embedded directly in CardSlab/OrderSlab rather than a separate section.
const TRACKING_MILESTONES = [
  { key: "info_received", label: "Info Received" },
  { key: "in_transit", label: "In Transit" },
  { key: "out_for_delivery", label: "Out for Delivery" },
  { key: "delivered", label: "Delivered" },
];

// Ship24 allows a maximum of 10 requests/second per endpoint. A dashboard
// page can easily mount many TrackingTimeline instances at once (every
// Buyer Paid card fires its own request on mount), which can burst past
// that limit even though nowhere near any monthly quota. This queue
// serializes all tracking calls site-wide with a small gap between each,
// so they're spread out instead of firing in a single burst.
let trackingQueueTail = Promise.resolve();
function queueTrackingRequest(fn) {
  const result = trackingQueueTail.then(fn);
  trackingQueueTail = result.catch(() => {}).then(() => new Promise((resolve) => setTimeout(resolve, 150)));
  return result;
}

function TrackingTimeline({ trackingNumber, courier, manualDeliveredAt }) {
  const [state, setState] = useState(null); // null | { loading } | { error } | { data }

  useEffect(() => {
    if (manualDeliveredAt) return; // manual override takes priority — skip the live check entirely
    if (!trackingNumber) return;
    let cancelled = false;
    setState({ loading: true });
    queueTrackingRequest(() => supabase.functions.invoke("track-package", { body: { trackingNumber, courier } }))
      .then(async ({ data, error }) => {
        if (cancelled) return;
        if (!error) {
          setState({ data });
          return;
        }
        // supabase-js's default error.message is a generic "non-2xx status
        // code" string — the actual reason (quota exceeded, bad tracking
        // number, etc.) is in the response body, so unwrap that instead.
        let message = error.message || "Tracking unavailable";
        try {
          if (error.context && typeof error.context.json === "function") {
            const body = await error.context.json();
            if (body?.error) message = body.error;
          }
        } catch {
          // fall back to the generic message above
        }
        setState({ error: message });
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackingNumber, courier, manualDeliveredAt]);

  if (!trackingNumber && !manualDeliveredAt) return null;

  const deliveredStepper = (
    <div className="flex items-center">
      {TRACKING_MILESTONES.map((m, i) => {
        const isLast = i === TRACKING_MILESTONES.length - 1;
        return (
          <React.Fragment key={m.key}>
            <div className="flex flex-col items-center" style={{ minWidth: 0, flexShrink: 0 }}>
              <div className="rounded-full flex items-center justify-center flex-shrink-0" style={{ width: 20, height: 20, backgroundColor: "#CC0001" }}>
                <Check size={11} color="#FAF7F2" strokeWidth={3} />
              </div>
              <span className="text-[9px] mt-1 text-center leading-tight" style={{ color: "#141110", fontWeight: 700, maxWidth: 56 }}>{m.label}</span>
            </div>
            {!isLast && <div className="flex-1" style={{ height: 2, backgroundColor: "#CC0001", marginBottom: 14 }} />}
          </React.Fragment>
        );
      })}
    </div>
  );

  if (manualDeliveredAt) {
    return (
      <div className="rounded-lg p-3 mt-3" style={{ backgroundColor: "#FAF7F2", border: "1px solid #E3DFD6" }}>
        {deliveredStepper}
        <div className="text-[11px] font-bold mt-2 pt-2" style={{ color: "#141110", borderTop: "1px solid #E3DFD6" }}>
          Package delivered on {fmtDDMMYYYY(manualDeliveredAt)}
        </div>
        {trackingNumber && (
          <div className="text-[10px] mt-1 opacity-50" style={{ color: "#4A4636", fontFamily: "'JetBrains Mono', monospace" }}>
            {courier ? `${courier} · ` : ""}{trackingNumber}
          </div>
        )}
      </div>
    );
  }

  if (!state || state.loading) {
    return <div className="text-[11px] opacity-50 mt-3" style={{ color: "#4A4636" }}>Checking tracking…</div>;
  }
  if (state.error) {
    return <div className="text-[11px] mt-3" style={{ color: "#CC0001" }}>{state.error}</div>;
  }

  const { status, statusText, lastEvent, lastUpdate, origin, destination } = state.data;
  const isException = status === "exception" || status === "failed_attempt";

  if (isException) {
    return (
      <div className="rounded-lg p-3 mt-3 flex items-start gap-2" style={{ backgroundColor: "#FCEBEA", border: "1px solid #CC0001" }}>
        <AlertTriangle size={16} color="#CC0001" className="flex-shrink-0 mt-0.5" />
        <div>
          <div className="text-xs font-bold" style={{ color: "#CC0001" }}>{statusText}</div>
          {lastEvent && <div className="text-[11px] mt-0.5" style={{ color: "#4A4636" }}>{lastEvent}</div>}
        </div>
      </div>
    );
  }

  const isDelivered = status === "delivered";
  const stepIndex = TRACKING_MILESTONES.findIndex((m) => m.key === status);
  // available_for_pickup isn't on the main track — treat it as roughly on par with out-for-delivery.
  const activeIndex = stepIndex >= 0 ? stepIndex : status === "available_for_pickup" ? 2 : -1;

  return (
    <div className="rounded-lg p-3 mt-3" style={{ backgroundColor: "#FAF7F2", border: "1px solid #E3DFD6" }}>
      {(origin || destination) && (
        <div className="flex items-center justify-between text-[10px] mb-3" style={{ color: "#4A4636" }}>
          <div className="flex items-center gap-1"><MapPin size={10} /><span className="opacity-60">Origin</span> <span className="font-semibold">{origin || "—"}</span></div>
          <div className="flex-1 mx-2 border-t border-dashed" style={{ borderColor: "#E3DFD6" }} />
          <div className="flex items-center gap-1"><span className="font-semibold">{destination || "—"}</span> <span className="opacity-60">Destination</span><Package size={10} /></div>
        </div>
      )}
      {isDelivered ? deliveredStepper : (
        <div className="flex items-center">
          {TRACKING_MILESTONES.map((m, i) => {
            const reached = i <= activeIndex;
            const isLast = i === TRACKING_MILESTONES.length - 1;
            return (
              <React.Fragment key={m.key}>
                <div className="flex flex-col items-center" style={{ minWidth: 0, flexShrink: 0 }}>
                  <div className="rounded-full flex items-center justify-center flex-shrink-0" style={{ width: 20, height: 20, backgroundColor: reached ? "#CC0001" : "#E3DFD6" }}>
                    {reached && <Check size={11} color="#FAF7F2" strokeWidth={3} />}
                  </div>
                  <span className="text-[9px] mt-1 text-center leading-tight" style={{ color: reached ? "#141110" : "#726C63", fontWeight: reached ? 700 : 400, maxWidth: 56 }}>{m.label}</span>
                </div>
                {!isLast && <div className="flex-1" style={{ height: 2, backgroundColor: i < activeIndex ? "#CC0001" : "#E3DFD6", marginBottom: 14 }} />}
              </React.Fragment>
            );
          })}
        </div>
      )}
      {isDelivered ? (
        <div className="text-[11px] font-bold mt-2 pt-2" style={{ color: "#141110", borderTop: "1px solid #E3DFD6" }}>
          Package delivered on {fmtDDMMYYYY(lastUpdate)}
        </div>
      ) : (
        lastEvent && <div className="text-[10px] mt-2 pt-2 opacity-60 truncate" style={{ color: "#4A4636", borderTop: "1px solid #E3DFD6" }}>{lastEvent}</div>
      )}
      <div className="text-[10px] mt-1 opacity-50" style={{ color: "#4A4636", fontFamily: "'JetBrains Mono', monospace" }}>
        {courier ? `${courier} · ` : ""}{trackingNumber}
      </div>
    </div>
  );
}

function CardSlab({ card, fxRate, onEdit, editable, onRefresh }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(t);
  }, []);

  const [receiptModalKey, setReceiptModalKey] = useState(null); // 'order_total' | 'order_earnings' | 'total_earnings' | null
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const [receiptError, setReceiptError] = useState("");

  const hasRealEnd = !!card.end_date;
  const cycleDays = card.status === "listed" ? 7 : card.status === "offer" ? 30 : null;
  const cycle = !hasRealEnd && card.start_date && cycleDays ? currentCountdownCycle(card.start_date, cycleDays, now) : null;
  const startDisplay = cycle ? fmtDateTime(cycle.start.toISOString()) : fmtDateTime(card.start_date);
  const endDisplay = hasRealEnd ? fmtDateTime(card.end_date) : cycle ? fmtDateTime(cycle.end.toISOString()) : "—";
  const countdown = hasRealEnd ? { text: "Ended", ended: true } : cycle ? formatCountdownLong(cycle.end, now) : { text: "—", ended: false };
  const mechanism = card.sale_mechanism || card.status;
  const startLabel = mechanism === "listed" ? "Start Bid" : mechanism === "offer" ? "Listed Price" : "Start Value";
  const endLabel = mechanism === "listed" ? "End Bid" : mechanism === "offer" ? "Offer Accepted" : "End Value";

  const handleReceiptUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !receiptModalKey || receiptModalKey === "total_earnings") return;
    setUploadingReceipt(true);
    setReceiptError("");
    try {
      const url = await uploadImage(file, `receipts/${card.id}`);
      const field = RECEIPT_FIELD[receiptModalKey];
      const { error } = await supabase.from("cards").update({ [field]: url }).eq("id", card.id);
      if (error) throw error;
      if (onRefresh) onRefresh();
    } catch (err) {
      setReceiptError(err.message || "Upload failed.");
    } finally {
      setUploadingReceipt(false);
    }
  };

  const handleReceiptRemove = async () => {
    if (!receiptModalKey || receiptModalKey === "total_earnings") return;
    setUploadingReceipt(true);
    setReceiptError("");
    try {
      const field = RECEIPT_FIELD[receiptModalKey];
      const { error } = await supabase.from("cards").update({ [field]: null }).eq("id", card.id);
      if (error) throw error;
      if (onRefresh) onRefresh();
    } catch (err) {
      setReceiptError(err.message || "Remove failed.");
    } finally {
      setUploadingReceipt(false);
    }
  };

  const Box = ({ boxKey, label, value }) => (
    <button
      onClick={() => setReceiptModalKey(boxKey)}
      className="rounded p-2 text-center"
      style={{ backgroundColor: "#141110" }}
    >
      <div className="text-[8px] tracking-wide opacity-60 leading-tight flex items-center justify-center gap-1" style={{ color: "#FAF7F2" }}>
        {label} <ImagePlus size={8} />
      </div>
      <div className="text-xs font-bold" style={{ color: "#3FA34D", fontFamily: "'Roboto Slab', serif" }}>{value}</div>
    </button>
  );

  const currentReceiptUrl = receiptModalKey && receiptModalKey !== "total_earnings" ? card[RECEIPT_FIELD[receiptModalKey]] : null;

  return (
    <div className="relative rounded-lg overflow-hidden" style={{ backgroundColor: "#FAF7F2", border: "1px solid #E3DFD6", boxShadow: "0 8px 24px -8px rgba(0,0,0,0.5)" }}>
      <div className="p-4">
        <div className="relative">
          <div className="overflow-x-auto card-scroll -mx-4 px-4" style={{ WebkitOverflowScrolling: "touch" }}>
            <div className="flex items-center gap-4" style={{ width: "max-content" }}>
              {card.photo_url && (
                <img src={card.photo_url} alt={card.description} className="flex-shrink-0 rounded" style={{ width: 72, height: 100, objectFit: "cover", border: "1px solid #E3DFD6" }} />
            )}

            <div className="flex-shrink-0" style={{ width: 256 }}>
              <h3 className="text-[14px] leading-snug font-semibold mb-1.5" style={{ color: "#141110", fontFamily: "'Space Grotesk', sans-serif" }}>{card.description}</h3>
              <div className="flex items-center gap-2 flex-wrap">
                <Stamp status={card.status} />
                {card.link && (
                  <a href={card.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] font-medium hover:underline" style={{ color: "#141110" }}>
                    View listing <ExternalLink size={11} />
                  </a>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] flex-shrink-0" style={{ fontFamily: "'JetBrains Mono', monospace", color: "#4A4636" }}>
              <div className="flex justify-between gap-3"><span className="opacity-60">Start</span><span>{startDisplay}</span></div>
              <div className="flex justify-between gap-3"><span className="opacity-60">{startLabel}</span><span>{fmtUSD(card.start_value)}</span></div>
              <div className="flex justify-between gap-3"><span className="opacity-60">End</span><span>{endDisplay}</span></div>
              <div className="flex justify-between gap-3"><span className="opacity-60">{endLabel}</span><span>{card.end_value != null ? fmtUSD(card.end_value) : "In Progress"}</span></div>
              <div className="flex justify-between gap-3"><span className="opacity-60">Countdown</span><span style={countdown.ended && !hasRealEnd ? { color: "#CC0001" } : undefined}>{countdown.text}</span></div>
              <div className="flex justify-between gap-3"><span className="opacity-60">Shipping</span><span>{hasValue(card.shipping) ? fmtUSD(card.shipping) : "—"}</span></div>
            </div>

            <div className="grid grid-cols-3 gap-1.5 flex-shrink-0" style={{ width: 220 }}>
              <Box boxKey="order_total" label="ORDER TOTAL" value={hasValue(card.order_total) ? fmtUSD(card.order_total) : "—"} />
              <Box boxKey="order_earnings" label="ORDER EARNINGS" value={hasValue(card.order_earnings) ? fmtUSD(card.order_earnings) : "—"} />
              <Box boxKey="total_earnings" label="TOTAL EARNINGS (SGD)" value={fmtSGD(computeTotalEarningsSGD(card, fxRate))} />
            </div>
            <div aria-hidden className="flex-shrink-0 sm:hidden" style={{ width: 28 }} />
            </div>
          </div>

          <div
            className="pointer-events-none absolute top-0 bottom-0 right-0 flex items-center justify-end sm:hidden"
            style={{ width: 36, background: "linear-gradient(to right, transparent, #FAF7F2 65%)" }}
          >
            <ChevronRight size={16} color="#726C63" />
          </div>
        </div>

        <TrackingTimeline trackingNumber={card.tracking_number} courier={card.courier} manualDeliveredAt={card.manual_delivered_at} />

        <div className="flex items-center justify-end gap-3 mt-3">
          <div className="text-[10px] opacity-50 whitespace-nowrap" style={{ color: "#4A4636", fontFamily: "'Space Grotesk', sans-serif" }}>Updated {timeAgo(card.updated_at)}</div>
          {editable && (
            <button onClick={() => onEdit(card)} className="text-[12px] font-semibold rounded px-3 py-1.5 whitespace-nowrap" style={{ border: "1px solid #141110", color: "#141110" }}>
              Edit card
            </button>
          )}
        </div>
      </div>

      {receiptModalKey && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
          style={{ backgroundColor: "rgba(20,17,16,0.85)" }}
          onClick={() => setReceiptModalKey(null)}
        >
          <div
            className="max-w-sm w-full rounded-lg p-5"
            style={{ backgroundColor: "#FAF7F2" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2" style={{ color: "#141110", fontFamily: "'Roboto Slab', serif" }}>
                <ImagePlus size={16} />
                <span className="font-bold text-sm">
                  {receiptModalKey === "total_earnings" ? "Total Earnings breakdown" : `${RECEIPT_LABEL[receiptModalKey]} receipt`}
                </span>
              </div>
              <button onClick={() => setReceiptModalKey(null)}><X size={18} color="#141110" /></button>
            </div>

            {receiptModalKey === "total_earnings" ? (
              <div className="text-xs" style={{ color: "#141110" }}>
                <div className="flex justify-between py-1"><span className="opacity-60">Order Earnings</span><span>{hasValue(card.order_earnings) ? fmtUSD(card.order_earnings) : "—"}</span></div>
                <div className="flex justify-between py-1" style={{ borderBottom: "1px solid #E3DFD6" }}><span className="opacity-60">Shipping</span><span>{hasValue(card.shipping) ? `−${fmtUSD(card.shipping)}` : "—"}</span></div>
                <div className="flex justify-between py-1.5 font-bold" style={{ borderBottom: "1px solid #E3DFD6" }}>
                  <span>Total Earnings (USD)</span>
                  <span>{hasValue(card.order_earnings) && hasValue(card.shipping) ? fmtUSD(Number(card.order_earnings) - Number(card.shipping)) : "—"}</span>
                </div>
                <div className="flex justify-between py-1" style={{ borderBottom: "1px solid #E3DFD6" }}><span className="opacity-60">Current Rate</span><span>{fxRate}</span></div>
                <div className="flex justify-between py-1.5 font-bold">
                  <span>Total Earnings (SGD)</span>
                  <span style={{ color: "#3FA34D" }}>{fmtSGD(computeTotalEarningsSGD(card, fxRate))}</span>
                </div>
                {(!hasValue(card.order_earnings) || !hasValue(card.shipping)) && (
                  <p className="mt-2 opacity-50">Fill in Order Earnings and Shipping to calculate this.</p>
                )}
              </div>
            ) : (
              <>
                {currentReceiptUrl ? (
                  <img src={currentReceiptUrl} alt={`${RECEIPT_LABEL[receiptModalKey]} receipt`} className="w-full rounded border" style={{ borderColor: "#E3DFD6" }} />
                ) : (
                  <div className="rounded border-2 border-dashed flex flex-col items-center justify-center py-10 gap-2" style={{ borderColor: "#E3DFD6" }}>
                    <ImagePlus size={28} color="#726C63" />
                    <p className="text-xs text-center px-6" style={{ color: "#726C63" }}>
                      {editable ? "No receipt uploaded yet." : "No receipt has been uploaded yet for this."}
                    </p>
                  </div>
                )}
                {editable && (
                  <div className="flex gap-2 mt-3">
                    <label className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold rounded py-2 cursor-pointer" style={{ border: "1px solid #141110", color: "#141110" }}>
                      {uploadingReceipt ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} />}
                      {uploadingReceipt ? "Uploading…" : currentReceiptUrl ? "Replace receipt" : "Upload receipt"}
                      <input type="file" accept="image/*" className="hidden" onChange={handleReceiptUpload} disabled={uploadingReceipt} />
                    </label>
                    {currentReceiptUrl && (
                      <button onClick={handleReceiptRemove} disabled={uploadingReceipt} className="text-xs font-semibold rounded px-3" style={{ border: "1px solid #CC0001", color: "#CC0001" }}>
                        Remove
                      </button>
                    )}
                  </div>
                )}
                {receiptError && <p className="text-[11px] mt-2" style={{ color: "#CC0001" }}>{receiptError}</p>}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------
   Order Slab — a group of cards bought together in one order,
   sharing one Order Total / Order Earnings / Shipping / status.
--------------------------------------------------------- */
function OrderItemRow({ item, order, now, fxRate, editable, onEditItem, Box }) {
  const hasRealEnd = !!item.end_date;
  const cycleDays = item.status === "listed" ? 7 : item.status === "offer" ? 30 : null;
  const cycle = !hasRealEnd && item.start_date && cycleDays ? currentCountdownCycle(item.start_date, cycleDays, now) : null;
  const startDisplay = cycle ? fmtDateTime(cycle.start.toISOString()) : fmtDateTime(item.start_date);
  const endDisplay = hasRealEnd ? fmtDateTime(item.end_date) : cycle ? fmtDateTime(cycle.end.toISOString()) : "—";
  const countdown = hasRealEnd ? { text: "Ended", ended: true } : cycle ? formatCountdownLong(cycle.end, now) : { text: "—", ended: false };
  const mechanism = item.sale_mechanism || item.status;
  const startLabel = mechanism === "listed" ? "Start Bid" : mechanism === "offer" ? "Listed Price" : "Start Value";
  const endLabel = mechanism === "listed" ? "End Bid" : mechanism === "offer" ? "Offer Accepted" : "End Value";

  return (
    <div className="flex items-center gap-4" style={{ width: "max-content" }}>
      {item.photo_url && (
        <img src={item.photo_url} alt={item.description} className="flex-shrink-0 rounded" style={{ width: 72, height: 100, objectFit: "cover", border: "1px solid #E3DFD6" }} />
      )}

      <div className="flex-shrink-0" style={{ width: 256 }}>
        <h3 className="text-[14px] leading-snug font-semibold mb-1.5" style={{ color: "#141110", fontFamily: "'Space Grotesk', sans-serif" }}>{item.description}</h3>
        <div className="flex items-center gap-2 flex-wrap">
          <Stamp status={order.status} />
          {item.link && (
            <a href={item.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] font-medium hover:underline" style={{ color: "#141110" }}>
              View listing <ExternalLink size={11} />
            </a>
          )}
          {editable && (
            <button onClick={() => onEditItem(item)} className="text-[11px] font-medium hover:underline" style={{ color: "#726C63" }}>
              Edit
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] flex-shrink-0" style={{ fontFamily: "'JetBrains Mono', monospace", color: "#4A4636" }}>
        <div className="flex justify-between gap-3"><span className="opacity-60">Start</span><span>{startDisplay}</span></div>
        <div className="flex justify-between gap-3"><span className="opacity-60">{startLabel}</span><span>{fmtUSD(item.start_value)}</span></div>
        <div className="flex justify-between gap-3"><span className="opacity-60">End</span><span>{endDisplay}</span></div>
        <div className="flex justify-between gap-3"><span className="opacity-60">{endLabel}</span><span>{item.end_value != null ? fmtUSD(item.end_value) : "In Progress"}</span></div>
        <div className="flex justify-between gap-3"><span className="opacity-60">Countdown</span><span style={countdown.ended && !hasRealEnd ? { color: "#CC0001" } : undefined}>{countdown.text}</span></div>
        <div className="flex justify-between gap-3"><span className="opacity-60">Shipping</span><span>{hasValue(order.shipping) ? fmtUSD(order.shipping) : "—"}</span></div>
      </div>

      {Box ? (
        <div className="grid grid-cols-3 gap-1.5 flex-shrink-0" style={{ width: 220 }}>
          <Box boxKey="order_total" label="ORDER TOTAL" value={hasValue(order.order_total) ? fmtUSD(order.order_total) : "—"} />
          <Box boxKey="order_earnings" label="ORDER EARNINGS" value={hasValue(order.order_earnings) ? fmtUSD(order.order_earnings) : "—"} />
          <Box boxKey="total_earnings" label="TOTAL EARNINGS (SGD)" value={fmtSGD(computeTotalEarningsSGD(order, fxRate))} />
        </div>
      ) : (
        <div aria-hidden className="flex-shrink-0" style={{ width: 220 }} />
      )}
    </div>
  );
}

function OrderSlab({ order, items, fxRate, onEditOrder, onEditItem, onAddItem, editable, onRefresh }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(t);
  }, []);

  const [receiptModalKey, setReceiptModalKey] = useState(null); // 'order_total' | 'order_earnings' | 'total_earnings' | null
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const [receiptError, setReceiptError] = useState("");

  const handleReceiptUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !receiptModalKey || receiptModalKey === "total_earnings") return;
    setUploadingReceipt(true);
    setReceiptError("");
    try {
      const url = await uploadImage(file, `receipts/${order.id}`);
      const field = RECEIPT_FIELD[receiptModalKey];
      const { error } = await supabase.from("orders").update({ [field]: url }).eq("id", order.id);
      if (error) throw error;
      if (onRefresh) onRefresh();
    } catch (err) {
      setReceiptError(err.message || "Upload failed.");
    } finally {
      setUploadingReceipt(false);
    }
  };

  const handleReceiptRemove = async () => {
    if (!receiptModalKey || receiptModalKey === "total_earnings") return;
    setUploadingReceipt(true);
    setReceiptError("");
    try {
      const field = RECEIPT_FIELD[receiptModalKey];
      const { error } = await supabase.from("orders").update({ [field]: null }).eq("id", order.id);
      if (error) throw error;
      if (onRefresh) onRefresh();
    } catch (err) {
      setReceiptError(err.message || "Remove failed.");
    } finally {
      setUploadingReceipt(false);
    }
  };

  const Box = ({ boxKey, label, value }) => (
    <button
      onClick={() => setReceiptModalKey(boxKey)}
      className="rounded p-2 text-center"
      style={{ backgroundColor: "#141110" }}
    >
      <div className="text-[8px] tracking-wide opacity-60 leading-tight flex items-center justify-center gap-1" style={{ color: "#FAF7F2" }}>
        {label} <ImagePlus size={8} />
      </div>
      <div className="text-xs font-bold" style={{ color: "#3FA34D", fontFamily: "'Roboto Slab', serif" }}>{value}</div>
    </button>
  );

  const currentReceiptUrl = receiptModalKey && receiptModalKey !== "total_earnings" ? order[RECEIPT_FIELD[receiptModalKey]] : null;

  return (
    <div className="relative rounded-lg overflow-hidden" style={{ backgroundColor: "#FAF7F2", border: "1px solid #E3DFD6", boxShadow: "0 8px 24px -8px rgba(0,0,0,0.5)" }}>
      <div className="p-4">
        <div className="mb-2">
          <span className="text-[10px] tracking-widest opacity-50 font-semibold" style={{ color: "#141110", fontFamily: "'Space Grotesk', sans-serif" }}>
            {items.length} CARDS · ONE ORDER
          </span>
        </div>

        <div className="relative">
          <div className="overflow-x-auto card-scroll -mx-4 px-4" style={{ WebkitOverflowScrolling: "touch" }}>
            <div className="flex flex-col gap-3 pr-7 sm:pr-0" style={{ width: "max-content" }}>
              {items.map((item, idx) => (
                <OrderItemRow
                  key={item.id}
                  item={item}
                  order={order}
                  now={now}
                  fxRate={fxRate}
                  editable={editable}
                  onEditItem={onEditItem}
                  Box={idx === 0 ? Box : null}
                />
              ))}
            </div>
          </div>

          <div
            className="pointer-events-none absolute top-0 bottom-0 right-0 flex items-center justify-end sm:hidden"
            style={{ width: 36, background: "linear-gradient(to right, transparent, #FAF7F2 65%)" }}
          >
            <ChevronRight size={16} color="#726C63" />
          </div>
        </div>

        <TrackingTimeline trackingNumber={order.tracking_number} courier={order.courier} manualDeliveredAt={order.manual_delivered_at} />

        <div className="flex items-center justify-end gap-3 mt-3 flex-wrap">
          {editable && (
            <>
              <button onClick={() => onAddItem(order)} className="text-[12px] font-semibold hover:underline whitespace-nowrap" style={{ color: "#141110" }}>
                + Add card
              </button>
              <div className="text-[10px] opacity-50 whitespace-nowrap" style={{ color: "#4A4636", fontFamily: "'Space Grotesk', sans-serif" }}>Updated {timeAgo(order.updated_at)}</div>
              <button onClick={() => onEditOrder(order)} className="text-[12px] font-semibold rounded px-3 py-1.5 whitespace-nowrap" style={{ border: "1px solid #141110", color: "#141110" }}>
                Edit order
              </button>
            </>
          )}
        </div>
      </div>

      {receiptModalKey && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
          style={{ backgroundColor: "rgba(20,17,16,0.85)" }}
          onClick={() => setReceiptModalKey(null)}
        >
          <div
            className="max-w-sm w-full rounded-lg p-5"
            style={{ backgroundColor: "#FAF7F2" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2" style={{ color: "#141110", fontFamily: "'Roboto Slab', serif" }}>
                <ImagePlus size={16} />
                <span className="font-bold text-sm">
                  {receiptModalKey === "total_earnings" ? "Total Earnings breakdown" : `${RECEIPT_LABEL[receiptModalKey]} receipt`}
                </span>
              </div>
              <button onClick={() => setReceiptModalKey(null)}><X size={18} color="#141110" /></button>
            </div>

            {receiptModalKey === "total_earnings" ? (
              <div className="text-xs" style={{ color: "#141110" }}>
                <div className="flex justify-between py-1"><span className="opacity-60">Order Earnings</span><span>{hasValue(order.order_earnings) ? fmtUSD(order.order_earnings) : "—"}</span></div>
                <div className="flex justify-between py-1" style={{ borderBottom: "1px solid #E3DFD6" }}><span className="opacity-60">Shipping</span><span>{hasValue(order.shipping) ? `−${fmtUSD(order.shipping)}` : "—"}</span></div>
                <div className="flex justify-between py-1.5 font-bold" style={{ borderBottom: "1px solid #E3DFD6" }}>
                  <span>Total Earnings (USD)</span>
                  <span>{hasValue(order.order_earnings) && hasValue(order.shipping) ? fmtUSD(Number(order.order_earnings) - Number(order.shipping)) : "—"}</span>
                </div>
                <div className="flex justify-between py-1" style={{ borderBottom: "1px solid #E3DFD6" }}><span className="opacity-60">Current Rate</span><span>{fxRate}</span></div>
                <div className="flex justify-between py-1.5 font-bold">
                  <span>Total Earnings (SGD)</span>
                  <span style={{ color: "#3FA34D" }}>{fmtSGD(computeTotalEarningsSGD(order, fxRate))}</span>
                </div>
                {(!hasValue(order.order_earnings) || !hasValue(order.shipping)) && (
                  <p className="mt-2 opacity-50">Fill in Order Earnings and Shipping to calculate this.</p>
                )}
              </div>
            ) : (
              <>
                {currentReceiptUrl ? (
                  <img src={currentReceiptUrl} alt={`${RECEIPT_LABEL[receiptModalKey]} receipt`} className="w-full rounded border" style={{ borderColor: "#E3DFD6" }} />
                ) : (
                  <div className="rounded border-2 border-dashed flex flex-col items-center justify-center py-10 gap-2" style={{ borderColor: "#E3DFD6" }}>
                    <ImagePlus size={28} color="#726C63" />
                    <p className="text-xs text-center px-6" style={{ color: "#726C63" }}>
                      {editable ? "No receipt uploaded yet." : "No receipt has been uploaded yet for this."}
                    </p>
                  </div>
                )}
                {editable && (
                  <div className="flex gap-2 mt-3">
                    <label className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold rounded py-2 cursor-pointer" style={{ border: "1px solid #141110", color: "#141110" }}>
                      {uploadingReceipt ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} />}
                      {uploadingReceipt ? "Uploading…" : currentReceiptUrl ? "Replace receipt" : "Upload receipt"}
                      <input type="file" accept="image/*" className="hidden" onChange={handleReceiptUpload} disabled={uploadingReceipt} />
                    </label>
                    {currentReceiptUrl && (
                      <button onClick={handleReceiptRemove} disabled={uploadingReceipt} className="text-xs font-semibold rounded px-3" style={{ border: "1px solid #CC0001", color: "#CC0001" }}>
                        Remove
                      </button>
                    )}
                  </div>
                )}
                {receiptError && <p className="text-[11px] mt-2" style={{ color: "#CC0001" }}>{receiptError}</p>}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------
   Card editor (owner only)
--------------------------------------------------------- */
function CardEditor({ initial, consignorId, forOrder, onSaved, onCancel, onDeleted }) {
  const blankItem = () => ({ link: "", description: "", photo_url: null, start_date: "", start_value: "", end_date: "", end_value: "" });

  const isGroupItemEdit = !!(initial && initial.order_id);
  const isQuickAdd = !initial && !!forOrder;
  const isTrimmed = isGroupItemEdit || isQuickAdd; // no status/financial fields shown

  const [items, setItems] = useState(
    initial ? [{ ...initial, start_date: isoToSGTInputValue(initial.start_date), end_date: isoToSGTInputValue(initial.end_date) }] : [blankItem()]
  );
  const [shared, setShared] = useState({
    status: initial?.status || "listed",
    sale_mechanism: initial?.sale_mechanism || null,
    order_total: initial?.order_total ?? "",
    order_earnings: initial?.order_earnings ?? "",
    shipping: initial?.shipping ?? "",
    courier: initial?.courier || "",
    tracking_number: initial?.tracking_number || "",
    manual_delivered_at: initial?.manual_delivered_at || "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [uploadingPhotoIdx, setUploadingPhotoIdx] = useState(null);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  const updateItem = (idx, key, value) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, [key]: value } : it)));
  };
  const addItem = () => setItems((prev) => [...prev, blankItem()]);
  const removeItem = (idx) => setItems((prev) => prev.filter((_, i) => i !== idx));

  const handleStatusChange = (e) => {
    const newStatus = e.target.value;
    setShared((prev) => ({
      ...prev,
      status: newStatus,
      sale_mechanism: newStatus === "listed" || newStatus === "offer" ? newStatus : prev.sale_mechanism,
    }));
  };

  const handlePhotoUpload = (idx) => async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadingPhotoIdx(idx);
    setError("");
    try {
      const url = await uploadImage(file, consignorId);
      updateItem(idx, "photo_url", url);
    } catch (err) {
      setError(err.message || "Photo upload failed.");
    } finally {
      setUploadingPhotoIdx(null);
    }
  };

  const itemPayload = (it) => ({
    link: it.link, description: it.description,
    start_date: sgtInputValueToISO(it.start_date), start_value: it.start_value === "" ? null : it.start_value,
    end_date: sgtInputValueToISO(it.end_date), end_value: it.end_value === "" ? null : it.end_value,
    photo_url: it.photo_url,
  });

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      if (isGroupItemEdit) {
        const { error: err } = await supabase.from("cards").update({ ...itemPayload(items[0]), updated_at: new Date().toISOString() }).eq("id", initial.id);
        if (err) throw err;
      } else if (isQuickAdd) {
        const { error: err } = await supabase.from("cards").insert({
          ...itemPayload(items[0]),
          consignor_id: consignorId,
          order_id: forOrder.id,
          status: forOrder.status,
          sale_mechanism: forOrder.sale_mechanism ?? null,
        });
        if (err) throw err;
      } else if (initial) {
        const { error: err } = await supabase.from("cards").update({
          ...itemPayload(items[0]),
          consignor_id: consignorId,
          status: shared.status,
          sale_mechanism: shared.sale_mechanism,
          order_total: shared.order_total === "" ? null : shared.order_total,
          order_earnings: shared.order_earnings === "" ? null : shared.order_earnings,
          shipping: shared.shipping === "" ? null : shared.shipping,
          courier: shared.courier || null,
          tracking_number: shared.tracking_number || null,
          manual_delivered_at: shared.manual_delivered_at || null,
          updated_at: new Date().toISOString(),
        }).eq("id", initial.id);
        if (err) throw err;
      } else if (items.length === 1) {
        const { error: err } = await supabase.from("cards").insert({
          ...itemPayload(items[0]),
          consignor_id: consignorId,
          status: shared.status,
          sale_mechanism: shared.sale_mechanism,
          order_total: shared.order_total === "" ? null : shared.order_total,
          order_earnings: shared.order_earnings === "" ? null : shared.order_earnings,
          shipping: shared.shipping === "" ? null : shared.shipping,
          courier: shared.courier || null,
          tracking_number: shared.tracking_number || null,
          manual_delivered_at: shared.manual_delivered_at || null,
        });
        if (err) throw err;
      } else {
        const { data: orderRow, error: orderErr } = await supabase.from("orders").insert({
          consignor_id: consignorId,
          status: shared.status,
          order_total: shared.order_total === "" ? null : shared.order_total,
          order_earnings: shared.order_earnings === "" ? null : shared.order_earnings,
          shipping: shared.shipping === "" ? null : shared.shipping,
          courier: shared.courier || null,
          tracking_number: shared.tracking_number || null,
          manual_delivered_at: shared.manual_delivered_at || null,
        }).select().single();
        if (orderErr) throw orderErr;

        const rows = items.map((it) => ({
          ...itemPayload(it),
          consignor_id: consignorId,
          order_id: orderRow.id,
          status: shared.status,
          sale_mechanism: shared.sale_mechanism,
        }));
        const { error: cardsErr } = await supabase.from("cards").insert(rows);
        if (cardsErr) throw cardsErr;
      }
      onSaved();
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!initial) return;
    setSaving(true);
    const orderIdToCheck = initial.order_id;
    const { error: err } = await supabase.from("cards").delete().eq("id", initial.id);
    if (err) { setSaving(false); setError(err.message); return; }
    if (orderIdToCheck) {
      const { data: remaining } = await supabase.from("cards").select("id").eq("order_id", orderIdToCheck);
      if (!remaining || remaining.length === 0) {
        await supabase.from("orders").delete().eq("id", orderIdToCheck);
      }
    }
    setSaving(false);
    onDeleted();
  };

  const title = isGroupItemEdit ? "Edit card" : isQuickAdd ? "Add card to order" : initial ? "Edit card" : "Add card";

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6" style={{ backgroundColor: "rgba(20,17,16,0.85)" }}>
      <div className="w-full sm:max-w-md rounded-t-xl sm:rounded-xl p-5 overflow-y-auto" style={{ backgroundColor: "#1F1A18", maxHeight: "90vh" }}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold" style={{ color: "#FAF7F2", fontFamily: "'Roboto Slab', serif" }}>{title}</h3>
          <button onClick={onCancel}><X size={20} color="#FAF7F2" /></button>
        </div>

        <div className="space-y-5">
          {items.map((it, idx) => (
            <div key={idx} className={items.length > 1 ? "space-y-3 pb-4" : "space-y-3"} style={items.length > 1 ? { borderBottom: "1px solid rgba(250,247,242,0.15)" } : undefined}>
              {items.length > 1 && (
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold tracking-wide opacity-60" style={{ color: "#FAF7F2" }}>CARD {idx + 1}</span>
                  <button onClick={() => removeItem(idx)} className="text-[11px] font-medium" style={{ color: "#CC0001" }}>Remove</button>
                </div>
              )}
              <Field label="eBay link" value={it.link} onChange={(e) => updateItem(idx, "link", e.target.value)} placeholder="https://www.ebay.com/itm/..." />
              <Field label="Card description" value={it.description} onChange={(e) => updateItem(idx, "description", e.target.value)} textarea />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Start date/time" value={it.start_date} onChange={(e) => updateItem(idx, "start_date", e.target.value)} type="datetime-local" />
                <Field label="Start value (USD)" value={it.start_value} onChange={(e) => updateItem(idx, "start_value", e.target.value)} type="number" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="End date/time" value={it.end_date} onChange={(e) => updateItem(idx, "end_date", e.target.value)} type="datetime-local" />
                <Field label="End value (USD)" value={it.end_value} onChange={(e) => updateItem(idx, "end_value", e.target.value)} type="number" />
              </div>
              <div>
                <label className="text-[11px] opacity-60 block mb-1" style={{ color: "#FAF7F2" }}>Card photo (front)</label>
                {it.photo_url && (
                  <img src={it.photo_url} alt="Card front" className="w-full rounded mb-2" style={{ maxHeight: 220, objectFit: "contain", backgroundColor: "#FAF7F2" }} />
                )}
                <div className="flex gap-2">
                  <label className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold rounded py-2 cursor-pointer" style={{ border: "1px solid rgba(250,247,242,0.4)", color: "#FAF7F2" }}>
                    {uploadingPhotoIdx === idx ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} />}
                    {uploadingPhotoIdx === idx ? "Uploading…" : it.photo_url ? "Replace photo" : "Upload photo"}
                    <input type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload(idx)} disabled={uploadingPhotoIdx !== null} />
                  </label>
                  {it.photo_url && (
                    <button onClick={() => updateItem(idx, "photo_url", null)} className="text-xs font-semibold rounded px-3" style={{ border: "1px solid #CC0001", color: "#CC0001" }}>
                      Remove
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}

          {!initial && !forOrder && (
            <button onClick={addItem} className="w-full text-xs font-semibold rounded py-2" style={{ border: "1px dashed rgba(250,247,242,0.4)", color: "#FAF7F2" }}>
              + Add another card to this order
            </button>
          )}

          {!isTrimmed && (
            <div className="space-y-3 pt-1">
              {items.length > 1 && (
                <p className="text-[11px] opacity-50" style={{ color: "#FAF7F2" }}>These apply to the whole order, shared across all {items.length} cards above.</p>
              )}
              <div>
                <label className="text-[11px] opacity-60 block mb-1" style={{ color: "#FAF7F2" }}>Status</label>
                <select value={shared.status} onChange={handleStatusChange} className="w-full rounded px-3 py-2 text-sm" style={{ backgroundColor: "#F3EFE3", color: "#1C1B14" }}>
                  <option value="listed">In Auction</option>
                  <option value="offer">Best Offer</option>
                  <option value="sold">Buyer Paid</option>
                  <option value="paid">Payout Done</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Order total (USD)" value={shared.order_total} onChange={(e) => setShared((p) => ({ ...p, order_total: e.target.value }))} type="number" />
                <Field label="Order earnings (USD)" value={shared.order_earnings} onChange={(e) => setShared((p) => ({ ...p, order_earnings: e.target.value }))} type="number" />
              </div>
              <Field label="Shipping (USD)" value={shared.shipping} onChange={(e) => setShared((p) => ({ ...p, shipping: e.target.value }))} type="number" />
              {(shared.status === "sold" || shared.status === "paid") && (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Courier" value={shared.courier} onChange={(e) => setShared((p) => ({ ...p, courier: e.target.value }))} placeholder="e.g. SingPost, Aramex, FedEx" />
                  <Field label="Tracking number" value={shared.tracking_number} onChange={(e) => setShared((p) => ({ ...p, tracking_number: e.target.value }))} placeholder="e.g. RR123456789SG" />
                </div>
              )}
              {(shared.status === "sold" || shared.status === "paid") && (
                <div>
                  <label className="flex items-center gap-2 text-[11px] mb-1.5" style={{ color: "#FAF7F2" }}>
                    <input
                      type="checkbox"
                      checked={!!shared.manual_delivered_at}
                      onChange={(e) => setShared((p) => ({ ...p, manual_delivered_at: e.target.checked ? new Date().toISOString().slice(0, 10) : "" }))}
                    />
                    Mark as delivered manually
                    <span className="opacity-50">— use this if tracking never updates (common for local Singapore deliveries)</span>
                  </label>
                  {shared.manual_delivered_at && (
                    <Field label="Delivery date" value={shared.manual_delivered_at} onChange={(e) => setShared((p) => ({ ...p, manual_delivered_at: e.target.value }))} type="date" />
                  )}
                </div>
              )}
            </div>
          )}
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
   Order editor (owner only) — edits the shared status /
   totals / shipping for a group of cards in one order.
--------------------------------------------------------- */
function OrderEditor({ order, onSaved, onCancel, onDeleted }) {
  const [form, setForm] = useState({
    status: order.status,
    sale_mechanism: order.sale_mechanism ?? null,
    order_total: order.order_total ?? "",
    order_earnings: order.order_earnings ?? "",
    shipping: order.shipping ?? "",
    courier: order.courier || "",
    tracking_number: order.tracking_number || "",
    manual_delivered_at: order.manual_delivered_at || "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  const handleStatusChange = (e) => {
    const newStatus = e.target.value;
    setForm((prev) => ({
      ...prev,
      status: newStatus,
      sale_mechanism: newStatus === "listed" || newStatus === "offer" ? newStatus : prev.sale_mechanism,
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      const payload = {
        status: form.status,
        order_total: form.order_total === "" ? null : form.order_total,
        order_earnings: form.order_earnings === "" ? null : form.order_earnings,
        shipping: form.shipping === "" ? null : form.shipping,
        courier: form.courier || null,
        tracking_number: form.tracking_number || null,
        manual_delivered_at: form.manual_delivered_at || null,
        updated_at: new Date().toISOString(),
      };
      const { error: orderErr } = await supabase.from("orders").update(payload).eq("id", order.id);
      if (orderErr) throw orderErr;
      // Keep each card's own status in sync with the order, so the existing
      // per-card status filter tabs keep working for grouped cards too.
      const { error: cardsErr } = await supabase.from("cards").update({ status: form.status, sale_mechanism: form.sale_mechanism }).eq("order_id", order.id);
      if (cardsErr) throw cardsErr;
      onSaved();
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setSaving(true);
    // Cards cascade-delete automatically (order_id references orders on delete cascade)
    const { error: err } = await supabase.from("orders").delete().eq("id", order.id);
    setSaving(false);
    if (err) { setError(err.message); return; }
    onDeleted();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6" style={{ backgroundColor: "rgba(20,17,16,0.85)" }}>
      <div className="w-full sm:max-w-md rounded-t-xl sm:rounded-xl p-5 overflow-y-auto" style={{ backgroundColor: "#1F1A18", maxHeight: "90vh" }}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold" style={{ color: "#FAF7F2", fontFamily: "'Roboto Slab', serif" }}>Edit order</h3>
          <button onClick={onCancel}><X size={20} color="#FAF7F2" /></button>
        </div>
        <div className="space-y-3">
          <p className="text-[11px] opacity-50" style={{ color: "#FAF7F2" }}>These apply to the whole order — every card in this group shares them.</p>
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
            <Field label="Order total (USD)" value={form.order_total} onChange={(e) => setForm((p) => ({ ...p, order_total: e.target.value }))} type="number" />
            <Field label="Order earnings (USD)" value={form.order_earnings} onChange={(e) => setForm((p) => ({ ...p, order_earnings: e.target.value }))} type="number" />
          </div>
          <Field label="Shipping (USD)" value={form.shipping} onChange={(e) => setForm((p) => ({ ...p, shipping: e.target.value }))} type="number" />
          {(form.status === "sold" || form.status === "paid") && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Courier" value={form.courier} onChange={(e) => setForm((p) => ({ ...p, courier: e.target.value }))} placeholder="e.g. SingPost, Aramex, FedEx" />
              <Field label="Tracking number" value={form.tracking_number} onChange={(e) => setForm((p) => ({ ...p, tracking_number: e.target.value }))} placeholder="e.g. RR123456789SG" />
            </div>
          )}
          {(form.status === "sold" || form.status === "paid") && (
            <div>
              <label className="flex items-center gap-2 text-[11px] mb-1.5" style={{ color: "#FAF7F2" }}>
                <input
                  type="checkbox"
                  checked={!!form.manual_delivered_at}
                  onChange={(e) => setForm((p) => ({ ...p, manual_delivered_at: e.target.checked ? new Date().toISOString().slice(0, 10) : "" }))}
                />
                Mark as delivered manually
                <span className="opacity-50">— use this if tracking never updates (common for local Singapore deliveries)</span>
              </label>
              {form.manual_delivered_at && (
                <Field label="Delivery date" value={form.manual_delivered_at} onChange={(e) => setForm((p) => ({ ...p, manual_delivered_at: e.target.value }))} type="date" />
              )}
            </div>
          )}
        </div>
        {error && <p className="text-[11px] mt-3" style={{ color: "#CC0001" }}>{error}</p>}
        <div className="flex gap-2 mt-5">
          <button onClick={handleDelete} disabled={saving} className="text-sm font-semibold rounded px-4 py-2" style={{ color: "#CC0001", border: "1px solid #CC0001" }}>
            Remove order
          </button>
          <button onClick={handleSave} disabled={saving} className="flex-1 text-sm font-bold rounded px-4 py-2" style={{ backgroundColor: "#CC0001", color: "#FAF7F2" }}>
            {saving ? "Saving…" : "Save order"}
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
  const [editingOrder, setEditingOrder] = useState(null);
  const [addingToOrder, setAddingToOrder] = useState(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newHandle, setNewHandle] = useState("");
  const [addError, setAddError] = useState("");
  const [copiedId, setCopiedId] = useState(null);
  const [fx, setFx] = useState({ rate: 1.29, updatedAt: null });
  const [fxInput, setFxInput] = useState("1.29");
  const [filter, setFilter] = useState("listed");
  const [orders, setOrders] = useState([]);

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

  const refreshCards = async () => {
    if (!selected) { setCards([]); setOrders([]); return; }
    const { data } = await supabase.from("cards").select("*").eq("consignor_id", selected).order("created_at", { ascending: false });
    setCards(data || []);
    const { data: oData } = await supabase.from("orders").select("*").eq("consignor_id", selected).order("created_at", { ascending: false });
    setOrders(oData || []);
  };

  useEffect(() => { refreshCards(); }, [selected, editingCard, editingOrder, addingToOrder]);

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

  const allListings = buildListingList(cards, orders);
  const filteredListings = allListings.filter((x) => x.status === filter);
  const amountOwed = sumTotalEarnings(allListings, ["sold"], fx.rate);
  const amountPaid = sumTotalEarnings(allListings, ["paid"], fx.rate);

  if (loading) return <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "#141110" }}><Loader2 className="animate-spin" color="#CC0001" size={28} /></div>;

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#141110" }}>
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="text-[11px] tracking-[0.25em] opacity-50" style={{ color: "#FAF7F2" }}>OWNER VIEW</div>
            <h1 className="text-2xl font-extrabold" style={{ color: "#FAF7F2", fontFamily: "'Roboto Slab', serif" }}>Sports Collectibles SG</h1>
          </div>
          <button onClick={signOut} className="text-xs underline opacity-60" style={{ color: "#FAF7F2" }}>Sign out</button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[170px_1fr] gap-5">
          <div className="flex flex-col gap-5">
            <div className="rounded-lg p-3" style={{ backgroundColor: "#1F1A18" }}>
              <div className="text-xs opacity-60 mb-2" style={{ color: "#FAF7F2" }}>USD → SGD rate</div>
              <div className="flex items-center gap-2 mb-2">
                <input type="number" step="0.01" value={fxInput} onChange={(e) => setFxInput(e.target.value)} className="w-16 rounded px-2 py-1 text-sm" style={{ backgroundColor: "#F3EFE3", color: "#1C1B14" }} />
                <button onClick={updateFxRate} className="text-xs font-semibold rounded px-2 py-1.5 flex-1" style={{ backgroundColor: "#CC0001", color: "#FAF7F2" }}>Update</button>
              </div>
              <div className="text-[10px] opacity-40" style={{ color: "#FAF7F2" }}>set {timeAgo(fx.updatedAt)} · auto-refreshes daily on open</div>
            </div>

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
                  <input value={newHandle} onChange={(e) => setNewHandle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addConsignor()} placeholder="telegram_username" className="w-full rounded px-2 py-1 text-sm" style={{ backgroundColor: "#F3EFE3", color: "#1C1B14", fontFamily: "'JetBrains Mono', monospace" }} />
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
                    <div className="text-[10px] opacity-40" style={{ color: "#FAF7F2", fontFamily: "'JetBrains Mono', monospace" }}>@{c.telegram_username}</div>
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
                <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
                  <div className="flex gap-2 flex-wrap">
                    {FILTER_TABS.map((f) => (
                      <button key={f.key} onClick={() => setFilter(f.key)} className="text-xs font-semibold rounded-full px-3 py-1.5"
                        style={{ backgroundColor: filter === f.key ? "#CC0001" : "transparent", color: "#FAF7F2", border: filter === f.key ? "none" : "1px solid rgba(250,247,242,0.25)" }}>
                        {f.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <div className="flex items-center gap-2 rounded-lg px-3 py-1.5" style={{ backgroundColor: "#1F1A18" }}>
                      <span className="text-[10px] opacity-60 whitespace-nowrap" style={{ color: "#FAF7F2" }}>Amount Owed</span>
                      <span className="text-sm font-bold whitespace-nowrap" style={{ color: "#3FA34D", fontFamily: "'Roboto Slab', serif" }}>{fmtSGD(amountOwed)}</span>
                    </div>
                    <div className="flex items-center gap-2 rounded-lg px-3 py-1.5" style={{ backgroundColor: "#1F1A18" }}>
                      <span className="text-[10px] opacity-60 whitespace-nowrap" style={{ color: "#FAF7F2" }}>Amount Paid</span>
                      <span className="text-sm font-bold whitespace-nowrap" style={{ color: "#3FA34D", fontFamily: "'Roboto Slab', serif" }}>{fmtSGD(amountPaid)}</span>
                    </div>
                  </div>
                </div>
                {filteredListings.length === 0 ? (
                  <div className="rounded-lg p-8 text-center text-sm opacity-50" style={{ backgroundColor: "#1F1A18", color: "#FAF7F2" }}>Nothing here yet.</div>
                ) : (
                  <div className="flex flex-col gap-4">
                    {filteredListings.map((x) =>
                      x.type === "single" ? (
                        <CardSlab key={x.key} card={x.card} fxRate={fx.rate} editable onEdit={(c) => setEditingCard(c)} onRefresh={refreshCards} />
                      ) : (
                        <OrderSlab
                          key={x.key}
                          order={x.order}
                          items={x.items}
                          fxRate={fx.rate}
                          editable
                          onEditOrder={(o) => setEditingOrder(o)}
                          onEditItem={(c) => setEditingCard(c)}
                          onAddItem={(o) => setAddingToOrder(o)}
                          onRefresh={refreshCards}
                        />
                      )
                    )}
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

      {addingToOrder !== null && (
        <CardEditor
          initial={null}
          forOrder={addingToOrder}
          consignorId={selected}
          onSaved={() => setAddingToOrder(null)}
          onCancel={() => setAddingToOrder(null)}
          onDeleted={() => setAddingToOrder(null)}
        />
      )}

      {editingOrder !== null && (
        <OrderEditor
          order={editingOrder}
          onSaved={() => setEditingOrder(null)}
          onCancel={() => setEditingOrder(null)}
          onDeleted={() => setEditingOrder(null)}
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
  const [orders, setOrders] = useState([]);
  const [fxRate, setFxRate] = useState(1.29);
  const [filter, setFilter] = useState("listed");

  useEffect(() => {
    (async () => {
      const { data: c } = await supabase.from("consignors").select("*").eq("telegram_username", username).maybeSingle();
      setConsignor(c || null);
      if (c) {
        const { data: cardsData } = await supabase.from("cards").select("*").eq("consignor_id", c.id).order("created_at", { ascending: false });
        setCards(cardsData || []);
        const { data: ordersData } = await supabase.from("orders").select("*").eq("consignor_id", c.id).order("created_at", { ascending: false });
        setOrders(ordersData || []);
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

  const allListings = buildListingList(cards, orders);
  const filtered = allListings.filter((x) => x.status === filter);
  const amountOwed = sumTotalEarnings(allListings, ["sold"], fxRate);
  const amountPaid = sumTotalEarnings(allListings, ["paid"], fxRate);

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#141110" }}>
      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="text-[11px] tracking-[0.25em] opacity-50 mb-1" style={{ color: "#FAF7F2" }}>SPORTS COLLECTIBLES SG</div>
        <h1 className="text-3xl font-extrabold mb-1" style={{ color: "#CC0001", fontFamily: "'Roboto Slab', serif" }}>{consignor.name}'s cards</h1>
        <p className="text-xs opacity-50 mb-5" style={{ color: "#FAF7F2" }}>Telegram @{consignor.telegram_username}</p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
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
          <div className="rounded-lg p-3 text-center" style={{ backgroundColor: "#1F1A18" }}>
            <div className="text-[10px] tracking-widest opacity-50 mb-1" style={{ color: "#FAF7F2" }}>AMOUNT OWED</div>
            <div className="text-lg font-bold" style={{ color: "#3FA34D", fontFamily: "'Roboto Slab', serif" }}>{fmtSGD(amountOwed)}</div>
          </div>
          <div className="rounded-lg p-3 text-center" style={{ backgroundColor: "#1F1A18" }}>
            <div className="text-[10px] tracking-widest opacity-50 mb-1" style={{ color: "#FAF7F2" }}>AMOUNT PAID</div>
            <div className="text-lg font-bold" style={{ color: "#3FA34D", fontFamily: "'Roboto Slab', serif" }}>{fmtSGD(amountPaid)}</div>
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
          <div className="flex flex-col gap-4">
            {filtered.map((x) =>
              x.type === "single" ? (
                <CardSlab key={x.key} card={x.card} fxRate={fxRate} editable={false} />
              ) : (
                <OrderSlab key={x.key} order={x.order} items={x.items} fxRate={fxRate} editable={false} />
              )
            )}
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
